// admin_modules/ignore_system.js — نظام تجاهل اللاعبين ووضع الصمت الجماعي بالقروبات

const config = require('../config.json');
const { sendReply, buildOfficialNickname } = require('../utils');
const { isAdmin } = require('./auth');
const { getPlayer, updatePlayer, setAdminSession } = require('../database');

// كاش لتسجيل فحص عناوين المجموعات لتجنب استدعاء API بشكل متكرر
global.lastMuteTitleCheck = global.lastMuteTitleCheck || {};

// تهيئة مجموعات الصمت من قاعدة البيانات عند الحاجة
async function initMutedGroups() {
  if (global.mutedGroupsLoaded) return;
  global.mutedGroups = global.mutedGroups || {};
  try {
    const db = require('../database').getDB();
    const list = await db.collection('muted_groups').find({}).toArray();
    for (const item of list) {
      global.mutedGroups[String(item.threadId)] = true;
    }
    global.mutedGroupsLoaded = true;
  } catch (e) {
    console.error('[Muted Groups Init] Error:', e);
  }
}

// دالة التحقق من صلاحية تطبيق عقوبة التجاهل
async function isAuthorizedForIgnore(senderID) {
  if (isAdmin(senderID)) return true;
  const player = await getPlayer(senderID);
  if (player && (player.rank === 'الامبراطور' || player.rank === 'نائب الامبراطور')) {
    return true;
  }
  return false;
}

// دالة مساعدة لحل هوية اللاعب المستهدف من الاسم أو اللقب أو الأيدي أو الرابط
async function resolveTargetPlayer(target) {
  if (!target) return null;
  const db = require('../database').getDB();
  let player = null;

  // 1. الأيدي المباشر
  if (/^\d+$/.test(target)) {
    player = await db.collection('players').findOne({ fbId: target });
  }

  // 2. الرابط المباشر
  if (!player && (target.includes('facebook.com') || target.includes('fb.com'))) {
    const idMatch = target.match(/(?:profile\.php\?id=)?(\d+)/);
    const extractedId = idMatch ? idMatch[1] : null;
    if (extractedId) {
      player = await db.collection('players').findOne({ fbId: extractedId });
    }
    if (!player) {
      player = await db.collection('players').findOne({ link: target });
    }
  }

  // 3. البحث بالكنية أو الاسم
  if (!player) {
    player = await db.collection('players').findOne({
      $or: [
        { name: { $regex: new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } },
        { nickname: { $regex: new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } }
      ]
    });
  }

  return player;
}

// دالة تنظيف التلقائي للمتجاهلين المنتهية فتراتهم وإعادة كنياتهم الطبيعية
async function checkAndCleanExpiredIgnores(api) {
  try {
    const db = require('../database').getDB();
    const now = new Date();
    const expired = await db.collection('ignored_players').find({ until: { $lt: now } }).toArray();
    for (const exp of expired) {
      // حذف سجل التجاهل أولاً حتى تُبنى الكنية الرسمية بدون 🔇
      await db.collection('ignored_players').deleteOne({ fbId: exp.fbId });
      const victimPlayer = await getPlayer(exp.fbId);
      if (victimPlayer) {
        const victimGroupId = config.groupes[victimPlayer.kingdom];
        if (victimGroupId) {
          try {
            const officialNick = await buildOfficialNickname(exp.fbId);
            await new Promise(resolve => api.changeNickname(officialNick, victimGroupId, exp.fbId, () => resolve()));
          } catch (e) {}
        }
      }
    }
  } catch (e) {
    console.error('[Expired Ignores Cleanup] Error:', e);
  }
}

