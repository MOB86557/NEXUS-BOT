// event_router.js
// الراوتر الرئيسي: يستقبل كل أحداث ورسائل البوت ويوجّهها للملفات المتخصصة

const config = require('./config.json');
const { getResponseDelay } = require('./settings');
const { getKingdomByThreadId, getCityByThreadId, sendReply } = require('./utils');

const { handleAhdathEvent } = require('./ahdath');
const { checkDeathRecoveryKill, notifyPendingPromotion, checkActiveStreakPromotion } = require('./hala_la3ib');
const {
  handleAdminDM, handleAdminGroup, handleAdminSessionState,
  handleDeputyEmperorCommands, handleChangeRankCommand
} = require('./admin_router');
const {
  loadAllSessions, handleDisabledSession, handleIfCommandDisabled,
  handleRegistrationFlow, routeRemainingSessions
} = require('./jalasat');
const {
  handleQuickCommands, handleReplySpecificCommands, handleGamesFlow,
  handleAnimeFlow, handleMyRankCommand, routeMainCommands
} = require('./tawjih_awamir');

const { handleDMJoin } = require('./tasjil');
const { isAdmin, isBotEnabled } = require('./admin');
const { handleIntruderMessage } = require('./dakhil');
const { checkAndSendNotifications } = require('./isharat');
const { cacheMessage, handleUnsend } = require('./spy_group');
const { handleAwamer } = require('./awamer');

const {
  getPlayer, getPlayerByNickname, incrementMessageCount,
  addXP, updatePlayer, getAdminSession
} = require('./database');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getKingdomGroups() {
  return Object.values(config.groupes).map(String);
}

