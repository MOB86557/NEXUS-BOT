const { 
  getDB, 
  getPlayer, 
  updatePlayer, 
  addNotification, 
  getPlayerByNickname,
  registerActiveSession,
  checkAndRemoveFromCache,
  addXP // 🆙 تم استيراد دالة إضافة الـ XP هنا
} = require('./database');
const { sendReply, getKingdomByThreadId } = require('./utils');
const { MATERIALS } = require('./tasni3');
const { changePlayerNickname } = require('./dukhul');

// ===========================
//          المتجر
// ===========================

const SHOP_ITEMS = [
  {
    name: 'رخصة تغيير اللقب',
    price: 350,
    description: 'تسمح بتغيير لقبك باللعبة'
  },
  {
    name: 'مسرع الزمن',
    price: 300,
    description: 'يقلل مدة {الحفر / الجمع / الصيد } للنصف'
  },
  {
    name: 'رخصة إزالة الإنذار',
    price: 900,
    description: 'تزيل إنذاراً واحداً من سجلك'
  }
];

const SHOP_PAGE_SIZE = 4;

async function handleMatjar(api, event, pageNum = 1, searchQuery = null) {
  const { threadID, senderID, messageID } = event;
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return;
  }

  const formatShopItem = item =>
    `╮───∙⋆⋅「 ${item.name}  」\n│ › السعر  : ${item.price}\n│ › الوصف : ${item.description} \n╯───────∙⋆⋅ ※ ⋅⋆∙───────◈`;

  // ===== وضع البحث =====
  if (searchQuery) {
    const q = searchQuery.trim().toLowerCase();
    const results = SHOP_ITEMS.filter(i => i.name.toLowerCase().includes(q));

    if (results.length === 0) {
      await sendReply(api,
        `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    متجر نيكسوس ⌯\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n⚠️ لم يتم ايجاد سلعة بهذا الاسم\n\n━════════════════━\n● للعودة للمتجر اكتب : متجر\n━════════════════━`,
        messageID, threadID);
      return;
    }

    const itemsText = results.map(formatShopItem).join('\n');
    const msg =
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    متجر نيكسوس ⌯\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
      `🔍 نتائج البحث عن : "${searchQuery}"\n\n` +
      itemsText +
      `\n\n━════════════════━\n● وجدت ${results.length} سلعة\n● للعودة للمتجر اكتب : متجر\n━════════════════━`;
    await sendReply(api, msg, messageID, threadID);
    return;
  }

  // ===== وضع الصفحات =====
  const totalPages = Math.ceil(SHOP_ITEMS.length / SHOP_PAGE_SIZE);
  const page = Math.max(1, Math.min(pageNum, totalPages));
  const start = (page - 1) * SHOP_PAGE_SIZE;
  const pageItems = SHOP_ITEMS.slice(start, start + SHOP_PAGE_SIZE);

  const itemsText = pageItems.map(formatShopItem).join('\n');
  const msg =
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    متجر نيكسوس ⌯\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    itemsText +
    `\n\n━════════════════━\n` +
    `● الصفحة ${page}/${totalPages}\n` +
    `● مجموع السلع المتوفر : ${SHOP_ITEMS.length}\n` +
    `● للانتقال لصفحة اخرى رد على هذه الرسالة برقم الصفحة 1.2.3...\n` +
    `● يمكنك البحث عن سلعة ما بالرد على هذه الرسالة وكتابة اسمها\n` +
    `━════════════════━\n` +
    `✧ لشراء غرض ما اكتب ↶\n《شراء اسم الغرض 》`;

  await sendReply(api, msg, messageID, threadID);
}

async function handleMatjarReply(api, event) {
  const text = (event.body || '').trim();
  if (!text) return false;

  const pageNum = parseInt(text, 10);
  if (!isNaN(pageNum) && String(pageNum) === text) {
    await handleMatjar(api, event, pageNum, null);
    return true;
  }

  await handleMatjar(api, event, 1, text);
  return true;
}

