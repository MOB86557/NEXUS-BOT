const { getPlayer, updatePlayer, addItemToBag } = require('./database');
const { sendReply } = require('./utils');
const { findResourceByName, calculatePrice } = require('./mubadil');

// ===== بيانات الأسلحة =====

const WEAPONS = [
  {
    name: 'السيف الصخري',
    damage: 5,
    durability: 2,
    recipe: [{ name: 'صخرة', qty: 12 }, { name: 'خشب', qty: 3 }]
  },
  {
    name: 'السيف الحديدي',
    damage: 10,
    durability: 3,
    recipe: [{ name: 'حديد', qty: 10 }, { name: 'فحم', qty: 2 }, { name: 'خشب', qty: 2 }]
  },
  {
    name: 'الخنجر',
    damage: 15,
    durability: 4,
    recipe: [{ name: 'حديد', qty: 8 }, { name: 'راتنج', qty: 3 }, { name: 'فضة', qty: 1 }]
  },
  {
    name: 'الرمح',
    damage: 20,
    durability: 5,
    recipe: [{ name: 'خشب', qty: 10 }, { name: 'حديد', qty: 6 }, { name: 'فحم', qty: 2 }]
  },
  {
    name: 'النشاب',
    damage: 25,
    durability: 6,
    recipe: [{ name: 'خشب', qty: 12 }, { name: 'راتنج', qty: 4 }, { name: 'حديد', qty: 4 }]
  },
  {
    name: 'مطرقة الحرب',
    damage: 30,
    durability: 7,
    recipe: [{ name: 'حديد', qty: 14 }, { name: 'صخرة', qty: 6 }, { name: 'فحم', qty: 4 }]
  },
  {
    name: 'النشاب المطور',
    damage: 35,
    durability: 8,
    recipe: [
      { name: 'النشاب', qty: 1, type: 'weapon' },
      { name: 'فضة', qty: 4 },
      { name: 'فطر متوهج', qty: 2 },
      { name: 'راتنج', qty: 2 }
    ]
  },
  {
    name: 'المنجل',
    damage: 40,
    durability: 9,
    recipe: [{ name: 'حديد', qty: 10 }, { name: 'ذهب', qty: 4 }, { name: 'أعشاب سامة', qty: 2 }]
  },
  {
    name: 'نصل التنين',
    damage: 45,
    durability: 10,
    recipe: [
      { name: 'ذهب', qty: 6 },
      { name: 'ياقوت مشع', qty: 4 },
      { name: 'كريستال البحر', qty: 3 },
      { name: 'بذور سحرية', qty: 2 }
    ]
  },
  {
    name: 'المنجل المزدوج',
    damage: 50,
    durability: 11,
    recipe: [
      { name: 'المنجل', qty: 1, type: 'weapon' },
      { name: 'ياقوت مشع', qty: 5 },
      { name: 'بذور سحرية', qty: 4 },
      { name: 'كريستال البحر', qty: 4 },
      { name: 'ذهب', qty: 6 }
    ]
  }
];

// ===== بيانات الدروع =====

