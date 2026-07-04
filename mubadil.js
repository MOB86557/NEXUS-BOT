const {
  getPlayer,
  updatePlayer,
  removeItemFromBag,
  addItemToBag,
  getMubadilSession,
  setMubadilSession,
  deleteMubadilSession,
  recordMubadilPurchase,
  getMubadilDemand
} = require('./database');
const { sendReply, sendMessage, sendImageFromUrl } = require('./utils');

const MUBADIL_IMAGE_URL = 'https://i.ibb.co/VrZFVRY/1d7a1884cee5.jpg';

// قفل بالذاكرة لمنع معالجة أكثر من رسالة بنفس الوقت لنفس اللاعب
const processingLock = new Set();

// ===== جداول الموارد (يجب أن تطابق نسب الإيجاد بملف ta3din_ta5zin.js) =====

const MURDAK_RESOURCES = [
  { name: 'صخرة',      chance: 35 },
  { name: 'حديد',      chance: 25 },
  { name: 'فحم',       chance: 15 },
  { name: 'فضة',       chance: 10 },
  { name: 'ذهب',       chance: 8 },
  { name: 'ياقوت مشع', chance: 7 },
];

const NIRAVIL_RESOURCES = [
  { name: 'خشب',        chance: 35 },
  { name: 'راتنج',       chance: 25 },
  { name: 'اعشاب طبية', chance: 15 },
  { name: 'أعشاب سامة', chance: 10 },
  { name: 'فطر متوهج',  chance: 8 },
  { name: 'بذور سحرية', chance: 7 },
];

const SOLFARA_RESOURCES = [
  { name: 'أصداف',         chance: 35 },
  { name: 'سمك',           chance: 25 },
  { name: 'طحالب بحرية',  chance: 15 },
  { name: 'لؤلؤ',          chance: 10 },
  { name: 'مرجان',         chance: 8 },
  { name: 'كريستال البحر', chance: 7 },
];

// ===== إعدادات الأسعار =====

const BASE_PRICE_BY_CHANCE = {
  35: 20,
  25: 40,
  15: 50,
  10: 70,
  8: 90,
  7: 110
};

const SELL_RATIO = 0.92; // نسبة ما يحصل عليه اللاعب عند البيع (92% من سعر الشراء)
const PRICE_CACHE_MS = 5 * 60 * 1000; // الأسعار تُحدّث كل 5 دقائق

// كاش بسيط بالذاكرة لتثبيت السعر لمدة 5 دقائق
const priceCache = new Map(); // key: resourceName -> { price, expiresAt }

// ===== حساب السعر =====
async function calculatePrice(resource) {
  const cached = priceCache.get(resource.name);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.price;
  }

  const demand = await getMubadilDemand(resource.name);
  const basePrice = BASE_PRICE_BY_CHANCE[resource.chance] || 30;
  const demandFactor = 1 + (demand / 50);
  const price = Math.round(basePrice * demandFactor);

  priceCache.set(resource.name, { price, expiresAt: now + PRICE_CACHE_MS });
  return price;
}

async function getResourcesWithPrices(table) {
  const result = [];
  for (const resource of table) {
    const price = await calculatePrice(resource);
    result.push({ ...resource, price });
  }
  return result;
}

// ===== القائمة الرئيسية =====

async function handleMubadil(api, event) {
  const { threadID, messageID, senderID } = event;

  const textMsgInfo = await sendReply(api,
    `مرحبا انا المبادل اقوم ببيع وشراء الموارد في نظام نيكسوس اختر مايعجبك\n⭗ شراء\n⭗ بيع\n☆ رد على هذه الرسالة باختيارك`,
    messageID, threadID);

  const validReplyIds = [];
  if (textMsgInfo && textMsgInfo.messageID) validReplyIds.push(String(textMsgInfo.messageID));

  await setMubadilSession(String(senderID), {
    step: 'awaiting_choice',
    validReplyIds,
    threadID
  });
}

