const {
  getPlayer,
  getPlayerByNickname,
  updatePlayer,
  addItemToBag,
  removeItemFromBag,
  getItemTransferSession,
  setItemTransferSession,
  deleteItemTransferSession,
  addNotification,
  addXP // 🆙 تم استيراد دالة إضافة الـ XP هنا
} = require('./database');
const { sendReply, getKingdomByThreadId } = require('./utils');

const COOLDOWN_MS = 20 * 60 * 1000;

// ===== جداول الموارد =====

const MURDAK_RESOURCES = [
  { name: 'صخرة',      chance: 35, maxQty: 10 },
  { name: 'حديد',      chance: 25, maxQty: 8 },
  { name: 'فحم',       chance: 15, maxQty: 7 },
  { name: 'فضة',       chance: 10, maxQty: 5 },
  { name: 'ذهب',       chance: 8,  maxQty: 4 },
  { name: 'ياقوت مشع', chance: 7,  maxQty: 3 },
];

const NIRAVIL_RESOURCES = [
  { name: 'خشب',        chance: 35, maxQty: 10 },
  { name: 'راتنج',       chance: 25, maxQty: 8 },
  { name: 'اعشاب طبية', chance: 15, maxQty: 7 },
  { name: 'أعشاب سامة', chance: 10, maxQty: 5 },
  { name: 'فطر متوهج',  chance: 8,  maxQty: 4 },
  { name: 'بذور سحرية', chance: 7,  maxQty: 3 },
];

const SOLFARA_RESOURCES = [
  { name: 'أصداف',         chance: 35, maxQty: 10 },
  { name: 'سمك',           chance: 25, maxQty: 8 },
  { name: 'طحالب بحرية',  chance: 15, maxQty: 7 },
  { name: 'لؤلؤ',          chance: 10, maxQty: 5 },
  { name: 'مرجان',         chance: 8,  maxQty: 4 },
  { name: 'كريستال البحر', chance: 7,  maxQty: 3 },
];

// ===== مساعدات =====

function rollResource(table) {
  const rand = Math.random() * 100;
  let cumulative = 0;
  for (const item of table) {
    cumulative += item.chance;
    if (rand < cumulative) {
      return { name: item.name, quantity: Math.floor(Math.random() * item.maxQty) + 1 };
    }
  }
  const last = table[table.length - 1];
  return { name: last.name, quantity: 1 };
}

