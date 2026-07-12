// tawjih_awamir.js
// توجيه جميع الأوامر النصية للاعب بعد تجاوز فحوصات الجلسات والأدمن
// (الأيدي، الميديا، الصوت، الألعاب، الأوامر، الرتب، الخريطة، السوق، البنك، التصنيع، الهجوم...)
const { sendReply, kingdomNamesAr } = require('./utils');
const { handleAydi } = require('./aydi');
const { handleSaySpeech } = require('./voice_tts');
const {
  handleActiveGameInput, handleGameInvitationReply, handleTugOfWarReply,
  handleDarAlal3abMenu, handleDarAlal3abSession
} = require('./dar_alal3ab_core');
const { handleNotificationsReply, handleShowNotifications } = require('./isharat');
const { subscribeWorldCup, handleWorldCupCommand, handleLiveMatches, handleUpcomingMatches } = require('./world_cup');
const { hasAnimeSession, handleAnimeSession, handleAnimeSearch, handleAnimeSuggestStart } = require('./anime');
const { handleMyRank, RANKS_ORDER } = require('./ranks');
const { handleKharita } = require('./musa3idat');
const { handleAwamer, handleAwamerPage } = require('./awamer');
const { handleArmorEquipReply, handleHijoom, handleTajhizDar3, handleAutoEquipToggle } = require('./hijoom');
const { handleSo9Reply, handleMatjarReply, handleMatjar, handleShopBuy, handleUse, handleSo9, handleBa3Fi, handleCode } = require('./so9_matjar');
const { handleMubadil } = require('./mubadil');
const { handleMalafi } = require('./malafi');
const { handleMustawaya } = require('./mustawaya');
const { handleBankMenu, handleBankDeposit, handleBankWithdraw, handleBankInvest, handleBankLoan, handleBankRepay } = require('./bank');
const { handleImageEdit } = require('./image_editor');
const { handleRasm, handleTarjama } = require('./rasm');
const { handleKoinezNashr } = require('./nashr');
const { handleTahwil } = require('./tahwil');
const { handleQroub } = require('./qroub');
const { handleTaqrir } = require('./taqrir');
const {
  handleHafr, handleJam3, handleSayd, handleHaqiba,
  handleHadhf, handleIrsal
} = require('./ta3din_ta5zin');
const { handleTasni3Menu, handleAslihah, handleDuru3, handleMawad, handleCraftItem } = require('./tasni3');
const {
  handleMatjarMaharat, handleBuySkill, handleMySkills,
  handleMySkillsDetailReply, handleActivateSkill
} = require('./matjar_maharat');

// يعالج أمر "الأيدي" + الميديا (صور انمي / ميمز) + أمر "قول" (تحويل النص لصوت)
// يرجع true إذا تمت معالجة الأمر
async function handleQuickCommands(api, event, text) {
  if (await handleAydi(api, event)) return true;

  if (['صور انمي', 'ميمز', 'رفع صور انمي', 'رفع ميمز', 'رفع'].includes(text)) {
    const { handleMediaCommands } = require('./anime_memes');
    await handleMediaCommands(api, event);
    return true;
  }

  if (text === 'قول' || text.startsWith('قول ')) {
    if (text === 'قول') {
      await sendReply(api, "اكتب الامر قول ثم الكلام الذي تريد للذكاء الاصطناعي قوله", event.messageID, event.threadID);
      return true;
    }
    const speechText = text.substring(4).trim();
    if (!speechText) {
      await sendReply(api, "اكتب الامر قول ثم الكلام الذي تريد للذكاء الاصطناعي قوله", event.messageID, event.threadID);
      return true;
    }
    await handleSaySpeech(api, event, speechText);
    return true;
  }

  return false;
}

// يعالج الردود الخاصة بدعوة لعبة / شد الحبل / الإشعارات / اشتراك كأس العالم عند الرد على رسالة
// يرجع true إذا تمت معالجة الرد
async function handleReplySpecificCommands(api, event, text, senderID, threadID) {
  if (event.type !== 'message_reply') return false;

  const inviteReplied = await handleGameInvitationReply(api, event);
  if (inviteReplied) return true;

  const tugReplied = await handleTugOfWarReply(api, event);
  if (tugReplied) return true;

  const notificationsReplied = await handleNotificationsReply(api, event);
  if (notificationsReplied) return true;

  const repliedBody = (event.messageReply && event.messageReply.body) || '';
  if (repliedBody.includes('كأس العالم 2026') && ['اشعار', 'إشعار'].includes(text)) {
    await subscribeWorldCup(senderID);
    await sendReply(api, `🔔 تم تفعيل إشعارات كأس العالم لمنتخبك بنجاح! ستصلك النتائج والأهداف فور حدوثها.`, event.messageID, threadID);
    return true;
  }

  return false;
}