// ===== صفحات الشراء =====

const BUY_PAGES = [
  { kingdomLabel: 'مورداك', table: MURDAK_RESOURCES },
  { kingdomLabel: 'سولفارا', table: SOLFARA_RESOURCES },
  { kingdomLabel: 'نيرافيل', table: NIRAVIL_RESOURCES }
];

async function sendBuyPage(api, senderID, threadID, replyToMessageID, pageNum) {
  const page = BUY_PAGES[pageNum - 1];
  const resourcesWithPrices = await getResourcesWithPrices(page.table);

  let msg = `⭗ موارد ${page.kingdomLabel} :\n`;
  resourcesWithPrices.forEach((r, i) => {
    msg += `${i + 1}. ${r.name} — ${r.price} كوينز\n`;
  });
  msg += `══════════════━\n`;
  msg += `● الصفحة ${pageNum} من 3\n`;
  msg += `● للانتقال لصفحة اخرى رد على هذه الرسالة برقم الصفحة 1.2.3..\n`;
  msg += `● لشراء اي مورد رد على هذه الرسالة باسمه\n`;
  msg += `● تنبيه : تتغير الاسعار كل 5 دقائق حسب الطلب وندرة المورد وعوامل اخرى\n`;
  msg += `━════════════════━`;

  const sentInfo = await sendReply(api, msg, replyToMessageID, threadID);
  const pageMsgId = (sentInfo && sentInfo.messageID) ? String(sentInfo.messageID) : null;

  await setMubadilSession(String(senderID), {
    step: 'buy_browsing',
    currentPage: pageNum,
    pageMessageId: pageMsgId,
    pageResources: resourcesWithPrices.map(r => ({ name: r.name, price: r.price })),
    threadID
  });
}

// ===== تدفق البيع =====

async function startSellFlow(api, event, player) {
  const { threadID, messageID, senderID } = event;
  const bag = player.bag || [];
  const resources = bag.filter(i => i.type === 'resource');

  if (resources.length === 0) {
    await sendReply(api, `لا يوجد لديك اي موارد بحقيبتك لبيعها 🚫`, messageID, threadID);
    return;
  }

  let listMsg = `⭗ موارد حقيبتك القابلة للبيع :\n`;
  resources.forEach((r, i) => {
    listMsg += `${i + 1}. ${r.name} ×${r.quantity}\n`;
  });
  listMsg += `━════════════════━\nرد على هذه الرسالة برقم المورد الذي تريد بيعه\n◇ لبيع كل ماتملك دفعة واحدة رد على هذه الرسالة برقم 0`;

  await setMubadilSession(String(senderID), {
    step: 'choose_resource',
    resources: resources.map(r => ({ name: r.name, quantity: r.quantity })),
    threadID
  });

  await sendReply(api, listMsg, messageID, threadID);
}