// دالة فحص وتطبيق عقوبات وضع الصمت النشط بالقروب
async function checkMutedGroupMessage(api, event) {
  const { threadID, senderID, messageID } = event;
  if (!threadID || !senderID) return false;

  await initMutedGroups();

  global.mutedGroups = global.mutedGroups || {};
  if (!global.mutedGroups[String(threadID)]) return false;

  const player = await getPlayer(senderID);

  // الاستثناء: يسمح فقط للإمبراطور ومطور النظام الأعلى بالكلام أثناء وضع الصمت
  const isEmp = player && player.rank === 'الامبراطور';
  const isSysAdmin = isAdmin(senderID);

  if (isEmp || isSysAdmin) {
    return false;
  }

  // آلية الاستشفاء الذاتي لإيموجي الصمت 🔇 في عنوان المجموعة (تفحص كل 15 ثانية كحد أقصى تلافياً لحظر الـ API)
  const nowTime = Date.now();
  if (!global.lastMuteTitleCheck[String(threadID)] || nowTime - global.lastMuteTitleCheck[String(threadID)] > 15000) {
    global.lastMuteTitleCheck[String(threadID)] = nowTime;
    try {
      api.getThreadInfo(threadID, (err, info) => {
        if (!err && info) {
          const currentTitle = info.threadName || '';
          if (!currentTitle.includes('🔇')) {
            api.setTitle(`${currentTitle} 🔇`.trim(), threadID);
          }
        }
      });
    } catch (titleErr) {}
  }

  // 1. العضو غير المسجل -> حذف الرسالة وطرد فوري
  if (!player) {
    try {
      api.unsendMessage(messageID, () => {});
      api.removeUserFromGroup(senderID, threadID, (err) => {
        if (err) console.error('[Mute Kick] Failed to kick unregistered user:', err);
      });
    } catch (e) {}
    return true;
  }

  // 2. اللاعب المسجل -> حذف الرسالة فوراً ومنحه إنذاراً تلقائياً
  try {
    api.unsendMessage(messageID, () => {});
  } catch (e) {}

  const currentWarnings = (player.warnings || 0) + 1;
  await updatePlayer(senderID, { warnings: currentWarnings });

  // تعديل الكنية في قروب المملكة لتظهر الإنذارات بالدوائر الحمراء
  const gid = config.groupes[player.kingdom];
  if (gid) {
    const { changePlayerNickname } = require('../dukhul');
    try {
      await changePlayerNickname(api, gid, senderID, player.nickname, player.rank || 'مجند', player.class, currentWarnings);
    } catch (nickErr) {}
  }

  const warnMsg = `⚠️ وضع الصمت نشط!\nاللاعب [${player.nickname}]، تم تسجيل إنذار ضدك وحذف رسالتك تلقائياً.\nالإنذارات الحالية: ${'🔴'.repeat(currentWarnings)}`;
  api.sendMessage({ body: warnMsg }, threadID);

  return true;
}

// اعتراض التغيير اليدوي لاسم المجموعة لإعادة الإيموجي فوراً إذا كانت المجموعة في وضع الصمت
async function handleThreadNameChange(api, event) {
  const { threadID, logMessageType, logMessageData } = event;
  if (logMessageType === 'log:thread-name') {
    await initMutedGroups();
    global.mutedGroups = global.mutedGroups || {};
    if (global.mutedGroups[String(threadID)]) {
      const newName = (logMessageData && logMessageData.name) || '';
      if (!newName.includes('🔇')) {
        try {
          api.setTitle(`${newName} 🔇`.trim(), threadID);
        } catch (e) {
          console.error('[Mute Title Auto-Restore] Failed to restore title:', e);
        }
      }
    }
  }
}

// دالة تفعيل تجاهل اللاعب بإدخال الدقائق
async function executeIgnoreCommand(api, event, operatorId, targetID) {
  const targetPlayer = await getPlayer(targetID);
  const operatorPlayer = await getPlayer(operatorId);
  const isOperatorAdminOrEmp = isAdmin(operatorId) || (operatorPlayer && operatorPlayer.rank === 'الامبراطور');

  // حماية الإدارة العليا: نائب الإمبراطور لا يمكنه معاقبة الإمبراطور أو أدمن مسجل
  const targetIsAdminOrEmp = isAdmin(targetID) || (targetPlayer && targetPlayer.rank === 'الامبراطور');
  if (targetIsAdminOrEmp && !isOperatorAdminOrEmp) {
    await sendReply(api, `❌ خطأ: لا يمكنك تطبيق عقوبة التجاهل على الإمبراطور أو المشرفين.`, event.messageID, event.threadID);
    return true;
  }

  await setAdminSession(operatorId, {
    state: 'AWAITING_IGNORE_DURATION',
    targetPlayerId: targetID,
    threadID: event.threadID
  });

  await sendReply(api, `يرجى تحديد وقت التجاهل بالدقائق:`, event.messageID, event.threadID);
  return true;
}