async function routeEvent(api, event, BOT_ID) {
  const db = require('./database').getDB();

  // ─── 1. اعتراض وتفعيل نظام التقمص الذكي كخطوة أولى ───
  const { handleImpersonationInterceptor } = require('./admin');
  handleImpersonationInterceptor(event);

  if (event.senderID) {
    try {
      const ignoredDoc = await db.collection('ignored_players').findOne({ fbId: String(event.senderID) });
      if (ignoredDoc) {
        const now = Date.now();
        if (now < new Date(ignoredDoc.until).getTime()) {
          return;
        } else {
          await db.collection('ignored_players').deleteOne({ fbId: String(event.senderID) });
        }
      }
    } catch (e) {
      console.error('[Router] Error checking ignored_players collection:', e);
    }
  }

  if (event.type === 'message_unsend') {
    await handleUnsend(api, event);
    return;
  }

  if (event.type === 'event') {
    await handleAhdathEvent(api, event, BOT_ID);
    return;
  }

  if (event.type !== 'message' && event.type !== 'message_reply') return;

  const { threadID, senderID, body } = event;
  const text = (body || '').trim();

  // ─── اعتراض ومعالجة لقطات شاشة كوينز التفاعل وردود المراجعة للأدمن ───
  try {
    const { handleSubmissionReply } = require('./interaction_coins');
    const processed = await handleSubmissionReply(api, event);
    if (processed) return;
  } catch (e) {
    console.error('[Router] Error in handleSubmissionReply:', e);
  }

  // ─── 2. فحص وتطبيق عقوبات الصمت مبكراً في القروبات قبل معالجة أي أمر ───
  if (event.isGroup) {
    const { checkMutedGroupMessage } = require('./admin_router');
    const isMuted = await checkMutedGroupMessage(api, event);
    if (isMuted) return; // تم كتم العضو وسحب رسالته وتنبيهه، نتوقف هنا
  }

  let player = await getPlayer(String(senderID));
  if (player) {
    // الإدارة (أدمن النظام / الامبراطور / نائب الامبراطور) معفيون من حظر الإنعاش
    // ويمكنهم استخدام لوحة التحكم وكل أوامرها حتى لو كانوا بحالة إنعاش
    const isPrivileged = isAdmin(senderID) ||
      player.rank === 'الامبراطور' ||
      player.rank === 'نائب الامبراطور';
    const stopped = await checkDeathRecoveryKill(api, event, player, isPrivileged);
    if (stopped) return;
  }

  // ─── حماية زوجة الامبراطور: انذار تلقائي لكل من يرد على رسالتها دون إذن ───
  try {
    const { checkProtectedWifeReply } = require('./admin_modules/moderation');
    await checkProtectedWifeReply(api, event, player);
  } catch (e) {
    console.error('[Router] Error in checkProtectedWifeReply:', e);
  }

  if (/^ارسال\s+.+\s+الى\s+.+$/.test(text)) {
    const match = text.match(/^ارسال\s+(.+s?)\s+الى\s+(.+)$/);
    if (match) {
      const targetNick = match[2].trim();
      const targetPlayer = await getPlayerByNickname(targetNick);
      if (targetPlayer && targetPlayer.recoveryUntil && new Date(targetPlayer.recoveryUntil).getTime() > Date.now()) {
        await sendReply(api, `❌ لا يمكنك إرسال الأغراض إلى [${targetPlayer.nickname}] لأنه في حالة إنعاش حالياً!`, event.messageID, threadID);
        return;
      }
    }
  }

  const isKingdomGroup = getKingdomGroups().includes(String(threadID));
  let cityDoc = null;
  if (!isKingdomGroup) {
    cityDoc = await getCityByThreadId(threadID);
  }
  const isKingdomOrCity = isKingdomGroup || (cityDoc !== null);
  const kingdom = isKingdomGroup
    ? getKingdomByThreadId(threadID)
    : (cityDoc ? cityDoc.kingdom : null);

  if (player && player.pendingPromotionNotify) {
    await notifyPendingPromotion(api, event, player);
  }

  await checkActiveStreakPromotion(api, event, player, isKingdomOrCity);

  if (!event.isGroup) {
    if (isAdmin(senderID)) {
      const handled = await handleAdminDM(api, event);
      if (handled) return;
    } else {
      await handleDMJoin(api, event);
      return;
    }
  }

  if (event.isGroup) cacheMessage(event);

  if (isAdmin(senderID)) {
    const handled = await handleAdminGroup(api, event);
    if (handled) return;
  }

  if (!isBotEnabled()) return;

  const _delay = getResponseDelay();
  if (_delay > 0) await sleep(_delay * 1000);

  if (isKingdomOrCity) {
    incrementMessageCount().catch(() => {});
    checkAndSendNotifications(api, event).catch(() => {});
    if (player) {
      updatePlayer(String(senderID), { lastMessageAt: new Date() }).catch(() => {});
    }
  }

  if (!text) return;

  if (await handleQuickCommands(api, event, text)) return;

  if (await handleReplySpecificCommands(api, event, text, senderID, threadID)) return;

  if (await handleGamesFlow(api, event, db, senderID)) return;

  const sender = String(senderID);
  if (await handleAnimeFlow(api, event, sender)) return;

  const sessions = await loadAllSessions(sender);
  const { disabledSession, tempSession, joinSession } = sessions;

  if (await handleDisabledSession(api, event, sender, disabledSession)) return;

  if (await handleIfCommandDisabled(api, event, text)) return;

  if (await handleRegistrationFlow(api, event, text, isKingdomOrCity, isKingdomGroup, tempSession, joinSession)) return;

  if (await routeRemainingSessions(api, event, sessions)) return;

  if (player) {
    await addXP(sender, 0.1, api, threadID).catch(() => {});
    const { checkAndApplyPromotions } = require('./ranks');
    await checkAndApplyPromotions(sender, api, threadID);
  }

  if (isKingdomOrCity && player && kingdom) {
    const isIntruder = await handleIntruderMessage(api, event, player, kingdom);
    if (isIntruder) return;
  }

  const adminSession = await getAdminSession(senderID);
  if (adminSession) {
    const handled = await handleAdminSessionState(api, event, adminSession);
    if (handled) return;
  }

  if (await handleDeputyEmperorCommands(api, event, player)) return;

  if (['اوامر', 'الاوامر', 'أوامر', 'الأوامر'].includes(text)) {
    await handleAwamer(api, event); return;
  }

  if (await handleMyRankCommand(api, event, text, player)) return;

  if (await handleChangeRankCommand(api, event)) return;

  // أمر كوينز التفاعل للاعبين
  if (text === 'كوينز التفاعل') {
    try {
      const { handlePlayerCoinsCommand } = require('./interaction_coins');
      await handlePlayerCoinsCommand(api, event);
    } catch (e) {
      console.error('[Router] Error in handlePlayerCoinsCommand:', e);
    }
    return;
  }

  await routeMainCommands(api, event, text, player, kingdom);
}

module.exports = { routeEvent };