/*
 * ═══════════════════════════════════════════════════════════════════════
 *  Mosaba9at.js — نظام مسابقات النشر والدعوات
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const { getDB, addNotification, updatePlayer, getPlayer, addXP } = require('./database');
const { sendReply } = require('./utils');

// مدة المسابقة: يومين (48 ساعة بالملي ثانية)
const COMPETITION_DURATION = 48 * 60 * 60 * 1000;

// جوائز المراتب الثلاثة الأولى
const PRIZES = [500, 450, 400];
const RANK_NAMES = ['الأولى', 'الثانية', 'الثالثة'];

/**
 * تهيئة نظام المسابقات عند بدء تشغيل البوت.
 */
async function initCompetitions(api) {
  try {
    const db = getDB();
    let config = await db.collection('competition_config').findOne({ _id: 'global' });

    const now = new Date();

    if (!config) {
      const startTime = now;
      const endTime = new Date(now.getTime() + COMPETITION_DURATION);
      config = { _id: 'global', startTime, endTime };
      await db.collection('competition_config').insertOne(config);
    }

    const endTime = new Date(config.endTime);
    const diff = endTime.getTime() - now.getTime();

    if (diff <= 0) {
      await distributeRewardsAndReset(api);
    } else {
      setTimeout(async () => {
        await distributeRewardsAndReset(api);
      }, diff);
      console.log(`[Competition] تم جدولة انتهاء المسابقة بعد ${Math.floor(diff / 1000 / 60)} دقيقة.`);
    }
  } catch (err) {
    console.error('[Competition] خطأ في تهيئة المسابقات:', err);
  }
}

/**
 * توزيع الجوائز على الثلاثة الأوائل في كل مسابقة، مع منح 40 XP لكل فائز.
 */
async function distributeRewardsAndReset(api) {
  try {
    const db = getDB();

    console.log('[Competition] جاري معالجة انتهاء المسابقة وتوزيع الجوائز...');

    // 1. توزيع جوائز ومكافآت مسابقة النشر
    const nashrEntries = await db.collection('competition_nashr_entries')
      .find({})
      .sort({ coins: -1 })
      .toArray();

    for (let i = 0; i < Math.min(3, nashrEntries.length); i++) {
      const entry = nashrEntries[i];
      const prize = PRIZES[i];
      const rankName = RANK_NAMES[i];
      const player = await getPlayer(entry.fbId);

      if (player) {
        const newCoins = (player.coins || 0) + prize;
        await updatePlayer(entry.fbId, { coins: newCoins });
        
        // 🆙 منح 40 XP للفائزين في مسابقة النشر
        await addXP(entry.fbId, 40, api, null).catch(() => {});

        await addNotification(entry.fbId, 
          `⦿ لقد فزت بالمرتبة 〘 ${rankName} 〙 في مسابقة كوينز النشر! 🎉\n` +
          `تمت إضافة الجائزة ⛁ ◀ ${prize} كوينز إلى حسابك.`
        );
      }
    }

    // 2. توزيع جوائز ومكافآت مسابقة الدعوات
    const da3waEntries = await db.collection('competition_da3wa_entries')
      .find({})
      .sort({ count: -1 })
      .toArray();

    for (let i = 0; i < Math.min(3, da3waEntries.length); i++) {
      const entry = da3waEntries[i];
      const prize = PRIZES[i];
      const rankName = RANK_NAMES[i];
      const player = await getPlayer(entry.fbId);

      if (player) {
        const newCoins = (player.coins || 0) + prize;
        await updatePlayer(entry.fbId, { coins: newCoins });

        // 🆙 منح 40 XP للفائزين في مسابقة الدعوات
        await addXP(entry.fbId, 40, api, null).catch(() => {});

        await addNotification(entry.fbId, 
          `⦿ لقد فزت بالمرتبة 〘 ${rankName} 〙 في مسابقة الدعوات! 🎉\n` +
          `تمت إضافة الجائزة ⛁ ◀ ${prize} كوينز إلى حسابك.`
        );
      }
    }

    // 3. مسح المدخلات الحالية للمسابقات المنتهية
    await db.collection('competition_nashr_entries').deleteMany({});
    await db.collection('competition_da3wa_entries').deleteMany({});

    // 4. تعيين وقت المسابقة الجديدة في قاعدة البيانات
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + COMPETITION_DURATION);

    await db.collection('competition_config').updateOne(
      { _id: 'global' },
      { $set: { startTime, endTime } },
      { upsert: true }
    );

    // 5. إعادة جدولة المؤقت للدورة القادمة
    setTimeout(async () => {
      await distributeRewardsAndReset(api);
    }, COMPETITION_DURATION);

    console.log('[Competition] تم توزيع الجوائز وبدء دورة مسابقات جديدة بنجاح.');
  } catch (err) {
    console.error('[Competition] خطأ أثناء توزيع الجوائز وإعادة التعيين:', err);
  }
}

