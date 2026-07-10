// admin_router.js
// توجيه أوامر الأدمن (DM وداخل القروبات) وأوامر نائب الامبراطور
// ملاحظة: تم تفكيك هذا الملف — كل ميزة أصبحت بملفها الخاص داخل admin_modules/:
//   - admin_modules/ignore_system.js  → التجاهل / فك التجاهل / وضع الصمت الجماعي
//   - admin_modules/deputy_panel.js   → لوحة تحكم نائب الامبراطور
//   - admin_modules/rank_change.js    → أمر "تغيير الرتبة"
//   - admin_modules/promo_codes.js    → نظام الأكواد الترويجية (جديد)

const { handleAdminCommand, isAdmin } = require('./admin');
const { getAdminSession } = require('./database');
const { sendReply } = require('./utils');

const ignoreSystem = require('./admin_modules/ignore_system');
const deputyPanel = require('./admin_modules/deputy_panel');
const rankChange = require('./admin_modules/rank_change');
const promoCodes = require('./admin_modules/promo_codes'); // استدعاء النظام الجديد

// يعالج أوامر الأدمن والإمبراطور والنائب عند المراسلة الخاصة (DM).
async function handleAdminDM(api, event) {
  const { senderID } = event;
  const text = (event.body || '').trim();

  // تنظيف جلسات التجاهل المنتهية
  await ignoreSystem.checkAndCleanExpiredIgnores(api).catch(() => {});

  // --- معالجة فك وتطبيق التجاهل للأدمن / الامبراطور / النائب عبر المراسلة الخاصة ---
  if (await ignoreSystem.tryHandleIgnoreCommand(api, event, senderID)) return true;

  if (!isAdmin(senderID)) return false;

  const { handleManshourat, handleManshouraatSession } = require('./nashr');
  const adminSessionDM = await getAdminSession(senderID);
  if (adminSessionDM?.state?.startsWith('NASHR_')) {
    await handleManshouraatSession(api, event, adminSessionDM);
    return true;
  }
  if (text === 'منشورات') {
    await handleManshourat(api, event);
    return true;
  }
  const adminHandledDM = await handleAdminCommand(api, event);
  if (adminHandledDM) return true;

  return false;
}

// يعالج أوامر الأدمن والإمبراطور والنائب داخل القروبات
async function handleAdminGroup(api, event) {
  const { senderID } = event;
  const text = (event.body || '').trim();

  // تنظيف جلسات التجاهل المنتهية
  await ignoreSystem.checkAndCleanExpiredIgnores(api).catch(() => {});

  // فحص وتطبيق عقوبات الصمت أولاً في القروب
  if (await ignoreSystem.checkMutedGroupMessage(api, event)) return true;

  // --- معالجة فك وتطبيق التجاهل للادمن / الامبراطور / نائب الامبراطور ---
  if (await ignoreSystem.tryHandleIgnoreCommand(api, event, senderID)) return true;

  if (!isAdmin(senderID)) return false;

  const { checkAndSendNotifications } = require('./isharat');
  checkAndSendNotifications(api, event).catch(() => {});

  const { handleManshourat, handleManshouraatSession } = require('./nashr');
  const adminSession2 = await getAdminSession(senderID);
  if (adminSession2?.state?.startsWith('NASHR_')) {
    await handleManshouraatSession(api, event, adminSession2);
    return true;
  }
  if (text === 'منشورات') {
    await handleManshourat(api, event);
    return true;
  }
  const adminHandled = await handleAdminCommand(api, event);
  if (adminHandled) return true;

  return false;
}

// يعالج جلسة اختيار قروب للإضافة، وجلسة اختيار رتبة، وجلسة إدخال وقت التجاهل، وجلسة إنشاء كود
async function handleAdminSessionState(api, event, adminSession) {
  if (adminSession.state === 'AWAITING_IGNORE_DURATION') {
    return await ignoreSystem.handleIgnoreDurationSession(api, event, adminSession);
  }

  if (adminSession.state === 'DEPUTY_ADD_GROUP') {
    return await deputyPanel.handleDeputyAddGroupSession(api, event, adminSession);
  }

  if (adminSession.state === 'AWAITING_RANK_CHANGE_NUMBER') {
    return await rankChange.handleRankChangeSession(api, event, adminSession);
  }

  // معالجة جلسات إنشاء كود ترويجي
  if (adminSession.state.startsWith('AWAITING_CODE_')) {
    return await promoCodes.handleCreateCodeSession(api, event, adminSession);
  }

  return false;
}

module.exports = {
  handleAdminDM,
  handleAdminGroup,
  handleAdminSessionState,
  handleDeputyEmperorCommands: deputyPanel.handleDeputyEmperorCommands,
  handleChangeRankCommand: rankChange.handleChangeRankCommand,
  checkMutedGroupMessage: ignoreSystem.checkMutedGroupMessage,
  handleThreadNameChange: ignoreSystem.handleThreadNameChange,
  isPlayerIgnored: ignoreSystem.isPlayerIgnored
};