async function handleMubadilSession(api, event, session) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();
  const lockKey = String(senderID);

  if (processingLock.has(lockKey)) {
    return true;
  }

  if (text === 'الغاء' || text === 'إلغاء') {
    await deleteMubadilSession(String(senderID));
    await sendReply(api, `تم الغاء العملية ❌️`, messageID, threadID);
    return true;
  }

  if (session.step === 'awaiting_choice') {
    const repliedId = event.messageReply ? String(event.messageReply.messageID) : null;
    const isValidReply = repliedId && (session.validReplyIds || []).includes(repliedId);

    if (!isValidReply) {
      // لم يتم الرد على رسالة المبادل، نتجاهل الرسالة فقط ونبقي الجلسة حية
      return false;
    }

    const player = await getPlayer(senderID);
    if (!player) {
      await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
      await deleteMubadilSession(String(senderID));
      return true;
    }

    if (text === 'شراء') {
      await sendBuyPage(api, senderID, threadID, messageID, 1);
      return true;
    }

    if (text === 'بيع') {
      await startSellFlow(api, event, player);
      return true;
    }

    // أي رد آخر غير شراء أو بيع: نحذف الجلسة لكي لا يعلق اللاعب
    await deleteMubadilSession(String(senderID));
    return false;
  }

  if (session.step === 'buy_browsing') {
    const repliedId = event.messageReply ? String(event.messageReply.messageID) : null;
    const isReplyToPage = repliedId && session.pageMessageId && repliedId === session.pageMessageId;

    if (!isReplyToPage) {
      // إذا أرسل شيئاً دون الرد على صفحة المتجر، نتجاهل فقط ونبقي الجلسة حية
      return false;
    }

    if (/^[1-3]$/.test(text)) {
      const pageNum = parseInt(text, 10);
      await sendBuyPage(api, senderID, threadID, messageID, pageNum);
      return true;
    }

    const pageResources = session.pageResources || [];
    const chosen = pageResources.find(r => r.name === text);

    if (!chosen) {
      // إذا كتب نصاً غير متوفر بالصفحة، نلغي الجلسة
      await deleteMubadilSession(String(senderID));
      return false;
    }

    await setMubadilSession(String(senderID), {
      step: 'await_buy_qty',
      resourceName: chosen.name,
      unitPrice: chosen.price,
      threadID
    });

    await sendReply(api,
      `الغرض : ${chosen.name}\nسعر الوحدة الواحدة : ${chosen.price} كوينز\n🔴 ارسل الكمية التي تريد شرائها\n《 الغاء 》للإلغاء`,
      messageID, threadID);
    return true;
  }

  if (session.step === 'await_buy_qty') {
    if (text.includes('.') || text.includes(',')) {
      await sendReply(api, `يجب ان يكون العدد بدون فاصلة ❌️`, messageID, threadID);
      return true;
    }
    const qty = parseInt(text, 10);
    if (isNaN(qty) || qty <= 0) {
      // إلغاء الجلسة تلقائياً وتوجيه النص لباقي الأوامر
      await deleteMubadilSession(String(senderID));
      return false;
    }

    const resource = findResourceByName(session.resourceName);
    const unitPrice = resource ? await calculatePrice(resource) : session.unitPrice;
    const totalPrice = unitPrice * qty;

    await setMubadilSession(String(senderID), {
      step: 'confirm_buy',
      resourceName: session.resourceName,
      qty,
      totalPrice,
      threadID
    });

    await sendReply(api,
      `⭗ تأكيد عملية الشراء\nالغرض : ${session.resourceName}\nالكمية : ${qty}\nالسعر الإجمالي : ${totalPrice} كوينز\n━════════════════━\nارسل 《 تأكيد 》لتأكيد العملية أو 《 الغاء 》للإلغاء`,
      messageID, threadID);
    return true;
  }

  if (session.step === 'confirm_buy') {
    if (text !== 'تأكيد' && text !== 'تاكيد') {
      await deleteMubadilSession(String(senderID));
      return false;
    }

    processingLock.add(lockKey);
    try {
      await deleteMubadilSession(String(senderID));
      await handleMubadilBuyResource(api, event, session.resourceName, session.qty, session.totalPrice);
    } finally {
      processingLock.delete(lockKey);
    }
    return true;
  }

  if (session.step === 'choose_resource') {
    const choice = parseInt(text, 10);
    if (isNaN(choice) || choice < 0 || choice > session.resources.length) {
      await deleteMubadilSession(String(senderID));
      return false;
    }

    if (choice === 0) {
      let totalCoins = 0;
      const breakdown = [];
      for (const r of session.resources) {
        const resource = findResourceByName(r.name);
        const unitPrice = resource ? await calculatePrice(resource) : 0;
        const sellUnitPrice = Math.round(unitPrice * SELL_RATIO);
        const earned = sellUnitPrice * r.quantity;
        totalCoins += earned;
        breakdown.push({ name: r.name, quantity: r.quantity, earned });
      }

      let confirmMsg = `⭗ بيع جميع مواردك :\n`;
      breakdown.forEach(r => {
        confirmMsg += `◆ ${r.name} ×${r.quantity} — ${r.earned} كوينز\n`;
      });
      confirmMsg += `━════════════════━\n💰 المجموع الكلي : ${totalCoins} كوينز\n━════════════════━\nاكتب 《 بيع 》للتأكيد أو 《 الغاء 》للإلغاء`;

      await setMubadilSession(String(senderID), {
        step: 'confirm_sell_all',
        resources: session.resources,
        totalCoins,
        threadID
      });

      await sendReply(api, confirmMsg, messageID, threadID);
      return true;
    }

    const chosen = session.resources[choice - 1];

    await setMubadilSession(String(senderID), {
      step: 'await_qty',
      resourceName: chosen.name,
      availableQty: chosen.quantity,
      threadID
    });

    await sendReply(api,
      `الغرض : ${chosen.name}\nالكمية المتوفرة لديك : ${chosen.quantity}\n🔴 ارسل الكمية التي تريد بيعها\n《 الغاء 》للإلغاء`,
      messageID, threadID);
    return true;
  }

  if (session.step === 'await_qty') {
    if (text.includes('.') || text.includes(',')) {
      await sendReply(api, `يجب ان يكون العدد بدون فاصلة ❌️`, messageID, threadID);
      return true;
    }
    const qty = parseInt(text, 10);
    if (isNaN(qty) || qty <= 0) {
      await deleteMubadilSession(String(senderID));
      return false;
    }

    const player = await getPlayer(senderID);
    const bag = player.bag || [];
    const item = bag.find(i => i.name === session.resourceName && i.type === 'resource');

    if (!item || item.quantity < qty) {
      await sendReply(api,
        `لا يوجد لديك كمية كافية من ${session.resourceName} 🚫\n◆ لديك : ${item ? item.quantity : 0}`,
        messageID, threadID);
      return true;
    }

    const resource = findResourceByName(session.resourceName);
    const unitPrice = resource ? await calculatePrice(resource) : 0;
    const sellUnitPrice = Math.round(unitPrice * SELL_RATIO);
    const totalPrice = sellUnitPrice * qty;

    await setMubadilSession(String(senderID), {
      step: 'confirm_sell',
      resourceName: session.resourceName,
      qty,
      totalPrice,
      threadID
    });

    await sendReply(api,
      `⭗ تأكيد عملية البيع\nالغرض : ${session.resourceName}\nالكمية : ${qty}\nالسعر الإجمالي : ${totalPrice} كوينز\n━════════════════━\nاكتب 《 بيع 》للتأكيد أو 《 الغاء 》للإلغاء`,
      messageID, threadID);
    return true;
  }

  if (session.step === 'confirm_sell') {
    if (text !== 'بيع') {
      await deleteMubadilSession(String(senderID));
      return false;
    }

    processingLock.add(lockKey);
    try {
      const player = await getPlayer(senderID);
      const bag = player.bag || [];
      const item = bag.find(i => i.name === session.resourceName && i.type === 'resource');

      if (!item || item.quantity < session.qty) {
        await deleteMubadilSession(String(senderID));
        await sendReply(api, `حدث خطأ، الكمية لم تعد متوفرة لديك ❌️`, messageID, threadID);
        return true;
      }

      const removed = await removeItemFromBag(String(senderID), session.resourceName, session.qty);
      if (!removed) {
        await deleteMubadilSession(String(senderID));
        await sendReply(api, `حدث خطأ أثناء عملية البيع ❌️`, messageID, threadID);
        return true;
      }

      const newCoins = (player.coins || 0) + session.totalPrice;
      await updatePlayer(String(senderID), { coins: newCoins });
      await deleteMubadilSession(String(senderID));

      await sendReply(api,
        `✅️ تم البيع بنجاح\n◆ الغرض : ${session.resourceName}\n◆ الكمية : ${session.qty}\n◆ المبلغ المستلم : ${session.totalPrice} كوينز\n◆ رصيدك الحالي : ${newCoins} كوينز`,
        messageID, threadID);
      return true;
    } finally {
      processingLock.delete(lockKey);
    }
  }

  if (session.step === 'confirm_sell_all') {
    if (text !== 'بيع') {
      await deleteMubadilSession(String(senderID));
      return false;
    }

    processingLock.add(lockKey);
    try {
      const player = await getPlayer(senderID);
      let totalEarned = 0;

      for (const r of session.resources) {
        const bag = (await getPlayer(senderID)).bag || [];
        const item = bag.find(i => i.name === r.name && i.type === 'resource');
        if (!item) continue;

        const resource = findResourceByName(r.name);
        const unitPrice = resource ? await calculatePrice(resource) : 0;
        const sellUnitPrice = Math.round(unitPrice * SELL_RATIO);
        const earned = sellUnitPrice * item.quantity;

        await removeItemFromBag(String(senderID), r.name, item.quantity);
        totalEarned += earned;
      }

      const freshPlayer = await getPlayer(senderID);
      const newCoins = (freshPlayer.coins || 0) + totalEarned;
      await updatePlayer(String(senderID), { coins: newCoins });
      await deleteMubadilSession(String(senderID));

      await sendReply(api,
        `✅️ تم بيع جميع مواردك بنجاح\n💰 المبلغ المستلم : ${totalEarned} كوينز\n◆ رصيدك الحالي : ${newCoins} كوينز`,
        messageID, threadID);
      return true;
    } finally {
      processingLock.delete(lockKey);
    }
  }

  return false;
}