/**
 * تسجيل كوينز النشر المكتسبة في المسابقة الحالية
 */
async function recordNashrCoins(fbId, coins, nickname) {
  try {
    const db = getDB();
    await db.collection('competition_nashr_entries').updateOne(
      { fbId: String(fbId) },
      { 
        $inc: { coins: Number(coins) },
        $set: { nickname }
      },
      { upsert: true }
    );
  } catch (err) {
    console.error('[Competition] خطأ في تسجيل كوينز النشر بالمسابقة:', err);
  }
}

/**
 * تسجيل نقطة دعوة جديدة في المسابقة الحالية للداعي
 */
async function recordDa3wa(inviterFbId, inviterNickname) {
  try {
    const db = getDB();
    await db.collection('competition_da3wa_entries').updateOne(
      { fbId: String(inviterFbId) },
      { 
        $inc: { count: 1 },
        $set: { nickname: inviterNickname }
      },
      { upsert: true }
    );
  } catch (err) {
    console.error('[Competition] خطأ في تسجيل دعوة بالمسابقة:', err);
  }
}

/**
 * عرض معلومات مسابقة النشر الحالية وقائمة المتصدرين
 */
async function handleNashrCompetition(api, event) {
  const { threadID, senderID, messageID } = event;
  try {
    const db = getDB();
    const config = await db.collection('competition_config').findOne({ _id: 'global' });
    if (!config) return;

    const diff = new Date(config.endTime).getTime() - Date.now();
    const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    const hours = Math.max(0, Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
    const minutes = Math.max(0, Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)));

    const entries = await db.collection('competition_nashr_entries')
      .find({})
      .sort({ coins: -1 })
      .toArray();

    let leadersStr = '';
    if (entries.length === 0) {
      leadersStr = '│ › لا يوجد مشاركون بعد \n';
    } else {
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      for (let i = 0; i < Math.min(5, entries.length); i++) {
        const entry = entries[i];
        const medal = medals[i] || `${i + 1}.`;
        leadersStr += `│ ${medal} ${entry.nickname}  —  ${entry.coins} 🪙\n`;
      }
    }

    // تحديد ترتيب اللاعب الحالي
    let userRankStr = '🚷';
    let userCoins = 0;
    const userIndex = entries.findIndex(e => e.fbId === String(senderID));
    if (userIndex !== -1) {
      userRankStr = String(userIndex + 1);
      userCoins = entries[userIndex].coins;
    }

    const msg = 
      `🏆────────────────🏆\n` +
      `        ✦  مسابقة كوينز النشر  ✦\n` +
      `🏆────────────────🏆\n\n` +
      `╮───∙⋆⋅「 القواعد 📜 」\n` +
      `│\n` +
      `│ ›  ◍ لتشارك كل ماعليك فعله هو \n` +
      `│ان تربح اكبر قدر ممكن من \n` +
      `│الكوينز من خلال نشر المنشورات \n` +
      `│ في مدة المسابقة بميزة كوينز النشر\n` +
      `│›  ◍  تتجدد المسابقة كل يومين\n` +
      `│›  ◍ الثلاثة الاوائل فقط من يكافؤون\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
      `╮───∙⋆⋅「 الجوائز 🎁 」\n` +
      `│\n` +
      `│ 🥇 المرتبة الأولى  —  500 🪙\n` +
      `│ 🥈 المرتبة الثانية —  450 🪙\n` +
      `│ 🥉 المرتبة الثالثة —  400 🪙\n` +
      `│\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
      `╮───∙⋆⋅「 الوقت المتبقي ⏰ 」\n` +
      `│\n` +
      `│ › ${days} يوم و ${hours} ساعة و ${minutes} دقيقة\n` +
      `│\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
      `╮───∙⋆⋅「 المتصدرون 👑 」\n` +
      `│\n` +
      `${leadersStr}` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙\n` +
      `👤 ترتيبك: ${userRankStr} (ربحت: ${userCoins} 🪙)`;

    await sendReply(api, msg, messageID, threadID);
  } catch (err) {
    console.error('[Competition] خطأ في عرض مسابقة النشر:', err);
  }
}

