/*
 * ═══════════════════════════════════════════════════════════════════════
 *  tasjil.js — نظام التسجيل والانضمام (معدل بالكامل: المتدرب هو الرتبة الأساسية)
 * ═══════════════════════════════════════════════════════════════════════
 */

const {
  getPlayer,
  getPlayerByNickname,
  createPlayer,
  updatePlayer,
  getTempSession,
  setTempSession,
  deleteTempSession,
  getNextClass,
  addNotification,
  getJoinSession,
  setJoinSession,
  deleteJoinSession,
  addXP
} = require('./database');

const {
  sendReply,
  sendMessage,
  getKingdomByThreadId,
  getCityByThreadId,
  kingdomNames,
  kingdomNamesAr,
  classSymbols,
  generateNickname,
  extractFbId,
  extractUsername
} = require('./utils');

const { changePlayerNickname } = require('./dukhul');
const config = require('./config.json');

// مراحل التسجيل
const STEPS = {
  NICKNAME: 'nickname',
  CONFIRM: 'confirm',
  SYSTEM_GROUP: 'system_group',
  INVITE: 'invite',
  KINGDOM_CHOICE: 'kingdom_choice'
};

async function handleTasjil(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  let kingdom = getKingdomByThreadId(threadID);
  let cityDoc = null;
  if (!kingdom) {
    cityDoc = await getCityByThreadId(threadID);
    if (cityDoc) kingdom = cityDoc.kingdom;
  }
  if (!kingdom) return;

  const existing = await getPlayer(senderID);
  if (existing) {
    await sendReply(api,
      `𓆫─━━࿇━━━──━━━࿇━━─𓆫\n              『 تنبيه ⚠ 』\n\nأنت مسجل مسبقاً في نظام نيكسوس باللقب 『${existing.nickname}』\n\n     𓆫─━━࿇━━━──━━━࿇━━─𓆫`,
      messageID, threadID);
    return;
  }

  const session = await getTempSession(senderID);

  if (!session || text === 'تسجيل') {
    await setTempSession(senderID, {
      step: STEPS.NICKNAME,
      kingdom,
      threadID
    });
    await sendReply(api, buildStep1(), messageID, threadID);
    return;
  }

  if (session.step === STEPS.NICKNAME) {
    await handleNicknameStep(api, event, session, text);
  } else if (session.step === STEPS.CONFIRM) {
    await handleConfirmStep(api, event, session, text);
  } else if (session.step === STEPS.SYSTEM_GROUP) {
    await handleSystemGroupStep(api, event, session, text);
  } else if (session.step === STEPS.INVITE) {
    await handleInviteStep(api, event, session, text);
  } else if (session.step === STEPS.KINGDOM_CHOICE) {
    await handleKingdomChoiceStep(api, event, session, text);
  }
}

async function handleNicknameStep(api, event, session, text) {
  const { threadID, senderID, messageID } = event;

  let error = null;
  if (text.length < 3) {
    error = 'يجب ان يكون اللقب اكثر من 3 احرف .....';
  } else if (text.length > 40) {
    error = 'يجب ان يكون اللقب اقل من 40 حرفا ....';
  } else if (!text.replace(/\s/g, '').length) {
    error = 'يجب الا يكون اللقب عبارة عن فراغات ...';
  } else {
    const taken = await getPlayerByNickname(text);
    if (taken) error = 'هذا اللقب تم استخدامه بالفعل ....';
  }

  if (error) {
    await sendReply(api, buildNicknameError(error), messageID, threadID);
    return;
  }

  await setTempSession(senderID, { ...session, step: STEPS.CONFIRM, pendingNickname: text });
  await sendReply(api, buildConfirmMsg(text), messageID, threadID);
}