// ===== شراء مورد مباشرة =====

function findResourceByName(name) {
  const all = [...MURDAK_RESOURCES, ...NIRAVIL_RESOURCES, ...SOLFARA_RESOURCES];
  return all.find(r => r.name === name);
}

async function handleMubadilBuyResource(api, event, resourceName, qty, agreedTotalPrice) {
  const { threadID, senderID, messageID } = event;

  const resource = findResourceByName(resourceName);
  if (!resource) {
    await sendReply(api, `هذا المورد غير متوفر لدى المبادل ❌️`, messageID, threadID);
    return true;
  }

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return true;
  }

  const quantity = parseInt(qty, 10);
  if (isNaN(quantity) || quantity <= 0) {
    await sendReply(api, `يجب ان يكون العدد صحيحا ❌️`, messageID, threadID);
    return true;
  }

  const totalPrice = (typeof agreedTotalPrice === 'number')
    ? agreedTotalPrice
    : (await calculatePrice(resource)) * quantity;
  const coins = player.coins || 0;

  if (coins < totalPrice) {
    await sendReply(api,
      `رصيدك غير كافي لإتمام عملية الشراء 🚫\n◆ السعر الإجمالي : ${totalPrice} كوينز\n◆ رصيدك : ${coins} كوينز`,
      messageID, threadID);
    return true;
  }

  const bag = player.bag || [];
  const hasItem = bag.find(i => i.name === resourceName && i.type === 'resource');
  const capacity = (player.bagLevel || 1) * 5;

  if (!hasItem && bag.length >= capacity) {
    await sendReply(api, `حقيبتك ممتلئة، لا يمكنك شراء غرض جديد ❌️`, messageID, threadID);
    return true;
  }

  await addItemToBag(String(senderID), resourceName, quantity);
  await updatePlayer(String(senderID), { coins: coins - totalPrice });
  await recordMubadilPurchase(resourceName, senderID, quantity);

  await sendReply(api,
    `✅️ تم الشراء بنجاح\n◆ الغرض : ${resourceName}\n◆ الكمية : ${quantity}\n◆ السعر الإجمالي : ${totalPrice} كوينز\n◆ رصيدك الحالي : ${coins - totalPrice} كوينز`,
    messageID, threadID);
  return true;
}

module.exports = {
  handleMubadil,
  handleMubadilSession,
  handleMubadilBuyResource,
  findResourceByName
};