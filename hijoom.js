const { getPlayer, getPlayerByNickname, updatePlayer, addNotification, addXP } = require('./database');
const { sendReply, sendMessage, kingdomNamesAr } = require('./utils');
const config = require('./config.json');

// ===== مساعدات =====

function getKingdomGroupId(kingdom) {
  if (kingdom === 'solfare') return String(config.groupes.solfare);
  if (kingdom === 'niravil') return String(config.groupes.niravil);
  if (kingdom === 'murdak')  return String(config.groupes.murdak);
  return null;
}

function autoEquipNextArmor(bag) {
  const armors = bag.filter(i => i.type === 'armor');
  if (armors.length === 0) return null;
  bag.forEach(i => { if (i.type === 'armor') i.equipped = false; });
  const minArmor = armors.reduce((min, a) => (a.absorption < min.absorption ? a : min), armors[0]);
  minArmor.equipped = true;
  return minArmor;
}

// ===== أمر الهجوم =====

async function handleHijoom(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  const match = text.match(/^هجوم\s+(.+?)\s+على\s+(.+)$/);
  if (!match) return;

  const weaponName    = match[1].trim();
  const targetNick    = match[2].trim();

  const attacker = await getPlayer(senderID);
  if (!attacker) {
    await sendReply(api,
      `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`,
      messageID, threadID);
    return;
  }

  const bag = attacker.bag || [];
  const weaponIdx = bag.findIndex(i => i.type === 'weapon' && i.name === weaponName);

  if (weaponIdx === -1) {
    await sendReply(api,
      `┍━━━━[ ❌ فشل الهجوم ]━━━━◊\n` +
      `┋ ⚔️ السلاح المحدد : ${weaponName}\n` +
      `┋ 🎒 السلاح غير موجود في حقيبتك\n` +
      `┕━━━━━━━━━━━━━━━━━◊`,
      messageID, threadID);
    return;
  }

  const weapon = bag[weaponIdx];

  const target = await getPlayerByNickname(targetNick);
  if (!target) {
    await sendReply(api,
      `┍━━━━[ ❌ فشل الهجوم ]━━━━◊\n` +
      `┋ 🎯 اللاعب المستهدف : ${targetNick}\n` +
      `┋ ❓ اللاعب غير موجود في النظام\n` +
      `┕━━━━━━━━━━━━━━━━━◊`,
      messageID, threadID);
    return;
  }

  if (target.fbId === String(senderID)) {
    await sendReply(api,
      `┍━━━━[ ❌ فشل الهجوم ]━━━━◊\n` +
      `┋ 🚫 لا يمكنك مهاجمة نفسك!\n` +
      `┕━━━━━━━━━━━━━━━━━◊`,
      messageID, threadID);
    return;
  }

  // ===== 🚫 منع الهجوم على لاعب من نفس المملكة =====
  if (attacker.kingdom === target.kingdom) {
    await sendReply(api,
      `◆━━━━━▷ ✦ ◁━━━━━◆ \n` +
      `🚫 | هذا اللاعب من نفس مملكتك لايمكنك الهجوم عليه \n` +
      `◆━━━━━▷ ✦ ◁━━━━━◆`,
      messageID, threadID);
    return;
  }

  // ===== ⛔ فحص حالة إنعاش وموت الهدف ⛔ =====
  const now = Date.now();
  if (target.recoveryUntil && new Date(target.recoveryUntil).getTime() > now) {
    await sendReply(api,
      `┍━━━━[ ❌ فشل الهجوم ]━━━━◊\n` +
      `┋ 🎯 اللاعب المستهدف : ${target.nickname}\n` +
      `┋ ⏳ اللاعب في حالة إنعاش حالياً ولا يمكن مهاجمته!\n` +
      `┕━━━━━━━━━━━━━━━━━◊`,
      messageID, threadID);
    return;
  }

  if ((target.hp ?? 1000) <= 0) {
    await sendReply(api,
      `┍━━━━[ ❌ فشل الهجوم ]━━━━◊\n` +
      `┋ 🎯 اللاعب المستهدف : ${target.nickname}\n` +
      `┋ 💀 اللاعب ميت ونقاط حياته 0 بالفعل!\n` +
      `┕━━━━━━━━━━━━━━━━━◊`,
      messageID, threadID);
    return;
  }

  // ===== ⚡ فحص واستهلاك الطاقة =====
  const baseDamage = weapon.damage;
  const requiredEP = Math.round(baseDamage * 1.6);
  const attackerEp = attacker.ep ?? 1000;

  if (attackerEp < requiredEP) {
    await sendReply(api,
      `┍━━━━[ ❌ فشل الهجوم ]━━━━◊\n` +
      `┋ 🔋 طاقة غير كافية للقيام بهذا الهجوم!\n` +
      `┋ ⚡ الطاقة المطلوبة : ${requiredEP}\n` +
      `┋ 🔋 طاقتك الحالية : ${attackerEp}\n` +
      `┕━━━━━━━━━━━━━━━━━◊`,
      messageID, threadID);
    return;
  }

  // ===== حساب الضرر =====
  let actualDamage = baseDamage;

  const targetBag     = (target.bag || []).map(i => ({ ...i }));
  const armorIdx      = targetBag.findIndex(i => i.type === 'armor' && i.equipped);

  let armorName           = null;
  let armorAbsorbed       = 0;
  let armorBroken         = false;
  let armorRemainingAfter = 0;

  if (armorIdx !== -1) {
    const armor          = targetBag[armorIdx];
    armorName            = armor.name;
    const curAbsorption  = armor.absorption;

    if (curAbsorption >= baseDamage) {
      armorAbsorbed       = baseDamage;
      actualDamage        = 0;
      armor.absorption   -= baseDamage;
      armorRemainingAfter = armor.absorption;

      if (armor.absorption === 0) {
        armorBroken = true;
        targetBag.splice(armorIdx, 1);
      }
    } else {
      armorAbsorbed = curAbsorption;
      actualDamage  = baseDamage - curAbsorption;
      armorBroken   = true;
      targetBag.splice(armorIdx, 1);
    }
  }

  // ===== تقليل متانة السلاح وزيادة العداد للترقية =====
  const newAttackerBag = bag.map(i => ({ ...i }));
  newAttackerBag[weaponIdx] = { ...weapon, durability: weapon.durability - 1 };
  if (newAttackerBag[weaponIdx].durability <= 0) {
    newAttackerBag.splice(weaponIdx, 1);
  }

  const weaponAttacksCount = (attacker.weaponAttacksCount || 0) + 1;

  // ===== تحديث HP الهدف =====
  const targetHp = target.hp ?? 1000;
  let newHp      = Math.max(0, targetHp - actualDamage);

  const armorBrokenFinal = armorBroken;
  let autoEquipInfo = null;
  let finalTargetBag = [...targetBag];

  if (armorBrokenFinal && target.autoEquip) {
    const nextArmor = autoEquipNextArmor(finalTargetBag);
    if (nextArmor) {
      autoEquipInfo = nextArmor;
    }
  }

  let revivedByElixir = false;
  let targetUpdates = { bag: finalTargetBag, hp: newHp };
  
  // تحديث بيانات المهاجم بخصم الطاقة المستهلكة
  let attackerUpdates = { 
    bag: newAttackerBag, 
    weaponAttacksCount, 
    ep: attackerEp - requiredEP 
  };

  if (newHp <= 0) {
    if (target.lifeElixir) {
      newHp = 300;
      revivedByElixir = true;
      targetUpdates.hp = 300;
      targetUpdates.lifeElixir = false;
    } else {
      // 💀 الوفاة الفعلية ودخول مرحلة الإنعاش 💀
      const recoveryDuration = 2 * 60 * 60 * 1000; // ساعتان بالملي ثانية
      const recoveryUntil = new Date(Date.now() + recoveryDuration);

      // 1. تصفير نقاط الحياة والطاقة لدى الضحية
      targetUpdates.hp = 0;
      targetUpdates.ep = 0;
      targetUpdates.recoveryUntil = recoveryUntil;
      targetUpdates.recoveryNotified = false;

      // 2. تصفير الكوينز والحقيبة لدى الضحية
      targetUpdates.coins = 0;
      targetUpdates.bag = [];

      // 3. تجهيز رسالة التنبيه المعلقة للضحية
      targetUpdates.deathPendingNotify = {
        attackerName: attacker.nickname,
        weaponName: weapon.name
      };

      // 4. إنشاء الصندوق الأسود وحفظ مسروقات الضحية بداخله للقاتل
      const blackBox = {
        name: "الصندوق الاسود",
        type: "special",
        victimName: target.nickname,
        lootCoins: target.coins || 0,
        lootBag: finalTargetBag, // ممتلكات حقيبة الضحية بالكامل مخزنة في الحقل السري للصندوق
        equipped: false
      };
      newAttackerBag.push(blackBox);

      // 5. تجهيز رسالة التنبيه المعلقة للقاتل
      attackerUpdates.killPendingNotify = {
        victimName: target.nickname
      };
    }
  }

  await Promise.all([
    updatePlayer(String(senderID), attackerUpdates),
    updatePlayer(target.fbId, targetUpdates)
  ]);

  // ===== 🏥 إضافة إيموجي الإنعاش لكنية الضحية إذا دخل فعلياً بحالة إنعاش =====
  if (targetUpdates.recoveryUntil) {
    try {
      const { changePlayerNickname } = require('./dukhul');
      const victimGroupId = getKingdomGroupId(target.kingdom);
      if (victimGroupId) {
        await changePlayerNickname(
          api, victimGroupId, target.fbId, target.nickname,
          target.rank || 'مجند', target.class, target.warnings || 0, '🏥'
        );
      }
    } catch (e) {
      console.error('[Hijoom] Error setting hospital nickname:', e);
    }
  }

  // فحص شروط الترقية التلقائية فوراً للمهاجم بعد زيادة الهجمة بسلاح
  try {
    const { checkAndApplyPromotions } = require('./ranks');
    await checkAndApplyPromotions(String(senderID), api, threadID);
  } catch (e) {
    console.error('[Hijoom] Error checking promotion:', e);
  }

  // 🆙 منح 20 XP للمهاجم فور قيامه بالهجوم بالسلاح
  await addXP(String(senderID), 20, api, threadID).catch(() => {});

  // 🆙 منح 100 XP إضافية في حالة قتل الخصم (نقاط حياته وصلت للصفر أو أقل)
  if (targetHp > 0 && targetHp - actualDamage <= 0) {
    await addXP(String(senderID), 100, api, threadID).catch(() => {});
  }

  const weaponDurLeft = newAttackerBag.find(i => i.type === 'weapon' && i.name === weapon.name);
  const durLine = weaponDurLeft
    ? `┋ 🔧 متانة السلاح المتبقية : ${weaponDurLeft.durability}\n`
    : `┋ 💥 السلاح تحطم بعد هذا الهجوم!\n`;

  const attackerMsg =
    `┍━━━━[ ☢️ هجوم ناجح ]━━━━◊\n` +
    `┋ ⚔️ السلاح المستخدم : ${weapon.name}\n` +
    `┋ 🎯 اللاعب المستهدف : ${target.nickname}\n` +
    `┋ ⚡ الطاقة المستهلكة : ${requiredEP} EP\n` +
    `┋ 🔋 طاقتك المتبقية   : ${attackerEp - requiredEP} EP\n` +
    `┋ 💢 الضرر الافتراضي : ${baseDamage}\n` +
    `┋ ☠️ الضرر المحقق    : ${actualDamage}\n` +
    durLine +
    `┕━━━━━━━━━━━━━━━━━◊`;

  await sendReply(api, attackerMsg, messageID, threadID);

  let shieldLine = '';
  if (armorName) {
    if (armorBrokenFinal) {
      shieldLine = `┋ 🛡️ امتصاص الدرع : ${armorName} امتص ${armorAbsorbed} ضرر ثم تحطم! 💔\n`;
    } else {
      shieldLine = `┋ 🛡️ امتصاص الدرع : ${armorName} امتص ${armorAbsorbed} ضرر (الامتصاص المتبقي: ${armorRemainingAfter})\n`;
    }
    if (autoEquipInfo) {
      shieldLine += `┋ ⚙️ تم تجهيز ${autoEquipInfo.name} تلقائياً (امتصاص: ${autoEquipInfo.absorption})\n`;
    }
  }

  const attackerKingdomAr = kingdomNamesAr[attacker.kingdom] || attacker.kingdom;

  const elixirLine = revivedByElixir
    ? `┋ 💎 إكسير الحياة أعادك للحياة بـ 300 HP!\n`
    : '';

  const targetNotif =
    `┍━━━[ ⚠️ تتعرض لهجوم 🚨 ]━━━◊\n` +
    `┋ ⚔️ المهاجم  : ${attacker.nickname}\n` +
    `┋ 🏰 مملكته   : ${attackerKingdomAr}\n` +
    shieldLine +
    `┋ ☠️ الضرر الصافي عليك : ${actualDamage}\n` +
    elixirLine +
    `┕━━━━━━━━━━━━━━━━━━◊`;

  // إرسال الإشعار للضحية وتنبيه مجموعتها بما أن الهجوم أصبح دائمًا خارجيًا
  await addNotification(target.fbId, targetNotif);

  const targetGroupId = getKingdomGroupId(target.kingdom);
  if (targetGroupId) {
    const groupAlert =
      `◊━━━━━━━━━━━━━━━━━━━◊\n` +
      `🚨𓊈 ☄تنبيه هجوم خارجي ☄ 𓊉🚨\n` +
      `◊━━━━━━━━━━━━━━━━━━━◊\n` +
      `❰ المهاجم 🗡️ ❱ ⟸ ${attacker.nickname}\n` +
      `❰ مملكته 🏰 ❱  ⟸ ${attackerKingdomAr}\n` +
      `◊━━━━━━━━━━━━━━━━━━◊\n` +
      `❰ المستهدف ⊹ ❱ ⟸ ${target.nickname}\n` +
      `◊━━━━━━━━━━━━━━━━━━◊`;

    await sendMessage(api, groupAlert, targetGroupId);
  }
}