const ARMORS = [
  {
    name: 'درع الحامي',
    absorption: 8,
    recipe: [{ name: 'خشب', qty: 8 }, { name: 'صخرة', qty: 4 }]
  },
  {
    name: 'ترس',
    absorption: 16,
    recipe: [{ name: 'خشب', qty: 6 }, { name: 'حديد', qty: 6 }]
  },
  {
    name: 'درع الصخرة',
    absorption: 32,
    recipe: [{ name: 'صخرة', qty: 14 }, { name: 'حديد', qty: 6 }]
  },
  {
    name: 'درع الأعماق',
    absorption: 64,
    recipe: [{ name: 'أصداف', qty: 8 }, { name: 'طحالب بحرية', qty: 4 }, { name: 'لؤلؤ', qty: 2 }]
  },
  {
    name: 'درع الصمود',
    absorption: 128,
    recipe: [{ name: 'حديد', qty: 12 }, { name: 'فحم', qty: 6 }, { name: 'فضة', qty: 2 }]
  },
  {
    name: 'درع الورق الحديدي',
    absorption: 150,
    recipe: [{ name: 'حديد', qty: 14 }, { name: 'راتنج', qty: 4 }, { name: 'ذهب', qty: 2 }]
  },
  {
    name: 'درع الجدار الحديدي',
    absorption: 200,
    recipe: [{ name: 'حديد', qty: 20 }, { name: 'فحم', qty: 8 }, { name: 'ذهب', qty: 4 }]
  },
  {
    name: 'ترس القوقعة',
    absorption: 290,
    recipe: [{ name: 'أصداف', qty: 10 }, { name: 'مرجان', qty: 5 }, { name: 'لؤلؤ', qty: 4 }]
  },
  {
    name: 'ترس الأشواك',
    absorption: 340,
    recipe: [
      { name: 'ترس القوقعة', qty: 1, type: 'armor' },
      { name: 'أعشاب سامة', qty: 4 },
      { name: 'مرجان', qty: 2 },
      { name: 'فضة', qty: 2 }
    ]
  },
  {
    name: 'درع الحرب',
    absorption: 400,
    recipe: [
      { name: 'ذهب', qty: 8 },
      { name: 'ياقوت مشع', qty: 4 },
      { name: 'كريستال البحر', qty: 4 },
      { name: 'بذور سحرية', qty: 4 }
    ]
  }
];

// ===== بيانات المواد =====

const MATERIALS = [
  {
    name: 'مشروب الطاقة',
    effect: 'زيادة 200 نقطة طاقة',
    recipe: [{ name: 'فطر متوهج', qty: 2 }, { name: 'سمك', qty: 2 }]
  },
  {
    name: 'مشروب محفز',
    effect: 'زيادة 400 نقطة طاقة',
    recipe: [{ name: 'فطر متوهج', qty: 3 }, { name: 'بذور سحرية', qty: 2 }, { name: 'ذهب', qty: 1 }]
  },
  {
    name: 'خلطة الشفاء',
    effect: 'زيادة 200 نقطة حياة',
    recipe: [{ name: 'اعشاب طبية', qty: 4 }, { name: 'طحالب بحرية', qty: 1 }]
  },
  {
    name: 'مشروب الحياة',
    effect: 'زيادة 400 نقطة حياة',
    recipe: [{ name: 'اعشاب طبية', qty: 6 }, { name: 'لؤلؤ', qty: 2 }, { name: 'راتنج', qty: 1 }]
  },
  {
    name: 'خلطة الأعماق',
    effect: 'زيادة 650 نقطة حياة',
    recipe: [{ name: 'مرجان', qty: 4 }, { name: 'كريستال البحر', qty: 3 }, { name: 'بذور سحرية', qty: 2 }]
  },
  {
    name: 'ترياق العلاج',
    effect: 'إلغاء تأثير السموم لدقيقة واحدة',
    recipe: [{ name: 'اعشاب طبية', qty: 3 }, { name: 'راتنج', qty: 2 }]
  },
  {
    name: 'السم الأسود',
    effect: 'مادة سامة تأثير نصف دقيقة',
    recipe: [{ name: 'أعشاب سامة', qty: 3 }, { name: 'فحم', qty: 1 }]
  },
  {
    name: 'سم الغدر',
    effect: 'مادة سامة تأثير دقيقة',
    recipe: [{ name: 'أعشاب سامة', qty: 5 }, { name: 'فطر متوهج', qty: 1 }]
  },
  {
    name: 'سم الخدر',
    effect: 'مادة سامة قوية تأثير 5 دقائق',
    recipe: [{ name: 'أعشاب سامة', qty: 6 }, { name: 'بذور سحرية', qty: 2 }, { name: 'ياقوت مشع', qty: 1 }]
  },
  {
    name: 'ترياق الشجرة الأم',
    effect: 'إلغاء تأثير السموم لأربع دقائق',
    recipe: [{ name: 'اعشاب طبية', qty: 5 }, { name: 'بذور سحرية', qty: 3 }, { name: 'لؤلؤ', qty: 1 }]
  },
  {
    name: 'خلطة الثور الغاضب',
    effect: 'زيادة 100 نقطة طاقة عند وصول الطاقة للصفر لمدة 20 دقيقة',
    recipe: [{ name: 'فحم', qty: 4 }, { name: 'ذهب', qty: 3 }, { name: 'فطر متوهج', qty: 2 }]
  },
  {
    name: 'إكسير الحياة',
    effect: 'عند وصول نقاط الحياة للصفر يمنحك فرصة العودة ويرفع نقاط الحياة إلى 300',
    recipe: [
      { name: 'ياقوت مشع', qty: 4 },
      { name: 'كريستال البحر', qty: 4 },
      { name: 'بذور سحرية', qty: 4 },
      { name: 'ذهب', qty: 2 }
    ]
  }
];

