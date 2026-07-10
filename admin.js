/*
 * ═══════════════════════════════════════════════════════════════════════
 *  الملف الرئيسي المركزي: admin.js — واجهة التوجيه (Router) ونقاط الدخول
 * ═══════════════════════════════════════════════════════════════════════
 *  الوظائف والمحتويات:
 *  - استدعاء وتصدير كافة الوظائف المتصلة بإدارة النظام.
 *  - تجميع الوحدات المفككة من مجلد admin_modules وإدارة الجلسات بشكل منظم.
 *  - تمكين وتسهيل عمل البوت للأدمن في المحادثات الخاصة بشكل عادي.
 *  - تمكين وضع الصمت الكامل، التقمص الذكي، إزالة الإنذارات، ورتب الإدارة.
 *
 *  ملاحظة: تم تفكيك هذا الملف بالكامل — كل ميزة أصبحت بملفها الخاص داخل
 *  admin_modules/ لتسهيل الصيانة. هذا الملف أصبح مجرد موجّه (Router) خفيف.
 * ═══════════════════════════════════════════════════════════════════════
 */

const config = require('./config.json');

// استيراد الوحدات المفككة
const auth = require('./admin_modules/auth');
const helpers = require('./admin_modules/helpers');
const system = require('./admin_modules/system');
const groups = require('./admin_modules/groups');
const protection = require('./admin_modules/protection');
const moderation = require('./admin_modules/moderation');
const commands = require('./admin_modules/commands');
const announcements = require('./admin_modules/announcements');
const ai = require('./admin_modules/ai');
const database = require('./admin_modules/database');
const files = require('./admin_modules/files');
const interactionCoins = require('./interaction_coins');

// الميزات المستخرجة حديثاً (كل ميزة بملفها الخاص)
const menu = require('./admin_modules/menu');
const commandMgmt = require('./admin_modules/command_mgmt');
const drawKeys = require('./admin_modules/draw_keys');
const tasks = require('./admin_modules/tasks');
const impersonation = require('./admin_modules/impersonation');

const { sendMessage } = require('./utils');
const { getAdminSession, setAdminSession, deleteAdminSession, getPermanentBan, setBotConfig, getPlayer } = require('./database');
const { markBotDeleted, setSpyEnabled, isSpyEnabled } = require('./spy_group');
const { setResponseDelay, getResponseDelay } = require('./settings');

// ═════════════════════════════════════════════════════════════════════
//   الموجّه الرئيسي لجميع أوامر الأدمن
// ═════════════════════════════════════════════════════════════════════

