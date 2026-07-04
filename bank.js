/*
 * ═══════════════════════════════════════════════════════════════════════
 *  bank.js — نظام بنك نيكسوس المتكامل (الإيداع، السحب، الاستثمار، القروض)
 * ═══════════════════════════════════════════════════════════════════════
 */

const { getPlayer, getBankSession, setBankSession, deleteBankSession, addXP } = require('./database');
const { sendReply, sendMessage, H } = require('./utils');
const config = require('./config.json');

// إعدادات الاستثمارات
const INVESTMENTS = {
  1: { name: 'قصير', min: 100, rate: 0.20, durationMs: 24 * 3600 * 1000 },
  2: { name: 'متوسط', min: 200, rate: 0.40, durationMs: 48 * 3600 * 1000 },
  3: { name: 'طويل', min: 300, rate: 0.60, durationMs: 4 * 24 * 3600 * 1000 }
};

// إعدادات القروض
const LOANS = {
  1: { name: 'قرض ليوم واحد', rate: 0.15, durationMs: 24 * 3600 * 1000 },
  2: { name: 'قرض ليومين', rate: 0.30, durationMs: 48 * 3600 * 1000 },
  3: { name: 'قرض لثلاثة أيام', rate: 0.40, durationMs: 72 * 3600 * 1000 }
};

// قائمة البنك الرئيسية
async function handleBankMenu(api, event) {
  const { threadID, senderID, messageID } = event;
  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api, `⚠️ يجب التسجيل أولاً للانضمام للبنك. اكتب 《 تسجيل 》.`, messageID, threadID);
    return;
  }

  const bankBalance = player.bankBalance || 0;
  let msg = 
    `          ╮━━━〔 🏦 〕━━━╭\n` +
    `  ═ ✦ ═  𝑵𝑬𝑿𝑼𝑺 𝑩𝑨𝑵𝙲   ═ ✦ ═\n` +
    `          ╯━━━〔 ⛃ 〕━━━╰\n` +
    `◈════════◈════════◈\n` +
    `✧ لقب اللاعب  ⬳ ⟦ ${player.nickname} ⟧\n` +
    `✧ رصيدك في البنك  ⬳ [ ${bankBalance.toLocaleString('en-US')} ⛃ ]\n`;
  
  if (player.loan) {
    msg += `✧ القرض المستحق  ⬳ [ ${player.loan.repayAmount} ⛃ ]\n`;
  }
  
  msg +=
    `◈════════◈════════◈\n` +
    `                ✳️ اوامر البنك ✳️\n` +
    `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n` +
    `✦ ايداع\n` +
    `✦ سحب\n` +
    `✦ استثمار\n` +
    `✦ قرض\n`;
    
  if (player.loan) {
    msg += `✦ سداد (لتسديد القرض الحالي)\n`;
  }
  
  msg += `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈`;

  await sendReply(api, msg, messageID, threadID);
}

// طلب الإيداع
async function handleBankDeposit(api, event) {
  const { threadID, senderID, messageID } = event;
  const player = await getPlayer(senderID);
  if (!player) return;

  await setBankSession(senderID, { state: 'BANK_DEPOSIT' });
  await sendReply(api,
    `          ╮━━━〔 🏦 〕━━━╭\n` +
    `  ═ ✦ ═  𝑵𝑬𝑿𝑼𝑺 𝑩𝑨𝑵𝙲   ═ ✦ ═\n` +
    `          ╯━━━〔 ⛃ 〕━━━╰\n` +
    `◈════════◈════════◈\n` +
    `✧ رجائا قم بكتابة المبلغ الذي تود ايداعه في البنك \n` +
    `🔴 الحد الادنى للايداع هو 40 ⛃\n` +
    `◈════════◈════════◈`,
    messageID, threadID
  );
}