// ===== الشراء السريع للمواد الناقصة =====

const QUICK_BUY_FEE = 30; // رسوم ثابتة تُضاف على تكلفة المواد عند الشراء السريع
const QUICK_BUY_EXPIRY_MS = 5 * 60 * 1000; // مدة صلاحية عرض الشراء السريع (تطابق كاش أسعار المبادل)

// جلسات الشراء السريع بالذاكرة، مفتاحها senderID
// القيمة: { threadID, itemName, purchases, totalCost, replyMessageId, expiresAt }
const pendingQuickBuy = new Map();

// أغراض معفاة من تكلفة الـ EP عند التصنيع (لا تُخصم منها طاقة ولا يُطبق شرط الحد الأدنى)
const EP_FREE_MATERIALS = ['مشروب محفز', 'مشروب الطاقة'];

// ===== مساعدات =====

function getBagCapacity(player) {
  return (player.bagLevel || 1) * 5;
}

function recipeText(recipe) {
  return recipe.map(ing => `${ing.qty} ${ing.name}`).join(' + ');
}

function canCraft(bag, recipe) {
  for (const ing of recipe) {
    if (ing.type === 'weapon' || ing.type === 'armor') {
      const found = bag.filter(i => i.name === ing.name && i.type === ing.type);
      if (found.length < ing.qty) return false;
    } else {
      const res = bag.find(i => i.name === ing.name && i.type === 'resource');
      if (!res || res.quantity < ing.qty) return false;
    }
  }
  return true;
}

function consumeIngredients(bag, recipe) {
  const newBag = bag.map(i => ({ ...i }));
  for (const ing of recipe) {
    if (ing.type === 'weapon' || ing.type === 'armor') {
      let count = ing.qty;
      for (let i = newBag.length - 1; i >= 0 && count > 0; i--) {
        if (newBag[i].name === ing.name && newBag[i].type === ing.type) {
          newBag.splice(i, 1);
          count--;
        }
      }
    } else {
      const idx = newBag.findIndex(i => i.name === ing.name && i.type === 'resource');
      if (idx >= 0) {
        newBag[idx].quantity -= ing.qty;
        if (newBag[idx].quantity <= 0) newBag.splice(idx, 1);
      }
    }
  }
  return newBag;
}

function findCraftable(name) {
  const w = WEAPONS.find(x => x.name === name);
  if (w) return { item: w, itemType: 'weapon' };
  const a = ARMORS.find(x => x.name === name);
  if (a) return { item: a, itemType: 'armor' };
  const m = MATERIALS.find(x => x.name === name);
  if (m) return { item: m, itemType: 'material' };
  return null;
}

function buildSortedList(items, bag, buildEntry) {
  const canList = [];
  const cantList = [];
  for (const item of items) {
    const able = canCraft(bag, item.recipe);
    const entry = buildEntry(item, able);
    if (able) canList.push(entry);
    else cantList.push(entry);
  }
  return [...cantList, ...canList].join('\n──────────────\n');
}

// ===== قائمة التصنيع الرئيسية =====

