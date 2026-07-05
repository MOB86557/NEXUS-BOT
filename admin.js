/*
 * ═══════════════════════════════════════════════════════════════════════
 *  الملف الرئيسي المركزي: admin.js — واجهة التوجيه (Router) ونقاط الدخول
 * ═══════════════════════════════════════════════════════════════════════
 *  الوظائف والمحتويات:
 *  - استدعاء وتصدير كافة الوظائف المتصلة بإدارة النظام.
 *  - تجميع الوحدات المفككة من مجلد admin_modules وإدارة الجلسات بشكل منظم.
 *  - تمكين وتسهيل عمل البوت للأدمن في المحادثات الخاصة بشكل عادي.
 *  - تمكين وضع الصمت الكامل، التقمص الذكي، إزالة الإنذارات، ورتب الإدارة.
 * ═══════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
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

const { sendMessage } = require('./utils');
// تم استيراد setAdminSession هنا لحل مشكلة كراش الأمر
const { getAdminSession, setAdminSession, deleteAdminSession, getPermanentBan, setBotConfig, getPlayer } = require('./database');
const { markBotDeleted, setSpyEnabled, isSpyEnabled } = require('./spy_group');
const { setResponseDelay, getResponseDelay } = require('./settings');

// دالة مساعدة لعمل escape لنصوص البحث
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═════════════════════════════════════════════════════════════════════
//   القائمة الرئيسية (لوحة تحكم الامبراطور)
// ═════════════════════════════════════════════════════════════════════

async function handleAdminMenu(api, event) {
  const msg =
    `╗═════━━━❖━━━═════╔\n` +
    `            لوحة تحكم الامبراطور       \n` +
    `╝═════━━━❖━━━═════╚\n` +
    `❖ بيانات \n` +
    `❖ معلومات \n` +
    `❖ بانكاي\n` +
    `❖ بانكاي مؤبد\n` +
    `❖ حذف\n` +
    `❖ الحظر\n` +
    `❖ اشعار \n` +
    `❖ اضافة مهام \n` +
    `❖ تجاهل / فك التجاهل \n` +
    `❖ ازالة الانذارات \n` +
    `❖ تقمص / الغاء التقمص \n` +
    `❖  رتب الادارة \n` +
    `❖ صمت هنا\n` +
    `❖ صمت الكل\n` +
    `❖ فك الصمت هنا\n` +
    `❖ فك الصمت الكل\n` +
    `❖ اعدادات كوينز التفاعل\n` +
    `❖ تفاعلات\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `❖ المشرفون\n` +
    `❖ ريست \n` +
    `❖ ملفات\n` +
    `❖ ايقاف البوت / تشغيل البوت\n` +
    `❖ تأخير \n` +
    `❖ تعديل\n` +
    `❖ تعطيل / تشغيل \n` +
    `❖ مسح\n` +
    `❖ جاسوس\n` +
    `❖ ضبط الاوامر \n` +
    `❖ البوتات \n` +
    `❖ تبديل \n` +
    `❖ اعادة ضبط \n` +
    `❖ الحماية \n` +
    `❖ قاعدة البيانات \n` +
    `❖ طلبات المراسلة \n` +
    `❖ القروبات\n` +
    `❖ قروبات البوت \n` +
    `❖ اضافة \n` +
    `❖ ايدي / ايدي القروب\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `❖ اعدادات قول \n` +
    `❖ منشورات\n` +
    `❖ الوكلاء / ذاكرة`;
  await sendMessage(api, msg, event.threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   منح صلاحيات الأدمن
// ═════════════════════════════════════════════════════════════════════

async function handleAdminGranted(api, event) {
  try {
    await sendMessage(api,
      `╗═════━━━━━═════╔\n ┇            𝑨𝑫𝑴𝑰𝑵 ☑            ┇  \n╝═════━━━━━═════╚`,
      event.threadID);
  } catch (e) {}
}

// ═════════════════════════════════════════════════════════════════════
//   منظم وجلسة التحكم بالأوامر للمطور
// ═════════════════════════════════════════════════════════════════════
async function handleCommandMgmtSession(api, event, session) {
  const { senderID, body } = event;
  const text = (body || '').trim();
  const s = session.state;

  const { deleteAdminSession, setAdminSession, getCustomCommands, saveCustomCommands } = require('./database');
  const { DEFAULT_COMMANDS, fetchCommandsList } = require('./awamer');

  if (text === 'خروج') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
    return;
  }

  const currentCommands = await fetchCommandsList();

  if (s === 'CMD_MGMT_MAIN') {
    if (text === '1') {
      await setAdminSession(senderID, { state: 'CMD_MGMT_ADD_TYPE' });
      await sendMessage(api, `╮───∙⋆⋅「 إضافة أمر 」\n│ اختر نوع الأمر:\n│ 1 》 أمر عادي (مفتوح للجميع)\n│ 2 》 أمر مقفول بمفتاح متجر\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
      return;
    }
    if (text === '2') {
      await setAdminSession(senderID, { state: 'CMD_MGMT_EDIT_SELECT' });
      let listMsg = `╮───∙⋆⋅「 تعديل أمر 」\nالرجاء إدخال رقم الأمر الذي ترغب في تعديله:\n`;
      currentCommands.forEach((cmd, idx) => {
        listMsg += `│ ${idx + 1}. ${cmd.text} ${cmd.key ? '(🔒 بمفتاح)' : ''}\n`;
      });
      listMsg += `╯───────∙⋆⋅ ※ ⋅⋆∙\n› أدخل الرقم المطلوب أو "خروج"`;
      await sendMessage(api, listMsg, event.threadID);
      return;
    }
    if (text === '3') {
      await setAdminSession(senderID, { state: 'CMD_MGMT_DELETE_SELECT' });
      let listMsg = `╮───∙⋆⋅「 حذف أمر 」\nالرجاء إدخال رقم الأمر الذي ترغب بحذفه:\n`;
      currentCommands.forEach((cmd, idx) => {
        listMsg += `│ ${idx + 1}. ${cmd.text}\n`;
      });
      listMsg += `╯───────∙⋆⋅ ※ ⋅⋆∙\n› أدخل الرقم المطلوب أو "خروج"`;
      await sendMessage(api, listMsg, event.threadID);
      return;
    }
    if (text === '4') {
      await setAdminSession(senderID, { state: 'CMD_MGMT_REORDER_SELECT' });
      let listMsg = `╮───∙⋆⋅「 ترتيب الأوامر 」\nالرجاء إدخال رقم الأمر الذي ترغب في تغيير مكانه:\n`;
      currentCommands.forEach((cmd, idx) => {
        listMsg += `│ ${idx + 1}. ${cmd.text}\n`;
      });
      listMsg += `╯───────∙⋆⋅ ※ ⋅⋆∙\n› أدخل الرقم المطلوب أو "خروج"`;
      await sendMessage(api, listMsg, event.threadID);
      return;
    }
    if (text === '5') {
      let listMsg = `╮───∙⋆⋅「 قائمة الأوامر الحالية 」\n`;
      currentCommands.forEach((cmd, idx) => {
        listMsg += `│ ${idx + 1}. ${cmd.text} ${cmd.key ? `[قفل: ${cmd.key}]` : ''}\n`;
      });
      listMsg += `╯───────∙⋆⋅ ※ ⋅⋆∙`;
      await sendMessage(api, listMsg, event.threadID);
      await setAdminSession(senderID, { state: 'CMD_MGMT_MAIN' });
      return;
    }
    if (text === '6') {
      await saveCustomCommands(DEFAULT_COMMANDS);
      await sendMessage(api, `✅ تم إعادة ضبط قائمة الأوامر للوضع الافتراضي بنجاح!`, event.threadID);
      await deleteAdminSession(senderID);
      return;
    }

    await sendMessage(api, `⚠️ خيار غير صحيح. الرجاء إدخال رقم من 1 إلى 6 أو 《 خروج 》.`, event.threadID);
    return;
  }

  // --- إضافة أمر جديد ---
  if (s === 'CMD_MGMT_ADD_TYPE') {
    if (text === '1') {
      await setAdminSession(senderID, { state: 'CMD_MGMT_ADD_TEXT', isLocked: false });
      await sendMessage(api, `الرجاء إدخال نص الأمر مع الوصف (مثال: ➤ اسم الأمر ┇ الوصف):`, event.threadID);
      return;
    }
    if (text === '2') {
      await setAdminSession(senderID, { state: 'CMD_MGMT_ADD_TEXT', isLocked: true });
      await sendMessage(api, `الرجاء إدخال نص الأمر في حالة فك القفل (مثال: ➤ ترجمة ┇ لترجمة النصوص):`, event.threadID);
      return;
    }
    await sendMessage(api, `⚠️ خيار غير صحيح. اختر 1 أو 2.`, event.threadID);
    return;
  }

  if (s === 'CMD_MGMT_ADD_TEXT') {
    const isLocked = session.isLocked;
    if (isLocked) {
      await setAdminSession(senderID, { state: 'CMD_MGMT_ADD_LOCKED_TEXT', isLocked, textValue: text });
      await sendMessage(api, `الرجاء إدخال نص الأمر في حالة القفل (مثال: ➤ 🔒 ترجمة ┇ لترجمة النصوص):`, event.threadID);
    } else {
      const newCmd = { text, kingdoms: [] };
      currentCommands.push(newCmd);
      await saveCustomCommands(currentCommands);
      await sendMessage(api, `✅ تم إضافة الأمر العادي الجديد بنجاح!`, event.threadID);
      await deleteAdminSession(senderID);
    }
    return;
  }

  if (s === 'CMD_MGMT_ADD_LOCKED_TEXT') {
    await setAdminSession(senderID, { state: 'CMD_MGMT_ADD_KEY', textValue: session.textValue, lockedTextValue: text });
    await sendMessage(api, `الرجاء إدخال اسم مفتاح المتجر الدقيق المرتبط بهذا الأمر (مثال: مفتاح أمر ترجمة):`, event.threadID);
    return;
  }

  if (s === 'CMD_MGMT_ADD_KEY') {
    const newCmd = {
      key: text,
      text: session.textValue,
      lockedText: session.lockedTextValue,
      kingdoms: []
    };
    currentCommands.push(newCmd);
    await saveCustomCommands(currentCommands);
    await sendMessage(api, `✅ تم إضافة الأمر المقفول الجديد بنجاح!`, event.threadID);
    await deleteAdminSession(senderID);
    return;
  }

  // --- تعديل أمر ---
  if (s === 'CMD_MGMT_EDIT_SELECT') {
    const idx = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= currentCommands.length) {
      await sendMessage(api, `⚠️ رقم غير صحيح. اختر من القائمة المتاحة.`, event.threadID);
      return;
    }
    const targetCmd = currentCommands[idx];
    await setAdminSession(senderID, { state: 'CMD_MGMT_EDIT_VALUE', editIndex: idx });
    await sendMessage(api, `╮───∙⋆⋅「 تعديل أمر 」\n│ النص الحالي: ${targetCmd.text}\n│ أدخل النص والوصف الجديد بالكامل:\n╯───────∙⋆┌ ※ ┐`, event.threadID);
    return;
  }

  if (s === 'CMD_MGMT_EDIT_VALUE') {
    const idx = session.editIndex;
    currentCommands[idx].text = text;
    if (currentCommands[idx].key) {
      currentCommands[idx].lockedText = `➤ 🔒 ${text.replace(/^➤\s*/, '')}`;
    }
    await saveCustomCommands(currentCommands);
    await sendMessage(api, `✅ تم تعديل الأمر بنجاح!`, event.threadID);
    await deleteAdminSession(senderID);
    return;
  }

  // --- حذف أمر ---
  if (s === 'CMD_MGMT_DELETE_SELECT') {
    const idx = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= currentCommands.length) {
      await sendMessage(api, `⚠️ رقم غير صحيح. اختر من القائمة المتاحة.`, event.threadID);
      return;
    }
    const deleted = currentCommands.splice(idx, 1);
    await saveCustomCommands(currentCommands);
    await sendMessage(api, `✅ تم حذف الأمر (${deleted[0].text}) بنجاح!`, event.threadID);
    await deleteAdminSession(senderID);
    return;
  }

  // --- ترتيب الأوامر ---
  if (s === 'CMD_MGMT_REORDER_SELECT') {
    const idx = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= currentCommands.length) {
      await sendMessage(api, `⚠️ رقم غير صحيح. اختر من القائمة المتاحة.`, event.threadID);
      return;
    }
    await setAdminSession(senderID, { state: 'CMD_MGMT_REORDER_DEST', fromIndex: idx });
    await sendMessage(api, `الأمر المختار هو: (${currentCommands[idx].text})\nأدخل الرقم الموضع الجديد الذي ترغب بنقل الأمر إليه (1 إلى ${currentCommands.length}):`, event.threadID);
    return;
  }

  if (s === 'CMD_MGMT_REORDER_DEST') {
    const fromIdx = session.fromIndex;
    const toIdx = parseInt(text, 10) - 1;
    if (isNaN(toIdx) || toIdx < 0 || toIdx >= currentCommands.length) {
      await sendMessage(api, `⚠️ موضع غير صحيح. الرجاء الإدخال من 1 إلى ${currentCommands.length}.`, event.threadID);
      return;
    }
    const [item] = currentCommands.splice(fromIdx, 1);
    currentCommands.splice(toIdx, 0, item);
    await saveCustomCommands(currentCommands);
    await sendMessage(api, `✅ تم تغيير ترتيب الأمر بنجاح!`, event.threadID);
    await deleteAdminSession(senderID);
    return;
  }
}

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

    // توجيه جلسات كوينز التفاعل للأدمن
    if (s.startsWith('INTERACTION_')) {
      const handled = await interactionCoins.handleAdminSettingsSession(api, event, adminSession);
      if (handled) return true;
    }

    // توجيه معالجة الجلسة النشطة لإنشاء مهمة جديدة من قبل الأدمن
    if (s.startsWith('ADMIN_ADD_TASK_')) {
      const db = require('./database').getDB();
      if (s === 'ADMIN_ADD_TASK_CHOOSE_RANK') {
        if (text === '1') {
          await setAdminSession(senderID, { state: 'ADMIN_ADD_TASK_TITLE', targetRank: 'نائب الامبراطور' });
          await sendMessage(api, `✉️ يرجى إدخال عنوان المهمة:`, event.threadID);
        } else {
          await sendMessage(api, `⚠️ خيار غير صحيح. يرجى إرسال رقم الرتبة المطلوبة (1) أو "خروج" للإلغاء.`, event.threadID);
        }
        return true;
      }
      if (s === 'ADMIN_ADD_TASK_TITLE') {
        await setAdminSession(senderID, {
          state: 'ADMIN_ADD_TASK_DETAILS',
          targetRank: adminSession.targetRank,
          taskTitle: text
        });
        await sendMessage(api, `📝 يرجى إدخال تفاصيل المهمة:`, event.threadID);
        return true;
      }
      if (s === 'ADMIN_ADD_TASK_DETAILS') {
        const title = adminSession.taskTitle;
        const details = text;
        const targetRank = adminSession.targetRank;

        await db.collection('tasks').insertOne({
          title,
          details,
          targetRank,
          createdBy: senderID,
          createdAt: new Date()
        });

        await deleteAdminSession(senderID);
        await sendMessage(api, `✅ تم ارسال المهمة للرتبة المحددة`, event.threadID);

        // إشعار كافة نوائب الإمبراطور المسجلين
        const deputies = await db.collection('players').find({ rank: 'نائب الامبراطور' }).toArray();
        for (const dep of deputies) {
          await db.collection('notifications').insertOne({
            fbId: String(dep.fbId),
            message: `🔔 مهمة جديدة اكتب " مهام "`,
            createdAt: new Date(),
            sent: false
          });
        }
        return true;
      }
    }

    if (s.startsWith('CMD_MGMT_')) {
      await handleCommandMgmtSession(api, event, adminSession);
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

  // --- أمر رتب الإدارة المخصص ---
  if (text === 'رتب الادارة' || text === 'رتب الإدارة') {
    const { handleRanksAlIdarah } = require('./ranks');
    await handleRanksAlIdarah(api, event);
    return true;
  }

  // --- أمر التقمص وإلغاء التقمص ---
  if (text === 'الغاء التقمص' || text === 'إلغاء التقمص') {
    global.impersonations = global.impersonations || {};
    const adminId = event.originalSenderID || senderID;
    if (global.impersonations[adminId]) {
      delete global.impersonations[adminId];
      const db = require('./database').getDB();
      await db.collection('impersonations').deleteOne({ adminId: adminId });
      await sendMessage(api, `╮───∙⋆⋅「 إلغاء التقمص 」\n│\n│ › ✅ تم إلغاء التقمص بنجاح.\n│ › عدت لهويتك الأصلية كمسؤول.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
    } else {
      await sendMessage(api, `⚠️ أنت لا تتقمص دور أي لاعب حالياً.`, event.threadID);
    }
    return true;
  }

  if (text.startsWith('تقمص ')) {
    const db = require('./database').getDB();
    const target = text.replace(/^تقمص\s+/, '').trim();
    if (!target) {
      await sendMessage(api, `⚠️ يرجى تحديد لقب اللاعب، ايديه، أو رابط حسابه للتقمص.`, event.threadID);
      return true;
    }
    
    let player = null;
    if (/^\d+$/.test(target)) {
      player = await db.collection('players').findOne({ fbId: target });
    }
    
    if (!player && (target.includes('facebook.com') || target.includes('fb.com'))) {
      const idMatch = target.match(/(?:profile\.php\?id=)?(\d+)/);
      const extractedId = idMatch ? idMatch[1] : null;
      if (extractedId) {
        player = await db.collection('players').findOne({ fbId: extractedId });
      }
      if (!player) {
        player = await db.collection('players').findOne({ link: target });
      }
    }
    
    if (!player) {
      player = await db.collection('players').findOne({ 
        $or: [
          { name: { $regex: new RegExp(escapeRegex(target), 'i') } },
          { nickname: { $regex: new RegExp(escapeRegex(target), 'i') } }
        ]
      });
    }
    
    global.impersonations = global.impersonations || {};
    
    if (player) {
      global.impersonations[senderID] = player.fbId;
      await db.collection('impersonations').updateOne(
        { adminId: senderID },
        { $set: { targetId: player.fbId, targetName: player.name || player.nickname || player.fbId } },
        { upsert: true }
      );
      await sendMessage(api, `╮───∙⋆⋅「 تقمص 」\n│\n│ › ✅ تم التقمص بنجاح!\n│ › أنت الآن تتقمص دور اللاعب: ${player.name || player.nickname || player.fbId}\n│ › لإلغاء التقمص اكتب: الغاء التقمص\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
    } else if (/^\d+$/.test(target)) {
      global.impersonations[senderID] = target;
      await db.collection('impersonations').updateOne(
        { adminId: senderID },
        { $set: { targetId: target, targetName: target } },
        { upsert: true }
      );
      await sendMessage(api, `╮───∙⋆⋅「 تقمص 」\n│\n│ › ✅ تم التقمص بنجاح (معرف مباشر)!\n│ › أنت الآن تتقمص دور الايدي: ${target}\n│ › لإلغاء التقمص اكتب: الغاء التقمص\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.threadID);
    } else {
      await sendMessage(api, `❌ لم يتم العثور على اللاعب المطلوب في قاعدة البيانات.`, event.threadID);
    }
    return true;
  }

  if (text === 'اعدادات قول') {
    const { handleTtsSettings } = require('./voice_tts');
    await handleTtsSettings(api, event);
    return true;
  }

  if (text === 'اضافة مهام' || text === 'إضافة مهام') {
    await setAdminSession(senderID, { state: 'ADMIN_ADD_TASK_CHOOSE_RANK' });
    const msg = 
      `╮───∙⋆⋅「 📋 إضافة مهمة جديدة 」\n` +
      `│ الرجاء اختيار رقم الرتبة الإدارية المستهدفة:\n` +
      `│ 1 》 نائب الامبراطور\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙───────◈\n\n` +
      `› أرسل رقم الخيار المطلوب أو اكتب 《 خروج 》 للإلغاء.`;
    await sendMessage(api, msg, event.threadID);
    return true;
  }

  if (text === 'ضبط الاوامر') {
    await setAdminSession(senderID, { state: 'CMD_MGMT_MAIN' });
    const menuMsg = 
      `╮───∙⋆⋅「 ⚙️ إدارة الأوامر 」\n` +
      `│ 1 》 إضافة أمر جديد\n` +
      `│ 2 》 تعديل أمر موجود\n` +
      `│ 3 》 حذف أمر\n` +
      `│ 4 》 تغيير ترتيب الأوامر\n` +
      `│ 5 》 عرض الأوامر كاملة\n` +
      `│ 6 》 إعادة ضبط للوضع الافتراضي\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙───────◈\n\n` +
      `› أرسل رقم الخيار المطلوب أو اكتب 《 خروج 》 للإلغاء.`;
    await sendMessage(api, menuMsg, event.threadID);
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

  if (text === 'لوحة التحكم')    { await handleAdminMenu(api, event);         return true; }
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

  // ⚠️ لازم فحص "بانكاي مؤبد" يكون قبل فحص "بانكاي" العادي
  // لأن regex أمر "بانكاي" العادي كان يمسك "بانكاي مؤبد فلان" ويعتبر "مؤبد فلان" هو اسم الهدف
  if (text === 'بانكاي مؤبد' || (event.messageReply && text === 'بانكاي مؤبد')) { await moderation.handleBayaatMoabad(api, event, ''); return true; }
  if (/^بانكاي مؤبد\s+(.+)$/.test(text)) { await moderation.handleBayaatMoabad(api, event, text.replace(/^بانكاي مؤبد\s+/, '')); return true; }

  if (text === 'بانكاي' || (event.messageReply && text === 'بانكاي')) { await moderation.handleBayaat(api, event, ''); return true; }
  if (/^بانكاي\s+(.+)$/.test(text)) { await moderation.handleBayaat(api, event, text.replace(/^بانكاي\s+/, '')); return true; }
  
  if (text === 'طرد' || (event.messageReply && text === 'طرد')) { await moderation.handleBayaat(api, event, ''); return true; }
  if (/^طرد\s+(.+)$/.test(text)) { await moderation.handleBayaat(api, event, text.replace(/^طرد\s+/, '')); return true; }
  
  if (text === 'حذف' || (event.messageReply && text === 'حذف')) { await moderation.handleHadhfAdmin(api, event, ''); return true; }
  if (/^حذف\s+(.+)$/.test(text)) { 
    const args = text.replace(/^حذف\s+/, ''); 
    if (!/^.+\s+من\s+.+$/.test(args)) { await moderation.handleHadhfAdmin(api, event, args); return true; } 
  }

  return false;
}

