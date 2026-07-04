const { getPlayer, getPlayerByNickname, updatePlayer, addNotification } = require('./database');
const { sendReply, getKingdomByThreadId } = require('./utils');

async function handleTahwil(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  const match = text.match(/^تحويل\s+(\S+)\s+كوينز\s+الى\s+(.+)$/);
  if (!match) return;

  const rawAmount = match[1];
  const targetNickname = match[2].trim();

  // التحقق من وجود فاصلة (عدد عشري)
  if (rawAmount.includes('.') || rawAmount.includes(',')) {
    await sendReply(api,
      `●─────── ⛁ ───────●\n ⦿ ⟬ يجب ان يكون العدد بدون فاصلة❌️ ⟭ ⦿\n⊱ ────────────── ⊰`,
      messageID, threadID);
    return;
  }

  const amount = parseInt(rawAmount, 10);

  // التحقق من صحة العدد
  if (isNaN(amount) || amount <= 0) {
    await sendReply(api,
      `●─────── ⛁ ───────●\n ⦿ ⟬ يجب ان يكون العدد صحيحا ❌️ ⟭ ⦿\n⊱ ────────────── ⊰`,
      messageID, threadID);
    return;
  }

  // جلب بيانات المرسل
  const sender = await getPlayer(senderID);
  if (!sender) {
    await sendReply(api,
      `●─────── ⛁ ───────●\n ⦿ ⟬ يجب التسجيل اولاً ❌️ ⟭ ⦿\n⊱ ────────────── ⊰`,
      messageID, threadID);
    return;
  }

  // جلب بيانات المستلم
  const receiver = await getPlayerByNickname(targetNickname);
  if (!receiver) {
    await sendReply(api,
      `●─────── ⛁ ───────●\n ⦿ ⟬ لايوجد لاعب بهذا اللقب  ❌️ ⟭ ⦿\n⊱ ────────────── ⊰`,
      messageID, threadID);
    return;
  }

  // ⚠️ التحقق مما إذا كان المستلم في حالة إنعاش حالياً ⚠️
  const now = Date.now();
  if (receiver.recoveryUntil && new Date(receiver.recoveryUntil).getTime() > now) {
    await sendReply(api,
      `●─────── ⛁ ───────●\n ⦿ ⟬ اللاعب في حالة إنعاش حالياً ❌️ ⟭ ⦿\n◆ لا يمكنك تحويل الكوينز للاعب وهو قيد الإنعاش.\n⊱ ────────────── ⊰`,
      messageID, threadID);
    return;
  }

  // التحقق من التحويل لنفسه
  if (receiver.fbId === String(senderID)) {
    await sendReply(api,
      `●─────── ⛁ ───────●\n ⦿ ⟬ لايمكنك التحويل لنفسك ❌️ ⟭ ⦿\n⊱ ────────────── ⊰`,
      messageID, threadID);
    return;
  }

  const senderCoins = sender.coins || 0;

  // التحقق من كفاية الكوينز
  if (senderCoins < amount) {
    const missing = amount - senderCoins;
    await sendReply(api,
      `●─────── ⛁ ───────●\n ⦿ ⟬ الكوينز غير كافي ❌️ ⟭ ⦿\n◆ اللاعب   : ${sender.nickname}\n◆ الكوينز المراد تحويله : ${amount}\n◆الكوينز الذي لديك.      : ${senderCoins}\n◆ ينقصك.                    : ${missing}\n⊱ ────────────── ⊰`,
      messageID, threadID);
    return;
  }

  // تنفيذ التحويل
  const newSenderCoins = senderCoins - amount;
  const newReceiverCoins = (receiver.coins || 0) + amount;

  await updatePlayer(sender.fbId, { coins: newSenderCoins });
  await updatePlayer(receiver.fbId, { coins: newReceiverCoins });

  // إشعار للمستلم
  await addNotification(receiver.fbId,
    `⛁ تلقيت تحويل كوينز\n◆ من اللاعب     : ${sender.nickname}\n◆ الكوينز المستلم : ${amount}\n◆ رصيدك الحالي  : ${newReceiverCoins}`
  );

  await sendReply(api,
    `●─────── ⛁ ───────●\n ⦿ ⟬ تمت عملية التحويل بنجاح⟭ ⦿\n◆اللاعب المستلم   : ${receiver.nickname}\n◆ الكوينز المحول  : ${amount}\n◆الكوينز المتبقي   : ${newSenderCoins}\n⊱ ────────────── ⊰`,
    messageID, threadID);
}

module.exports = { handleTahwil };