// telegram_bot.js

const TelegramBot = require('node-telegram-bot-api');
const { getDB, getBots, getBotConfig, setBotConfig } = require('./database');
const { 
  switchToBot, 
  startAutoRotation, 
  stopAutoRotation, 
  isAutoRotateActive, 
  triggerRestart 
} = require('./bot_rotation');
const { ObjectId } = require('mongodb');
const config = require('./config.json');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { sendMessage } = require('./utils');

// توكن بوت تليجرام الخاص بك
const TOKEN = '8870146984:AAFpPLVRMDERtgBs86BOtJpBvdrXk_VpopA';

let bot;
const sessions = {}; // تتبع مدخلات المشرفين

// جلب قائمة معرفات المشرفين من ملف الإعدادات
const ALLOWED_TELEGRAM_ADMINS = config.telegramAdmins || []; 

function initTelegramBot() {
  bot = new TelegramBot(TOKEN, { polling: true });

  console.log('[Telegram] 🤖 تم بدء تشغيل لوحة التحكم عبر تليجرام بنجاح.');

  // تسجيل وتثبيت أمر البداية /start ليظهر بجانب صندوق الكتابة في تليجرام
  bot.setMyCommands([
    { command: 'start', description: '🚀 تشغيل لوحة التحكم الرئيسية' }
  ]).then(() => {
    console.log('[Telegram] ✅ تم تسجيل الأوامر بنجاح في قائمة البوت الرئيسية.');
  }).catch((err) => {
    console.error('[Telegram] ❌ فشل تسجيل الأوامر في القائمة:', err.message);
  });

  // التحقق من صلاحية المستخدم
  function isAdmin(msg) {
    const userId = msg.from.id;
    if (ALLOWED_TELEGRAM_ADMINS.length === 0) {
      return true;
    }
    return ALLOWED_TELEGRAM_ADMINS.includes(userId);
  }

  // القائمة الرئيسية على هيئة أزرار
  function sendMainMenu(chatId, text = '👋 مرحباً بك في لوحة تحكم نظام نيكسوس:') {
    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🤖 عرض الحسابات النشطة', callback_data: 'view_bots' },
            { text: '➕ إضافة بوت جديد', callback_data: 'add_bot_start' }
          ],
          [
            { text: '🔄 التبديل التلقائي', callback_data: 'auto_rotate_menu' },
            { text: '🔀 تبديل الحساب يدوياً', callback_data: 'manual_switch_menu' }
          ],
          [
            { text: '📁 إدارة الملفات (ملفات)', callback_data: 'fe_open' },
            { text: '🔄 إعادة تشغيل السيرفر (ريست)', callback_data: 'confirm_restart' }
          ],
          [
            { text: '👑 أدوات الإدارة العامة', callback_data: 'general_admin_menu' },
            { text: '⚙️ تفاصيل النظام الحالية', callback_data: 'system_info' }
          ]
        ]
      }
    };
    bot.sendMessage(chatId, text, opts);
  }

  // إرسال واجهة مستكشف الملفات
  function sendFileExplorer(chatId, userId, messageIdToEdit = null) {
    const session = sessions[userId];
    if (!session || (session.action !== 'file_explorer' && 
                     session.action !== 'awaiting_new_file_name' && 
                     session.action !== 'awaiting_new_dir_name' && 
                     session.action !== 'awaiting_file_upload_here')) {
      return sendMainMenu(chatId, '⚠️ انتهت جلسة مستكشف الملفات.');
    }

    // إعادة تعيين وضع الجلسة للتأكد من المزامنة
    session.action = 'file_explorer';

    let curDir = session.currentPath;
    if (!fs.existsSync(curDir)) {
      curDir = process.cwd();
      session.currentPath = curDir;
    }

    try {
      const filesInDir = fs.readdirSync(curDir, { withFileTypes: true });
      
      const excluded = ['node_modules', '.git', '.github', '.vscode', '.npm', 'tmp'];
      const dirs = [];
      const files = [];

      filesInDir.forEach(item => {
        if (excluded.includes(item.name)) return;
        if (item.isDirectory()) {
          dirs.push(item.name);
        } else {
          files.push(item.name);
        }
      });

      dirs.sort();
      files.sort();

      const explorerItems = [];
      let textMsg = `📁 *مستكشف الملفات المتقدم:*\n📍 المسار الحالي: \`${curDir.replace(process.cwd(), '.')}\`\n\n`;
      textMsg += `📌 *محتويات المجلد:*\n`;

      let idx = 1;
      dirs.forEach(d => {
        explorerItems.push({ name: d, isDir: true, absolutePath: path.join(curDir, d) });
        textMsg += `${idx}. 📁 ${d}\n`;
        idx++;
      });

      files.forEach(f => {
        explorerItems.push({ name: f, isDir: false, absolutePath: path.join(curDir, f) });
        textMsg += `${idx}. 📄 ${f}\n`;
        idx++;
      });

      if (explorerItems.length === 0) {
        textMsg += `⚠️ _المجلد فارغ_\n`;
      }

      session.explorerItems = explorerItems;

      const inline_keyboard = [];
      let row = [];
      for (let i = 0; i < explorerItems.length; i++) {
        row.push({ text: `${i + 1}`, callback_data: `fe_select_${i}` });
        if (row.length === 5) {
          inline_keyboard.push(row);
          row = [];
        }
      }
      if (row.length > 0) {
        inline_keyboard.push(row);
      }

      // أدوات التحكم بالملفات والمجلدات الجديدة
      inline_keyboard.push([
        { text: '➕ ملف جديد', callback_data: 'fe_create_file' },
        { text: '📁 مجلد جديد', callback_data: 'fe_create_dir' }
      ]);
      inline_keyboard.push([
        { text: '📤 رفع ملف هنا', callback_data: 'fe_upload_here' }
      ]);

      const navRow = [];
      if (curDir !== process.cwd() && curDir !== path.parse(curDir).root) {
        navRow.push({ text: '🔙 المجلد الأعلى', callback_data: 'fe_up' });
      }
      navRow.push({ text: '🏠 القائمة الرئيسية', callback_data: 'main_menu' });
      inline_keyboard.push(navRow);

      const opts = {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard }
      };

      if (messageIdToEdit) {
        bot.editMessageText(textMsg, { chat_id: chatId, message_id: messageIdToEdit, ...opts })
          .catch(() => {
            bot.sendMessage(chatId, textMsg, opts);
          });
      } else {
        bot.sendMessage(chatId, textMsg, opts);
      }

    } catch (err) {
      bot.sendMessage(chatId, `❌ حدث خطأ أثناء قراءة المجلد: ${err.message}`);
    }
  }

  // قائمة التحكم بملف معين
  function sendFileMenu(chatId, userId, file, messageIdToEdit = null) {
    let fileSize = 'غير معروف';
    try {
      const stats = fs.statSync(file.absolutePath);
      fileSize = (stats.size / 1024).toFixed(2) + ' KB';
    } catch (e) {}

    const textMsg = `📄 *التحكم بالملف:*\n\n` +
      `▪️ الاسم: \`${file.name}\`\n` +
      `▪️ الحجم: *${fileSize}*\n` +
      `▪️ المسار الكامل: \`${file.absolutePath.replace(process.cwd(), '.')}\`\n\n` +
      `💡 اختر أحد الإجراءات المتاحة للملف أدناه:`;

    const inline_keyboard = [
      [
        { text: '📖 قراءة المحتوى', callback_data: 'fe_file_read' },
        { text: '✍️ تعديل المحتوى', callback_data: 'fe_file_edit' }
      ],
      [
        { text: '🗑️ حذف الملف', callback_data: 'fe_file_delete' },
        { text: '🔙 العودة للمجلد', callback_data: 'fe_file_back' }
      ]
    ];

    const opts = {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard }
    };

    if (messageIdToEdit) {
      bot.editMessageText(textMsg, { chat_id: chatId, message_id: messageIdToEdit, ...opts })
        .catch(() => {
          bot.sendMessage(chatId, textMsg, opts);
        });
    } else {
      bot.sendMessage(chatId, textMsg, opts);
    }
  }

  // استقبال رسالة التشغيل /start
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(msg)) {
      return bot.sendMessage(chatId, `⚠️ عذراً، ليس لديك صلاحية للوصول إلى لوحة التحكم.\nمعرف تليجرام الخاص بك هو: \`${userId}\``, { parse_mode: 'Markdown' });
    }

    delete sessions[userId];

    if (ALLOWED_TELEGRAM_ADMINS.length === 0) {
      bot.sendMessage(chatId, `ℹ️ *ملاحظة إعداد أول:* لم يتم تعيين قائمة مشرفين في الملف.\nمعرف حسابك الحالي هو: \`${userId}\`\nتم منحك وصول مؤقت حالياً لتهيئة البوت.`, { parse_mode: 'Markdown' });
    }

    sendMainMenu(chatId);
  });

  // معالجة الضغط على الأزرار
  bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;

    if (ALLOWED_TELEGRAM_ADMINS.length > 0 && !ALLOWED_TELEGRAM_ADMINS.includes(userId)) {
      return bot.answerCallbackQuery(callbackQuery.id, { text: '⚠️ غير مصرح لك باستخدام هذه اللوحة', show_alert: true });
    }

    bot.answerCallbackQuery(callbackQuery.id);

    // --- عرض الحسابات ---
    if (data === 'view_bots') {
      try {
        const bots = await getBots();
        if (bots.length === 0) {
          return bot.sendMessage(chatId, '❌ لا توجد أي حسابات مضافة في قاعدة البيانات حالياً.', {
            reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للقائمة الرئيسة', callback_data: 'main_menu' }]] }
          });
        }

        let responseText = '📋 *قائمة الحسابات المسجلة في النظام:*\n\n';
        const inlineKeyboard = [];

        bots.forEach((b, idx) => {
          const statusIcon = b.status === 'failed' ? '🔴 فاشل' : b.status === 'disabled' ? '🟡 معطل' : '🟢 نشط';
          responseText += `${idx + 1}. *${b.name}*\nالحالة: ${statusIcon}\n\n`;
          inlineKeyboard.push([{ text: `⚙️ إدارة الحساب: ${b.name}`, callback_data: `manage_bot_${b._id}` }]);
        });

        inlineKeyboard.push([{ text: '🔙 العودة للقائمة الرئيسة', callback_data: 'main_menu' }]);

        bot.sendMessage(chatId, responseText, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      } catch (err) {
        bot.sendMessage(chatId, `❌ حدث خطأ أثناء عرض الحسابات: ${err.message}`);
      }
    }

    // --- إدارة تفاصيل حساب محدد ---
    else if (data.startsWith('manage_bot_')) {
      const botId = data.replace('manage_bot_', '');
      try {
        const bots = await getBots();
        const targetBot = bots.find(b => String(b._id) === botId);

        if (!targetBot) {
          return bot.sendMessage(chatId, '⚠️ تعذر العثور على الحساب المحدد.');
        }

        const statusText = targetBot.status === 'failed' ? '🔴 فاشل' : targetBot.status === 'disabled' ? '🟡 معطل' : '🟢 نشط';
        const infoMsg = `👤 *تفاصيل الحساب:*\n\nالاسم: *${targetBot.name}*\nالحالة: ${statusText}\nعدد الكوكيز: ${targetBot.cookies ? targetBot.cookies.length : 0}`;

        const inlineKeyboard = [
          [
            { text: '🔑 تعديل الكوكيز', callback_data: `edit_cookies_${botId}` },
            { text: targetBot.status === 'disabled' ? '🟢 تفعيل' : '🟡 تعطيل', callback_data: `toggle_bot_${botId}` }
          ],
          [
            { text: '❌ حذف نهائي', callback_data: `delete_bot_confirm_${botId}` }
          ],
          [
            { text: '🔙 قائمة الحسابات', callback_data: 'view_bots' }
          ]
        ];

        bot.sendMessage(chatId, infoMsg, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      } catch (err) {
        bot.sendMessage(chatId, `❌ حدث خطأ: ${err.message}`);
      }
    }

    // --- تشغيل أو إيقاف الحساب ---
    else if (data.startsWith('toggle_bot_')) {
      const botId = data.replace('toggle_bot_', '');
      try {
        const db = getDB();
        const bots = await getBots();
        const targetBot = bots.find(b => String(b._id) === botId);
        if (targetBot) {
          const newStatus = targetBot.status === 'disabled' ? 'active' : 'disabled';
          await db.collection('bots').updateOne(
            { _id: new ObjectId(botId) },
            { $set: { status: newStatus } }
          );
          bot.sendMessage(chatId, `✅ تم تعديل حالة الحساب [${targetBot.name}] إلى: ${newStatus === 'active' ? 'نشط 🟢' : 'معطل 🟡'}`);
          sendMainMenu(chatId);
        }
      } catch (e) {
        bot.sendMessage(chatId, `❌ فشل التعديل: ${e.message}`);
      }
    }

    // --- تأكيد الحذف ---
    else if (data.startsWith('delete_bot_confirm_')) {
      const botId = data.replace('delete_bot_confirm_', '');
      bot.sendMessage(chatId, '⚠️ هل أنت متأكد من حذف الحساب نهائياً؟ لا يمكن التراجع عن هذا الإجراء.', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '👍 نعم، احذفه', callback_data: `delete_bot_execute_${botId}` },
              { text: '👎 تراجع', callback_data: 'view_bots' }
            ]
          ]
        }
      });
    }

    // --- تنفيذ حذف الحساب ---
    else if (data.startsWith('delete_bot_execute_')) {
      const botId = data.replace('delete_bot_execute_', '');
      try {
        const db = getDB();
        await db.collection('bots').deleteOne({ _id: new ObjectId(botId) });
        bot.sendMessage(chatId, '✅ تم حذف الحساب من قاعدة البيانات بنجاح.');
        sendMainMenu(chatId);
      } catch (e) {
        bot.sendMessage(chatId, `❌ حدث خطأ أثناء عملية الحذف: ${e.message}`);
      }
    }

    // --- طلب الكوكيز الجديدة لتعديل الحساب ---
    else if (data.startsWith('edit_cookies_')) {
      const botId = data.replace('edit_cookies_', '');
      sessions[userId] = { action: 'awaiting_cookies_edit', botId };
      bot.sendMessage(chatId, '🔑 الرجاء إرسال كود الكوكيز الجديد بتنسيق JSON (مصفوفة الرموز):');
    }

    // --- بدء إضافة حساب جديد ---
    else if (data === 'add_bot_start') {
      sessions[userId] = { action: 'awaiting_new_bot_name' };
      bot.sendMessage(chatId, '✍️ الرجاء إدخال اسم تعريفي مناسب للحساب الجديد:');
    }

    // --- قائمة التبديل اليدوي بين الحسابات المتاحة ---
    else if (data === 'manual_switch_menu') {
      try {
        const bots = await getBots();
        const activeBots = bots.filter(b => b.status !== 'disabled');

        if (activeBots.length === 0) {
          return bot.sendMessage(chatId, '⚠️ لا توجد حسابات مفعّلة في قاعدة البيانات حالياً للتحويل إليها.');
        }

        const inlineKeyboard = [];
        activeBots.forEach(b => {
          inlineKeyboard.push([{ text: `🔄 تحويل إلى: ${b.name}`, callback_data: `switch_to_${b._id}` }]);
        });
        inlineKeyboard.push([{ text: '🔙 إلغاء', callback_data: 'main_menu' }]);

        bot.sendMessage(chatId, '🎯 الرجاء اختيار حساب البوت المطلوب لتشغيله بدلاً من الحساب الحالي فوراُ:', {
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      } catch (err) {
        bot.sendMessage(chatId, `❌ حدث خطأ: ${err.message}`);
      }
    }

    // --- تنفيذ تحويل البوت النشط ---
    else if (data.startsWith('switch_to_')) {
      const botId = data.replace('switch_to_', '');
      try {
        await switchToBot(botId);
        bot.sendMessage(chatId, '🔄 تم تغيير الحساب النشط في الإعدادات! سيقوم البوت الآن بإعادة تشغيل نفسه برمجياً للعمل بالحساب الجديد...');
        triggerRestart();
      } catch (err) {
        bot.sendMessage(chatId, `❌ فشل التبديل: ${err.message}`);
      }
    }

    // --- إعدادات التبديل التلقائي الدوري ---
    else if (data === 'auto_rotate_menu') {
      try {
        const isActive = isAutoRotateActive();
        const minutes = await getBotConfig('autoRotateMinutes') || 60;
        const statusText = isActive ? `نشط 🟢 (كل ${minutes} دقيقة)` : 'معطل 🔴';

        const inlineKeyboard = [
          [
            { text: '🟢 تشغيل التبديل التلقائي', callback_data: 'enable_auto_rotate_start' },
            { text: '🔴 إيقاف التبديل التلقائي', callback_data: 'disable_auto_rotate' }
          ],
          [
            { text: '⏱️ تعديل وقت التدوير (بالدقائق)', callback_data: 'set_rotate_time_start' }
          ],
          [
            { text: '🔙 القائمة الرئيسية', callback_data: 'main_menu' }
          ]
        ];

        bot.sendMessage(chatId, `⚙️ *إعدادات نظام التبديل التلقائي للأجهزة:*\n\nالوضع الحالي: *${statusText}*`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: inlineKeyboard }
        });
      } catch (err) {
        bot.sendMessage(chatId, `❌ حدث خطأ: ${err.message}`);
      }
    }

    // --- تشغيل التبديل التلقائي الدوري ---
    else if (data === 'enable_auto_rotate_start') {
      try {
        const minutes = await getBotConfig('autoRotateMinutes') || 60;
        await startAutoRotation(minutes, () => {
          bot.sendMessage(chatId, '🔄 [إشعار] تم إجراء التبديل التلقائي لحساب البوت وإعادة تشغيل السيرفر بنجاح.');
          triggerRestart();
        });
        bot.sendMessage(chatId, `✅ تم تشغيل التبديل التلقائي للقرابات بنجاح كل (${minutes}) دقيقة!`);
        sendMainMenu(chatId);
      } catch (e) {
        bot.sendMessage(chatId, `❌ تعذر تفعيل التبديل التلقائي: ${e.message}`);
      }
    }

    // --- تعطيل التبديل التلقائي الدوري ---
    else if (data === 'disable_auto_rotate') {
      try {
        await stopAutoRotation();
        bot.sendMessage(chatId, '🔴 تم إيقاف نظام التبديل التلقائي بنجاح.');
        sendMainMenu(chatId);
      } catch (e) {
        bot.sendMessage(chatId, `❌ تعذر إيقاف التبديل التلقائي: ${e.message}`);
      }
    }

    // --- تعديل وقت التدوير ---
    else if (data === 'set_rotate_time_start') {
      sessions[userId] = { action: 'awaiting_rotate_minutes' };
      bot.sendMessage(chatId, '⏱️ الرجاء إرسال عدد دقائق التدوير المطلوبة كقيمة رقمية (مثال: 60):');
    }

    // --- عرض معلومات وإحصائيات الحسابات ---
    else if (data === 'system_info') {
      try {
        const bots = await getBots();
        const activeCount = bots.filter(b => b.status === 'active').length;
        const disabledCount = bots.filter(b => b.status === 'disabled').length;
        const failedCount = bots.filter(b => b.status === 'failed').length;
        const rotateActive = isAutoRotateActive() ? 'نشط 🟢' : 'معطل 🔴';

        const infoText = `📊 *تفاصيل وإحصائيات البوتات في النظام:*\n\n` +
          `▪️ إجمالي الحسابات: *${bots.length}*\n` +
          `▪️ النشطة: *${activeCount} 🟢*\n` +
          `▪️ المعطلة: *${disabledCount} 🟡*\n` +
          `▪️ المتضررة/الفاشلة: *${failedCount} 🔴*\n` +
          `▪️ حالة التدوير التلقائي: *${rotateActive}*`;

        bot.sendMessage(chatId, infoText, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '🔙 القائمة الرئيسية', callback_data: 'main_menu' }]]
          }
        });
      } catch (err) {
        bot.sendMessage(chatId, `❌ فشل عرض بيانات النظام: ${err.message}`);
      }
    }

    // --- العودة إلى القائمة الرئيسة ---
    else if (data === 'main_menu') {
      sendMainMenu(chatId);
    }

    // ─── 📁 [ ميزات متصفح ومحرر الملفات ] ───
    else if (data === 'fe_open') {
      sessions[userId] = { 
        action: 'file_explorer', 
        currentPath: process.cwd(),
        explorerItems: []
      };
      sendFileExplorer(chatId, userId);
    }
    else if (data === 'fe_up') {
      const session = sessions[userId];
      if (session && session.action === 'file_explorer') {
        session.currentPath = path.dirname(session.currentPath);
        sendFileExplorer(chatId, userId, msg.message_id);
      }
    }
    else if (data.startsWith('fe_select_')) {
      const idx = parseInt(data.replace('fe_select_', ''), 10);
      const session = sessions[userId];
      if (session && session.action === 'file_explorer' && session.explorerItems[idx]) {
        const item = session.explorerItems[idx];
        if (item.isDir) {
          session.currentPath = item.absolutePath;
          sendFileExplorer(chatId, userId, msg.message_id);
        } else {
          session.selectedFile = item;
          sendFileMenu(chatId, userId, item, msg.message_id);
        }
      }
    }
    else if (data === 'fe_file_back') {
      sendFileExplorer(chatId, userId, msg.message_id);
    }
    else if (data === 'fe_file_read') {
      const session = sessions[userId];
      if (session && session.selectedFile) {
        const filePath = session.selectedFile.absolutePath;
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          if (content.trim().length === 0) {
            bot.sendMessage(chatId, 'ℹ️ الملف فارغ تماماً.');
          } else if (content.length <= 3000) {
            bot.sendMessage(chatId, `📖 *محتوى الملف:* \`${session.selectedFile.name}\`\n\n\`\`\`\n${content}\n\`\`\``, { parse_mode: 'Markdown' });
          } else {
            bot.sendMessage(chatId, '📦 محتوى الملف طويل جداً، جاري إرساله كمستند...');
            bot.sendDocument(chatId, fs.createReadStream(filePath));
          }
        } catch (err) {
          bot.sendMessage(chatId, `❌ تعذر قراءة الملف: ${err.message}`);
        }
      }
    }
    else if (data === 'fe_file_edit') {
      const session = sessions[userId];
      if (session && session.selectedFile) {
        session.action = 'awaiting_file_content';
        bot.sendMessage(chatId, `✍️ *تعديل الملف:* \`${session.selectedFile.name}\`\n\n` +
          `يمكنك تعديل الملف بإحدى الطرق التالية:\n` +
          `1️⃣ إرسال الكود البرمجي الجديد مباشرة كرسالة نصية.\n` +
          `2️⃣ أو رفع ملف جديد (مستند) وسيتم استبدال محتوى الملف الحالي به بالكامل.\n\n` +
          `⚠️ _ملاحظة: هذا الإجراء سيقوم بمسح المحتوى القديم وكتابة الجديد مكانه._\n\n` +
          `💬 أرسل المحتوى الجديد الآن، أو اكتب *الغاء* للتراجع:`, { parse_mode: 'Markdown' });
      }
    }
    else if (data === 'fe_file_delete') {
      const session = sessions[userId];
      if (session && session.selectedFile) {
        bot.sendMessage(chatId, `⚠️ هل أنت متأكد تماماً من حذف الملف \`${session.selectedFile.name}\` نهائياً؟`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🗑️ نعم، احذفه', callback_data: 'fe_file_delete_confirm' },
                { text: '❌ تراجع', callback_data: 'fe_file_delete_cancel' }
              ]
            ]
          }
        });
      }
    }
    else if (data === 'fe_file_delete_confirm') {
      const session = sessions[userId];
      if (session && session.selectedFile) {
        try {
          fs.unlinkSync(session.selectedFile.absolutePath);
          bot.sendMessage(chatId, `✅ تم حذف الملف \`${session.selectedFile.name}\` بنجاح.`);
          session.action = 'file_explorer';
          sendFileExplorer(chatId, userId);
        } catch (err) {
          bot.sendMessage(chatId, `❌ فشل حذف الملف: ${err.message}`);
        }
      }
    }
    else if (data === 'fe_file_delete_cancel') {
      const session = sessions[userId];
      if (session && session.selectedFile) {
        sendFileMenu(chatId, userId, session.selectedFile, msg.message_id);
      }
    }

    // ─── 🛠️ [ أزرار التفاعل الجديدة لإدارة الملفات المتقدمة ] ───
    else if (data === 'fe_create_file') {
      const session = sessions[userId];
      if (session) {
        session.action = 'awaiting_new_file_name';
        bot.sendMessage(chatId, '➕ *إنشاء ملف جديد:*\n\nالرجاء كتابة اسم الملف الجديد بالكامل مع صيغته (مثال: `index.js` أو `config.json`):\n\n💬 اكتب *الغاء* للتراجع.', { parse_mode: 'Markdown' });
      }
    }
    else if (data === 'fe_create_dir') {
      const session = sessions[userId];
      if (session) {
        session.action = 'awaiting_new_dir_name';
        bot.sendMessage(chatId, '📁 *إنشاء مجلد جديد:*\n\nالرجاء كتابة اسم المجلد الجديد:\n\n💬 اكتب *الغاء* للتراجع.', { parse_mode: 'Markdown' });
      }
    }
    else if (data === 'fe_upload_here') {
      const session = sessions[userId];
      if (session) {
        session.action = 'awaiting_file_upload_here';
        bot.sendMessage(chatId, '📤 *رفع ملف وحفظه هنا:*\n\nالرجاء سحب وإفلات أو رفع الملف المطلوب (كمستند Document) ليتم تخزينه مباشرة في المجلد المفتوح حالياً.\n\n💬 اكتب *الغاء* للتراجع.', { parse_mode: 'Markdown' });
      }
    }

    // ─── 🔄 [ ميزات إعادة التشغيل البرمجية المضافة ] ───
    else if (data === 'confirm_restart') {
      bot.sendMessage(chatId, '⚠️ هل أنت متأكد من إعادة تشغيل السيرفر (ريست)؟\nسيتم إيقاف الخدمة لثوانٍ معدودة وإعادة تشغيل البوت بالكامل.', {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ نعم، أعد التشغيل', callback_data: 'execute_restart' },
              { text: '❌ تراجع', callback_data: 'main_menu' }
            ]
          ]
        }
      });
    }
    else if (data === 'execute_restart') {
      await bot.sendMessage(chatId, '🔄 جاري تنفيذ عملية إعادة التشغيل البرمجية (ريست) للسيرفر الآن...');
      try {
        triggerRestart();
      } catch (err) {
        bot.sendMessage(chatId, `❌ فشل استدعاء إعادة التشغيل: ${err.message}`);
      }
    }

    // ─── 👑 [ أدوات الإدارة العامة المضافة ] ───
    else if (data === 'general_admin_menu') {
      const opts = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📢 إرسال إشعار جماعي', callback_data: 'tg_broadcast' },
              { text: '⏱️ ضبط تأخير الردود', callback_data: 'tg_delay_settings' }
            ],
            [
              { text: '👁️ كشف المحذوف (جاسوس)', callback_data: 'tg_spy_toggle' },
              { text: '📊 إحصائيات قاعدة البيانات', callback_data: 'tg_db_stats' }
            ],
            [
              { text: '🔙 العودة للقائمة الرئيسية', callback_data: 'main_menu' }
            ]
          ]
        }
      };
      bot.sendMessage(chatId, '👑 *أدوات التحكم والإدارة العامة لسيرفر نيكسوس:*', opts);
    }
    else if (data === 'tg_broadcast') {
      sessions[userId] = { action: 'awaiting_broadcast_text' };
      bot.sendMessage(chatId, '📢 *إرسال إشعار جماعي إلى جميع قروبات الممالك الثلاث:* \n\nالرجاء إرسال نص الإشعار المطلوب، وسيتم بثه فوراً لكافة مجموعات الممالك النشطة.\n\n💬 اكتب *الغاء* للتراجع.');
    }
    else if (data === 'tg_delay_settings') {
      const { getResponseDelay } = require('./settings');
      const currentDelay = getResponseDelay() || 0;
      sessions[userId] = { action: 'awaiting_delay_input' };
      bot.sendMessage(chatId, `⏱️ *ضبط تأخير الردود للقروبات:*\n\nالتأخير الحالي: *${currentDelay} ثانية.*\n\nالرجاء إرسال القيمة الرقمية الجديدة بالثواني (مثال: 1.5 أو 0 لإلغاء التأخير تماماً):`);
    }
    else if (data === 'tg_spy_toggle') {
      const { isSpyEnabled, setSpyEnabled } = require('./spy_group');
      const currentlyEnabled = isSpyEnabled();
      await setSpyEnabled(!currentlyEnabled);
      bot.sendMessage(chatId, `👁️ *نظام جاسوس كشف الرسائل المحذوفة:*\n\nالحالة الجديدة: ${!currentlyEnabled ? '✅ تـم الـتـفـعـيـل' : '🔴 تـم الـتـعـطـيـل'}`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للتحكم', callback_data: 'general_admin_menu' }]] }
      });
    }
    else if (data === 'tg_db_stats') {
      try {
        const db = getDB();
        const playersCount = await db.collection('players').countDocuments();
        const messagesCount = await db.collection('messages').countDocuments().catch(() => 0);
        const botsCount = await db.collection('bots').countDocuments();
        
        let dbStatsMsg = `📊 *إحصائيات قاعدة البيانات الحالية (MongoDB):*\n\n`;
        dbStatsMsg += `👥 إجمالي اللاعبين المسجلين: *${playersCount}*\n`;
        dbStatsMsg += `🤖 إجمالي الحسابات المخزنة: *${botsCount}*\n`;
        dbStatsMsg += `💬 إجمالي تتبع الرسائل النشطة: *${messagesCount}*\n\n`;
        dbStatsMsg += `🟢 الاتصال مستقر وقيد التشغيل بنجاح.`;

        bot.sendMessage(chatId, dbStatsMsg, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للتحكم', callback_data: 'general_admin_menu' }]] }
        });
      } catch (err) {
        bot.sendMessage(chatId, `❌ تعذر قراءة بيانات MongoDB: ${err.message}`);
      }
    }
  });

  // معالجة الرسائل النصية والمدخلات المطلوبة من المشرفين
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.body || msg.text || '').trim();
    const userId = msg.from.id;

    if (!isAdmin(msg) || !sessions[userId]) return;

    const session = sessions[userId];

    // --- إلغاء العمليات المشتركة في إدارة الملفات ---
    if (text.toLowerCase() === 'الغاء' || text === 'إلغاء') {
      const cancellableActions = [
        'awaiting_new_file_name', 
        'awaiting_new_dir_name', 
        'awaiting_file_upload_here',
        'awaiting_file_content'
      ];
      if (cancellableActions.includes(session.action)) {
        session.action = 'file_explorer';
        bot.sendMessage(chatId, '❌ تم إلغاء العملية الجارية.');
        sendFileExplorer(chatId, userId);
        return;
      }
    }

    // --- استقبال كوكيز حساب جديد ---
    if (session.action === 'awaiting_new_bot_cookies') {
      try {
        const cookiesParsed = JSON.parse(text);
        if (!Array.isArray(cookiesParsed)) {
          return bot.sendMessage(chatId, '❌ تنسيق الكوكيز خاطئ! يجب إرسال كود كوكيز صالح على هيئة مصفوفة JSON. يرجى إعادة المحاولة:');
        }

        const db = getDB();
        await db.collection('bots').insertOne({
          name: session.botName,
          cookies: cookiesParsed,
          status: 'active',
          lastUsed: null,
          failedAt: null
        });

        delete sessions[userId];
        bot.sendMessage(chatId, `✅ تم حفظ وإضافة البوت الجديد [${session.botName}] بنجاح في قاعدة البيانات وهو جاهز للاستخدام!`);
        sendMainMenu(chatId);
      } catch (err) {
        bot.sendMessage(chatId, `❌ خطأ في معالجة وفك كود الـ JSON:\n\`${err.message}\`\n\nيرجى تصحيح النص والمحاولة مجدداً:`, { parse_mode: 'Markdown' });
      }
    }

    // --- استقبال اسم البوت الجديد ---
    else if (session.action === 'awaiting_new_bot_name') {
      if (text.length < 2) {
        return bot.sendMessage(chatId, '⚠️ الاسم المدخل قصير جداً، يرجى كتابة اسم تعريفي مناسب للبوت:');
      }
      sessions[userId] = { action: 'awaiting_new_bot_cookies', botName: text };
      bot.sendMessage(chatId, `✍️ تم تسجيل الاسم: [${text}].\nالآن قم بإرسال كود الكوكيز الخاص بالحساب كصيغة JSON كاملة لإتمام الحفظ:`);
    }

    // --- استقبال كود تعديل الكوكيز لحساب موجود مسبقاً ---
    else if (session.action === 'awaiting_cookies_edit') {
      try {
        const cookiesParsed = JSON.parse(text);
        if (!Array.isArray(cookiesParsed)) {
          return bot.sendMessage(chatId, '❌ تنسيق الكوكيز خاطئ! يرجى إرسال مصفوفة JSON صحيحة ومتكاملة:');
        }

        const db = getDB();
        await db.collection('bots').updateOne(
          { _id: new ObjectId(session.botId) },
          { $set: { cookies: cookiesParsed, status: 'active', failedAt: null } }
        );

        delete sessions[userId];
        bot.sendMessage(chatId, '✅ تم تحديث بيانات الكوكيز للحساب وتحويل حالته إلى نشط بنجاح!');
        sendMainMenu(chatId);
      } catch (err) {
        bot.sendMessage(chatId, `❌ خطأ في معالجة وتحليل الـ JSON:\n\`${err.message}\`\n\nيرجى تعديل النص وإرساله مجدداً:`, { parse_mode: 'Markdown' });
      }
    }

    // --- استقبال وتعديل وقت التدوير التلقائي الدوري ---
    else if (session.action === 'awaiting_rotate_minutes') {
      const mins = parseInt(text, 10);
      if (isNaN(mins) || mins <= 0) {
        return bot.sendMessage(chatId, '⚠️ قيمة غير صحيحة، يرجى إدخال عدد الدقائق كرقم صحيح (مثال: 90):');
      }

      try {
        await setBotConfig('autoRotateMinutes', mins);
        
        if (isAutoRotateActive()) {
          await startAutoRotation(mins, () => {
            bot.sendMessage(chatId, '🔄 [إشعار] تم إجراء دورة التبديل التلقائي للحساب وإعادة التشغيل بنجاح.');
            triggerRestart();
          });
        }

        delete sessions[userId];
        bot.sendMessage(chatId, `⏱️ تم تعديل وقت التدوير التلقائي بنجاح ليصبح كل [${mins}] دقيقة.`);
        sendMainMenu(chatId);
      } catch (err) {
        bot.sendMessage(chatId, `❌ حدث خطأ أثناء الحفظ: ${err.message}`);
      }
    }

    // ─── 📁 [ استقبال وحفظ محتوى الملفات والرفع ] ───
    else if (session.action === 'awaiting_file_content') {
      const targetPath = session.selectedFile?.absolutePath;
      if (!targetPath) {
        delete sessions[userId];
        return bot.sendMessage(chatId, '❌ حدث خطأ، لم يتم التعرف على الملف المستهدف.');
      }

      if (msg.document) {
        try {
          bot.sendMessage(chatId, '📥 جاري تحميل المستند المرفق واستبدال محتوى الملف الحالي به...');
          const fileId = msg.document.file_id;
          
          const downloadPath = await bot.downloadFile(fileId, os.tmpdir());
          fs.copyFileSync(downloadPath, targetPath);
          try { fs.unlinkSync(downloadPath); } catch (e) {}

          bot.sendMessage(chatId, `✅ تم استبدال وتحديث الملف \`${session.selectedFile.name}\` بنجاح عبر المستند المرفق!`);
          session.action = 'file_explorer';
          sendFileMenu(chatId, userId, session.selectedFile);
        } catch (err) {
          bot.sendMessage(chatId, `❌ فشل حفظ المستند المرفق: ${err.message}`);
        }
      } else {
        try {
          fs.writeFileSync(targetPath, text, 'utf8');
          bot.sendMessage(chatId, `✅ تم حفظ وتحديث الملف \`${session.selectedFile.name}\` بنجاح!`);
          session.action = 'file_explorer';
          sendFileMenu(chatId, userId, session.selectedFile);
        } catch (err) {
          bot.sendMessage(chatId, `❌ حدث خطأ أثناء الكتابة وحفظ الملف: ${err.message}`);
        }
      }
    }

    // ─── 📁 [ معالجة إنشاء ملف جديد ] ───
    else if (session.action === 'awaiting_new_file_name') {
      const fileName = text.trim();
      if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
        return bot.sendMessage(chatId, '❌ اسم الملف غير صالح. يرجى إرسال اسم مبسط دون مسارات مخصصة:');
      }
      const targetPath = path.join(session.currentPath, fileName);
      if (fs.existsSync(targetPath)) {
        return bot.sendMessage(chatId, '⚠️ هذا الملف موجود بالفعل في هذا المجلد. يرجى كتابة اسم آخر:');
      }
      try {
        fs.writeFileSync(targetPath, '', 'utf8');
        bot.sendMessage(chatId, `✅ تم إنشاء الملف الجديد \`${fileName}\` بنجاح!`);
        sendFileExplorer(chatId, userId);
      } catch (err) {
        bot.sendMessage(chatId, `❌ تعذر إنشاء الملف الجديد: ${err.message}`);
      }
    }

    // ─── 📁 [ معالجة إنشاء مجلد جديد ] ───
    else if (session.action === 'awaiting_new_dir_name') {
      const dirName = text.trim();
      if (!dirName || dirName.includes('/') || dirName.includes('\\')) {
        return bot.sendMessage(chatId, '❌ اسم المجلد غير صالح. يرجى إرسال اسم مبسط:');
      }
      const targetPath = path.join(session.currentPath, dirName);
      if (fs.existsSync(targetPath)) {
        return bot.sendMessage(chatId, '⚠️ هذا المجلد موجود بالفعل هنا. يرجى كتابة اسم آخر:');
      }
      try {
        fs.mkdirSync(targetPath, { recursive: true });
        bot.sendMessage(chatId, `✅ تم إنشاء المجلد الجديد \`${dirName}\` بنجاح!`);
        sendFileExplorer(chatId, userId);
      } catch (err) {
        bot.sendMessage(chatId, `❌ تعذر إنشاء المجلد الجديد: ${err.message}`);
      }
    }

    // ─── 📁 [ معالجة رفع وحفظ ملف جديد ] ───
    else if (session.action === 'awaiting_file_upload_here') {
      if (!msg.document) {
        return bot.sendMessage(chatId, '⚠️ يرجى إرفاق الملف كـ مستند (Document) أو إرسال *الغاء* للتراجع:');
      }
      try {
        bot.sendMessage(chatId, '📥 جاري استقبال وتحميل الملف وحفظه بالمسار الحالي...');
        const fileId = msg.document.file_id;
        const originalName = msg.document.file_name || 'uploaded_file';
        const targetPath = path.join(session.currentPath, originalName);

        const downloadPath = await bot.downloadFile(fileId, os.tmpdir());
        fs.copyFileSync(downloadPath, targetPath);
        try { fs.unlinkSync(downloadPath); } catch (e) {}

        bot.sendMessage(chatId, `✅ تم حفظ الملف بنجاح باسم: \`${originalName}\``);
        sendFileExplorer(chatId, userId);
      } catch (err) {
        bot.sendMessage(chatId, `❌ حدث خطأ أثناء تنزيل أو حفظ الملف: ${err.message}`);
      }
    }

    // ─── 👑 [ استقبال وبث الإشعارات لقروبات الفيس بوك ] ───
    else if (session.action === 'awaiting_broadcast_text') {
      if (text.toLowerCase() === 'الغاء' || text === 'إلغاء') {
        delete sessions[userId];
        return bot.sendMessage(chatId, '❌ تم إلغاء بث الإشعار.', { reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للتحكم', callback_data: 'general_admin_menu' }]] } });
      }

      try {
        const groupIds = Object.values(config.groupes).map(String).filter(Boolean);
        let count = 0;
        
        let activeApi = null;
        try {
          const rotation = require('./bot_rotation');
          if (typeof rotation.getActiveApi === 'function') {
            activeApi = rotation.getActiveApi();
          } else {
            activeApi = require('./bot_rotation').activeApi; 
          }
        } catch (e) {}

        if (!activeApi) {
          return bot.sendMessage(chatId, '⚠️ تعذر الإرسال بسبب عدم العثور على حساب نشط على الفيس بوك حالياً لإجراء عملية البث.');
        }

        const msgToSend = `📢 ⟦ إشـعـار إداري عـاجـل ⟧ 📢\n━━━━━━━━━━━━━━━━━━━\n\n${text}\n\n━━━━━━━━━━━━━━━━━━━`;

        for (const gid of groupIds) {
          try {
            await sendMessage(activeApi, msgToSend, gid);
            count++;
          } catch (err) {}
        }

        delete sessions[userId];
        bot.sendMessage(chatId, `✅ تم بث الإشعار بنجاح إلى (${count}) مجموعة من مجموعات الممالك!`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 العودة', callback_data: 'general_admin_menu' }]] }
        });
      } catch (err) {
        bot.sendMessage(chatId, `❌ حدث خطأ أثناء عملية البث: ${err.message}`);
      }
    }

    // ─── ⏱️ [ استقبال وتعديل وقت تأخير الردود ] ───
    else if (session.action === 'awaiting_delay_input') {
      const seconds = parseFloat(text);
      if (isNaN(seconds) || seconds < 0) {
        return bot.sendMessage(chatId, '⚠️ القيمة المدخلة غير صالحة. يرجى إرسال رقم صحيح أو عشري أكبر من أو يساوي 0:');
      }

      try {
        const { setResponseDelay } = require('./settings');
        setResponseDelay(seconds);
        await setBotConfig('responseDelay', seconds);

        delete sessions[userId];
        bot.sendMessage(chatId, `✅ تم ضبط تأخير الردود بنجاح إلى: *${seconds} ثانية*!`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 العودة للتحكم', callback_data: 'general_admin_menu' }]] }
        });
      } catch (err) {
        bot.sendMessage(chatId, `❌ حدث خطأ أثناء الحفظ: ${err.message}`);
      }
    }
  });
}

module.exports = { initTelegramBot };