// اعتراض ومعالجة نظام التقمص لجميع رسائل الأحداث الواردة
function handleImpersonationInterceptor(event) {
  if (!event || !event.senderID) return;
  global.impersonations = global.impersonations || {};
  
  const text = (event.body || '').trim();
  if (text === 'الغاء التقمص' || text === 'إلغاء التقمص') {
    return; // دع الأمر يمر عبر هويته الأصلية ليتمكن الأدمن من الإلغاء
  }
  
  if (global.impersonations[event.senderID]) {
    event.originalSenderID = event.senderID; // حفظ الهوية الأصلية احتياطاً
    event.senderID = global.impersonations[event.senderID]; // تزييف الهوية باللاعب المتقمص
  }
}

// دالة البدء مع جلب التقمص المخزن بقاعدة البيانات
async function initAdminIdsWithImpersonation(api) {
  await auth.initAdminIds(api);
  try {
    const db = require('./database').getDB();
    const list = await db.collection('impersonations').find({}).toArray();
    global.impersonations = global.impersonations || {};
    for (const item of list) {
      global.impersonations[String(item.adminId)] = String(item.targetId);
    }
  } catch (e) {
    console.error('[Admin Init] Error loading impersonations:', e);
  }
}

// التصديرات المتوافقة
module.exports = {
  handleAdminGranted,
  handleAdminCommand,
  handleImpersonationInterceptor,
  handleProtection: protection.handleProtection,
  handleDisabledCommand: commands.handleDisabledCommand,
  matchCommandKey: commands.matchCommandKey,
  isAdmin: auth.isAdmin,
  kickFromAllGroups: helpers.kickFromAllGroups,
  getPermanentBan,
  initAdminIds: initAdminIdsWithImpersonation, // تم الترقية لتحميل التقمص
  initGroupes: auth.initGroupes,
  initBotEnabled: system.initBotEnabled,
  isBotEnabled: system.isBotEnabled,
};