// طلب السحب
async function handleBankWithdraw(api, event) {
  const { threadID, senderID, messageID } = event;
  const player = await getPlayer(senderID);
  if (!player) return;

  await setBankSession(senderID, { state: 'BANK_WITHDRAW' });
  await sendReply(api,
    `          ╮━━━〔 🏦 〕━━━╭\n` +
    `  ═ ✦ ═  𝑵𝑬𝑿𝑼𝑺 𝑩𝑨𝑵𝙲   ═ ✦ ═\n` +
    `          ╯━━━〔 ⛃ 〕━━━╰\n` +
    `◈════════◈════════◈\n` +
    `✧ رصيدك الحالي في البنك ⬳ [ ${(player.bankBalance || 0).toLocaleString('en-US')} ⛃ ]\n` +
    `✧ رجائا قم بكتابة المبلغ الذي تود سحبه من البنك \n` +
    `◈════════◈════════◈`,
    messageID, threadID
  );
}

// طلب الاستثمار
async function handleBankInvest(api, event) {
  const { threadID, senderID, messageID } = event;
  const player = await getPlayer(senderID);
  if (!player) return;

  if (player.loan) {
    await sendReply(api, `⚠️ لا يمكنك بدء استثمار ولديك قرض نشط غير مسدد! يرجى تسديد القرض أولاً.`, messageID, threadID);
    return;
  }

  const activeInvests = player.investments || [];
  if (activeInvests.length >= 2) {
    await sendReply(api, `⚠️ لقد وصلت للحد الأقصى من الاستثمارات النشطة (استثمارين كحد أقصى).`, messageID, threadID);
    return;
  }

  await setBankSession(senderID, { state: 'BANK_INVEST_TYPE' });
  await sendReply(api,
    `          ╮━━━〔 🏦 〕━━━╭\n` +
    `  ═ ✦ ═  𝑵𝑬𝑿𝑼𝑺 𝑩𝑨𝑵𝙲   ═ ✦ ═\n` +
    `          ╯━━━〔 ⛃ 〕━━━╰\n` +
    `◈════════◈════════◈\n` +
    `أهلاً بك في قسم الاستثمار 📈\n` +
    `الاستثمارات المتاحة:\n\n` +
    `1 ↜ استثمار قصير ⏳\n` +
    `  • الحد الأدنى للايداع: 100 ⛃\n` +
    `  • الربح: 20% في 24 ساعة\n\n` +
    `2 ↜ استثمار متوسط ⏳\n` +
    `  • الحد الأدنى للايداع: 200 ⛃\n` +
    `  • الربح: 40% في 48 ساعة\n\n` +
    `3 ↜ استثمار طويل ⏳\n` +
    `  • الحد الأدنى للايداع: 300 ⛃\n` +
    `  • الربح: 60% في 4 أيام\n\n` +
    `• استثماراتك النشطة حالياً: ${activeInvests.length} / 2\n\n` +
    `أرسل رقم الاستثمار للبدء (مثال: 1) أو "الغاء" للخروج.\n` +
    `◈════════◈════════◈`,
    messageID, threadID
  );
}

// طلب القرض
async function handleBankLoan(api, event) {
  const { threadID, senderID, messageID } = event;
  const player = await getPlayer(senderID);
  if (!player) return;

  if ((player.level || 1) <= 15) {
    await sendReply(api, `⚠️ هذا القسم متاح فقط للاعبين ذوي المستوى الأكبر من 15! مستواك الحالي: ${player.level || 1}.`, messageID, threadID);
    return;
  }

  if (player.loan) {
    const dueAt = new Date(player.loan.dueAt);
    await sendReply(api, 
      `⚠️ لديك قرض نشط بالفعل يبلغ قدره ${player.loan.repayAmount} ⛃ يستحق في ${dueAt.toLocaleDateString('ar-EG')}!\n` +
      `لا يمكنك اقتراض مبالغ إضافية قبل تسوية القرض الحالي بكتابة "سداد".`, 
      messageID, threadID
    );
    return;
  }

  await setBankSession(senderID, { state: 'BANK_LOAN_TYPE' });
  await sendReply(api,
    `          ╮━━━〔 🏦 〕━━━╭\n` +
    `  ═ ✦ ═  𝑵𝑬𝑿𝑼𝑺 𝑩𝑨𝑵𝙲   ═ ✦ ═\n` +
    `          ╯━━━〔 ⛃ 〕━━━╰\n` +
    `◈════════◈════════◈\n` +
    `أهلاً بك في قسم القروض 💳\n` +
    `القروض المتاحة (الحد الأقصى للاقتراض هو 300 ⛃):\n\n` +
    `1 ↜ قرض ليوم واحد\n` +
    `  • الفائدة عند التسديد: 15%\n` +
    `  • المدة: 24 ساعة\n\n` +
    `2 ↜ قرض ليومين\n` +
    `  • الفائدة عند التسديد: 30%\n` +
    `  • المدة: 48 ساعة\n\n` +
    `3 ↜ قرض لثلاثة أيام\n` +
    `  • الفائدة عند التسديد: 40%\n` +
    `  • المدة: 72 ساعة\n\n` +
    `* تنبيه: في حال التخلف عن السداد في الموعد (المدة + ساعتين سماح)، سيتم مصادرة كوينزاتك وحقيبتك بالكامل وحصولك على إنذارين!\n\n` +
    `أرسل رقم القرض لطلب الاقتراض (مثال: 1) أو "الغاء" للخروج.\n` +
    `◈════════◈════════◈`,
    messageID, threadID
  );
}