/**
 * عرض معلومات مسابقة الدعوات الحالية وقائمة المتصدرين
 */
async function handleDa3waCompetition(api, event) {
  const { threadID, senderID, messageID } = event;
  try {
    const db = getDB();
    const config = await db.collection('competition_config').findOne({ _id: 'global' });
    if (!config) return;

    const diff = new Date(config.endTime).getTime() - Date.now();
    const days = Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
    const hours = Math.max(0, Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));
    const minutes = Math.max(0, Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)));

    const entries = await db.collection('competition_da3wa_entries')
      .find({})
      .sort({ count: -1 })
      .toArray();

    let leadersStr = '';
    if (entries.length === 0) {
      leadersStr = '│ › لا يوجد مشاركون بعد \n';
    } else {
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      for (let i = 0; i < Math.min(5, entries.length); i++) {
        const entry = entries[i];
        const medal = medals[i] || `${i + 1}.`;
        leadersStr += `│ ${medal} ${entry.nickname}  —  ${entry.count} دعوات 👤\n`;
      }
    }

    // تحديد ترتيب اللاعب الحالي
    let userRankStr = '🚷';
    let userCount = 0;
    const userIndex = entries.findIndex(e => e.fbId === String(senderID));
    if (userIndex !== -1) {
      userRankStr = String(userIndex + 1);
      userCount = entries[userIndex].count;
    }

    const msg = 
      `🏆────────────────🏆\n` +
      `        ✦  مسابقة الدعوات  ✦\n` +
      `🏆────────────────🏆\n\n` +
      `╮───∙⋆⋅「 القواعد 📜 」\n` +
      `│\n` +
      `│ ›  ◍ لتشارك كل ماعليك فعله هو \n` +
      `│ان تدعو اكبر قدر ممكن من \n` +
      `│الاعضاء في مدة المسابقة \n` +
      `│›  ◍  تتجدد المسابقة كل يومين\n` +
      `│›  ◍ الثلاثة الاوائل فقط من يكافؤون\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
      `╮───∙⋆⋅「 الجوائز 🎁 」\n` +
      `│\n` +
      `│ 🥇 المرتبة الأولى  —  500 🪙\n` +
      `│ 🥈 المرتبة الثانية —  450 🪙\n` +
      `│ 🥉 المرتبة الثالثة —  400 🪙\n` +
      `│\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
      `╮───∙⋆⋅「 الوقت المتبقي ⏰ 」\n` +
      `│\n` +
      `│ › ${days} يوم و ${hours} ساعة و ${minutes} دقيقة\n` +
      `│\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
      `╮───∙⋆⋅「 المتصدرون 👑 」\n` +
      `│\n` +
      `${leadersStr}` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙\n` +
      `👤 ترتيبك: ${userRankStr} (دعوت: ${userCount} 👤)`;

    await sendReply(api, msg, messageID, threadID);
  } catch (err) {
    console.error('[Competition] خطأ في عرض مسابقة الدعوات:', err);
  }
}

module.exports = {
  initCompetitions,
  recordNashrCoins,
  recordDa3wa,
  handleNashrCompetition,
  handleDa3waCompetition
};