function formatTimeRemaining(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min} دقيقة و ${sec} ثانية`;
  return `${sec} ثانية`;
}

function getBagCapacity(player) {
  return (player.bagLevel || 1) * 5;
}

// ===== النشاط (حفر / جمع / صيد) =====

async function handleActivity(api, event, { activityKey, resourceTable, actionName, actionEmoji, failEmoji, repeatVerb, requiredKingdom }) {
  const { threadID, senderID, messageID } = event;
  const kingdom = getKingdomByThreadId(threadID);
  if (kingdom !== requiredKingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return;
  }

  const now = Date.now();
  const lastTime = player[activityKey] ? new Date(player[activityKey]).getTime() : 0;
  const elapsed = now - lastTime;

  const speedActive = player.speedBoost && new Date(player.speedBoost.expires).getTime() > now;
  const effectiveCooldown = speedActive ? Math.floor(COOLDOWN_MS / 2) : COOLDOWN_MS;

  if (elapsed < effectiveCooldown) {
    const remaining = effectiveCooldown - elapsed;
    await sendReply(api,
      `●─── ⟪ فشل ${actionName} ${failEmoji} ⟫ ───●\n❖ لايمكنك ${actionName} بعد\n❖ انتضر 🕐 : ${formatTimeRemaining(remaining)}\n●─────── ⌬ ───────●`,
      messageID, threadID);
    return;
  }

  const currentEP = player.ep ?? 1000;
  if (currentEP < 20) {
    await sendReply(api,
      `●─── ⟪ فشل ${actionName} ${failEmoji} ⟫ ───●\n❖ طاقتك غير كافية\n❖ EP لديك : ${currentEP}/1000\n❖ تحتاج على الأقل 20 EP\n●─────── ⌬ ───────●`,
      messageID, threadID);
    return;
  }

  const result = rollResource(resourceTable);
  const bag = player.bag || [];
  const hasItem = bag.find(i => i.name === result.name && i.type === 'resource');
  const capacity = getBagCapacity(player);

  if (!hasItem && bag.length >= capacity) {
    await sendReply(api,
      `●─── ⟪ فشل ${actionName} ${failEmoji} ⟫ ───●\n❖ حقيبتك ممتلئة\n❖ احذف بعض الأغراض لتتمكن من ${actionName}\n●─────── ⌬ ───────●`,
      messageID, threadID);
    return;
  }

  await addItemToBag(String(senderID), result.name, result.quantity);
  
  // 🆙 منح 5 XP لعملية الحفر أو الجمع أو الصيد الناجحة
  await addXP(String(senderID), 5, api, threadID).catch(() => {});

  let newEP = currentEP - 20;
  let rageTriggered = false;
  const nowActivity = Date.now();
  if (newEP <= 0 && player.rageBoost && new Date(player.rageBoost.expires).getTime() > nowActivity) {
    newEP = 100;
    rageTriggered = true;
  }

  await updatePlayer(String(senderID), { [activityKey]: new Date(), ep: newEP });

  const rageLine = rageTriggered ? `\n 🔥 خلطة الثور الغاضب فعّلت : EP → 100` : '';
  await sendReply(api,
    `●─── ⟪ تم ${actionName} بنجاح ${actionEmoji} ⟫ ───●\n『 حصلت على  』↜ ┇ ${result.name}\n『 الكمية   』↜ ↜   ┇ ×${result.quantity}\n ✦ ${repeatVerb} مجددا بعد 20 دقيقة 🔄 ${actionEmoji}${rageLine}\n●─────── ⌬ ───────●`,
    messageID, threadID);
}

async function handleHafr(api, event) {
  await handleActivity(api, event, {
    activityKey: 'lastHafr',
    resourceTable: MURDAK_RESOURCES,
    actionName: 'الحفر',
    actionEmoji: '⛏️',
    failEmoji: '⛏️❌️',
    repeatVerb: 'احفر',
    requiredKingdom: 'murdak'
  });
}

async function handleJam3(api, event) {
  await handleActivity(api, event, {
    activityKey: 'lastJam3',
    resourceTable: NIRAVIL_RESOURCES,
    actionName: 'الجمع',
    actionEmoji: '🌿',
    failEmoji: '🌿❌️',
    repeatVerb: 'اجمع',
    requiredKingdom: 'niravil'
  });
}

async function handleSayd(api, event) {
  await handleActivity(api, event, {
    activityKey: 'lastSayd',
    resourceTable: SOLFARA_RESOURCES,
    actionName: 'الصيد',
    actionEmoji: '🐚',
    failEmoji: '🐚❌️',
    repeatVerb: 'اصطد',
    requiredKingdom: 'solfare'
  });
}

// ===== الحقيبة =====

async function handleHaqiba(api, event) {
  const { threadID, senderID, messageID } = event;
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return;
  }

  const bag = player.bag || [];
  const bagLevel = player.bagLevel || 1;
  const capacity = bagLevel * 5;

  let bagContent = '';
  if (bag.length === 0) {
    bagContent = '┇❐ الحقيبة فارغة';
  } else {
    bagContent = bag.map(item => {
      if (item.type === 'resource') return `┇❐ ${item.name} ×${item.quantity}`;
      if (item.type === 'weapon') return `┇❐ ${item.name} ﴿D${item.damage ?? '-'}/T${item.durability ?? '-'}﴾`;
      if (item.type === 'armor') return `┇❐ ${item.name} ﴿A${item.absorption ?? '-'}﴾`;
      if (item.type === 'material') return `┇❐ ${item.name}`;
      return `┇❐ ${item.name}`;
    }).join('\n');
  }

  await sendReply(api,
    `╮──────────────╭ \n┆          ❲ الحقيبة ⌬  ❳           ┆\n┊المستوى ◁ ${bagLevel}\n┊السعة.    ◁ ${bag.length}/${capacity}\n╯──────────────╰\n${bagContent}\n━═══════════════━\nلحذف اي غرض اكتب 《حذف (اسم الغرض) 》\n━═══════════════━`,
    messageID, threadID);
}

// ===== حذف غرض =====

async function handleHadhf(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  const match = text.match(/^حذف\s+(.+)$/);
  if (!match) return;

  const itemName = match[1].trim();

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً`, messageID, threadID);
    return;
  }

  const bag = player.bag || [];
  const idx = bag.findIndex(i => i.name === itemName);

  if (idx < 0) {
    await sendReply(api, `هذا الغرض غير موجود بحقيبتك 🚫`, messageID, threadID);
    return;
  }

  bag.splice(idx, 1);
  await updatePlayer(String(senderID), { bag });

  await sendReply(api,
    `━══════════════━\nتم الحذف بنجاح ✅️\n✦ الغرض المحذوف : ${itemName}\n━══════════════━`,
    messageID, threadID);
}

// ===== ارسال غرض =====