// دالة فك تجاهل اللاعب يدوياً
async function executeUnignoreCommand(api, event, operatorId, targetID) {
  const db = require('../database').getDB();
  const targetPlayer = await getPlayer(targetID);
  const operatorPlayer = await getPlayer(operatorId);
  const isOperatorAdminOrEmp = isAdmin(operatorId) || (operatorPlayer && operatorPlayer.rank === 'الامبراطور');

  // حماية الإدارة العليا
  const targetIsAdminOrEmp = isAdmin(targetID) || (targetPlayer && targetPlayer.rank === 'الامبراطور');
  if (targetIsAdminOrEmp && !isOperatorAdminOrEmp) {
    await sendReply(api, `❌ خطأ: لا يمكنك فك التجاهل عن الإمبراطور أو المشرفين.`, event.messageID, event.threadID);
    return true;
  }

  const victimNick = targetPlayer ? targetPlayer.nickname : targetID;
  const exists = await db.collection('ignored_players').findOne({ fbId: targetID });
  if (!exists) {
    await sendReply(api, `⚠️ اللاعب [${victimNick}] ليس متجاهلاً حالياً.`, event.messageID, event.threadID);
    return true;
  }

  await db.collection('ignored_players').deleteOne({ fbId: targetID });

  // إرجاع كنيته الرسمية الكاملة (رتبة + فئة + إنذارات) وحذف إيموجي الكتم 🔇
  if (targetPlayer) {
    const victimGroupId = config.groupes[targetPlayer.kingdom];
    if (victimGroupId) {
      try {
        const officialNick = await buildOfficialNickname(targetID);
        await new Promise(resolve => api.changeNickname(officialNick, victimGroupId, targetID, () => resolve()));
      } catch (e) {}
    }
  }

  await sendReply(api, `╮───∙⋆⋅「 فك التجاهل 」\n│\n│ › ✅ تم فك التجاهل عن اللاعب [${victimNick}] بنجاح.\n│ › تمت إزالة إيموجي (🔇) وإرجاع كنيته الأصلية.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.messageID, event.threadID);
  return true;
}

// دالة مساعدة للتحقق من تجاهل لاعب
async function isPlayerIgnored(fbId) {
  try {
    const db = require('../database').getDB();
    const now = new Date();
    const record = await db.collection('ignored_players').findOne({ fbId: String(fbId) });
    if (record) {
      if (record.until > now) {
        return true;
      } else {
        await db.collection('ignored_players').deleteOne({ fbId: String(fbId) });
      }
    }
  } catch (e) {}
  return false;
}

// دالة مشتركة لمحاولة معالجة أوامر "تجاهل" / "فك التجاهل" — تُستخدم من كل من موجّه الـDM وموجّه القروبات
// تُعيد true إذا تمت معالجة الأمر (سواء بنجاح أو بخطأ رسالة للمستخدم)، و false إن لم يكن الأمر متعلقاً بالتجاهل أصلاً
async function tryHandleIgnoreCommand(api, event, senderID) {
  const text = (event.body || '').trim();
  const isIgnoreCmd = text.startsWith('تجاهل') || (event.type === 'message_reply' && text === 'تجاهل');
  const isUnignoreCmd = text.startsWith('فك التجاهل') || text.startsWith('فك_التجاهل') || (event.type === 'message_reply' && (text === 'فك التجاهل' || text === 'فك_التجاهل'));

  if (!isIgnoreCmd && !isUnignoreCmd) return false;

  const authorized = await isAuthorizedForIgnore(senderID);
  if (!authorized) return false;

  let targetID = null;
  if (isIgnoreCmd) {
    let query = text.replace(/^تجاهل\s*/, '').trim();
    if (event.type === 'message_reply' && event.messageReply.senderID) {
      targetID = String(event.messageReply.senderID);
    } else if (query) {
      const targetPlayer = await resolveTargetPlayer(query);
      if (targetPlayer) targetID = targetPlayer.fbId;
    }
    if (!targetID) {
      await sendReply(api, `❌ يرجى الرد على رسالة اللاعب أو كتابة لقب/ايدي/رابط حسابه لتجاهله.`, event.messageID, event.threadID);
      return true;
    }
    await executeIgnoreCommand(api, event, senderID, targetID);
    return true;
  } else {
    let query = text.replace(/^فك\s+التجاهل\s*/, '').replace(/^فك_التجاهل\s*/, '').trim();
    if (event.type === 'message_reply' && event.messageReply.senderID) {
      targetID = String(event.messageReply.senderID);
    } else if (query) {
      const targetPlayer = await resolveTargetPlayer(query);
      if (targetPlayer) targetID = targetPlayer.fbId;
    }
    if (!targetID) {
      await sendReply(api, `❌ يرجى الرد على رسالة اللاعب أو كتابة لقب/ايدي/رابط حسابه لفك التجاهل.`, event.messageID, event.threadID);
      return true;
    }
    await executeUnignoreCommand(api, event, senderID, targetID);
    return true;
  }
}

// جلسة إدخال دقائق التجاهل (AWAITING_IGNORE_DURATION)
async function handleIgnoreDurationSession(api, event, adminSession) {
  const { senderID, threadID } = event;
  const text = (event.body || '').trim();
  const { deleteAdminSession } = require('../database');

  if (text === 'خروج') {
    await deleteAdminSession(senderID);
    await sendReply(api, `╮───∙⋆⋅「 تم إلغاء العملية 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.messageID, threadID);
    return true;
  }

  const minutes = parseInt(text, 10);
  if (isNaN(minutes) || minutes <= 0) {
    await sendReply(api, `⚠️ يرجى إدخال عدد دقائق صحيح (رقم أكبر من 0) أو اكتب 《 خروج 》 للإلغاء.`, event.messageID, threadID);
    return true;
  }

  const targetID = adminSession.targetPlayerId;
  const victimPlayer = await getPlayer(targetID);
  const victimNick = victimPlayer ? victimPlayer.nickname : targetID;

  const ignoreUntil = new Date(Date.now() + minutes * 60 * 1000);
  const db = require('../database').getDB();
  await db.collection('ignored_players').updateOne(
    { fbId: targetID },
    { $set: { fbId: targetID, until: ignoreUntil, ignoredAt: new Date() } },
    { upsert: true }
  );

  // تعديل الكنية للكنية الرسمية الكاملة — سجل التجاهل محفوظ أعلاه فتُضاف 🔇 تلقائياً
  // مع الحفاظ على الرتبة والفئة والإنذارات وإيموجي الإنعاش 🏥 إن وُجد
  if (victimPlayer) {
    const victimGroupId = config.groupes[victimPlayer.kingdom];
    if (victimGroupId) {
      try {
        const officialNick = await buildOfficialNickname(targetID);
        await new Promise(resolve => api.changeNickname(officialNick, victimGroupId, targetID, () => resolve()));
      } catch (e) {
        console.error('[Ignore Nickname Change] Failed to set nickname:', e);
      }
    }
  }

  await deleteAdminSession(senderID);
  await sendReply(api, `╮───∙⋆⋅「 تجاهل لاعب 」\n│\n│ › تم تجاهل اللاعب [${victimNick}] لمدة [${minutes}] دقائق.\n│ ◇ لفك التجاهل عنه رد على رسالته بامر فك التجاهل\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.messageID, threadID);
  return true;
}

module.exports = {
  initMutedGroups,
  isAuthorizedForIgnore,
  resolveTargetPlayer,
  checkAndCleanExpiredIgnores,
  checkMutedGroupMessage,
  handleThreadNameChange,
  executeIgnoreCommand,
  executeUnignoreCommand,
  isPlayerIgnored,
  tryHandleIgnoreCommand,
  handleIgnoreDurationSession
};
