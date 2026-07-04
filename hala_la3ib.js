// hala_la3ib.js
// فحوصات حالة اللاعب عند كل رسالة: إشعار موت، حالة إنعاش، إشعار قتل ناجح،
// إشعار ترقية معلّق، وترقية النشاط المتتالي (streak)
const config = require('./config.json');
const { sendReply } = require('./utils');
const { updatePlayer } = require('./database');
const fs = require('fs');
const path = require('path');

// يفحص حالات الموت/الإنعاش/القتل الناجح للاعب
// يرجع true إذا تم إرسال رد ولازم الراوتر الرئيسي يعمل return فوراً
// isPrivileged: عند true (أدمن نظام / الامبراطور / نائب الامبراطور) يتم تجاوز حظر الإنعاش بالكامل
async function checkDeathRecoveryKill(api, event, player, isPrivileged) {
  const { threadID, senderID } = event;
  if (!player) return false;

  const now = Date.now();

  if (player.deathPendingNotify) {
    const notify = player.deathPendingNotify;
    const deathAlertMsg =
      `💀 ⟦ تـم قـتـلـك! ⟧ 💀\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `⚔️ تم قتلك من قبل اللاعب : ${notify.attackerName}\n` +
      `🗡️ بسلاح : ${notify.weaponName}\n\n` +
      `🎒 فقدت كل ممتلكات حقيبتك وكوينزك!\n` +
      `⏳ ستبقى في الانعاش لمدة ساعتين.`;

    await sendReply(api, deathAlertMsg, event.messageID, threadID);
    await updatePlayer(String(senderID), { deathPendingNotify: null });
    return true;
  }

  if (player.recoveryUntil) {
    const recoveryTime = new Date(player.recoveryUntil).getTime();
    if (now < recoveryTime) {
      // الإدارة (أدمن النظام / الامبراطور / نائب الامبراطور) معفيون من حظر الإنعاش
      // ويمكنهم استخدام لوحة التحكم وكل أوامرها بشكل طبيعي حتى لو كانوا بحالة إنعاش
      if (isPrivileged) {
        return false;
      }

      if (!player.recoveryNotified) {
        const diffMs = recoveryTime - now;
        const diffMins = Math.floor(diffMs / 60000);
        const hours = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        const timeRemainingStr = hours > 0 ? `${hours} ساعة و ${mins} دقيقة` : `${mins} دقيقة`;

        await sendReply(api, `⚠️ انت في الإنعاش انتظر : ${timeRemainingStr}`, event.messageID, threadID);
        await updatePlayer(String(senderID), { recoveryNotified: true });
      }
      return true;
    } else {
      await updatePlayer(String(senderID), {
        hp: 1000,
        ep: 1000,
        recoveryUntil: null,
        recoveryNotified: false
      });

      // إزالة إيموجي الإنعاش 🏥 من الكنية وإرجاعها لشكلها الطبيعي
      try {
        const { changePlayerNickname } = require('./dukhul');
        const groupId = config.groupes[player.kingdom];
        if (groupId) {
          await changePlayerNickname(
            api, groupId, senderID, player.nickname,
            player.rank || 'مجند', player.class, player.warnings || 0
          );
        }
      } catch (e) {
        console.error('[Hala La3ib] Error restoring nickname after recovery:', e);
      }

      await sendReply(api, `✅️ انتهت مدة الإنعاش، يمكنك استعمال البوت مجدداً.`, event.messageID, threadID);
      return true;
    }
  }

  if (player.killPendingNotify) {
    const notify = player.killPendingNotify;
    const killAlertMsg =
      `☠️ ⟦ إشـعـار قـتـل نـاجـح ⟧ ☠️\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `لقد قتلت اللاعب [ ${notify.victimName} ] وحصلت على صندوق أسود.\n` +
      `📦 لفتحه اكتب : 《 استعمال الصندوق الاسود 》`;

    await sendReply(api, killAlertMsg, event.messageID, threadID);
    await updatePlayer(String(senderID), { killPendingNotify: null });
    // ملاحظة: السلوك الأصلي لا يعمل return هنا (لا يوقف تنفيذ بقية الراوتر)
  }

  return false;
}