// ===== أمر تجهيز الدرع =====

async function handleTajhizDar3(api, event) {
  const { threadID, senderID, messageID } = event;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api,
      `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`,
      messageID, threadID);
    return;
  }

  const bag    = player.bag || [];
  const armors = bag.filter(i => i.type === 'armor');

  if (armors.length === 0) {
    await sendReply(api,
      `❰━━━━═ الدروع المتاحة ═━━━━❱\n` +
      `⌖ لا يوجد دروع في حقيبتك\n` +
      `❰━━━━━══ 🛡️ ══━━━━━❱`,
      messageID, threadID);
    return;
  }

  const autoStatus = player.autoEquip ? '🟢' : '🔴';

  const armorList = armors.map((a, idx) => {
    const mark = a.equipped ? ' ⧨' : '';
    return `${idx + 1} 》 ${a.name} (امتصاص: ${a.absorption})${mark}`;
  }).join('\n');

  const msg =
    `❰━━━━═ الدروع المتاحة ═━━━━❱\n` +
    `${armorList}\n` +
    `⌖━━━━━━━━━━━━━━━⌖\n` +
    `❖ لتجهيز الدرع رد على هذه الرسالة برقمه\n` +
    `❖ لتفعيل او الغاء تفعيل التجهيز التلقائي اكتب 《التجهيز التلقائي》\n` +
    `❖ التجهيز التلقائي ${autoStatus}\n` +
    `❰━━━━━══ 🛡️ ══━━━━━❱`;

  await sendReply(api, msg, messageID, threadID);
}