// سداد القرض يدوياً
async function handleBankRepay(api, event) {
  const { threadID, senderID, messageID } = event;
  const player = await getPlayer(senderID);
  if (!player) return;

  if (!player.loan) {
    await sendReply(api, `⚠️ ليس لديك أي قرض نشط لتسديده حالياً.`, messageID, threadID);
    return;
  }

  const repayAmount = player.loan.repayAmount;
  const bankBalance = player.bankBalance || 0;

  if (bankBalance < repayAmount) {
    await sendReply(api, `⚠️ رصيدك في البنك (${bankBalance} ⛃) غير كافٍ لتسديد القرض المطلوب (${repayAmount} ⛃). يرجى إيداع الكوينز أولاً قبل السداد!`, messageID, threadID);
    return;
  }

  const newBank = bankBalance - repayAmount;

  await require('./database').getDB().collection('players').updateOne(
    { fbId: senderID },
    { $set: { bankBalance: newBank, loan: null } }
  );

  await sendReply(api,
    `◈════════◈════════◈\n` +
    `تم سداد القرض بنجاح! 💳✅\n` +
    `• المبلغ المخصوم من رصيد البنك: ${repayAmount} ⛃\n` +
    `• تم تصفية حساب القروض الخاص بك بنجاح.\n` +
    `◈════════◈════════◈`,
    messageID, threadID
  );
}

