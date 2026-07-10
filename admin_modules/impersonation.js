// admin_modules/impersonation.js — نظام تقمص هوية اللاعبين للأدمن (تقمص / الغاء التقمص)

const { sendMessage } = require('../utils');
const auth = require('./auth');

// دالة مساعدة لعمل escape لنصوص البحث
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═════════════════════════════════════════════════════════════════════
//   أوامر التقمص وإلغاء التقمص (يُستدعى من موجّه أوامر الأدمن الرئيسي)
// ═════════════════════════════════════════════════════════════════════
// يُعيد true إذا تمت معالجة الأمر، و false إن لم يكن النص متعلقاً بالتقمص
async function handleImpersonationCommand(api, event) {
  const { senderID, threadID } = event;
  const text = (event.body || '').trim();

  if (text === 'الغاء التقمص' || text === 'إلغاء التقمص') {
    global.impersonations = global.impersonations || {};
    const adminId = event.originalSenderID || senderID;
    if (global.impersonations[adminId]) {
      delete global.impersonations[adminId];
      const db = require('../database').getDB();
      await db.collection('impersonations').deleteOne({ adminId: adminId });
      await sendMessage(api, `╮───∙⋆⋅「 إلغاء التقمص 」\n│\n│ › ✅ تم إلغاء التقمص بنجاح.\n│ › عدت لهويتك الأصلية كمسؤول.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    } else {
      await sendMessage(api, `⚠️ أنت لا تتقمص دور أي لاعب حالياً.`, threadID);
    }
    return true;
  }

  if (text.startsWith('تقمص ')) {
    const db = require('../database').getDB();
    const target = text.replace(/^تقمص\s+/, '').trim();
    if (!target) {
      await sendMessage(api, `⚠️ يرجى تحديد لقب اللاعب، ايديه، أو رابط حسابه للتقمص.`, threadID);
      return true;
    }

    let player = null;
    if (/^\d+$/.test(target)) {
      player = await db.collection('players').findOne({ fbId: target });
    }

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

    if (!player) {
      player = await db.collection('players').findOne({
        $or: [
          { name: { $regex: new RegExp(escapeRegex(target), 'i') } },
          { nickname: { $regex: new RegExp(escapeRegex(target), 'i') } }
        ]
      });
    }

    global.impersonations = global.impersonations || {};

    if (player) {
      global.impersonations[senderID] = player.fbId;
      await db.collection('impersonations').updateOne(
        { adminId: senderID },
        { $set: { targetId: player.fbId, targetName: player.name || player.nickname || player.fbId } },
        { upsert: true }
      );
      await sendMessage(api, `╮───∙⋆⋅「 تقمص 」\n│\n│ › ✅ تم التقمص بنجاح!\n│ › أنت الآن تتقمص دور اللاعب: ${player.name || player.nickname || player.fbId}\n│ › لإلغاء التقمص اكتب: الغاء التقمص\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    } else if (/^\d+$/.test(target)) {
      global.impersonations[senderID] = target;
      await db.collection('impersonations').updateOne(
        { adminId: senderID },
        { $set: { targetId: target, targetName: target } },
        { upsert: true }
      );
      await sendMessage(api, `╮───∙⋆⋅「 تقمص 」\n│\n│ › ✅ تم التقمص بنجاح (معرف مباشر)!\n│ › أنت الآن تتقمص دور الايدي: ${target}\n│ › لإلغاء التقمص اكتب: الغاء التقمص\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    } else {
      await sendMessage(api, `❌ لم يتم العثور على اللاعب المطلوب في قاعدة البيانات.`, threadID);
    }
    return true;
  }

  return false;
}

// اعتراض ومعالجة نظام التقمص لجميع رسائل الأحداث الواردة
function handleImpersonationInterceptor(event) {
  if (!event || !event.senderID) return;
  global.impersonations = global.impersonations || {};

  const text = (event.body || '').trim();
  if (text === 'الغاء التقمص' || text === 'إلغاء التقمص') {
    return; // دع الأمر يمر عبر هويته الأصلية ليتمكن الأدمن من الإلغاء
  }

  if (global.impersonations[event.senderID]) {
    event.originalSenderID = event.senderID; // حفظ الهوية الأصلية احتياطاً
    event.senderID = global.impersonations[event.senderID]; // تزييف الهوية باللاعب المتقمص
  }
}

// دالة البدء مع جلب التقمص المخزن بقاعدة البيانات
async function initAdminIdsWithImpersonation(api) {
  await auth.initAdminIds(api);
  try {
    const db = require('../database').getDB();
    const list = await db.collection('impersonations').find({}).toArray();
    global.impersonations = global.impersonations || {};
    for (const item of list) {
      global.impersonations[String(item.adminId)] = String(item.targetId);
    }
  } catch (e) {
    console.error('[Admin Init] Error loading impersonations:', e);
  }
}

module.exports = {
  handleImpersonationCommand,
  handleImpersonationInterceptor,
  initAdminIdsWithImpersonation
};
