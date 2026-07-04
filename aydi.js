// ─── ايدي.js — أوامر عرض الـ ID ───
const { sendMessage } = require('./utils');

async function handleAydi(api, event) {
  const { threadID, senderID } = event;
  const text = (event.body || '').trim();

  if (text === 'ايدي') {
    const targetId = (event.messageReply && event.messageReply.senderID)
      ? String(event.messageReply.senderID)
      : String(senderID);
    const label = (event.messageReply && event.messageReply.senderID)
      ? 'ايدي الشخص'
      : 'ايدي';
    await sendMessage(api,
      `╮───∙⋆⋅「 ${label} 」\n│\n│ › ${targetId}\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return true;
  }

  if (text === 'ايدي القروب') {
    await sendMessage(api,
      `╮───∙⋆⋅「 ايدي القروب 」\n│\n│ › ${threadID}\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return true;
  }

  return false;
}

module.exports = { handleAydi };