// معالجة جلسات مدخلات البنك
async function handleBankSession(api, event, session) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  const player = await getPlayer(senderID);
  if (!player) {
    await deleteBankSession(senderID);
    return;
  }

  if (['الغاء', 'إلغاء', 'خروج'].includes(text)) {
    await deleteBankSession(senderID);
    await sendReply(api, `🚫 تم إلغاء العملية البنكية الحالية.`, messageID, threadID);
    return;
  }

  // معالجة الإيداع
  if (session.state === 'BANK_DEPOSIT') {
    const amount = parseInt(text, 10);
    if (isNaN(amount) || amount < 40) {
      await sendReply(api, `⚠️ يرجى إدخال مبلغ صحيح أكبر أو يساوي 40 ⛃.`, messageID, threadID);
      return;
    }
    if ((player.coins || 0) < amount) {
      await sendReply(api, `⚠️ رصيدك الحالي غير كافٍ! لديك حالياً ${player.coins || 0} كوينز فقط.`, messageID, threadID);
      return;
    }

    const newCoins = (player.coins || 0) - amount;
    const newBank = (player.bankBalance || 0) + amount;

    await require('./database').getDB().collection('players').updateOne(
      { fbId: senderID },
      { $set: { coins: newCoins, bankBalance: newBank } }
    );

    await deleteBankSession(senderID);
    await sendReply(api, 
      `◈════════◈════════◈\n` +
      `تم نقل ${amount} كوينز الى رصيد حسابك في البنك 💳\n` +
      `◈════════◈════════◈`, 
      messageID, threadID
    );
    return;
  }

  // معالجة السحب
  if (session.state === 'BANK_WITHDRAW') {
    const amount = parseInt(text, 10);
    const bankBalance = player.bankBalance || 0;
    if (isNaN(amount) || amount <= 0) {
      await sendReply(api, `⚠️ يرجى إدخال مبلغ سحب صحيح أكبر من 0.`, messageID, threadID);
      return;
    }
    if (bankBalance < amount) {
      await sendReply(api, `⚠️ رصيدك البنكي غير كافٍ! لديك حالياً ${bankBalance} ⛃ في البنك.`, messageID, threadID);
      return;
    }

    const newCoins = (player.coins || 0) + amount;
    const newBank = bankBalance - amount;

    await require('./database').getDB().collection('players').updateOne(
      { fbId: senderID },
      { $set: { coins: newCoins, bankBalance: newBank } }
    );

    await deleteBankSession(senderID);
    await sendReply(api, 
      `◈════════◈════════◈\n` +
      `تم سحب ${amount} كوينز الى محفظتك بنجاح 💰\n` +
      `◈════════◈════════◈`, 
      messageID, threadID
    );
    return;
  }

  // معالجة اختيار الاستثمار
  if (session.state === 'BANK_INVEST_TYPE') {
    if (!['1', '2', '3'].includes(text)) {
      await sendReply(api, `⚠️ يرجى اختيار رقم صحيح (1 أو 2 أو 3) أو كتابة "الغاء".`, messageID, threadID);
      return;
    }
    const type = parseInt(text, 10);
    const invData = INVESTMENTS[type];

    await setBankSession(senderID, { state: 'BANK_INVEST_AMOUNT', investType: type });
    await sendReply(api,
      `◈════════◈════════◈\n` +
      `المستثمر: استثمار ${invData.name}\n` +
      `يرجى كتابة المبلغ الذي تود استثماره.\n` +
      `الحد الأدنى: ${invData.min} ⛃\n` +
      `◈════════◈════════◈`,
      messageID, threadID
    );
    return;
  }

  // معالجة إكمال الاستثمار
  if (session.state === 'BANK_INVEST_AMOUNT') {
    const amount = parseInt(text, 10);
    const type = session.investType;
    const invData = INVESTMENTS[type];

    if (isNaN(amount) || amount < invData.min) {
      await sendReply(api, `⚠️ يرجى إدخال مبلغ صحيح أكبر من أو يساوي الحد الأدنى (${invData.min} ⛃).`, messageID, threadID);
      return;
    }

    const bankBalance = player.bankBalance || 0;
    if (bankBalance < amount) {
      await sendReply(api, `⚠️ رصيدك البنكي غير كافٍ! يرجى إيداع الكوينز أولاً قبل بدء الاستثمار.`, messageID, threadID);
      return;
    }

    const endAt = new Date(Date.now() + invData.durationMs);
    const profit = Math.floor(amount * invData.rate);

    const newBank = bankBalance - amount;
    const newInvests = player.investments || [];
    newInvests.push({
      id: Math.random().toString(36).substring(2, 7).toUpperCase(),
      type: type,
      amount: amount,
      profit: profit,
      startAt: new Date(),
      endAt: endAt
    });

    await require('./database').getDB().collection('players').updateOne(
      { fbId: senderID },
      { $set: { bankBalance: newBank, investments: newInvests } }
    );

    await deleteBankSession(senderID);
    await sendReply(api,
      `◈════════◈════════◈\n` +
      `تم بدء الاستثمار بنجاح! 📈\n` +
      `• المبلغ المستثمر: ${amount} ⛃\n` +
      `• الربح المتوقع: +${profit} ⛃ (+${invData.rate * 100}%)\n` +
      `• تاريخ الانتهاء: ${endAt.toLocaleDateString('ar-EG')} الساعة ${endAt.toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}\n` +
      `◈════════◈════════◈`,
      messageID, threadID
    );
    return;
  }

  // معالجة اختيار القرض
  if (session.state === 'BANK_LOAN_TYPE') {
    if (!['1', '2', '3'].includes(text)) {
      await sendReply(api, `⚠️ يرجى اختيار رقم صحيح (1 أو 2 أو 3) أو كتابة "الغاء".`, messageID, threadID);
      return;
    }
    const type = parseInt(text, 10);
    const loanData = LOANS[type];

    await setBankSession(senderID, { state: 'BANK_LOAN_AMOUNT', loanType: type });
    await sendReply(api,
      `◈════════◈════════◈\n` +
      `لقد اخترت: ${loanData.name}\n` +
      `يرجى كتابة المبلغ الذي تود اقتراضه (يجب ألا يتعدى 300 ⛃):\n` +
      `◈════════◈════════◈`,
      messageID, threadID
    );
    return;
  }

  // معالجة إكمال القرض
  if (session.state === 'BANK_LOAN_AMOUNT') {
    const amount = parseInt(text, 10);
    const type = session.loanType;
    const loanData = LOANS[type];

    if (isNaN(amount) || amount <= 0 || amount > 300) {
      await sendReply(api, `⚠️ يرجى إدخال مبلغ اقتراض صحيح بين 1 و 300 ⛃.`, messageID, threadID);
      return;
    }

    const repayAmount = Math.ceil(amount * (1 + loanData.rate));
    const dueAt = new Date(Date.now() + loanData.durationMs);
    const graceEndAt = new Date(Date.now() + loanData.durationMs + 2 * 3600 * 1000); // 2 hours grace period

    const newBank = (player.bankBalance || 0) + amount;
    const loanObj = {
      type: type,
      amount: amount,
      repayAmount: repayAmount,
      borrowedAt: new Date(),
      dueAt: dueAt,
      graceEndAt: graceEndAt,
      interestRate: loanData.rate,
      notified6h: false,
      notifiedGrace: false
    };

    await require('./database').getDB().collection('players').updateOne(
      { fbId: senderID },
      { $set: { bankBalance: newBank, loan: loanObj } }
    );

    await deleteBankSession(senderID);
    await sendReply(api,
      `◈════════◈════════◈\n` +
      `تم منح القرض بنجاح وإيداعه في حسابك البنكي! 💳\n` +
      `• المبلغ المقترض: ${amount} ⛃\n` +
      `• المطلوب سداده: ${repayAmount} ⛃ (${loanData.rate * 100}% فائدة)\n` +
      `• موعد التسديد الأقصى: ${dueAt.toLocaleDateString('ar-EG')} الساعة ${dueAt.toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'})}\n` +
      `◈════════◈════════◈`,
      messageID, threadID
    );
    return;
  }
}

