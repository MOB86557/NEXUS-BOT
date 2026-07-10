// admin_modules/draw_keys.js — إدارة مفاتيح Google AI Studio الخاصة بالرسم

const { sendMessage } = require('../utils');
const { setAdminSession, deleteAdminSession } = require('../database');

// ═════════════════════════════════════════════════════════════════════
//   بدء جلسة إدارة مفاتيح الرسم (نقطة الدخول من الأمر: "مفاتيح رسم")
// ═════════════════════════════════════════════════════════════════════

async function handleDrawKeysStart(api, event) {
  const { senderID, threadID } = event;
  await setAdminSession(senderID, { state: 'DRAW_KEYS_MAIN' });
  const menuMsg =
    `╮───∙⋆⋅「 🎨 إدارة مفاتيح الرسم 」\n` +
    `│ 1 》 عرض المفاتيح الحالية\n` +
    `│ 2 》 إضافة مفتاح جديد\n` +
    `│ 3 》 حذف مفتاح\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙───────◈\n\n` +
    `› أرسل رقم الخيار المطلوب أو اكتب 《 خروج 》 للإلغاء.`;
  await sendMessage(api, menuMsg, event.threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   جلسة إدارة مفاتيح الرسم
// ═════════════════════════════════════════════════════════════════════
async function handleDrawKeysSession(api, event, session) {
  const { senderID, body } = event;
  const text = (body || '').trim();
  const s = session.state;
  const db = require('../database').getDB();

  if (text === 'خروج') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
    return;
  }

  if (s === 'DRAW_KEYS_MAIN') {
    if (text === '1') {
      const keys = await db.collection('drawing_keys').find({}).toArray();
      if (keys.length === 0) {
        await sendMessage(api, `⚠️ لا توجد أي مفاتيح رسم مضافة حالياً.`, event.threadID);
      } else {
        let msg = `╮───∙⋆⋅「 🎨 مفاتيح الرسم المضافة 」\n`;
        keys.forEach((k, idx) => {
          msg += `│ ${idx + 1}. ${k.key.substring(0, 8)}...${k.key.substring(k.key.length - 4)}\n`;
        });
        msg += `╯───────∙⋆⋅ ※ ⋅⋆∙`;
        await sendMessage(api, msg, event.threadID);
      }
      await setAdminSession(senderID, { state: 'DRAW_KEYS_MAIN' });
      return;
    }
    if (text === '2') {
      await setAdminSession(senderID, { state: 'DRAW_KEYS_ADD' });
      await sendMessage(api, `يرجى إرسال مفتاح Google AI Studio الجديد المراد إضافته:`, event.threadID);
      return;
    }
    if (text === '3') {
      const keys = await db.collection('drawing_keys').find({}).toArray();
      if (keys.length === 0) {
        await sendMessage(api, `⚠️ لا توجد مفاتيح لحذفها.`, event.threadID);
        await setAdminSession(senderID, { state: 'DRAW_KEYS_MAIN' });
        return;
      }
      await setAdminSession(senderID, { state: 'DRAW_KEYS_DELETE', keysList: keys });
      let msg = `╮───∙⋆⋅「 🗑️ حذف مفتاح رسم 」\nالرجاء كتابة رقم المفتاح المراد حذفه:\n`;
      keys.forEach((k, idx) => {
        msg += `│ ${idx + 1}. ${k.key.substring(0, 8)}...${k.key.substring(k.key.length - 4)}\n`;
      });
      msg += `╯───────∙⋆⋅ ※ ⋅⋆∙\n› اكتب الرقم أو "خروج" للإلغاء.`;
      await sendMessage(api, msg, event.threadID);
      return;
    }
    await sendMessage(api, `⚠️ خيار غير صحيح. الرجاء إدخال رقم من 1 إلى 3 أو 《 خروج 》.`, event.threadID);
    return;
  }

  if (s === 'DRAW_KEYS_ADD') {
    if (!text) {
      await sendMessage(api, `⚠️ الرجاء إدخال مفتاح صالح.`, event.threadID);
      return;
    }
    const exists = await db.collection('drawing_keys').findOne({ key: text });
    if (exists) {
      await sendMessage(api, `⚠️ هذا المفتاح مضاف بالفعل مسبقاً!`, event.threadID);
    } else {
      await db.collection('drawing_keys').insertOne({ key: text, createdAt: new Date() });
      await sendMessage(api, `✅ تم إضافة مفتاح الرسم الجديد بنجاح!`, event.threadID);
    }
    await deleteAdminSession(senderID);
    return;
  }

  if (s === 'DRAW_KEYS_DELETE') {
    const idx = parseInt(text, 10) - 1;
    const keysList = session.keysList || [];
    if (isNaN(idx) || idx < 0 || idx >= keysList.length) {
      await sendMessage(api, `⚠️ خيار غير صحيح. الرجاء إدخال الرقم المقابل للمفتاح.`, event.threadID);
      return;
    }
    const keyToDelete = keysList[idx];
    await db.collection('drawing_keys').deleteOne({ _id: keyToDelete._id });
    await sendMessage(api, `✅ تم حذف المفتاح بنجاح!`, event.threadID);
    await deleteAdminSession(senderID);
    return;
  }
}

module.exports = {
  handleDrawKeysStart,
  handleDrawKeysSession
};
