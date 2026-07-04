// musa3idat.js
// دوال مساعدة عامة يستخدمها الراوتر: إشعار الأدمن، فتح الصندوق الأسود، عرض خريطة العالم
const { getKingdomByThreadId, getCityByThreadId, sendMessage, sendReply, kingdomNamesAr } = require('./utils');
const { updatePlayer } = require('./database');

// ميزة إخطار جميع المسؤولين الأساسيين عبر الرسائل الخاصة والاشعارات
async function notifyAdmins(api, message) {
  const db = require('./database').getDB();
  const config = require('./config.json');

  const adminIdsFromConfig = config.adminIDs || config.admins || config.ownerID || [];
  const ids = (Array.isArray(adminIdsFromConfig) ? adminIdsFromConfig : [adminIdsFromConfig]).map(String);

  try {
    const emperors = await db.collection('players').find({ rank: 'الامبراطور' }).toArray();
    for (const emp of emperors) {
      const empId = String(emp.fbId);
      if (!ids.includes(empId)) ids.push(empId);
    }
  } catch (e) {}

  for (const id of ids) {
    try {
      await db.collection('notifications').insertOne({
        fbId: id,
        message: message,
        createdAt: new Date(),
        sent: false
      });
    } catch (e) {}

    try {
      await sendMessage(api, message, id);
    } catch (e) {}
  }
}

// ميزة تشغيل الصندوق الأسود المطور وحساب المساحة
async function handleUseBlackBox(api, event, player) {
  const { threadID, senderID, messageID } = event;
  const bag = player.bag || [];
  const boxes = bag.filter(i => i.name === 'الصندوق الاسود');

  if (boxes.length === 0) {
    await sendReply(api, `❌ لا يوجد لديك أي صندوق أسود في حقيبتك!`, messageID, threadID);
    return;
  }

  const selectedBox = boxes[Math.floor(Math.random() * boxes.length)];
  const lootCoins = selectedBox.lootCoins || 0;
  const lootBag = selectedBox.lootBag || [];
  const victimName = selectedBox.victimName || "مجهول";

  if (lootCoins === 0 && lootBag.length === 0) {
    const tempBag = bag.filter(i => i !== selectedBox);
    await updatePlayer(String(senderID), { bag: tempBag });
    await sendReply(api, `📦 فتحت الصندوق الأسود الخاص بـ [${victimName}] ولكنه كان فارغاً تماماً! 💨`, messageID, threadID);
    return;
  }

  const maxSlots = (player.bagLevel || 1) * 10;
  const tempBag = bag.map(i => ({ ...i }));

  const boxIdx = tempBag.findIndex(i => i.name === 'الصندوق الاسود' && i.victimName === victimName && i.lootCoins === lootCoins);
  if (boxIdx !== -1) {
    tempBag.splice(boxIdx, 1);
  }

  for (const loot of lootBag) {
    if (loot.type === 'resource') {
      const idx = tempBag.findIndex(i => i.name === loot.name && i.type === 'resource');
      if (idx !== -1) {
        tempBag[idx].quantity += loot.quantity;
      } else {
        tempBag.push({ ...loot });
      }
    } else {
      tempBag.push({ ...loot });
    }
  }

  if (tempBag.length > maxSlots) {
    await sendReply(api,
      `🎒 حقيبتك ممتلئة ولا تتسع لمحتويات هذا الصندوق!\n` +
      `📦 المساحة المطلوبة: ${tempBag.length} خانة / السعة القصوى المتاحة: ${maxSlots} خانة.\n` +
      `💡 قم ببيع بعض الأغراض أو تفريغ حقيبتك لتتمكن من فتحه.`,
      messageID, threadID);
    return;
  }

  const finalCoins = (player.coins || 0) + lootCoins;
  await updatePlayer(String(senderID), { bag: tempBag, coins: finalCoins });

  const itemsList = lootBag.map(i => `▫️ ${i.name} ${i.quantity ? `×${i.quantity}` : ''}`).join('\n') || '▫️ لا يوجد أغراض عينية';

  const successMsg =
    `🎉 ⟦ تـم فـتـح الـصـنـدوق الأسـود ⟧ 🎉\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `👤 ممتلكات الضحية المستهدفة : ${victimName}\n` +
    `💰 الكوينز المستردة : +${lootCoins} كوينز\n\n` +
    `🎒 الأغراض التي حصلت عليها :\n${itemsList}\n` +
    `━━━━━━━━━━━━━━━━━━━`;

  await sendReply(api, successMsg, messageID, threadID);
}

// ميزة عرض خريطة عالم نيكسوس (المدن والممالك وموقع اللاعب الحالي والأصلي)
async function handleKharita(api, event, player) {
  const { threadID } = event;
  const { getDB } = require('./database');

  let allCities = [];
  try {
    allCities = await getDB().collection('cities').find().toArray();
  } catch (e) {}

  const citiesMap = { solfare: [], niravil: [], murdak: [] };
  for (const c of allCities) {
    if (citiesMap[c.kingdom]) citiesMap[c.kingdom].push(c.name);
  }

  let currentLocation = '—';
  let originalLocation = '—';

  if (player) {
    const regCity = player.registeredCityName;
    const regKingdom = kingdomNamesAr[player.kingdom] || player.kingdom;
    originalLocation = regCity ? `${regKingdom} — ${regCity}` : `${regKingdom} — العاصمة`;

    const capKingdom = getKingdomByThreadId(threadID);
    if (capKingdom) {
      currentLocation = `${kingdomNamesAr[capKingdom]} — العاصمة`;
    } else {
      const cityDoc = await getCityByThreadId(threadID);
      if (cityDoc) {
        currentLocation = `${kingdomNamesAr[cityDoc.kingdom]} — ${cityDoc.name}`;
      }
    }
  }

  const kingdoms = ['murdak', 'solfare', 'niravil'];
  let mapMsg = `؜━━━━━━━━━━━━━━━━━━━\n⊱          خريطة عالم نيكسوس.          ⊰\n━━━━━━━━━━━━━━━━━━━\n`;

  for (const k of kingdoms) {
    const cities = citiesMap[k];
    mapMsg += `؜╮───∙⋆⋅「 مملكة ${kingdomNamesAr[k]} 」\n│ › العاصمة\n`;
    for (const cityName of cities) {
      mapMsg += `│ › ${cityName}\n`;
    }
    mapMsg += `╯───────∙⋆⋅ ※ ⋅⋆∙\n`;
  }

  mapMsg += `━━━━━━━━━━━━━━━━━━━\n`;
  mapMsg += `موقعك الحالي : ⊹ ${currentLocation}\n`;
  mapMsg += `موقع الاصلي   : ⛩ ${originalLocation}\n`;
  mapMsg += `━━━━━━━━━━━━━━━━━━━`;

  await sendReply(api, mapMsg, event.messageID, threadID);
}

module.exports = { notifyAdmins, handleUseBlackBox, handleKharita };