// يعالج جلسة دار الألعاب (اللوبي) إن وجدت، ومدخل اللعبة النشطة الحالية
// يرجع true إذا تمت معالجة المدخل
async function handleGamesFlow(api, event, db, senderID) {
  const activeGameHandled = await handleActiveGameInput(api, event);
  if (activeGameHandled) return true;

  const darAlal3abSession = await db.collection('dar_alal3ab_sessions').findOne({ fbId: String(senderID) });
  if (darAlal3abSession) {
    const lobbyHandled = await handleDarAlal3abSession(api, event, darAlal3abSession);
    if (lobbyHandled) return true;
  }

  return false;
}

// يعالج جلسة الأنمي (بحث/اقتراح) إن كانت نشطة للاعب
// يرجع true إذا تمت معالجة الرسالة ضمن جلسة الأنمي
async function handleAnimeFlow(api, event, sender) {
  if (hasAnimeSession(sender)) {
    await handleAnimeSession(api, event);
    return true;
  }
  return false;
}

// يعالج رد التفاعل مع الأرقام (صفحات الأوامر / اختيار درع) ورد ردود الردود الخاصة بالسوق/المتجر
// يرجع true إذا تمت معالجة الرد
async function handleNumericReplyCommands(api, event, text) {
  if (event.messageReply && /^\d+$/.test(text)) {
    const repliedBody = event.messageReply.body || '';
    if (repliedBody.includes('الاوامر.')) {
      try { api.unsendMessage(event.messageReply.messageID, () => {}); } catch (e) {}
      try { api.unsendMessage(event.messageID, () => {}); } catch (e) {}

      await handleAwamerPage(api, event, parseInt(text, 10));
      return true;
    }
    if (repliedBody.includes('الدروع المتاحة')) { await handleArmorEquipReply(api, event, parseInt(text, 10)); return true; }
    if (repliedBody.includes('متجر مهارات')) { await handleMatjarMaharat(api, event, parseInt(text, 10)); return true; }
    if (repliedBody.includes('مهاراتك المملوكة')) { await handleMySkillsDetailReply(api, event, parseInt(text, 10)); return true; }
  }

  if (event.messageReply && text) {
    const repliedBody = event.messageReply.body || '';
    if (repliedBody.includes('سوق نيكسوس')) { await handleSo9Reply(api, event); return true; }
    if (repliedBody.includes('متجر نيكسوس')) { await handleMatjarReply(api, event); return true; }
  }

  return false;
}

// أمر "رتبتي" — يعرض رتبة اللاعب الحالية
// يرجع true إذا تمت معالجة الأمر
async function handleMyRankCommand(api, event, text, player) {
  if (text !== 'رتبتي') return false;

  if (!player) {
    await sendReply(api, `يجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام`, event.messageID, event.threadID);
    return true;
  }
  await handleMyRank(api, event, player);
  return true;
}