async function handleConfirmStep(api, event, session, text) {
  const { threadID, senderID, messageID } = event;

  if (text === 'تعديل' || text === 'تسجيل') {
    await setTempSession(senderID, { ...session, step: STEPS.NICKNAME, pendingNickname: null });
    await sendReply(api, buildStep1(), messageID, threadID);
    return;
  }

  if (text === 'نعم') {
    await setTempSession(senderID, { ...session, step: STEPS.SYSTEM_GROUP });
    await sendReply(api, buildSystemGroupMsg(), messageID, threadID);
    return;
  }

  await sendReply(api, `❖ ارسل 《 نعم 》للمواصلة او 《 تعديل 》لتغيير اللقب`, messageID, threadID);
}

async function handleSystemGroupStep(api, event, session, text) {
  const { threadID, senderID, messageID } = event;

  if (text === 'تم') {
    await setTempSession(senderID, { ...session, step: STEPS.INVITE });
    await sendReply(api, buildInviteMsg(), messageID, threadID);
  }
}

async function handleInviteStep(api, event, session, text) {
  const { threadID, senderID, messageID } = event;

  if (text === 'تخطي') {
    await finalizeRegistration(api, event, session, null);
    return;
  }

  let inviterPlayer = null;
  const fbId = extractFbId(text);

  if (fbId) {
    inviterPlayer = await getPlayer(fbId);
  }

  if (!inviterPlayer) {
    inviterPlayer = await getPlayerByNickname(text);
  }

  if (!inviterPlayer) {
    await sendReply(api, buildInviteError(), messageID, threadID);
    return;
  }

  if (inviterPlayer.kingdom !== session.kingdom) {
    await setTempSession(senderID, {
      ...session,
      step: STEPS.KINGDOM_CHOICE,
      inviterFbId: inviterPlayer.fbId,
      inviterKingdom: inviterPlayer.kingdom
    });
    await sendReply(api, buildKingdomChoiceMsg(inviterPlayer.kingdom, session.kingdom), messageID, threadID);
    return;
  }

  await finalizeRegistration(api, event, session, inviterPlayer.fbId);
}

async function handleKingdomChoiceStep(api, event, session, text) {
  const { threadID, senderID, messageID } = event;

  if (text === 'مواصلة') {
    await finalizeRegistration(api, event, session, session.inviterFbId);
    return;
  }

  if (text === 'نقل') {
    const targetKingdom = session.inviterKingdom;
    const targetGroupId = config.groupes[targetKingdom];

    await sendReply(api,
      `⚠️ ━━━━━━━━━━━━━━━━ ⚠️\n┇سيتم نقلك لمملكة ${kingdomNamesAr[targetKingdom]} بعد 5 ثواني\n\n┇اذا لم تجد قروب المملكة الجديدة جرب البحث في طلبات المراسلة \n⚠️ ━━━━━━━━━━━━━━━━ ⚠️`,
      messageID, threadID);

    setTimeout(async () => {
      try {
        await removeFromGroup(api, senderID, threadID);
        await addToGroup(api, senderID, targetGroupId);

        const userInfo = await getUserInfo(api, senderID);
        const userName = userInfo ? userInfo.name : String(senderID);

        await sendMessage(api,
          `⟬ ${userName} ⟭\n✦ تمت عملية النقل بنجاح`,
          targetGroupId);

        await finalizeRegistration(api, event, { ...session, kingdom: targetKingdom, threadID: targetGroupId }, session.inviterFbId, true);

      } catch (err) {
        console.error('خطأ في النقل:', err);
        await sendMessage(api,
          `حصل خطأ يرجى التواصل مع الادمن`,
          threadID);
      }
    }, 5000);

    return;
  }

  await sendReply(api,
    `❖ ارسل 《 مواصلة 》للبقاء في مملكتك او 《 نقل 》للانتقال`,
    messageID, threadID);
}