async function handleShopBuy(api, event, itemName) {
  const { threadID, senderID, messageID } = event;
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return false;

  const shopItem = SHOP_ITEMS.find(i => i.name === itemName);
  if (!shopItem) return false;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return true;
  }

  const coins = player.coins || 0;
  if (coins < shopItem.price) {
    await sendReply(api,
      `●─────── 🏪 ───────●\n❌️ رصيدك غير كافٍ للشراء\n◆ السعر : ${shopItem.price} كوينز\n◆ رصيدك : ${coins} كوينز\n◆ ينقصك : ${shopItem.price - coins} كوينز\n●─────────────────●`,
      messageID, threadID);
    return true;
  }

  const bag = player.bag || [];
  const bagCapacity = (player.bagLevel || 1) * 5;
  if (bag.length >= bagCapacity) {
    await sendReply(api, `حقيبتك ممتلئة، لايمكنك الشراء 🚫`, messageID, threadID);
    return true;
  }

  const newBag = [...bag];
  newBag.push({ name: shopItem.name, type: 'material' });

  await updatePlayer(String(senderID), {
    coins: coins - shopItem.price,
    bag: newBag
  });

  // 🆙 منح 10 XP للشراء الناجح من المتجر
  await addXP(String(senderID), 10, api, threadID).catch(() => {});

  await sendReply(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✅️ تمت عملية الشراء\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ الغرض : ${shopItem.name}\n◆ الكوينز المدفوعة : ${shopItem.price}\n◆ رصيدك المتبقي : ${coins - shopItem.price} كوينز`,
    messageID, threadID);
  return true;
}

// ===========================
//           السوق
// ===========================

const PAGE_SIZE = 4;

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function getUniqueCode() {
  const db = getDB();
  let code;
  let tries = 0;
  do {
    code = generateCode();
    const existing = await db.collection('market').findOne({ code });
    if (!existing) break;
    tries++;
  } while (tries < 30);
  return code;
}

function formatListing(listing) {
  const lines = [];
  lines.push(`┇⏣ اسم السلعة.  : ${listing.item.name}`);

  if (listing.item.type === 'resource') {
    lines.push(`┇⏣ الكمية المتاحة : ×${listing.item.quantity}`);
    lines.push(`┇⏣ سعر الوحدة : ${listing.price} كوينز`);
  } else if (listing.item.type === 'weapon') {
    lines.push(`┇⏣ الضرر والمتانة : ﴿D${listing.item.damage ?? '-'}/T${listing.item.durability ?? '-'}﴾`);
    lines.push(`┇⏣ سعر الوحدة : ${listing.price} كوينز`);
  } else if (listing.item.type === 'armor') {
    lines.push(`┇⏣ الامتصاص : ${listing.item.absorption ?? '-'}`);
    lines.push(`┇⏣ سعر الوحدة : ${listing.price} كوينز`);
  } else if (listing.item.type === 'material') {
    const mat = MATERIALS.find(m => m.name === listing.item.name);
    lines.push(`┇⏣ التأثير : ${mat ? mat.effect : '-'}`);
    lines.push(`┇⏣ سعر الوحدة : ${listing.price} كوينز`);
  }

  lines.push(`┇⏣ البائع. : ${listing.sellerNickname}`);
  lines.push(`┇✺ رمز الشراء🔖 : ${listing.code}`);
  return lines.join('\n');
}

async function handleSo9(api, event, pageNum = 1, searchQuery = null) {
  const { threadID, senderID, messageID } = event;
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return;
  }

  const db = getDB();
  const allListings = await db.collection('market')
    .find({})
    .sort({ purchases: 1, createdAt: 1 })
    .toArray();

  if (allListings.length === 0) {
    await sendReply(api,
      `╗═════━━━❖━━━═════╔\n⌘                سوق نيكسوس             ⌘  \n╝═════━━━❖━━━═════╚\n\nالسوق فارغ حاليا ... ⌯ ༆\n\n━════════════════━\n● لاضافة سلعة للسوق اكتب ↶\n《 بيع في السوق 》\n━════════════════━`,
      messageID, threadID);
    return;
  }

  // ===== وضع البحث =====
  if (searchQuery) {
    const q = searchQuery.trim().toLowerCase();
    const results = allListings.filter(l =>
      l.item.name.toLowerCase().includes(q)
    );

    if (results.length === 0) {
      await sendReply(api,
        `╗═════━━━❖━━━═════╔\n⌘                سوق نيكسوس             ⌘  \n╝═════━━━❖━━━═════╚\n\n⚠️ لم يتم ايجاد سلعة بهذا الاسم\n\n━════════════════━\n● للعودة لقائمة السوق اكتب : سوق\n━════════════════━`,
        messageID, threadID);
      return;
    }

    const itemsText = results.map(l => formatListing(l)).join('\n▰▰▰▰▰▰▰▰▰▰▰▰▰\n');
    const msg =
      `╗═════━━━❖━━━═════╔\n⌘                سوق نيكسوس             ⌘  \n╝═════━━━❖━━━═════╚\n` +
      `🔍 نتائج البحث عن : "${searchQuery}"\n` +
      `▰▰▰▰▰▰▰▰▰▰▰▰▰\n` +
      itemsText +
      `\n━════════════════━\n● وجدت ${results.length} سلعة\n● للعودة لقائمة السوق اكتب : سوق\n━════════════════━`;

    await sendReply(api, msg, messageID, threadID);
    return;
  }

  // ===== وضع الصفحات العادي =====
  const totalPages = Math.ceil(allListings.length / PAGE_SIZE);
  const page = Math.max(1, Math.min(pageNum, totalPages));
  const start = (page - 1) * PAGE_SIZE;
  const pageItems = allListings.slice(start, start + PAGE_SIZE);

  const itemsText = pageItems.map(l => formatListing(l)).join('\n▰▰▰▰▰▰▰▰⏠▰▰▰▰\n');

  const msg =
    `╗═════━━━❖━━━═════╔\n⌘                سوق نيكسوس             ⌘  \n╝═════━━━❖━━━═════╚\n` +
    itemsText +
    `\n━════════════════━\n` +
    `● الصفحة ${page}/${totalPages}\n` +
    `● مجموع السلع المتوفر : ${allListings.length}\n` +
    `● للانتقال لصفحة اخرى رد على هذه الرسالة برقم الصفحة 1.2.3...\n` +
    `● يمكنك البحث عن سلعة ما بالرد على هذه الرسالة وكتابة اسمها\n` +
    `━════════════════━`;

  await sendReply(api, msg, messageID, threadID);
}

async function handleBa3Fi(api, event) {
  const { threadID, senderID, messageID } = event;
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return;
  }

  const bag = player.bag || [];
  if (bag.length === 0) {
    await sendReply(api, `حقيبتك فارغة لا يوجد شيء للبيع 🚫`, messageID, threadID);
    return;
  }

  const itemLines = bag.map((item, i) => {
    if (item.type === 'resource') return `${i + 1}. ${item.name} ×${item.quantity}`;
    if (item.type === 'weapon') return `${i + 1}. ${item.name} ﴿D${item.damage ?? '-'}/T${item.durability ?? '-'}﴾`;
    if (item.type === 'armor') return `${i + 1}. ${item.name} ﴿A${item.absorption ?? '-'}﴾`;
    if (item.type === 'material') return `${i + 1}. ${item.name}`;
    return `${i + 1}. ${item.name}`;
  });

  await setMarketSession(String(senderID), {
    type: 'sell',
    step: 'await_item',
    bagSnapshot: bag,
    threadID
  });

  await sendReply(api,
    `╗═════━━━❖━━━═════╔\n⌘           بيع في السوق 🏪          ⌘\n╝═════━━━❖━━━═════╚\n${itemLines.join('\n')}\n━════════════════━\nاكتب رقم الغرض المراد بيعه في السوق\n《 الغاء 》للإلغاء`,
    messageID, threadID);
}

async function handleMarketSession(api, event, session) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();
  const db = getDB();

  if (text === 'الغاء') {
    await deleteMarketSession(String(senderID));
    await sendReply(api, `تم الغاء العملية ❌️`, messageID, threadID);
    return;
  }

  if (session.type === 'sell') {

    if (session.step === 'await_item') {
      const num = parseInt(text, 10);
      const bag = session.bagSnapshot;
      if (isNaN(num) || num < 1 || num > bag.length) {
        await sendReply(api, `رقم غير صحيح، اكتب رقماً من 1 إلى ${bag.length}`, messageID, threadID);
        return;
      }
      const chosenItem = bag[num - 1];

      if (chosenItem.type === 'resource') {
        await setMarketSession(String(senderID), { ...session, step: 'await_qty', chosenItem, threadID });
        await sendReply(api,
          `اخترت : ${chosenItem.name}\nلديك : ×${chosenItem.quantity}\nاكتب الكمية المراد بيعها :\n《 الغاء 》للإلغاء`,
          messageID, threadID);
      } else {
        await setMarketSession(String(senderID), { ...session, step: 'await_price', chosenItem, sellQty: 1, threadID });
        await sendReply(api,
          `اخترت : ${chosenItem.name}\nاكتب سعر البيع (بالكوينز) :\n《 الغاء 》للإلغاء`,
          messageID, threadID);
      }
      return;
    }

    if (session.step === 'await_qty') {
      if (text.includes('.') || text.includes(',')) {
        await sendReply(api, `يجب ان يكون العدد بدون فاصلة ❌️`, messageID, threadID);
        return;
      }
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty <= 0) {
        await sendReply(api, `يجب ان يكون العدد صحيحاً ❌️`, messageID, threadID);
        return;
      }
      if (qty > session.chosenItem.quantity) {
        await sendReply(api, `ليس لديك هذه الكمية، لديك فقط ×${session.chosenItem.quantity}`, messageID, threadID);
        return;
      }
      await setMarketSession(String(senderID), { ...session, step: 'await_price', sellQty: qty, threadID });
      await sendReply(api,
        `الكمية : ×${qty}\nاكتب سعر بيع الواحدة (بالكوينز) :\n《 الغاء 》للإلغاء`,
        messageID, threadID);
      return;
    }

    if (session.step === 'await_price') {
      if (text.includes('.') || text.includes(',')) {
        await sendReply(api, `يجب ان يكون السعر بدون فاصلة ❌️`, messageID, threadID);
        return;
      }
      const price = parseInt(text, 10);
      if (isNaN(price) || price <= 0) {
        await sendReply(api, `يجب ان يكون السعر صحيحاً ❌️`, messageID, threadID);
        return;
      }

      const player = await getPlayer(senderID);
      const bag = player.bag || [];
      const chosenItem = session.chosenItem;

      let itemIndex = -1;
      if (chosenItem.type === 'resource') {
        itemIndex = bag.findIndex(i => i.name === chosenItem.name && i.type === 'resource');
        if (itemIndex < 0 || bag[itemIndex].quantity < session.sellQty) {
          await deleteMarketSession(String(senderID));
          await sendReply(api, `لم يعد لديك هذا المورد بالكمية المطلوبة ❌️`, messageID, threadID);
          return;
        }
      } else {
        itemIndex = bag.findIndex(i =>
          i.name === chosenItem.name && i.type === chosenItem.type &&
          i.durability === chosenItem.durability && i.absorption === chosenItem.absorption
        );
        if (itemIndex < 0) {
          await deleteMarketSession(String(senderID));
          await sendReply(api, `لم يعد هذا الغرض موجوداً في حقيبتك ❌️`, messageID, threadID);
          return;
        }
      }

      const code = await getUniqueCode();
      const marketItem = { name: chosenItem.name, type: chosenItem.type };
      if (chosenItem.type === 'resource') {
        marketItem.quantity = session.sellQty;
      } else if (chosenItem.type === 'weapon') {
        marketItem.damage = chosenItem.damage;
        marketItem.durability = chosenItem.durability;
      } else if (chosenItem.type === 'armor') {
        marketItem.absorption = chosenItem.absorption;
      }

      await db.collection('market').insertOne({
        code,
        sellerFbId: String(senderID),
        sellerNickname: player.nickname,
        item: marketItem,
        price,
        purchases: 0,
        createdAt: new Date()
      });

      const newBag = [...bag];
      if (chosenItem.type === 'resource') {
        newBag[itemIndex].quantity -= session.sellQty;
        if (newBag[itemIndex].quantity <= 0) newBag.splice(itemIndex, 1);
      } else {
        newBag.splice(itemIndex, 1);
      }
      await updatePlayer(String(senderID), { bag: newBag });
      await deleteMarketSession(String(senderID));

      await sendReply(api,
        `━════════════════━\n✅️ تم اضافة سلعتك للسوق بنجاح\n◆ السلعة : ${chosenItem.name}\n${chosenItem.type === 'resource' ? `◆ الكمية : ×${session.sellQty}\n` : ''}◆ السعر : ${price} كوينز\n◆ الرمز 🔖 : ${code}\n━════════════════━\nلاسترداد سلعتك لاحقاً اكتب رمزها`,
        messageID, threadID);
      return;
    }
  }

  if (session.type === 'buy') {

    if (session.step === 'await_action') {
      if (text === 'استرداد' && session.isSeller) {
        const freshListing = await db.collection('market').findOne({ code: session.listing.code });
        if (!freshListing) {
          await deleteMarketSession(String(senderID));
          await sendReply(api, `السلعة لم تعد موجودة في السوق ❌️`, messageID, threadID);
          return;
        }
        await retrieveListing(api, event, freshListing);
        await deleteMarketSession(String(senderID));
        return;
      }

      if (text === 'شراء' && !session.isSeller) {
        const freshListing = await db.collection('market').findOne({ code: session.listing.code });
        if (!freshListing) {
          await deleteMarketSession(String(senderID));
          await sendReply(api, `هذه السلعة لم تعد متاحة ❌️`, messageID, threadID);
          return;
        }

        if (freshListing.item.type === 'resource') {
          await setMarketSession(String(senderID), { ...session, step: 'await_buy_qty', listing: freshListing, threadID });
          await sendReply(api,
            `الكمية المتاحة : ×${freshListing.item.quantity}\nاكتب الكمية المراد شرائها :\n《 الغاء 》للإلغاء`,
            messageID, threadID);
        } else {
          const totalPrice = freshListing.price;
          const player = await getPlayer(senderID);
          const coins = player.coins || 0;
          await setMarketSession(String(senderID), { ...session, step: 'await_confirm', listing: freshListing, buyQty: 1, totalPrice, threadID });
          await sendReply(api,
            `━════════════════━\n◆ السلعة : ${freshListing.item.name}\n◆ السعر الكلي : ${totalPrice} كوينز\n◆ رصيدك بعد الشراء : ${coins - totalPrice} كوينز\n━════════════════━\nارسل 《 تأكيد 》 او 《 الغاء 》`,
            messageID, threadID);
        }
        return;
      }
      return;
    }

    if (session.step === 'await_buy_qty') {
      if (text.includes('.') || text.includes(',')) {
        await sendReply(api, `يجب ان يكون العدد بدون فاصلة ❌️`, messageID, threadID);
        return;
      }
      const qty = parseInt(text, 10);
      if (isNaN(qty) || qty <= 0) {
        await sendReply(api, `يجب ان يكون العدد صحيحاً ❌️`, messageID, threadID);
        return;
      }

      const freshListing = await db.collection('market').findOne({ code: session.listing.code });
      if (!freshListing) {
        await deleteMarketSession(String(senderID));
        await sendReply(api, `هذه السلعة لم تعد متاحة ❌️`, messageID, threadID);
        return;
      }
      if (qty > freshListing.item.quantity) {
        await sendReply(api, `الكمية المتاحة فقط ×${freshListing.item.quantity}`, messageID, threadID);
        return;
      }

      const totalPrice = freshListing.price * qty;
      const player = await getPlayer(senderID);
      const coins = player.coins || 0;
      await setMarketSession(String(senderID), { ...session, step: 'await_confirm', listing: freshListing, buyQty: qty, totalPrice, threadID });
      await sendReply(api,
        `━════════════════━\n◆ السلعة : ${freshListing.item.name}\n◆ الكمية : ×${qty}\n◆ السعر الكلي : ${totalPrice} كوينز\n◆ رصيدك بعد الشراء : ${coins - totalPrice} كوينز\n━════════════════━\nارسل 《 تأكيد 》 او 《 الغاء 》`,
        messageID, threadID);
      return;
    }

    if (session.step === 'await_confirm') {
      if (text === 'تأكيد') {
        await executePurchase(api, event, session);
      }
      return;
    }
  }
}

async function executePurchase(api, event, session) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();

  const listing = await db.collection('market').findOne({ code: session.listing.code });
  if (!listing) {
    await deleteMarketSession(String(senderID));
    await sendReply(api, `هذه السلعة لم تعد متاحة ❌️`, messageID, threadID);
    return;
  }

  const player = await getPlayer(senderID);
  const coins = player.coins || 0;
  const { buyQty, totalPrice } = session;
  const item = listing.item;

  if (coins < totalPrice) {
    await deleteMarketSession(String(senderID));
    await sendReply(api,
      `رصيدك غير كافٍ للشراء ❌️\n◆ تحتاج : ${totalPrice} كوينز\n◆ رصيدك : ${coins} كوينز`,
      messageID, threadID);
    return;
  }

  const bag = player.bag || [];
  const bagCapacity = (player.bagLevel || 1) * 5;

  if (item.type === 'resource') {
    const existingResource = bag.find(i => i.name === item.name && i.type === 'resource');
    if (!existingResource && bag.length >= bagCapacity) {
      await deleteMarketSession(String(senderID));
      await sendReply(api, `حقيبتك ممتلئة، لايمكنك الشراء 🚫`, messageID, threadID);
      return;
    }
  } else {
    if (bag.length >= bagCapacity) {
      await deleteMarketSession(String(senderID));
      await sendReply(api, `حقيبتك ممتلئة، لايمكنك الشراء 🚫`, messageID, threadID);
      return;
    }
  }

  await updatePlayer(String(senderID), { coins: coins - totalPrice });

  const seller = await getPlayer(listing.sellerFbId);
  if (seller) {
    await updatePlayer(listing.sellerFbId, { coins: (seller.coins || 0) + totalPrice });
    
    // 🆙 منح الـ XP للبائع بناءً على المبيعات الناجحة في السوق
    if (item.type === 'resource') {
      // بيع كل مورد يعطي 4 XP
      await addXP(listing.sellerFbId, buyQty * 4, api, threadID).catch(() => {});
    } else {
      // بيع سلاح/درع/مادة/أداة متجر يعطي 10 XP
      await addXP(listing.sellerFbId, 10, api, threadID).catch(() => {});
    }

    await addNotification(listing.sellerFbId,
      `🏪 تم بيع سلعتك في السوق\n◆ السلعة : ${item.name}\n${item.type === 'resource' ? `◆ الكمية : ×${buyQty}\n` : ''}◆ الكوينز المستلمة : ${totalPrice}\n◆ المشتري : ${player.nickname}`
    );
  }

  const newBag = [...bag];
  if (item.type === 'resource') {
    const idx = newBag.findIndex(i => i.name === item.name && i.type === 'resource');
    if (idx >= 0) {
      newBag[idx].quantity += buyQty;
    } else {
      newBag.push({ name: item.name, type: 'resource', quantity: buyQty });
    }
    const remaining = listing.item.quantity - buyQty;
    if (remaining <= 0) {
      await db.collection('market').deleteOne({ code: listing.code });
    } else {
      await db.collection('market').updateOne(
        { code: listing.code },
        { $set: { 'item.quantity': remaining }, $inc: { purchases: buyQty } }
      );
    }
  } else {
    newBag.push({ ...item });
    await db.collection('market').deleteOne({ code: listing.code });
  }

  await updatePlayer(String(senderID), { bag: newBag });
  await deleteMarketSession(String(senderID));

  await sendReply(api,
    `━════════════════━\n✅️ تمت عملية الشراء بنجاح\n◆ السلعة : ${item.name}\n${item.type === 'resource' ? `◆ الكمية : ×${buyQty}\n` : ''}◆ الكوينز المدفوعة : ${totalPrice}\n◆ رصيدك المتبقي : ${coins - totalPrice} كوينز\n━════════════════━`,
    messageID, threadID);
}

async function retrieveListing(api, event, listing) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();

  const player = await getPlayer(senderID);
  const bag = player.bag || [];
  const bagCapacity = (player.bagLevel || 1) * 5;
  const item = listing.item;

  if (item.type === 'resource') {
    const existing = bag.find(i => i.name === item.name && i.type === 'resource');
    if (!existing && bag.length >= bagCapacity) {
      await sendReply(api, `حقيبتك ممتلئة، لايمكن استرداد السلعة 🚫`, messageID, threadID);
      return;
    }
  } else {
    if (bag.length >= bagCapacity) {
      await sendReply(api, `حقيبتك ممتلئة، لايمكن استرداد السلعة 🚫`, messageID, threadID);
      return;
    }
  }

  const newBag = [...bag];
  if (item.type === 'resource') {
    const idx = newBag.findIndex(i => i.name === item.name && i.type === 'resource');
    if (idx >= 0) {
      newBag[idx].quantity += item.quantity;
    } else {
      newBag.push({ name: item.name, type: 'resource', quantity: item.quantity });
    }
  } else {
    newBag.push({ ...item });
  }

  await updatePlayer(String(senderID), { bag: newBag });
  await db.collection('market').deleteOne({ code: listing.code });

  await sendReply(api,
    `━════════════════━\n✅️ تم استرداد سلعتك بنجاح\n◆ السلعة : ${item.name}\n${item.type === 'resource' ? `◆ الكمية : ×${item.quantity}\n` : ''}━════════════════━`,
    messageID, threadID);
}

async function handleCode(api, event, code) {
  const { threadID, senderID, messageID } = event;
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return false;

  const db = getDB();
  const listing = await db.collection('market').findOne({ code: code.toUpperCase() });
  if (!listing) return false;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return true;
  }

  const isSeller = listing.sellerFbId === String(senderID);
  const details = formatListing(listing);

  if (isSeller) {
    await setMarketSession(String(senderID), { type: 'buy', step: 'await_action', listing, isSeller: true, threadID });
    await sendReply(api,
      `╗═════━━━❖━━━═════╔\n⌘           سلعتك في السوق 🔖           ⌘\n╝═════━━━❖━━━═════╚\n${details}\n━════════════════━\nلاسترداد سلعتك اكتب 《 استرداد 》\n《 الغاء 》للإلغاء`,
      messageID, threadID);
  } else {
    await setMarketSession(String(senderID), { type: 'buy', step: 'await_action', listing, isSeller: false, threadID });
    await sendReply(api,
      `╗═════━━━❖━━━═════╔\n⌘           تفاصيل السلعة 🔖           ⌘\n╝═════━━━❖━━━═════╚\n${details}\n━════════════════━\nلمواصلة الشراء اكتب 《 شراء 》\n《 الغاء 》للإلغاء`,
      messageID, threadID);
  }
  return true;
}

// ===== جلسات السوق =====

async function getMarketSession(fbId) {
  const db = getDB();
  return await db.collection('market_sessions').findOne({ fbId: String(fbId) });
}

async function setMarketSession(fbId, data) {
  const db = getDB();
  registerActiveSession(fbId); // 🟢 إضافة لكاش الجلسات
  await db.collection('market_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteMarketSession(fbId) {
  const db = getDB();
  await db.collection('market_sessions').deleteOne({ fbId: String(fbId) });
  await checkAndRemoveFromCache(fbId); // 🔴 إزالة آمنة من الكاش
}

// ===========================
//     جلسات الاستعمال
// ===========================

async function getUseSession(fbId) {
  const db = getDB();
  return await db.collection('use_sessions').findOne({ fbId: String(fbId) });
}

async function setUseSession(fbId, data) {
  const db = getDB();
  registerActiveSession(fbId); // 🟢 إضافة لكاش الجلسات
  await db.collection('use_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteUseSession(fbId) {
  const db = getDB();
  await db.collection('use_sessions').deleteOne({ fbId: String(fbId) });
  await checkAndRemoveFromCache(fbId); // 🔴 إزالة آمنة من الكاش
}

// ===========================
//   أمر استعمال أداة المتجر
// ===========================

async function handleUse(api, event, itemName) {
  const { threadID, senderID, messageID } = event;
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return;
  }

  const bag = player.bag || [];
  const itemIndex = bag.findIndex(i => i.name === itemName && i.type === 'material');
  if (itemIndex < 0) {
    await sendReply(api, `❌️ لا تملك 《 ${itemName} 》 في حقيبتك`, messageID, threadID);
    return;
  }

  // ===== مفاتيح الأوامر الموقوفة (الخيار ب) =====
  const KEY_NAMES = [
    'مفتاح أمر ايديت',
    'مفتاح أمر رسم',
    'مفتاح أمر قول',
    'مفتاح أمر ترجمة',
    'مفتاح أمر اقتراح انمي',
    'مفتاح أمر بحث'
  ];
  if (KEY_NAMES.includes(itemName)) {
    // إزالة المفتاح من حقيبة اللاعب تلقائياً لأنه لم يعد مطلوباً
    const newBag = [...bag];
    newBag.splice(itemIndex, 1);
    await updatePlayer(String(senderID), { bag: newBag });

    await sendReply(api,
      `╮───────∙⋆⋅「 تنبيه ℹ️ 」\n│ › هذا المفتاح لم يعد مطلوباً، الأمر مفتوح للجميع.\n│ › تم إزالته من حقيبتك تلقائياً.\n╯───────∙⋆⋅ ※ ⋅⋆∙───────◈`,
      messageID, threadID);
    return;
  }

  // ===== رخصة إزالة الإنذار =====
  if (itemName === 'رخصة إزالة الإنذار') {
    const warnings = player.warnings || 0;
    // لا تستهلك الرخصة إذا لم يكن هناك إنذارات
    if (warnings <= 0) {
      await sendReply(api,
        `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    رخصة إزالة الإنذار 📜\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n❌️ ليس لديك أي إنذارات لإزالتها\n◆ الرخصة لم تُستهلك وما زالت في حقيبتك`,
        messageID, threadID);
      return;
    }
    // إزالة إنذار واحد فقط واستهلاك الرخصة
    const newBag = [...bag];
    newBag.splice(itemIndex, 1);
    const newWarnings = warnings - 1;
    await updatePlayer(String(senderID), { bag: newBag, warnings: newWarnings });
    // تحديث الكنية في المجموعة لإزالة الدائرة الحمراء
    try {
      await changePlayerNickname(api, threadID, senderID, player.nickname, player.rank, player.class, newWarnings);
    } catch (_) {}
    await sendReply(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✅️ تم استعمال رخصة إزالة الإنذار\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ الإنذارات السابقة : ${'🔴'.repeat(warnings)}\n◆ الإنذارات الحالية : ${newWarnings > 0 ? '🔴'.repeat(newWarnings) : '✅️ لا يوجد إنذارات'}`,
      messageID, threadID);
    return;
  }

  // ===== مسرع الزمن =====
  if (itemName === 'مسرع الزمن') {
    const now = Date.now();
    if (player.speedBoost && new Date(player.speedBoost.expires).getTime() > now) {
      const remaining = new Date(player.speedBoost.expires).getTime() - now;
      const totalSec = Math.floor(remaining / 1000);
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const timeStr = hours > 0 ? `${hours} ساعة و ${mins} دقيقة` : `${mins} دقيقة`;
      await sendReply(api,
        `❌️ يوجد مسرع زمن نشط بالفعل\n◆ الوقت المتبقي : ${timeStr}`,
        messageID, threadID);
      return;
    }
    const newBag = [...bag];
    newBag.splice(itemIndex, 1);
    const expires = new Date(now + 24 * 60 * 60 * 1000);
    await updatePlayer(String(senderID), { bag: newBag, speedBoost: { expires } });
    await sendReply(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✅️ تم تفعيل مسرع الزمن\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ مدة الحفر / الجمع / الصيد أصبحت النصف\n◆ التأثير يستمر لمدة 24 ساعة`,
      messageID, threadID);
    return;
  }

  // ===== رخصة تغيير اللقب =====
  if (itemName === 'رخصة تغيير اللقب') {
    await setUseSession(String(senderID), {
      type: 'nickname_change',
      itemIndex,
      threadID
    });
    await sendReply(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    رخصة تغيير اللقب 📜\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ اكتب لقبك الجديد :\n《 الغاء 》للإلغاء`,
      messageID, threadID);
    return;
  }

  // ===== مشروب الطاقة =====
  if (itemName === 'مشروب الطاقة') {
    const currentEP = player.ep ?? 1000;
    const newEP = Math.min(1000, currentEP + 50);
    const newBag = [...bag];
    newBag.splice(itemIndex, 1);
    await updatePlayer(String(senderID), { bag: newBag, ep: newEP });
    await sendReply(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✅️ تم استعمال مشروب الطاقة 🧪\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ EP : ${currentEP} ➡️ ${newEP}/1000`,
      messageID, threadID);
    return;
  }

  // ===== مشروب محفز =====
  if (itemName === 'مشروب محفز') {
    const currentEP = player.ep ?? 1000;
    const newEP = Math.min(1000, currentEP + 150);
    const newBag = [...bag];
    newBag.splice(itemIndex, 1);
    await updatePlayer(String(senderID), { bag: newBag, ep: newEP });
    await sendReply(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✅️ تم استعمال المشروب المحفز 🧪\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ EP : ${currentEP} ➡️ ${newEP}/1000`,
      messageID, threadID);
    return;
  }

  // ===== خلطة الشفاء =====
  if (itemName === 'خلطة الشفاء') {
    const currentHP = player.hp ?? 1000;
    const newHP = Math.min(1000, currentHP + 50);
    const newBag = [...bag];
    newBag.splice(itemIndex, 1);
    await updatePlayer(String(senderID), { bag: newBag, hp: newHP });
    await sendReply(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✅️ تم استعمال خلطة الشفاء 🧪\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ HP : ${currentHP} ➡️ ${newHP}/1000`,
      messageID, threadID);
    return;
  }

  // ===== مشروب الحياة =====
  if (itemName === 'مشروب الحياة') {
    const currentHP = player.hp ?? 1000;
    const newHP = Math.min(1000, currentHP + 100);
    const newBag = [...bag];
    newBag.splice(itemIndex, 1);
    await updatePlayer(String(senderID), { bag: newBag, hp: newHP });
    await sendReply(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✅️ تم استعمال مشروب الحياة 🧪\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ HP : ${currentHP} ➡️ ${newHP}/1000`,
      messageID, threadID);
    return;
  }

  // ===== خلطة الأعماق =====
  if (itemName === 'خلطة الأعماق') {
    const currentHP = player.hp ?? 1000;
    const newHP = Math.min(1000, currentHP + 200);
    const newBag = [...bag];
    newBag.splice(itemIndex, 1);
    await updatePlayer(String(senderID), { bag: newBag, hp: newHP });
    await sendReply(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✅️ تم استعمال خلطة الأعماق 🧪\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ HP : ${currentHP} ➡️ ${newHP}/1000`,
      messageID, threadID);
    return;
  }

  // ===== خلطة الثور الغاضب =====
  if (itemName === 'خلطة الثور الغاضب') {
    const now2 = Date.now();
    if (player.rageBoost && new Date(player.rageBoost.expires).getTime() > now2) {
      const remaining = new Date(player.rageBoost.expires).getTime() - now2;
      const mins = Math.ceil(remaining / 60000);
      await sendReply(api,
        `❌️ خلطة الثور الغاضب نشطة بالفعل\n◆ الوقت المتبقي : ${mins} دقيقة`,
        messageID, threadID);
      return;
    }
    const newBag = [...bag];
    newBag.splice(itemIndex, 1);
    const expires = new Date(now2 + 20 * 60 * 1000);
    await updatePlayer(String(senderID), { bag: newBag, rageBoost: { expires } });
    await sendReply(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✅️ تم تفعيل خلطة الثور الغاضب 🔥\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ عند وصول EP للصفر ستحصل تلقائياً على 100 EP\n◆ التأثير يستمر لمدة 20 دقيقة`,
      messageID, threadID);
    return;
  }

  // ===== إكسير الحياة =====
  if (itemName === 'إكسير الحياة') {
    if (player.lifeElixir) {
      await sendReply(api, `❌️ إكسير الحياة نشط بالفعل`, messageID, threadID);
      return;
    }
    const newBag = [...bag];
    newBag.splice(itemIndex, 1);
    await updatePlayer(String(senderID), { bag: newBag, lifeElixir: true });
    await sendReply(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✅️ تم تفعيل إكسير الحياة 💎\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ عند وصول HP للصفر ستعود للحياة بـ 300 HP`,
      messageID, threadID);
    return;
  }

  await sendReply(api, `❌️ هذه الأداة غير قابلة للاستعمال`, messageID, threadID);
}

// ===========================
//     معالجة جلسة الاستعمال
// ===========================

async function handleUseSession(api, event, session) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  if (text === 'الغاء') {
    await deleteUseSession(String(senderID));
    await sendReply(api, `تم الغاء العملية ❌️`, messageID, threadID);
    return;
  }

  if (session.type === 'nickname_change') {
    // التحقق من اللقب
    let error = null;
    if (text.length < 3) {
      error = 'يجب ان يكون اللقب أكثر من 3 أحرف';
    } else if (text.length > 40) {
      error = 'يجب ان يكون اللقب أقل من 40 حرفاً';
    } else if (!text.replace(/\s/g, '').length) {
      error = 'يجب ألا يكون اللقب عبارة عن فراغات';
    } else {
      const taken = await getPlayerByNickname(text);
      if (taken) error = 'هذا اللقب مستخدم مسبقاً';
    }

    if (error) {
      await sendReply(api, `❌️ ${error}\nاكتب لقباً آخر أو 《 الغاء 》`, messageID, threadID);
      return;
    }

    const player = await getPlayer(senderID);
    const bag = [...(player.bag || [])];
    bag.splice(session.itemIndex, 1);

    const oldNickname = player.nickname;
    await updatePlayer(String(senderID), { nickname: text, bag });
    await deleteUseSession(String(senderID));

    try {
      await changePlayerNickname(api, threadID, senderID, text, player.rank, player.class);
    } catch (_) {}

    await sendReply(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✅️ تم تغيير اللقب\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n◆ اللقب القديم : ${oldNickname}\n◆ اللقب الجديد : ${text}`,
      messageID, threadID);
  }
}