// ===== معالجة الرد بالرقم لتجهيز الدرع =====

async function handleArmorEquipReply(api, event, num) {
  const { threadID, senderID, messageID } = event;

  const player = await getPlayer(senderID);
  if (!player) return;

  const bag    = player.bag || [];
  const armors = bag.filter(i => i.type === 'armor');

  if (num < 1 || num > armors.length) {
    await sendReply(api,
      `❌ رقم غير صحيح، الرجاء اختيار رقم بين 1 و ${armors.length}`,
      messageID, threadID);
    return;
  }

  const selected = armors[num - 1];

  bag.forEach(i => { if (i.type === 'armor') i.equipped = false; });

  const targetIdx = bag.findIndex(i => i.name === selected.name && i.absorption === selected.absorption);
  if (targetIdx !== -1) {
    bag[targetIdx].equipped = true;
  }

  await updatePlayer(String(senderID), { bag });

  await sendReply(api,
    `✅... تم تجهيز درع 《${selected.name}》 بنجاح!\n🛡️ الامتصاص : ${selected.absorption}`,
    messageID, threadID);
}

// ===== تبديل التجهيز التلقائي =====

async function handleAutoEquipToggle(api, event) {
  const { threadID, senderID, messageID } = event;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api,
      `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`,
      messageID, threadID);
    return;
  }

  const newState   = !player.autoEquip;
  const statusIcon = newState ? '🟢' : '🔴';
  const statusText = newState ? 'مفعل' : 'معطل';

  await updatePlayer(String(senderID), { autoEquip: newState });

  await sendReply(api,
    `⚙️ التجهيز التلقائي للدرع\n` +
    `━━━━━━━━━━━━━━━\n` +
    `الحالة : ${statusIcon} ${statusText}\n` +
    (newState
      ? `✅ عند تحطم الدرع المجهز سيتم تجهيز الدرع الأقل امتصاصاً تلقائياً`
      : `❌ لن يتم التجهيز التلقائي عند تحطم الدرع`),
    messageID, threadID);
}

module.exports = {
  handleHijoom,
  handleTajhizDar3,
  handleArmorEquipReply,
  handleAutoEquipToggle
};