async function finalizeRegistration(api, event, session, inviterFbId, transferred = false) {
  const { threadID, senderID, messageID } = event;
  const targetThreadID = session.threadID || threadID;

  const playerClass = await getNextClass(session.kingdom);
  const symbol = classSymbols[playerClass];
  
  // تصحيح: الرتبة الأساسية عند أول تسجيل في النظام هي "متدرب"
  const rank = 'متدرب';

  let registeredCityName = null;
  try {
    const { getDB } = require('./database');
    const cityDoc = await getDB().collection('cities').findOne({ threadId: String(targetThreadID) });
    if (cityDoc) registeredCityName = cityDoc.name;
  } catch (e) {}

  const playerData = {
    fbId: String(senderID),
    nickname: session.pendingNickname,
    kingdom: session.kingdom,
    class: playerClass,
    rank,
    coins: 0,
    level: 1,
    hp: 1000,
    ep: 1000,
    invitedBy: inviterFbId || null,
    registeredAt: new Date(),
    registeredThreadId: String(targetThreadID),
    registeredCityName: registeredCityName || null
  };

  await createPlayer(playerData);
  await deleteTempSession(senderID);

  const groupId = config.groupes[session.kingdom];
  try {
    await changePlayerNickname(api, groupId, senderID, session.pendingNickname, rank, playerClass);
  } catch (e) {
    console.error('خطأ في تغيير كنية اللاعب الجديدة عند التسجيل:', e);
  }

  const successMsg = buildSuccessMsg(session.pendingNickname, session.kingdom, playerClass, registeredCityName);
  if (transferred) {
    await sendMessage(api, successMsg, targetThreadID);
  } else {
    await sendReply(api, successMsg, messageID, targetThreadID);
  }

  if (inviterFbId) {
    const inviter = await getPlayer(inviterFbId);
    if (inviter) {
      await updatePlayer(inviterFbId, { coins: (inviter.coins || 0) + 50 });
      await addXP(inviterFbId, 30, api, targetThreadID).catch(() => {});

      await addNotification(inviterFbId,
        `⦿ انضم اللاعب 〘 ${session.pendingNickname} 〙بفضلك الى عالم نيكسوس \nحصلت على مكافئة ⛁ ◀ 50 كوينز`
      );

      try {
        const { recordDa3wa } = require('./Mosaba9at');
        await recordDa3wa(inviterFbId, inviter.nickname || String(inviterFbId));
      } catch (compErr) {
        console.error('[Competition] خطأ في تسجيل الدعوة بالمسابقة:', compErr);
      }
    }
  }
}