// يرسل إشعار الترقية المعلّق (مع صورة إن وجدت)
async function notifyPendingPromotion(api, event, player) {
  const { threadID, senderID } = event;
  if (!player || !player.pendingPromotionNotify) return;

  const notifyInfo = player.pendingPromotionNotify;

  const arabKhiafy = '\u061C';
  const congratsMsg =
    `${arabKhiafy}╗═════ 🎖️ ترقية 🎖️ ═════╔\n\n` +
    `مبروك!\n\n` +
    `يسرّنا إبلاغك بأنه تمّت ترقيتك إلى رتبة:\n\n` +
    `⭐ ${notifyInfo.newRank} ⭐\n\n` +
    `نتمنى لك المزيد من النجاح والتقدّم.\n\n` +
    `╝══════════════════╚`;

  await sendReply(api, congratsMsg, event.messageID, threadID);

  const imageJpgPath = path.join(__dirname, 'promotion.jpg');
  const imagePngPath = path.join(__dirname, 'promotion.png');
  let imagePathToSend = null;

  if (fs.existsSync(imageJpgPath)) {
    imagePathToSend = imageJpgPath;
  } else if (fs.existsSync(imagePngPath)) {
    imagePathToSend = imagePngPath;
  }

  if (imagePathToSend) {
    try {
      await new Promise((resolve, reject) => {
        api.sendMessage({
          body: '',
          attachment: fs.createReadStream(imagePathToSend)
        }, threadID, (err, info) => {
          if (err) return reject(err);
          resolve(info);
        });
      });
    } catch (err) {
      console.error('[Ranks] Error sending promotion image:', err);
    }
  }

  await updatePlayer(senderID, { pendingPromotionNotify: null });
}

// يحسب نشاط اللاعب المتتالي (streak) ويرقّيه تلقائياً عند الوصول لـ 7 أيام
async function checkActiveStreakPromotion(api, event, player, isKingdomOrCity) {
  const { senderID } = event;
  if (!player || !isKingdomOrCity || !['مخضرم', 'حارس'].includes(player.rank)) return;

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const lastActive = player.lastActiveDay || '';
  let streak = player.consecutiveActiveDays || 0;

  if (lastActive === yesterdayStr) {
    streak += 1;
    await updatePlayer(senderID, { lastActiveDay: todayStr, consecutiveActiveDays: streak });
  } else if (lastActive !== todayStr) {
    streak = 1;
    await updatePlayer(senderID, { lastActiveDay: todayStr, consecutiveActiveDays: streak });
  }

  if (streak >= 7) {
    await updatePlayer(senderID, {
      rank: 'محارب',
      pendingPromotionNotify: { oldRank: player.rank, newRank: 'محارب' },
      consecutiveActiveDays: 0
    });

    const { changePlayerNickname } = require('./dukhul');
    const groupId = config.groupes[player.kingdom];
    if (groupId) {
      try {
        await changePlayerNickname(api, groupId, senderID, player.nickname, 'محارب', player.class);
      } catch (e) {
        console.error('[Router] Error changing nickname on active promotion to warrior:', e);
      }
    }
  }
}

// ─── تيك دوري لنظام الإنعاش ───
// 1. يصفّي تلقائياً أي لاعب انتهت مدة إنعاشه حتى لو لم يرسل أي رسالة بنفسه.
// 2. يعيد فرض إيموجي الإنعاش 🏥 على كل لاعب لا يزال بحالة إنعاش نشطة،
//    احتياطاً من أي حذف أو تعديل يدوي للكنية من داخل القروب.
async function tickRecoverySystem(api) {
  try {
    const db = require('./database').getDB();
    const now = Date.now();

    const recoveringPlayers = await db.collection('players').find({
      recoveryUntil: { $ne: null }
    }).toArray();

    if (recoveringPlayers.length === 0) return;

    const { changePlayerNickname } = require('./dukhul');

    for (const player of recoveringPlayers) {
      const recoveryTime = new Date(player.recoveryUntil).getTime();
      const groupId = config.groupes[player.kingdom];

      if (now >= recoveryTime) {
        // ─── انتهت مدة الإنعاش: تصفية الحالة وإرجاع الكنية الطبيعية ───
        await updatePlayer(player.fbId, {
          hp: 1000,
          ep: 1000,
          recoveryUntil: null,
          recoveryNotified: false
        });

        if (groupId) {
          try {
            await changePlayerNickname(
              api, groupId, player.fbId, player.nickname,
              player.rank || 'مجند', player.class, player.warnings || 0
            );
          } catch (e) {
            console.error('[Recovery Tick] خطأ أثناء إرجاع الكنية الطبيعية:', e.message);
          }
        }

        try {
          const { addNotification } = require('./database');
          await addNotification(player.fbId, `✅️ انتهت مدة الإنعاش، يمكنك استعمال البوت مجدداً.`);
        } catch (e) {}

      } else if (groupId) {
        // ─── لسا بالإنعاش: إعادة فرض 🏥 احتياطاً من حذفها يدوياً ───
        try {
          await changePlayerNickname(
            api, groupId, player.fbId, player.nickname,
            player.rank || 'مجند', player.class, player.warnings || 0, '🏥'
          );
        } catch (e) {
          console.error('[Recovery Tick] خطأ أثناء إعادة فرض إيموجي الإنعاش:', e.message);
        }
      }
    }
  } catch (e) {
    console.error('[Recovery Tick] خطأ عام في tickRecoverySystem:', e.message);
  }
}

module.exports = {
  checkDeathRecoveryKill,
  notifyPendingPromotion,
  checkActiveStreakPromotion,
  tickRecoverySystem
};