async function handleIrsal(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  const match = text.match(/^ارسال\s+(.+)\s+الى\s+(.+)$/);
  if (!match) return;

  const itemName = match[1].trim();
  const targetNickname = match[2].trim();

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً`, messageID, threadID);
    return;
  }

  const bag = player.bag || [];
  const matchingItems = bag.filter(i => i.name === itemName);

  if (matchingItems.length === 0) {
    await sendReply(api, `هذا الغرض غير موجود بحقيبتك 🚫`, messageID, threadID);
    return;
  }

  const receiver = await getPlayerByNickname(targetNickname);
  if (!receiver) {
    await sendReply(api,
      `●─────── ❖ ───────●\n ⦿ ⟬ لايوجد لاعب بهذا اللقب  ❌️ ⟭ ⦿\n❌️ ────────────── ❌️`,
      messageID, threadID);
    return;
  }

  if (receiver.fbId === String(senderID)) {
    await sendReply(api, `لايمكنك الارسال لنفسك 🚫`, messageID, threadID);
    return;
  }

  const receiverBag = receiver.bag || [];
  const receiverHasItem = receiverBag.find(i => i.name === itemName);
  const receiverCapacity = (receiver.bagLevel || 1) * 5;

  if (!receiverHasItem && receiverBag.length >= receiverCapacity) {
    await addNotification(receiver.fbId,
      `❌️ فشلت عملية استلام غرض\n◆ المرسل : ${player.nickname}\n◆ الغرض : ${itemName}\n◆ السبب : حقيبتك ممتلئة`
    );
    await sendReply(api,
      `●─────── ❖ ───────●\n ⦿ ⟬  حقيبة المستلم ممتلئة  ⟭ ⦿\n❌️ ────────────── ❌️`,
      messageID, threadID);
    return;
  }

  const item = matchingItems[0];

  if (item.type === 'resource') {
    await setItemTransferSession(String(senderID), {
      step: 'await_qty',
      itemName,
      receiverFbId: receiver.fbId,
      receiverNickname: receiver.nickname,
      threadID
    });
    await sendReply(api,
      `●─────── ❖ ───────●\n        ⦿ ⟬  عملية تحويل  ⟭ ⦿\nالغرض : ${itemName}\n🔴 ارسل الكمية التي تريد تحويلها \n📤 ────────────── 📤\n《 الغاء 》للإلغاء`,
      messageID, threadID);
    return;
  }

  if (matchingItems.length > 1) {
    const list = matchingItems.map((it, i) => {
      if (it.type === 'weapon') return `${i + 1}. ${it.name} ﴿D${it.damage ?? '-'}/T${it.durability ?? '-'}﴾`;
      if (it.type === 'armor') return `${i + 1}. ${it.name} ﴿A${it.absorption ?? '-'}﴾`;
      return `${i + 1}. ${it.name}`;
    }).join('\n');
    await setItemTransferSession(String(senderID), {
      step: 'await_choice',
      itemName,
      items: matchingItems,
      receiverFbId: receiver.fbId,
      receiverNickname: receiver.nickname,
      threadID
    });
    await sendReply(api,
      `يوجد لديك من هذا ${item.type === 'weapon' ? 'السلاح' : 'الدرع'} اكثر من واحد\n${list}\nرجائا ارسل رقم السلاح/الدرع الذي تريد ارساله\n《 الغاء 》للإلغاء`,
      messageID, threadID);
    return;
  }

  await executeSingleItemTransfer(api, event, player, receiver, item);
}

async function executeSingleItemTransfer(api, event, sender, receiver, item) {
  const { senderID, messageID, threadID } = event;

  const senderPlayer = await getPlayer(senderID);
  const bag = senderPlayer.bag || [];
  const idx = bag.findIndex(i =>
    i.name === item.name && i.type === item.type &&
    i.durability === item.durability && i.absorption === item.absorption
  );
  if (idx >= 0) bag.splice(idx, 1);
  await updatePlayer(String(senderID), { bag });

  const receiverPlayer = await getPlayer(receiver.fbId);
  const receiverBag = receiverPlayer.bag || [];
  receiverBag.push({ ...item });
  await updatePlayer(receiver.fbId, { bag: receiverBag });

  await addNotification(receiver.fbId,
    `📦 تم استلام ${item.type === 'weapon' ? 'سلاح' : 'درع'}\n◆ من اللاعب : ${sender.nickname}\n◆ الغرض : ${item.name}`
  );

  await sendReply(api,
    `✅️ تم الارسال بنجاح\n◆ الغرض : ${item.name}\n◆ المرسل إليه : ${receiver.nickname}`,
    messageID, threadID);
}

// ===== معالجة جلسة تحويل الأغراض =====

async function handleItemTransferSession(api, event, session) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  if (text === 'الغاء') {
    await deleteItemTransferSession(String(senderID));
    await sendReply(api, `تم الغاء عملية التحويل ❌️`, messageID, threadID);
    return;
  }

  if (session.step === 'await_qty') {
    if (text.includes('.') || text.includes(',')) {
      await sendReply(api, `يجب ان يكون العدد بدون فاصلة ❌️`, messageID, threadID);
      return;
    }
    const qty = parseInt(text, 10);
    if (isNaN(qty) || qty <= 0) {
      await sendReply(api, `يجب ان يكون العدد صحيحا ❌️`, messageID, threadID);
      return;
    }

    const player = await getPlayer(senderID);
    const bag = player.bag || [];
    const item = bag.find(i => i.name === session.itemName && i.type === 'resource');

    if (!item || item.quantity < qty) {
      await sendReply(api,
        `لا يوجد لديك كمية كافية من ${session.itemName} 🚫\n◆ لديك : ${item ? item.quantity : 0}`,
        messageID, threadID);
      return;
    }

    const receiver = await getPlayer(session.receiverFbId);
    if (!receiver) {
      await deleteItemTransferSession(String(senderID));
      await sendReply(api, `حدث خطأ في البحث عن المستلم`, messageID, threadID);
      return;
    }

    const receiverBag = receiver.bag || [];
    const receiverHasItem = receiverBag.find(i => i.name === session.itemName);
    const receiverCapacity = (receiver.bagLevel || 1) * 5;

    if (!receiverHasItem && receiverBag.length >= receiverCapacity) {
      await deleteItemTransferSession(String(senderID));
      await addNotification(receiver.fbId,
        `❌️ فشلت عملية استلام غرض\n◆ المرسل : ${player.nickname}\n◆ الغرض : ${session.itemName}\n◆ السبب : حقيبتك ممتلئة`
      );
      await sendReply(api,
        `●─────── ❖ ───────●\n ⦿ ⟬  حقيبة المستلم ممتلئة  ⟭ ⦿\n❌️ ────────────── ❌️`,
        messageID, threadID);
      return;
    }

    const currentQty = (receiverHasItem ? receiverHasItem.quantity : 0) + qty;

    await removeItemFromBag(String(senderID), session.itemName, qty);
    await addItemToBag(session.receiverFbId, session.itemName, qty);
    await deleteItemTransferSession(String(senderID));

    await addNotification(session.receiverFbId,
      `📦 تم استلام مورد\n◆ من اللاعب : ${player.nickname}\n◆ الغرض : ${session.itemName}\n◆ الكمية : ${qty}\n◆ إجمالي لديك : ${currentQty}`
    );

    await sendReply(api,
      `✅️ تم الارسال بنجاح\n◆ الغرض : ${session.itemName}\n◆ الكمية : ${qty}\n◆ المرسل إليه : ${session.receiverNickname}`,
      messageID, threadID);
    return;
  }

  if (session.step === 'await_choice') {
    const choice = parseInt(text, 10);
    if (isNaN(choice) || choice < 1 || choice > session.items.length) {
      await sendReply(api, `الرجاء إدخال رقم صحيح`, messageID, threadID);
      return;
    }

    const chosenItem = session.items[choice - 1];
    const player = await getPlayer(senderID);
    const receiver = await getPlayer(session.receiverFbId);

    if (!receiver) {
      await deleteItemTransferSession(String(senderID));
      await sendReply(api, `حدث خطأ في البحث عن المستلم`, messageID, threadID);
      return;
    }

    const bag = player.bag || [];
    const idx = bag.findIndex(i =>
      i.name === chosenItem.name && i.type === chosenItem.type &&
      i.durability === chosenItem.durability && i.absorption === chosenItem.absorption
    );
    if (idx >= 0) bag.splice(idx, 1);
    await updatePlayer(String(senderID), { bag });

    const receiverBag = receiver.bag || [];
    receiverBag.push({ ...chosenItem });
    await updatePlayer(session.receiverFbId, { bag: receiverBag });

    await deleteItemTransferSession(String(senderID));

    await addNotification(session.receiverFbId,
      `📦 تم استلام ${chosenItem.type === 'weapon' ? 'سلاح' : 'درع'}\n◆ من اللاعب : ${player.nickname}\n◆ الغرض : ${chosenItem.name}`
    );

    await sendReply(api,
      `✅️ تم الارسال بنجاح\n◆ الغرض : ${chosenItem.name}\n◆ المرسل إليه : ${session.receiverNickname}`,
      messageID, threadID);
    return;
  }
}

module.exports = {
  handleHafr,
  handleJam3,
  handleSayd,
  handleHaqiba,
  handleHadhf,
  handleIrsal,
  handleItemTransferSession
};