// ===========================
//   معالجة الرد على رسالة السوق
//   (رقم صفحة أو بحث بالاسم)
// ===========================

/**
 * يُستدعى من event_router عند الرد على رسالة السوق
 * @param {object} api
 * @param {object} event  - يجب أن يحتوي body
 * @returns {boolean} true إذا تمت المعالجة
 */
async function handleSo9Reply(api, event) {
  const text = (event.body || '').trim();
  if (!text) return false;

  // رقم صفحة ؟
  const pageNum = parseInt(text, 10);
  if (!isNaN(pageNum) && String(pageNum) === text) {
    await handleSo9(api, event, pageNum, null);
    return true;
  }

  // نص → بحث
  await handleSo9(api, event, 1, text);
  return true;
}

module.exports = {
  handleMatjar,
  handleMatjarReply,
  handleShopBuy,
  handleUse,
  handleUseSession,
  getUseSession,
  handleSo9,
  handleSo9Reply,
  handleBa3Fi,
  handleMarketSession,
  handleCode,
  getMarketSession,
  hasKey
};
// ===========================
//   فحص امتلاك مفتاح أمر
// ===========================

/**
 * دالة تفقد امتلاك المفتاح - تم تحديثها لتُرجع true دائمًا
 * لجعل جميع الأوامر مفتوحة لكافة اللاعبين بدون شروط.
 * @param {object} player - كائن اللاعب
 * @param {string} keyName - اسم المفتاح
 * @returns {boolean}
 */
function hasKey(player, keyName) {
  return true;
}