// معالجة المواعيد والتحققات الدورية في الخلفية
async function tickBankSystem(api) {
  const db = require('./database').getDB();
  const now = new Date();

  // جلب اللاعبين المستثمرين أو لديهم قروض نشطة
  const players = await db.collection('players').find({
    $or: [
      { investments: { $exists: true, $ne: [] } },
      { loan: { $ne: null } }
    ]
  }).toArray();

  for (const player of players) {
    let updated = false;

    // 1. معالجة الاستثمارات
    if (player.investments && player.investments.length > 0) {
      const activeInvests = [];
      for (const inv of player.investments) {
        if (now >= new Date(inv.endAt)) {
          const totalReturn = inv.amount + inv.profit;
          player.bankBalance = (player.bankBalance || 0) + totalReturn;

          // 🆙 منح 15 XP للاعب عند اكتمال استثماره وحصوله على الأرباح
          await addXP(player.fbId, 15, api, null).catch(() => {});

          const title = inv.type === 1 ? 'قصير' : inv.type === 2 ? 'متوسط' : 'طويل';
          const notifMsg = `📈 انتهى استثمارك الـ ${title} بنجاح!\n` +
                           `• رأس المال: ${inv.amount} ⛃\n` +
                           `• الأرباح المكتسبة: ${inv.profit} ⛃\n` +
                           `• تم إيداع ${totalReturn} ⛃ في رصيدك البنكي بنجاح.`;
          await require('./database').addNotification(player.fbId, notifMsg);
          updated = true;
        } else {
          activeInvests.push(inv);
        }
      }
      player.investments = activeInvests;
    }

    // 2. معالجة القروض
    if (player.loan) {
      const loan = player.loan;
      const dueAt = new Date(loan.dueAt);
      const graceEndAt = new Date(loan.graceEndAt);
      const msLeft = dueAt.getTime() - now.getTime();
      const hoursLeft = msLeft / (3600 * 1000);

      // تنبيه الـ 6 ساعات المتبقية
      if (hoursLeft > 0 && hoursLeft <= 6 && !loan.notified6h) {
        const notifMsg = `⚠️ تنبيه تسديد القرض!\n` +
                         `• متبقي 6 ساعات فقط لتسديد القرض البالغ ${loan.repayAmount} ⛃.\n` +
                         `• يرجى إيداع الكوينز وسداده لتفادي غرامات الحظر ومصادرة ممتلكاتك.`;
        await require('./database').addNotification(player.fbId, notifMsg);
        loan.notified6h = true;
        updated = true;
      }

      // تنبيه فترة السماح عند انتهاء الوقت الأصلي
      if (now >= dueAt && now < graceEndAt && !loan.notifiedGrace) {
        const notifMsg = `🚨 انتهت المهلة الرسمية لتسديد القرض!\n` +
                         `• لقد دخلت في فترة السماح الأخيرة (ساعتان فقط).\n` +
                         `• يرجى السداد فوراً لتجنب مصادرة الكوينز والحقيبة بالكامل والحصول على إنذارين!`;
        await require('./database').addNotification(player.fbId, notifMsg);
        loan.notifiedGrace = true;
        updated = true;
      }

      // تطبيق العقوبة بعد انتهاء فترة السماح
      if (now >= graceEndAt) {
        const oldWarnings = player.warnings || 0;
        player.coins = 0;
        player.bankBalance = 0;
        player.bag = [];
        player.warnings = oldWarnings + 2;
        player.loan = null;
        updated = true;

        const punishmentMsg = `🚨 عقوبة عدم تسديد القرض!\n` +
                              `• تم مصادرة كوينزاتك وحسابك البنكي بالكامل.\n` +
                              `• تم إفراغ ومصادرة محتويات حقيبتك بالكامل.\n` +
                              `• تم منحك إنذارين 🔴🔴 لتخلفك عن السداد في الموعد.`;
        await require('./database').addNotification(player.fbId, punishmentMsg);

        // تحديث كنية اللاعب في جميع قروبات الممالك بإضافة كرات الإنذار الحمراء
        try {
          const kingdoms = ['solfare', 'niravil', 'murdak'];
          for (const k of kingdoms) {
            const gid = config.groupes[k];
            if (gid) {
              await require('./dukhul').changePlayerNickname(
                api, gid, player.fbId, player.nickname, player.rank || 'مجند', player.class, player.warnings
              );
            }
          }
        } catch (e) {
          console.error('خطأ تحديث كنية الإنذار:', e.message);
        }
      }
    }

    if (updated) {
      await db.collection('players').updateOne(
        { fbId: player.fbId },
        {
          $set: {
            bankBalance: player.bankBalance || 0,
            investments: player.investments || [],
            loan: player.loan,
            coins: player.coins || 0,
            bag: player.bag || [],
            warnings: player.warnings || 0
          }
        }
      );

      if ((player.warnings || 0) >= 4) {
        const { checkAndEnforceWarnings } = require('./admin_modules/moderation');
        await checkAndEnforceWarnings(api, player.fbId, player.nickname, player.kingdom, player.warnings).catch(e => {
          console.error('[BankTick] خطأ تطبيق عقوبة الإنذارات:', e.message);
        });
      }
    }
  }
}

module.exports = {
  handleBankMenu,
  handleBankDeposit,
  handleBankWithdraw,
  handleBankInvest,
  handleBankLoan,
  handleBankRepay,
  handleBankSession,
  tickBankSystem
};