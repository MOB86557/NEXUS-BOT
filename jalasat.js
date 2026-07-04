// jalasat.js
// تحميل وتوجيه جميع الجلسات (sessions) النشطة للاعب: جلسة تسجيل، نقل غرض،
// استعمال، سوق، انضمام، نشر، بنك، كأس العالم، المبادل، وأمر معطّل مؤقتاً
const {
  getTempSession, getItemTransferSession,
  isCommandDisabled, getDisabledCmdSession, deleteDisabledCmdSession,
  addCommandWatcher, getJoinSession, getNashrSession,
  getBankSession, getMubadilSession, hasActiveSession
} = require('./database');
const { matchCommandKey, handleDisabledCommand } = require('./admin');
const { handleTasjil, handleExternalJoin, handleExternalJoinReply, handleDMJoin } = require('./tasjil');
const { handleItemTransferSession } = require('./ta3din_ta5zin');
const { handleMubadilSession } = require('./mubadil');
const { handleUseSession, getUseSession, handleMarketSession, getMarketSession } = require('./so9_matjar');
const { handleNashrReply } = require('./nashr');
const { handleBankSession } = require('./bank');
const { getWorldCupSession, handleWorldCupSession } = require('./world_cup');
const { sendReply } = require('./utils');

// يجلب كل الجلسات النشطة للاعب دفعة واحدة (إن وجدت)
async function loadAllSessions(sender) {
  const hasSession = hasActiveSession(sender);

  let sessions = {
    disabledSession: null,
    tempSession: null,
    itemSession: null,
    useSession: null,
    marketSession: null,
    joinSession: null,
    nashrSession: null,
    bankSession: null,
    worldCupSession: null,
    mubadilSession: null,
  };

  if (hasSession) {
    const [
      disabledSession, tempSession, itemSession, useSession, marketSession,
      joinSession, nashrSession, bankSession, worldCupSession, mubadilSession,
    ] = await Promise.all([
      getDisabledCmdSession(sender),
      getTempSession(sender),
      getItemTransferSession(sender),
      getUseSession(sender),
      getMarketSession(sender),
      getJoinSession(sender),
      getNashrSession(sender),
      getBankSession(sender),
      getWorldCupSession(sender),
      getMubadilSession(sender),
    ]);

    sessions = {
      disabledSession, tempSession, itemSession, useSession, marketSession,
      joinSession, nashrSession, bankSession, worldCupSession, mubadilSession,
    };
  }

  return sessions;
}

// يعالج جلسة "أمر معطّل" (انتظار رد المستخدم نعم/لا لتفعيل إشعار توفر الأمر)
// يرجع true إذا تمت معالجة الجلسة (لازم return فوري بعدها)
async function handleDisabledSession(api, event, sender, disabledSession) {
  if (!disabledSession) return false;

  const text = (event.body || '').trim();
  const { threadID } = event;

  if (text === 'نعم') {
    await addCommandWatcher(sender, disabledSession.cmdKey);
    await deleteDisabledCmdSession(sender);
    await sendReply(api,
      `╮───∙⋆⋅「 تم 」\n│ › سيتم إشعارك حين يتوفر الأمر ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      event.messageID, threadID);
  } else {
    await deleteDisabledCmdSession(sender);
  }
  return true;
}

// يفحص إن كان الأمر المكتوب معطّلاً حالياً، ويعالجه إن كان كذلك
// يرجع true إذا تمت معالجة الأمر (لازم return فوري بعدها)
async function handleIfCommandDisabled(api, event, text) {
  const cmdKey = matchCommandKey(text);
  const isDisabled = cmdKey ? await isCommandDisabled(cmdKey) : false;

  if (cmdKey && isDisabled) {
    await handleDisabledCommand(api, event, cmdKey);
    return true;
  }
  return false;
}

// يعالج أمر "تسجيل" والجلسات المرتبطة بالتسجيل (تسجيل داخلي/خارجي ورد اختيار المملكة)
// يرجع true إذا تمت معالجة الأمر (لازم return فوري بعدها)
async function handleRegistrationFlow(api, event, text, isKingdomOrCity, isKingdomGroup, tempSession, joinSession) {
  if (text === 'تسجيل') {
    if (isKingdomOrCity) {
      await handleTasjil(api, event);
    } else {
      await handleExternalJoin(api, event);
    }
    return true;
  }

  if (tempSession && isKingdomOrCity) {
    await handleTasjil(api, event);
    return true;
  }

  if (!isKingdomGroup && event.type === 'message_reply') {
    const repliedBody = (event.messageReply && event.messageReply.body) || '';
    if (repliedBody.includes('انضم الى عالم نيكسوس') ||
        (joinSession && joinSession.step === 'CHOOSE_KINGDOM')) {
      const handled = await handleExternalJoinReply(api, event);
      if (handled) return true;
    }
  }

  return false;
}

// يوجّه بقية أنواع الجلسات (نقل غرض، استعمال، سوق، انضمام DM، نشر، بنك، كأس العالم، المبادل)
// يرجع true إذا تمت معالجة الجلسة (لازم return فوري بعدها)
async function routeRemainingSessions(api, event, sessions) {
  const {
    itemSession, useSession, marketSession, joinSession,
    nashrSession, bankSession, worldCupSession, mubadilSession
  } = sessions;

  if (itemSession) { await handleItemTransferSession(api, event, itemSession); return true; }
  if (useSession) { await handleUseSession(api, event, useSession); return true; }
  if (marketSession) { await handleMarketSession(api, event, marketSession); return true; }
  if (joinSession) { await handleDMJoin(api, event); return true; }
  if (nashrSession) { await handleNashrReply(api, event, nashrSession); return true; }
  if (bankSession) { await handleBankSession(api, event, bankSession); return true; }
  if (worldCupSession) { await handleWorldCupSession(api, event, worldCupSession); return true; }

  // فحص وإلغاء الجلسة بمرونة تامة لتجنب تعليق اللاعبين
  if (mubadilSession) {
    const handled = await handleMubadilSession(api, event, mubadilSession);
    if (handled) return true;
  }

  return false;
}

module.exports = {
  loadAllSessions,
  handleDisabledSession,
  handleIfCommandDisabled,
  handleRegistrationFlow,
  routeRemainingSessions
};