// التوجيه الرئيسي لكل الأوامر النصية العامة (السوق/المتجر/البنك/التصنيع/الهجوم/الألعاب الخ)
// يُستدعى بعد تجاوز كل فحوصات الجلسات والأدمن ورتبة نائب الامبراطور
// يرجع true إذا تمت معالجة الأمر
async function routeMainCommands(api, event, text, player, kingdom) {
  const { threadID } = event;

  if (text === 'خريطة') {
    await handleKharita(api, event, player);
    return true;
  }

  if (['دار الالعاب', 'دار الألعاب', 'دار العاب', 'العاب', 'ألعاب'].includes(text)) {
    await handleDarAlal3abMenu(api, event); return true;
  }

  if (text === 'مسابقة النشر') {
    const { handleNashrCompetition } = require('./Mosaba9at');
    await handleNashrCompetition(api, event);
    return true;
  }

  if (text === 'مسابقة الدعوات') {
    const { handleDa3waCompetition } = require('./Mosaba9at');
    await handleDa3waCompetition(api, event);
    return true;
  }

  const notifCommands = ['اشعارات', 'الاشعارات', 'أشعارات', 'إشعارات', 'الأشعارات', 'الإشعارات'];
  if (notifCommands.includes(text)) {
    await handleShowNotifications(api, event, 1);
    return true;
  }

  if (text === 'ايجنت') {
    const { handleAgentList } = require('./agent');
    await handleAgentList(api, event);
    return true;
  }

  if (event.type === 'message_reply') {
    const { handleAgentReply } = require('./agent');
    const agentHandled = await handleAgentReply(api, event);
    if (agentHandled) return true;
  }

  if (text && text.length >= 2 && text.length <= 50) {
    const { handleAgentStart } = require('./agent');
    const agentStarted = await handleAgentStart(api, event, text);
    if (agentStarted) return true;
  }

  const numericHandled = await handleNumericReplyCommands(api, event, text);
  if (numericHandled) return true;

  if (text === 'المبادل') { await handleMubadil(api, event); return true; }

  if (['المتجر', 'متجر', 'متجر نيكسوس'].includes(text)) { await handleMatjar(api, event); return true; }

  if (['متجر مهارات', 'متجر المهارات'].includes(text)) { await handleMatjarMaharat(api, event, 1); return true; }
  if (text === 'مهاراتي') { await handleMySkills(api, event); return true; }

  const buySkillMatch = text.match(/^شراء مهارة\s+(.+)$/);
  if (buySkillMatch) { await handleBuySkill(api, event, buySkillMatch[1].trim()); return true; }

  const activateSkillMatch = text.match(/^تفعيل مهارة\s+(.+)$/);
  if (activateSkillMatch) { await handleActivateSkill(api, event, activateSkillMatch[1].trim()); return true; }

  const shopMatch = text.match(/^شراء\s+(.+)$/);
  if (shopMatch) { const h = await handleShopBuy(api, event, shopMatch[1].trim()); if (h) return true; }

  if (text === 'استعمال الصندوق الاسود') {
    const { handleUseBlackBox } = require('./musa3idat');
    await handleUseBlackBox(api, event, player);
    return true;
  }

  const useMatch = text.match(/^استعمال\s+(.+)$/);
  if (useMatch) { await handleUse(api, event, useMatch[1].trim()); return true; }

  if (['السوق', 'سوق', 'سوق نيكسوس'].includes(text)) { await handleSo9(api, event, 1); return true; }
  if (text === 'بيع في السوق') { await handleBa3Fi(api, event); return true; }

  if (/^[A-Za-z0-9]{4}$/.test(text)) {
    const h = await handleCode(api, event, text); if (h) return true;
  }

  if (text === 'ملفي') { await handleMalafi(api, event); return true; }

  if (text === 'فيفا') {
    await handleWorldCupCommand(api, event);
    return true;
  }

  if (text === 'مباريات') {
    await handleLiveMatches(api, event);
    return true;
  }

  if (['كأس', 'كاس'].includes(text)) {
    await handleUpcomingMatches(api, event);
    return true;
  }

  if (await handleMustawaya(api, event, player)) return true;

  if (['بنك', 'البنك'].includes(text)) { await handleBankMenu(api, event); return true; }
  if (text === 'ايداع') { await handleBankDeposit(api, event); return true; }
  if (text === 'سحب') { await handleBankWithdraw(api, event); return true; }
  if (text === 'استثمار') { await handleBankInvest(api, event); return true; }
  if (text === 'قرض') { await handleBankLoan(api, event); return true; }
  if (text === 'سداد') { await handleBankRepay(api, event); return true; }

  if (/^ايديت(\s+\d+)?$/.test(text)) {
    await handleImageEdit(api, event);
    return true;
  }

  const rasmHandled = await handleRasm(api, event);
  if (rasmHandled) return true;

  const tarjamaHandled = await handleTarjama(api, event);
  if (tarjamaHandled) return true;

  if (['بحث', 'البحث'].includes(text)) {
    await handleAnimeSearch(api, event);
    return true;
  }

  const isSuggestCommand = /^(اقتراح|إقتراح)\s+(انمي|أنمي|إنمي)$/i.test(text);
  if (isSuggestCommand) {
    await handleAnimeSuggestStart(api, event);
    return true;
  }

  if (text === 'كوينز النشر') { await handleKoinezNashr(api, event); return true; }

  if (/^تحويل\s+\S+\s+كوينز\s+الى\s+.+$/.test(text)) { await handleTahwil(api, event); return true; }

  if (await handleQroub(api, event)) return true;

  if (await handleTaqrir(api, event)) return true;

  if (text === 'حفر' && kingdom === 'murdak') { await handleHafr(api, event); return true; }
  if (text === 'جمع' && kingdom === 'niravil') { await handleJam3(api, event); return true; }
  if (text === 'صيد' && kingdom === 'solfare') { await handleSayd(api, event); return true; }

  if (['حقيبة', 'حقيبتي', 'الحقيبة'].includes(text)) { await handleHaqiba(api, event); return true; }
  if (/^حذف\s+.+$/.test(text)) { await handleHadhf(api, event); return true; }
  if (/^ارسال\s+.+\s+الى\s+.+$/.test(text)) { await handleIrsal(api, event); return true; }

  if (text === 'تصنيع') { await handleTasni3Menu(api, event); return true; }
  if (/^تصنيع\s+(.+)$/.test(text)) { await handleCraftItem(api, event); return true; }
  if (['أسلحة', 'اسلحة'].includes(text)) { await handleAslihah(api, event); return true; }
  if (text === 'دروع') { await handleDuru3(api, event); return true; }
  if (text === 'مواد') { await handleMawad(api, event); return true; }

  if (/^هجوم\s+.+\s+على\s+.+$/.test(text)) { await handleHijoom(api, event); return true; }
  if (text === 'تجهيز الدرع') { await handleTajhizDar3(api, event); return true; }
  if (text === 'التجهيز التلقائي') { await handleAutoEquipToggle(api, event); return true; }

  return false;
}

module.exports = {
  handleQuickCommands,
  handleReplySpecificCommands,
  handleGamesFlow,
  handleAnimeFlow,
  handleMyRankCommand,
  routeMainCommands
};