async function handleAdminCommand(api, event) {
  const { senderID, body } = event;
  if (!auth.isAdmin(senderID)) return false;

  const text = (body || '').trim();

  // أوامر التحكم الأساسية بالحساب (نشطة دائماً حتى وإن كان البوت معطلاً)
  if (text === 'تشغيل البوت') { await system.handleBotStart(api, event); return true; }
  if (text === 'ايقاف البوت') { await system.handleBotStop(api, event); return true; }

  const adminSession = await getAdminSession(senderID);

  if (adminSession) {
    const s = adminSession.state;

    if (text === 'خروج') {
      await deleteAdminSession(senderID);
      await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
      return true;
    }

    // توجيه جلسات مفاتيح الرسم للادمن
    if (s.startsWith('DRAW_KEYS_')) {
      await drawKeys.handleDrawKeysSession(api, event, adminSession);
      return true;
    }

    // توجيه جلسات كوينز التفاعل للأدمن
    if (s.startsWith('INTERACTION_')) {
      const handled = await interactionCoins.handleAdminSettingsSession(api, event, adminSession);
      if (handled) return true;
    }

    // توجيه معالجة الجلسة النشطة لإنشاء مهمة جديدة من قبل الأدمن
    if (s.startsWith('ADMIN_ADD_TASK_')) {
      await tasks.handleTasksSession(api, event, adminSession);
      return true;
    }

    if (s.startsWith('CMD_MGMT_')) {
      await commandMgmt.handleCommandMgmtSession(api, event, adminSession);
      return true;
    }
    if (s === 'DATA_MAIN' || s === 'DATA_AWAIT_NAME' || s === 'DATA_AWAIT_PHOTO' || s === 'DATA_AWAIT_BOT_NICK') { 
      await groups.handleDataSession(api, event, adminSession); 
      return true; 
    }
    if (s === 'BOT_GROUPS_MAIN') {
      await groups.handleBotGroupsSession(api, event, adminSession);
      return true;
    }
    if (s === 'MSG_REQS_MAIN' || s === 'MSG_REQS_ACTION') {
      await groups.handleMessageRequestsSession(api, event, adminSession);
      return true;
    }
    if (s.startsWith('CITIES_')) {
      await groups.handleCitiesSession(api, event, adminSession);
      return true;
    }
    if (s === 'MA3LOOMAT_MAIN') { 
      await moderation.handleMa3looomatSession(api, event, adminSession); 
      return true; 
    }
    if (s === 'HAZAR_LIST') { 
      await moderation.handleHazarSession(api, event, adminSession); 
      return true; 
    }
    if (s === 'ISHAAR_KINGDOM' || s === 'ISHAAR_TEXT') { 
      await announcements.handleIshaarSession(api, event, adminSession); 
      return true; 
    }
    if (s === 'TATLEEL_AWAIT_WORD') { 
      await commands.handleTatleelSession(api, event, adminSession); 
      return true; 
    }
    if (s === 'TASHGEEL_CHOOSE') { 
      await commands.handleTashgeelSession(api, event, adminSession); 
      return true; 
    }
    if (['BOTAAT_MAIN','BOTAAT_BOT_MENU','BOTAAT_ADD_NAME','BOTAAT_ADD_COOKIES','BOTAAT_EDIT_COOKIES','BOTAAT_RENAME','BOTAAT_DELETE_CONFIRM'].includes(s)) { 
      await system.handleBotaatSession(api, event, adminSession); 
      return true; 
    }
    if (s === 'TABDEEL_SELECT') { 
      await system.handleTabdeelSession(api, event, adminSession); 
      return true; 
    }
    if (s === 'HIMAYA_MAIN') { 
      await protection.handleHimayaSession(api, event, adminSession); 
      return true; 
    }
    if (['NEXUS_AI_MAIN','NEXUS_ADD_NAME','NEXUS_ADD_KEY','NEXUS_ADD_PROMPT','NEXUS_EDIT_SELECT','NEXUS_EDIT_PROMPT','NEXUS_DELETE_SELECT'].includes(s)) { 
      await ai.handleNexusAISession(api, event, adminSession); 
      return true; 
    }
    if (s === 'QAEEDA_MAIN' || s === 'QAEEDA_CONFIRM' || s === 'QAEEDA_CONFIRM_ALL') { 
      await database.handleQaeedaDBSession(api, event, adminSession); 
      return true; 
    }
    if (s === 'QAROBAAT_MAIN' || s === 'QAROBAAT_AWAIT_ID') { 
      await groups.handleQarobaatSession(api, event, adminSession); 
      return true; 
    }
    if (s.startsWith('FILES_')) { 
      await files.handleFilesSession(api, event, adminSession); 
      return true; 
    }
    if (s === 'IDAFA_SELECT') { 
      await groups.handleIdafaSession(api, event, adminSession); 
      return true; 
    }
    if (s === 'BAYAAT_TARGET') { 
      await deleteAdminSession(senderID); 
      await moderation.handleBayaat(api, event, text); 
      return true; 
    }
    if (s === 'BAYAAT_MOABAD_TARGET') { 
      await deleteAdminSession(senderID); 
      await moderation.handleBayaatMoabad(api, event, text); 
      return true; 
    }
    if (s === 'HADHF_TARGET') { 
      await deleteAdminSession(senderID); 
      await moderation.handleHadhfAdmin(api, event, text); 
      return true; 
    }
    if (['TTS_MAIN','TTS_ADD_KEY','TTS_DELETE_KEY','TTS_VOICE'].includes(s)) {
      const { handleTtsSettingsSession } = require('./voice_tts');
      await handleTtsSettingsSession(api, event, adminSession);
      return true;
    }
  }

  // معالجة الأوامر المباشرة

  // --- أوامر الصمت الكامل ---
  if (text === 'صمت هنا') {
    await moderation.handleMuteHere(api, event);
    return true;
  }
  if (text === 'صمت الكل') {
    await moderation.handleMuteAll(api, event);
    return true;
  }
  if (text === 'فك الصمت هنا') {
    await moderation.handleUnmuteHere(api, event);
    return true;
  }
  if (text === 'فك الصمت الكل') {
    await moderation.handleUnmuteAll(api, event);
    return true;
  }

  // --- أمر إزالة الإنذارات ---
  if (text.startsWith('ازالة الانذارات') || text.startsWith('إزالة الإنذارات') || (event.messageReply && (text === 'ازالة الانذارات' || text === 'إزالة الإنذارات'))) {
    await moderation.handleEzalatIntharat(api, event, text);
    return true;
  }

  // --- أمر العقوبة (إضافة إنذار) ---
  if (text === 'عقوبة') {
    if (!event.messageReply) {
      const { sendReply } = require('./utils');
      await sendReply(api, `❌ يرجى الرد على رسالة اللاعب المستهدف لتطبيق العقوبة (إضافة إنذار).`, event.messageID, event.threadID);
      return true;
    }
    const targetID = String(event.messageReply.senderID);
    const { updatePlayer } = require('./database');
    const { sendReply } = require('./utils');
    const victimPlayer = await getPlayer(targetID);
    if (!victimPlayer) {
      await sendReply(api, `❌ هذا المستخدم غير مسجل في نظام نيكسوس.`, event.messageID, event.threadID);
      return true;
    }
    const currentWarnings = (victimPlayer.warnings || 0) + 1;
    await updatePlayer(targetID, { warnings: currentWarnings });
    try {
      const gid = config.groupes[victimPlayer.kingdom];
      if (gid) {
        const { changePlayerNickname } = require('./dukhul');
        await changePlayerNickname(api, gid, targetID, victimPlayer.nickname, victimPlayer.rank || 'مجند', victimPlayer.class, currentWarnings);
      }
    } catch (e) {}
    await sendReply(api, `⚠️ تم إضافة إنذار للاعب [${victimPlayer.nickname}].\nعدد الإنذارات الحالي: ${'🔴'.repeat(currentWarnings)}`, event.messageID, event.threadID);
    await moderation.checkAndEnforceWarnings(api, targetID, victimPlayer.nickname, victimPlayer.kingdom, currentWarnings).catch(() => {});
    return true;
  }

  // --- أمر رتب الإدارة المخصص ---
  if (text === 'رتب الادارة' || text === 'رتب الإدارة') {
    const { handleRanksAlIdarah } = require('./ranks');
    await handleRanksAlIdarah(api, event);
    return true;
  }

  // --- أمر التقمص وإلغاء التقمص ---
  if (await impersonation.handleImpersonationCommand(api, event)) {
    return true;
  }

  if (text === 'اعدادات قول') {
    const { handleTtsSettings } = require('./voice_tts');
    await handleTtsSettings(api, event);
    return true;
  }

  if (text === 'اضافة مهام' || text === 'إضافة مهام') {
    await tasks.handleTasksStart(api, event);
    return true;
  }

  if (text === 'مفاتيح رسم') {
    await drawKeys.handleDrawKeysStart(api, event);
    return true;
  }

  if (text === 'ضبط الاوامر') {
    await commandMgmt.handleCommandMgmtStart(api, event);
    return true;
  }

  if (text === 'ايدي') {
    const targetId = (event.messageReply && event.messageReply.senderID) ? String(event.messageReply.senderID) : String(senderID);
    const label = (event.messageReply && event.messageReply.senderID) ? 'ايدي الشخص' : 'ايدي';
    await sendMessage(api, `╮───∙⋆⋅「 ${label} 」\n│\n│ › ${targetId}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
    return true;
  }
  
  if (text === 'ايدي القروب') { 
    if (!event.isGroup) {
      await sendMessage(api, `╮───∙⋆⋅「 ايدي القروب 」\n│\n│ › ⚠️ أنت في محادثة خاصة (ليست مجموعة).\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
    } else {
      await sendMessage(api, `╮───∙⋆⋅「 ايدي القروب 」\n│\n│ › ${event.threadID}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID); 
    }
    return true; 
  }

  if (text === 'لوحة التحكم')    { await menu.handleAdminMenu(api, event);      return true; }
  if (text === 'بيانات')          { await database.handleBayaanat(api, event);   return true; }
  if (text === 'تعديل')           { await groups.handleTa3deel(api, event);     return true; }
  if (text === 'معلومات')         { await moderation.handleMa3loomat(api, event, ''); return true; }
  
  if (/^معلومات\s+(.+)$/.test(text)) { 
    await moderation.handleMa3loomat(api, event, text.match(/^معلومات\s+(.+)$/)[1]); 
    return true; 
  }
  
  if (text === 'الحظر')           { await moderation.handleHazar(api, event);   return true; }
  if (text === 'اشعار')           { await announcements.handleIshaarAdmin(api, event); return true; }
  if (text === 'تعطيل')           { await commands.handleTatleel(api, event, senderID); return true; }
  if (text === 'تشغيل')           { await commands.handleTashgeel(api, event, senderID); return true; }
  if (text === 'البوتات')         { await system.handleBotaat(api, event);     return true; }
  if (text === 'تبديل')           { await system.handleTabdeel(api, event);    return true; }
  if (text === 'اعادة ضبط')       { await groups.handleEadatDabt(api, event);   return true; }
  if (text === 'الحماية')         { await protection.handleHimaya(api, event);  return true; }
  if (text === 'ريست')            { await system.handleReset(api, event);       return true; }
  if (text === 'قاعدة البيانات')  { await database.handleQaeedaDB(api, event);   return true; }
  if (text === 'القروبات')        { await groups.handleQarobaat(api, event);    return true; }
  if (text === 'قروبات البوت')    { await groups.handleBotGroups(api, event);   return true; }
  if (text === 'طلبات المراسلة')  { await groups.handleMessageRequests(api, event); return true; }
  if (text === 'الوكلاء')         { await ai.handleNexusAI(api, event);         return true; }
  if (text === 'اضافة')           { await groups.handleIdafa(api, event);       return true; }
  if (text === 'المشرفون')        { await auth.handleMoshrefeen(api, event);    return true; }
  
  if (/^ادمن اضافة\s+(.+)$/.test(text)) { 
    await auth.handleAdminAdd(api, event, text.match(/^ادمن اضافة\s+(.+)$/)[1]); 
    return true; 
  }
  
  if (/^ادمن حذف\s+(.+)$/.test(text)) { 
    await auth.handleAdminRemove(api, event, text.match(/^ادمن حذف\s+(.+)$/)[1]); 
    return true; 
  }

  if (text === 'ذاكرة') { 
    await ai.handleZakira(api, event, ''); 
    return true; 
  }
  
  if (/^ذاكرة\s+(.+)$/.test(text)) { 
    await ai.handleZakira(api, event, text.match(/^ذاكرة\s+(.+)$/)[1].trim()); 
    return true; 
  }

  // أمر كوينز التفاعل للأدمن
  if (text === 'اعدادات كوينز التفاعل') {
    await interactionCoins.handleAdminSettings(api, event);
    return true;
  }

  if (text === 'تفاعلات') {
    await interactionCoins.handleAdminReviewCommand(api, event);
    return true;
  }

  // أمر التأخير
  const delayMatch = text.match(/^تأخير\s+(\d+(\.\d+)?)$/);
  if (delayMatch) {
    const seconds = parseFloat(delayMatch[1]);
    setResponseDelay(seconds);
    await setBotConfig('responseDelay', seconds);
    const msg = seconds === 0
      ? `╮───∙⋆⋅「 تأخير 」\n│\n│ › ✅ تم إلغاء التأخير\n│ › البوت يرد فوراً الآن\n╯───────∙⋆⋅ ※ ⋅⋆∙`
      : `╮───∙⋆⋅「 تأخير 」\n│\n│ › ✅ تم ضبط التأخير\n│ › المدة: ${seconds} ثانية\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
    await sendMessage(api, msg, event.threadID);
    return true;
  }

  if (text === 'ملفات')           { await files.handleFiles(api, event);         return true; }

  if (text === 'جاسوس') {
    const now = isSpyEnabled(); await setSpyEnabled(!now);
    await sendMessage(api, `╮───∙⋆⋅「 جاسوس 」\n│\n│ › ${!now ? '✅ تم تفعيل كشف الرسائل المحذوفة' : '🔴 تم تعطيل كشف الرسائل المحذوفة'}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
    return true;
  }

  if (text === 'مسح') {
    if (!event.messageReply || !event.messageReply.messageID) {
      await sendMessage(api, `╮───∙⋆⋅「 مسح 」\n│\n│ › رد على الرسالة التي تريد حذفها\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID); 
      return true;
    }
    try { markBotDeleted(event.messageReply.messageID); await new Promise(r => api.unsendMessage(event.messageReply.messageID, () => r())); } catch (e) {}
    try {
      await new Promise(r => api.setMessageReaction('🗑️', event.messageID, event.threadID, () => r(), true));
      setTimeout(() => { try { api.setMessageReaction('', event.messageID, event.threadID, () => {}, true); } catch (e) {} }, 1000);
    } catch (e) {}
    return true;
  }

  if (text === 'بانكاي' || (event.messageReply && text === 'بانكاي')) { await moderation.handleBayaat(api, event, ''); return true; }
  if (/^بانكاي\s+(.+)$/.test(text)) { await moderation.handleBayaat(api, event, text.replace(/^بانكاي\s+/, '')); return true; }
  
  if (text === 'بانكاي مؤبد' || (event.messageReply && text === 'بانكاي مؤبد')) { await moderation.handleBayaatMoabad(api, event, ''); return true; }
  if (/^بانكاي مؤبد\s+(.+)$/.test(text)) { await moderation.handleBayaatMoabad(api, event, text.replace(/^بانكاي مؤبد\s+/, '')); return true; }
  
  if (text === 'طرد' || (event.messageReply && text === 'طرد')) { await moderation.handleBayaat(api, event, ''); return true; }
  if (/^طرد\s+(.+)$/.test(text)) { await moderation.handleBayaat(api, event, text.replace(/^طرد\s+/, '')); return true; }
  
  if (text === 'حذف' || (event.messageReply && text === 'حذف')) { await moderation.handleHadhfAdmin(api, event, ''); return true; }
  if (/^حذف\s+(.+)$/.test(text)) { 
    const args = text.replace(/^حذف\s+/, ''); 
    if (!/^.+\s+من\s+.+$/.test(args)) { await moderation.handleHadhfAdmin(api, event, args); return true; } 
  }

  return false;
}

// التصديرات المتوافقة
module.exports = {
  handleAdminGranted: menu.handleAdminGranted,
  handleAdminCommand,
  handleImpersonationInterceptor: impersonation.handleImpersonationInterceptor,
  handleProtection: protection.handleProtection,
  handleDisabledCommand: commands.handleDisabledCommand,
  matchCommandKey: commands.matchCommandKey,
  isAdmin: auth.isAdmin,
  kickFromAllGroups: helpers.kickFromAllGroups,
  getPermanentBan,
  initAdminIds: impersonation.initAdminIdsWithImpersonation, // تم الترقية لتحميل التقمص
  initGroupes: auth.initGroupes,
  initBotEnabled: system.initBotEnabled,
  isBotEnabled: system.isBotEnabled,
};