function buildStep1() {
  return `╗═════━━━❖━━━═════╔
 ⊱          بٖــــوٖاٖبٖةٖ نٖــــيٖكٖسٖــــوٖسٖ        ⊰  
╝═════━━━❖━━━═════╚

     𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『مرحلة التسجيل ⛨ 』

اهلا بك في عالم نيكسوس من فضلك اكتب اللقب الذي تود استعماله في النظام 

     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildNicknameError(reason) {
  return `𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『لقب غير مناسب ⚠ 』

${reason}

❖ اعد ارسال لقبك 

     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildConfirmMsg(nickname) {
  return `╗═════━━━❖━━━═════╔
 ⊱          بٖــــوٖاٖبٖةٖ نٖــــيٖكٖسٖــــوٖسٖ        ⊰  
╝═════━━━❖━━━═════╚

     𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『 تأكيد اللقب ⊹ 』

هل انت متأكد من استعمال هذا اللقب『${nickname}』

✎ لتعديله ارسل 《 تعديل 》
⎋ للمواصلة ارسل 《 نعم 》


     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildSystemGroupMsg() {
  return `╗═════━━━❖━━━═════╔
 ⊱          بٖــــوٖاٖبٖةٖ نٖــــيٖكٖسٖــــوٖسٖ        ⊰  
╝═════━━━❖━━━═════╚

     𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『 قروب النضام 𖠿 』

✦ قم بالانضمام الى المجموعة الرسمية لنضام نيكسوس ⚐
✦ بعد الانضمام ارسل 《 تم 》

https://facebook.com/groups/1970196400432434/


     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildInviteMsg() {
  return `     𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『 الدعوة ✉ 』

✦ في حالة دعاك شخص ما للنضام رجائا ارسل لقبه او رابط حسابه ليحصل على مكافئة 

✦ لتخطي هذه المرحلة ارسل 《 تخطي 》


     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildInviteError() {
  return `𓆫─━━࿇━━━──━━━࿇━━─𓆫
              『 خطأ ⚠ 』

✦ لم يتم العثور على هذا اللاعب في نضام نيكسوس رجائا ارسل لقبا او رابطا صحيحا 

✦ لتخطي هذه المرحلة ارسل 《 تخطي 》


     𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildKingdomChoiceMsg(inviterKingdom, currentKingdom) {
  return `𓆫─━━࿇━━━──━━━࿇━━─𓆫 
✦ اللاعب الذي دعاك كان من مملكة ${kingdomNamesAr[inviterKingdom]} 
✦ اتود الاستمرار في هذه المملكة او الانتقال الى مملكة ${kingdomNamesAr[inviterKingdom]}
❖ للمواصلة هنا ارسل 《مواصلة 》
❖ للانتقال الى ${kingdomNamesAr[inviterKingdom]} ارسل 《نقل 》
𓆫─━━࿇━━━──━━━࿇━━─𓆫`;
}

function buildSuccessMsg(nickname, kingdom, playerClass, cityName) {
  const symbol = classSymbols[playerClass];
  const cityLine = cityName
    ? `⌑ المدينة الحالية  ⍇⫸ ${cityName}\n`
    : `⌑ المدينة الحالية  ⍇⫸ العاصمة\n`;
  return `𒂭━══════════════━𒂭
          『 تم التسجيل بنجاح 』      
    
⌑ اللقب     ⍇\u200B⫸  ${nickname}
⌑ المملكة   ⍇⫸ ${kingdomNamesAr[kingdom]}
${cityLine}
   قام نضام نيكسوس بتحديد فئتك
  ▱▰▱▰▱▰▱▰▱▰▱▰
       تم تصنيفك ك : ${playerClass} ${symbol}
  ▱▰▱▰▱▰▱▰▱▰▱▰
اكتب 《الاوامر 》لعرض اوامر التحكم بالبوت 
𒂭━══════════════━𒂭`;
}

function removeFromGroup(api, userId, threadID) {
  return new Promise((resolve, reject) => {
    api.removeUserFromGroup(userId, threadID, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function addToGroup(api, userId, threadID) {
  return new Promise((resolve, reject) => {
    api.addUserToGroup(userId, threadID, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function getUserInfo(api, userId) {
  return new Promise((resolve) => {
    api.getUserInfo(userId, (err, info) => {
      if (err || !info) return resolve(null);
      resolve(info[userId] || null);
    });
  });
}

function resolveKingdom(text) {
  const t = text.trim();
  if (t === '1' || t === 'مورداك') return 'murdak';
  if (t === '2' || t === 'سولفارا') return 'solfare';
  if (t === '3' || t === 'نيرافيل') return 'niravil';
  return null;
}

function reactToMessage(api, messageID, emoji) {
  return new Promise((resolve) => {
    api.setMessageReaction(emoji, messageID, () => resolve(), true);
  });
}

function buildKingdomJoinMsg() {
  return `╮──∙⋆⋅「 انضم الى عالم نيكسوس 」\n│\n│› اذا كنت تريد دخول عالم صراع الممالك نيكسوس رد على هذه الرسالة برقم المملكة او اسمها !\n│ ✧ 1 / مورداك \n│ ✧ 2 / سولفارا\n│ ✧ 3 / نيرافيل\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
}

function buildJoiningMsg(kingdom) {
  return `╮───∙⋆⋅「 جاري المعالجة ⏳ 」\n│\n│ › يجري الآن إضافتك إلى مملكة ${kingdomNamesAr[kingdom]}\n│ › تفضل بالانتظار لحظة ...\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
}

function buildJoinedMsg(kingdom) {
  return `╮──∙⋆⋅「 مرحباً بك في نيكسوس ✨ 」\n│\n│ › دخلت لعالم نيكسوس\n│ › المملكة الحالية : ${kingdomNamesAr[kingdom]}\n│\n│ › اكتب 《 تسجيل 》 لإنشاء حسابك\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
}

function buildDMMsg(kingdom) {
  return `╮──∙⋆⋅「 نيكسوس — طلب انضمام 」\n│\n│ › مرحباً ! طلبت الانضمام لمملكة ${kingdomNamesAr[kingdom]}\n│\n│ › رد على هذه الرسالة بأي نص\n│ › لتتم إضافتك في قروب المملكة\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
}

async function handleExternalJoin(api, event) {
  const { threadID, senderID, messageID } = event;

  const existing = await getPlayer(senderID);
  if (existing) {
    await sendReply(api,
      `𓆫─━━࿇━━━──━━━࿇━━─𓆫\n              『 تنبيه ⚠ 』\n\nأنت مسجل مسبقاً في نظام نيكسوس باللقب 『${existing.nickname}』\n\n     𓆫─━━࿇━━━──━━━࿇━━─𓆫`,
      messageID, threadID);
    return;
  }

  await sendReply(api,
    `╮───∙⋆⋅「 تنبيه 」\n│\n│ › التسجيل متاح فقط في قروبات الممالك\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    messageID, threadID);

  const info = await sendMessage(api, buildKingdomJoinMsg(), threadID);
  const joinMsgId = info ? info.messageID : null;

  await setJoinSession(senderID, {
    step: 'CHOOSE_KINGDOM',
    externalThreadId: String(threadID),
    joinMsgId
  });
}

async function handleExternalJoinReply(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  const session = await getJoinSession(senderID);
  if (!session || session.step !== 'CHOOSE_KINGDOM') return false;

  const kingdom = resolveKingdom(text);
  if (!kingdom) {
    await sendReply(api,
      `╮───∙⋆⋅「 خطأ 」\n│ › الرجاء إرسال رقم المملكة أو اسمها\n│ ✧ 1 / مورداك\n│ ✧ 2 / سولفارا\n│ ✧ 3 / نيرافيل\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    return true;
  }

  await reactToMessage(api, messageID, '⏳');

  const targetGroupId = String(config.groupes[kingdom]);

  await sendReply(api, buildJoiningMsg(kingdom), messageID, threadID);

  try {
    await addToGroup(api, senderID, targetGroupId);
    await reactToMessage(api, messageID, '✅');
    await sendMessage(api, buildJoinedMsg(kingdom), targetGroupId);
    await deleteJoinSession(senderID);
  } catch (e) {
    await setJoinSession(senderID, {
      ...session,
      step: 'WAITING_DM',
      kingdom,
      targetGroupId,
      externalMsgId: messageID,
      externalThreadId: String(threadID)
    });

    try {
      await sendMessage(api, buildDMMsg(kingdom), senderID);
    } catch (dmErr) {
      console.error('خطأ في إرسال DM:', dmErr);
    }

    await sendReply(api,
      `╮───∙⋆⋅「 تنبيه 」\n│\n│ › تم إرسال رسالة لك في الخاص\n│ › رد عليها لإضافتك في قروب المملكة\n│ › والدخول لعالم نيكسوس ✨\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
  }

  return true;
}

async function handleDMJoin(api, event) {
  const { senderID, messageID } = event;

  const session = await getJoinSession(senderID);
  if (!session || session.step !== 'WAITING_DM') return false;

  const { kingdom, targetGroupId, externalMsgId, externalThreadId } = session;

  try {
    await addToGroup(api, senderID, targetGroupId);

    if (externalMsgId) {
      await reactToMessage(api, externalMsgId, '✅').catch(() => {});
    }

    await sendMessage(api, buildJoinedMsg(kingdom), targetGroupId);

    await sendMessage(api,
      `╮──∙⋆⋅「 تم ✅ 」\n│\n│ › تمت إضافتك إلى عالم نيكسوس\n│ › المملكة الحالية : ${kingdomNamesAr[kingdom]}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      senderID);

    await deleteJoinSession(senderID);
  } catch (e) {
    console.error('خطأ في إضافة اللاعب من DM:', e);
    await sendMessage(api,
      `╮───∙⋆⋅「 خطأ 」\n│\n│ › حصل خطأ يرجى التواصل مع الأدمن\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      senderID);
  }

  return true;
}

module.exports = { handleTasjil, handleExternalJoin, handleExternalJoinReply, handleDMJoin };