async function handleTasni3Menu(api, event, kingdom) {
  const { senderID, messageID, threadID } = event;
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return;
  }

  const msg =
    `╭──────────────⟢ـ\n` +
    `         منطقة التصنيع ⚙️\n` +
    `谷──────────────⟢ـ\n` +
    `✦ اختر ماتود تصنيعه :\n\n` +
    `╗═════  ⚔️  ═════╔\n` +
    `║             أسلحة                ║\n` +
    `╝═════════════╚\n` +
    `╗═════  🛡️  ═════╔\n` +
    `║             دروع                  ║\n` +
    `╝═════════════╚\n` +
    `╗═════  🧪  ═════╔\n` +
    `║             مواد                   ║\n` +
    `╝═════════════╚`;

  await sendReply(api, msg, messageID, threadID);
}

// ===== قائمة الأسلحة =====

async function handleAslihah(api, event, kingdom) {
  const { senderID, messageID, threadID } = event;
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return;
  }

  const bag = player.bag || [];

  const list = buildSortedList(WEAPONS, bag, (w, able) => {
    const circle = able ? '🟢' : '🔴';
    return (
      `${circle}\n` +
      `⟬ ${w.name} ⟭\n` +
      `◈ الضرر : ${w.damage}\n` +
      `◈ المتانة : ${w.durability}\n` +
      `⚒️ الوصفة : ${recipeText(w.recipe)}`
    );
  });

  const msg =
    `━━━━━━━━ ⚔️ ━━━━━━━━\n` +
    `${list}\n` +
    `──────────────\n` +
    `لتصنيع اي سلاح اكتب  ↶\n` +
    `《   تصنيع ( اسم السلاح )   》\n` +
    `──────────────`;

  await sendReply(api, msg, messageID, threadID);
}

// ===== قائمة الدروع =====

async function handleDuru3(api, event, kingdom) {
  const { senderID, messageID, threadID } = event;
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return;
  }

  const bag = player.bag || [];

  const list = buildSortedList(ARMORS, bag, (a, able) => {
    const circle = able ? '🟢' : '🔴';
    return (
      `${circle}\n` +
      `⟬ ${a.name} ⟭\n` +
      `◈ الامتصاص : ${a.absorption}\n` +
      `⚒️ الوصفة : ${recipeText(a.recipe)}`
    );
  });

  const msg =
    `━━━━━━━━ 🛡️ ━━━━━━━━\n` +
    `${list}\n` +
    `──────────────\n` +
    `لتصنيع اي درع اكتب  ↶\n` +
    `《   تصنيع ( اسم الدرع )   》\n` +
    `──────────────`;

  await sendReply(api, msg, messageID, threadID);
}

// ===== قائمة المواد =====

async function handleMawad(api, event, kingdom) {
  const { senderID, messageID, threadID } = event;
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return;
  }

  const bag = player.bag || [];

  const list = buildSortedList(MATERIALS, bag, (m, able) => {
    const circle = able ? '🟢' : '🔴';
    return (
      `${circle}\n` +
      `⟬ ${m.name} ⟭\n` +
      `◈ التأثير : ${m.effect}\n` +
      `⚒️ الوصفة : ${recipeText(m.recipe)}`
    );
  });

  const msg =
    `━━━━━━━━ 🧪 ━━━━━━━━\n` +
    `${list}\n` +
    `──────────────\n` +
    `المواد تستهلك مباشرة عند استعمالها\n` +
    `لتصنيع اي مادة اكتب  ↶\n` +
    `《   تصنيع ( اسم المادة )   》\n` +
    `──────────────`;

  await sendReply(api, msg, messageID, threadID);
}

// ===== تصنيع غرض =====

async function handleCraftItem(api, event, kingdom) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();
  if (!kingdom) return;

  const match = text.match(/^تصنيع\s+(.+)$/);
  if (!match) return;
  const itemName = match[1].trim();

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return;
  }

  const isEpFree = EP_FREE_MATERIALS.includes(itemName);
  const currentEP = player.ep ?? 1000;
  if (!isEpFree && currentEP < 30) {
    await sendReply(api,
      `●── ⟪ فشل التصنيع ⚙️❌ ⟫ ──●\n❖ طاقتك غير كافية للتصنيع\n❖ EP لديك : ${currentEP}/1000\n❖ تحتاج على الأقل 30 EP\n●─────── ⌬ ───────●`,
      messageID, threadID);
    return;
  }

  const found = findCraftable(itemName);
  if (!found) {
    await sendReply(api,
      `●── ⟪ فشل التصنيع ⚙️❌ ⟫ ──●\n❖ لا يوجد غرض بهذا الاسم في قائمة التصنيع\n●─────── ⌬ ───────●`,
      messageID, threadID);
    return;
  }

  const { item, itemType } = found;
  const bag = player.bag || [];

  if (!canCraft(bag, item.recipe)) {
    const missing = [];
    const purchasable = [];
    let hasUnpurchasableMissing = false;

    for (const ing of item.recipe) {
      if (ing.type === 'weapon' || ing.type === 'armor') {
        const have = bag.filter(i => i.name === ing.name && i.type === ing.type).length;
        if (have < ing.qty) {
          missing.push(`${ing.name} (لديك ${have}/${ing.qty})`);
          hasUnpurchasableMissing = true;
        }
      } else {
        const res = bag.find(i => i.name === ing.name && i.type === 'resource');
        const have = res ? res.quantity : 0;
        if (have < ing.qty) {
          missing.push(`${ing.name} (لديك ${have}/${ing.qty})`);
          const needQty = ing.qty - have;
          const resourceDef = findResourceByName(ing.name);
          if (resourceDef) {
            const unitPrice = await calculatePrice(resourceDef);
            purchasable.push({ name: ing.name, needQty, unitPrice, cost: unitPrice * needQty });
          } else {
            hasUnpurchasableMissing = true;
          }
        }
      }
    }

    let msg =
      `●── ⟪ فشل التصنيع ⚙️❌ ⟫ ──●\n` +
      `❖ مواردك غير كافية\n${missing.map(m => `┇ ${m}`).join('\n')}`;

    let quickBuy = null;
    if (purchasable.length > 0) {
      const materialsCost = purchasable.reduce((sum, p) => sum + p.cost, 0);
      const totalCost = materialsCost + QUICK_BUY_FEE;
      quickBuy = { purchases: purchasable, totalCost };

      msg += `\n➤ للشراء السريع للمواد الناقصة رد على هذه الرسالة برقم 0\n`;
      msg += `❖ التكلفة : ${totalCost} كوينز (شامل 30 كوينز رسوم الشراء السريع)`;
      if (hasUnpurchasableMissing) {
        msg += `\n⚠️ الشراء السريع يغطي الموارد الخام فقط دون الأغراض المُصنّعة الناقصة أعلاه`;
      }
    }

    msg += `\n●─────── ⌬ ───────●`;

    const sentInfo = await sendReply(api, msg, messageID, threadID);

    if (quickBuy && sentInfo && sentInfo.messageID) {
      pendingQuickBuy.set(String(senderID), {
        threadID,
        itemName: item.name,
        purchases: quickBuy.purchases,
        totalCost: quickBuy.totalCost,
        replyMessageId: String(sentInfo.messageID),
        expiresAt: Date.now() + QUICK_BUY_EXPIRY_MS
      });
    }

    return;
  }

  const bagAfterConsume = consumeIngredients(bag, item.recipe);
  const capacity = getBagCapacity(player);

  if (itemType === 'weapon') {
    const sameCount = bagAfterConsume.filter(i => i.name === item.name && i.type === 'weapon').length;
    if (sameCount >= 3) {
      await sendReply(api,
        `●── ⟪ فشل التصنيع ⚙️❌ ⟫ ──●\n❖ لا يمكن تخزين أكثر من 3 من نفس السلاح في الحقيبة\n●─────── ⌬ ───────●`,
        messageID, threadID);
      return;
    }
  }

  if (bagAfterConsume.length >= capacity) {
    await sendReply(api,
      `●── ⟪ فشل التصنيع ⚙️❌ ⟫ ──●\n❖ حقيبتك ممتلئة\n❖ احذف بعض الأغراض لتتمكن من التصنيع\n●─────── ⌬ ───────●`,
      messageID, threadID);
    return;
  }

  let newItem;
  let displayText;

  if (itemType === 'weapon') {
    newItem = { name: item.name, type: 'weapon', damage: item.damage, durability: item.durability };
    displayText = `${item.name} ﴿D${item.damage}/T${item.durability}﴾`;
  } else if (itemType === 'armor') {
    newItem = { name: item.name, type: 'armor', absorption: item.absorption };
    displayText = `${item.name} ﴿A${item.absorption}﴾`;
  } else {
    newItem = { name: item.name, type: 'material' };
    displayText = item.name;
  }

  bagAfterConsume.push(newItem);
  const epCost = isEpFree ? 0 : 30;
  await updatePlayer(String(senderID), { bag: bagAfterConsume, ep: currentEP - epCost });

  await sendReply(api,
    `●── ⟪ تم التصنيع بنجاح ⚙️✅ ⟫ ──●\n『 الغرض المصنوع 』↜ ┇ ${displayText}\n●─────── ⌬ ───────●`,
    messageID, threadID);
}

// ===== معالجة رد الشراء السريع للمواد الناقصة =====
// يجب استدعاء هذه الدالة من الموجه الرئيسي عند وصول رد على رسالة (قبل معالجة الأوامر الأخرى)
// إن أعادت true فهذا يعني أن الرسالة عولجت، وإلا فيجب تمريرها لباقي المعالجات

async function handleCraftQuickBuyReply(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();
  if (text !== '0') return false;

  const repliedId = event.messageReply ? String(event.messageReply.messageID) : null;
  if (!repliedId) return false;

  const pending = pendingQuickBuy.get(String(senderID));
  if (!pending || pending.replyMessageId !== repliedId) {
    await sendReply(api,
      `هذا العرض لم يعد صالحاً (منتهي الصلاحية أو تم استبداله بمحاولة تصنيع أحدث)، حاول التصنيع مجدداً ⌛️`,
      messageID, threadID);
    return true;
  }

  pendingQuickBuy.delete(String(senderID));

  if (Date.now() > pending.expiresAt) {
    await sendReply(api,
      `انتهت صلاحية عرض الشراء السريع، حاول التصنيع مجدداً ⌛️`,
      messageID, threadID);
    return true;
  }

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, messageID, threadID);
    return true;
  }

  const coins = player.coins || 0;
  if (coins < pending.totalCost) {
    await sendReply(api,
      `رصيدك غير كافي لإتمام الشراء السريع 🚫\n◆ التكلفة : ${pending.totalCost} كوينز\n◆ رصيدك : ${coins} كوينز`,
      messageID, threadID);
    return true;
  }

  const bag = player.bag || [];
  const capacity = getBagCapacity(player);
  const newDistinctItems = pending.purchases.filter(p =>
    !bag.some(i => i.name === p.name && i.type === 'resource')
  ).length;

  if (bag.length + newDistinctItems > capacity) {
    await sendReply(api, `حقيبتك ممتلئة، لا يمكنك إتمام الشراء السريع ❌️`, messageID, threadID);
    return true;
  }

  for (const p of pending.purchases) {
    await addItemToBag(String(senderID), p.name, p.needQty);
  }
  const newCoins = coins - pending.totalCost;
  await updatePlayer(String(senderID), { coins: newCoins });

  const breakdown = pending.purchases
    .map(p => `◆ ${p.name} ×${p.needQty} — ${p.cost} كوينز`)
    .join('\n');

  await sendReply(api,
    `✅️ تم الشراء السريع بنجاح\n${breakdown}\n💰 التكلفة الإجمالية : ${pending.totalCost} كوينز\n◆ رصيدك الحالي : ${newCoins} كوينز\n\nيمكنك الآن إعادة محاولة التصنيع 《 تصنيع ${pending.itemName} 》`,
    messageID, threadID);
  return true;
}

module.exports = {
  handleTasni3Menu,
  handleAslihah,
  handleDuru3,
  handleMawad,
  handleCraftItem,
  handleCraftQuickBuyReply,
  WEAPONS,
  ARMORS,
  MATERIALS
};
