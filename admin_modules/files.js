// admin_modules/files.js — محرر ملفات المشروع للأدمن

const fs   = require('fs');
const path = require('path');
const { sendMessage }                          = require('../utils');
const { setAdminSession, deleteAdminSession, setBotConfig } = require('../database');

// ── جذر المشروع (مجلد واحد فوق admin_modules) ──
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── حد عرض الملف النصي (أحرف) ──
const MAX_VIEW_CHARS = 3000;

// ── امتدادات نصية مسموح بعرضها وتعديلها ──
const TEXT_EXTS = new Set([
  '.js', '.json', '.txt', '.md', '.env', '.sh', '.yaml', '.yml', '.html', '.css', '.log'
]);

// ── ملفات/مجلدات محظورة من الحذف ──
const PROTECTED = new Set(['index.js', 'secrets.json', 'secrets.js', 'config.json', 'node_modules', '.git']);

// ─────────────────────────────────────────────
// مساعدات داخلية
// ─────────────────────────────────────────────

/** تحويل مسار نسبي من الجلسة إلى مسار مطلق آمن */
function resolveSafe(relPath) {
  const abs = path.resolve(PROJECT_ROOT, relPath);
  if (!abs.startsWith(PROJECT_ROOT)) return null; // منع الخروج خارج المشروع
  return abs;
}

/** قراءة محتويات مجلد مع تصنيف الملفات والمجلدات */
function listDir(absPath) {
  const entries = fs.readdirSync(absPath, { withFileTypes: true });
  const dirs    = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  const files   = entries.filter(e => e.isFile()).map(e => e.name).sort();
  return { dirs, files };
}

/** تنسيق رسالة قائمة المجلد */
function buildDirMsg(relPath, dirs, files) {
  const display = relPath === '.' ? '/ (جذر المشروع)' : relPath;
  let msg = `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n`;
  msg += `     ✦ محرر الملفات ✦\n`;
  msg += `╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n`;
  msg += `╮───∙⋆⋅「 📂 ${display} 」\n│\n`;

  let idx = 1;
  const items = [];

  dirs.forEach(d => {
    msg += `│ ${idx}. 📁 ${d}/\n`;
    items.push({ type: 'dir', name: d });
    idx++;
  });

  files.forEach(f => {
    const ext = path.extname(f).toLowerCase();
    const icon = TEXT_EXTS.has(ext) ? '📄' : '📦';
    msg += `│ ${idx}. ${icon} ${f}\n`;
    items.push({ type: 'file', name: f });
    idx++;
  });

  if (items.length === 0) msg += `│ › المجلد فارغ\n`;

  msg += `│\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
  msg += `╮───∙⋆⋅「 الخيارات 」\n`;
  msg += `│ › ارسل رقم للدخول/فتح\n`;
  msg += `│ › 《 رجوع 》 للمجلد السابق\n`;
  msg += `│ › 《 ملف جديد 》\n`;
  msg += `│ › 《 مجلد جديد 》\n`;
  msg += `│ › 《 خروج 》\n`;
  msg += `╯───────∙⋆⋅ ※ ⋅⋆∙`;
  return { msg, items };
}

/** تنسيق رسالة خيارات الملف */
function buildFileMenu(relPath) {
  const name = path.basename(relPath);
  const ext  = path.extname(name).toLowerCase();
  const canText = TEXT_EXTS.has(ext);
  let msg = `╮───∙⋆⋅「 📄 ${name} 」\n│\n`;
  if (canText) msg += `│ 1 › عرض المحتوى\n│ 2 › تعديل المحتوى\n`;
  msg += `│ ${canText ? '3' : '1'} › حذف الملف\n`;
  msg += `│ ${canText ? '4' : '2'} › نسخ الملف\n`;
  msg += `│\n│ › 《 رجوع 》\n│ › 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  return { msg, canText };
}

// ─────────────────────────────────────────────
// الدالة الرئيسية — فتح محرر الملفات
// ─────────────────────────────────────────────
async function handleFiles(api, event) {
  const { threadID, senderID } = event;
  const relPath = '.';
  const absPath = resolveSafe(relPath);
  const { dirs, files } = listDir(absPath);
  const { msg, items } = buildDirMsg(relPath, dirs, files);
  await setAdminSession(senderID, {
    state: 'FILES_BROWSE',
    relPath,
    items,
    history: []
  });
  await sendMessage(api, msg, threadID);
}

// ─────────────────────────────────────────────
// معالج الجلسة الرئيسي
// ─────────────────────────────────────────────
async function handleFilesSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();

  // ── خروج عام ──
  if (text === 'خروج') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  // ══════════════════════════════════════════
  // حالة: تصفح المجلدات
  // ══════════════════════════════════════════
  if (session.state === 'FILES_BROWSE') {
    // رجوع
    if (text === 'رجوع') {
      const history = session.history || [];
      const prev = history.length > 0 ? history[history.length - 1] : '.';
      const newHistory = history.slice(0, -1);
      const absPath = resolveSafe(prev);
      if (!absPath || !fs.existsSync(absPath)) {
        await sendMessage(api, `⚠️ لا يوجد مجلد سابق`, threadID);
        return;
      }
      const { dirs, files } = listDir(absPath);
      const { msg, items } = buildDirMsg(prev, dirs, files);
      await setAdminSession(senderID, { state: 'FILES_BROWSE', relPath: prev, items, history: newHistory });
      await sendMessage(api, msg, threadID);
      return;
    }

    // ملف جديد
    if (text === 'ملف جديد') {
      await setAdminSession(senderID, { ...session, state: 'FILES_NEW_FILE' });
      await sendMessage(api,
        `╮───∙⋆⋅「 ملف جديد 」\n│\n│ › ارسل اسم الملف الجديد\n│ › مثال: helper.js\n│ › او 《 رجوع 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }

    // مجلد جديد
    if (text === 'مجلد جديد') {
      await setAdminSession(senderID, { ...session, state: 'FILES_NEW_DIR' });
      await sendMessage(api,
        `╮───∙⋆⋅「 مجلد جديد 」\n│\n│ › ارسل اسم المجلد الجديد\n│ › او 《 رجوع 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }

    // اختيار رقم
    const idx = parseInt(text, 10) - 1;
    const items = session.items || [];
    if (isNaN(idx) || idx < 0 || idx >= items.length) {
      await sendMessage(api, `⚠️ ارسل رقماً من القائمة أو أحد الخيارات`, threadID);
      return;
    }

    const chosen = items[idx];

    // دخول مجلد
    if (chosen.type === 'dir') {
      const newRel = path.join(session.relPath, chosen.name);
      const absPath = resolveSafe(newRel);
      if (!absPath || !fs.existsSync(absPath)) {
        await sendMessage(api, `⚠️ المجلد غير موجود`, threadID);
        return;
      }
      const { dirs, files } = listDir(absPath);
      const { msg, items: newItems } = buildDirMsg(newRel, dirs, files);
      const newHistory = [...(session.history || []), session.relPath];
      await setAdminSession(senderID, { state: 'FILES_BROWSE', relPath: newRel, items: newItems, history: newHistory });
      await sendMessage(api, msg, threadID);
      return;
    }

    // فتح ملف
    if (chosen.type === 'file') {
      const fileRel = path.join(session.relPath, chosen.name);
      const { msg: fmsg, canText } = buildFileMenu(fileRel);
      await setAdminSession(senderID, {
        ...session,
        state: 'FILES_FILE_MENU',
        currentFile: fileRel,
        canText
      });
      await sendMessage(api, fmsg, threadID);
      return;
    }
  }

  // ══════════════════════════════════════════
  // حالة: قائمة خيارات الملف
  // ══════════════════════════════════════════
  if (session.state === 'FILES_FILE_MENU') {
    const fileRel  = session.currentFile;
    const absFile  = resolveSafe(fileRel);
    const canText  = session.canText;
    const fileName = path.basename(fileRel);

    if (text === 'رجوع') {
      // عودة لتصفح المجلد الحالي
      const absPath = resolveSafe(session.relPath);
      const { dirs, files } = listDir(absPath);
      const { msg, items } = buildDirMsg(session.relPath, dirs, files);
      await setAdminSession(senderID, { state: 'FILES_BROWSE', relPath: session.relPath, items, history: session.history || [] });
      await sendMessage(api, msg, threadID);
      return;
    }

    const opt1 = canText ? '1' : null;
    const opt2 = canText ? '2' : null;
    const optDel  = canText ? '3' : '1';
    const optCopy = canText ? '4' : '2';

    // عرض المحتوى
    if (canText && text === opt1) {
      if (!absFile || !fs.existsSync(absFile)) { await sendMessage(api, `⚠️ الملف غير موجود`, threadID); return; }
      let content = fs.readFileSync(absFile, 'utf8');
      const totalLines = content.split('\n').length;
      let truncated = false;
      if (content.length > MAX_VIEW_CHARS) { content = content.slice(0, MAX_VIEW_CHARS); truncated = true; }
      let msg = `╮───∙⋆⋅「 📄 ${fileName} 」\n│ › الأسطر: ${totalLines}${truncated ? ` (معروض أول ${MAX_VIEW_CHARS} حرف)` : ''}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
      msg += content;
      if (truncated) msg += `\n\n⚠️ الملف طويل، تم عرض جزء منه فقط.`;
      await sendMessage(api, msg, threadID);
      return;
    }

    // تعديل المحتوى
    if (canText && text === opt2) {
      if (!absFile || !fs.existsSync(absFile)) { await sendMessage(api, `⚠️ الملف غير موجود`, threadID); return; }
      await setAdminSession(senderID, { ...session, state: 'FILES_EDIT_AWAIT' });
      await sendMessage(api,
        `╮───∙⋆⋅「 تعديل › ${fileName} 」\n│\n│ › ارسل المحتوى الجديد الكامل للملف\n│ › ⚠️ سيُستبدل المحتوى بالكامل\n│ › او 《 رجوع 》 للإلغاء\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }

    // حذف الملف
    if (text === optDel) {
      if (PROTECTED.has(fileName)) {
        await sendMessage(api, `╮───∙⋆⋅「 محظور 」\n│\n│ › ⛔ هذا الملف محمي ولا يمكن حذفه\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
        return;
      }
      await setAdminSession(senderID, { ...session, state: 'FILES_DELETE_CONFIRM' });
      await sendMessage(api,
        `╮───∙⋆⋅「 حذف ملف 」\n│\n│ › الملف : ${fileName}\n│\n│ ⚠️ هذا الإجراء لا يمكن التراجع عنه!\n│ › ارسل 《 تأكيد 》 للحذف\n│ › او 《 رجوع 》 للإلغاء\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }

    // نسخ الملف
    if (text === optCopy) {
      await setAdminSession(senderID, { ...session, state: 'FILES_COPY_AWAIT' });
      await sendMessage(api,
        `╮───∙⋆⋅「 نسخ › ${fileName} 」\n│\n│ › ارسل اسم النسخة الجديدة\n│ › مثال: ${fileName.replace('.', '_copy.')}\n│ › (ستُحفظ في نفس المجلد)\n│ › او 《 رجوع 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }

    await sendMessage(api, `⚠️ اختر رقماً صحيحاً أو 《 رجوع 》`, threadID);
    return;
  }

  // ══════════════════════════════════════════
  // حالة: انتظار المحتوى الجديد للتعديل
  // ══════════════════════════════════════════
  if (session.state === 'FILES_EDIT_AWAIT') {
    if (text === 'رجوع') {
      const { msg: fmsg } = buildFileMenu(session.currentFile);
      await setAdminSession(senderID, { ...session, state: 'FILES_FILE_MENU' });
      await sendMessage(api, fmsg, threadID);
      return;
    }
    const absFile  = resolveSafe(session.currentFile);
    const fileName = path.basename(session.currentFile);
    if (!absFile) { await sendMessage(api, `⚠️ مسار غير صالح`, threadID); return; }
    try {
      // نسخة احتياطية تلقائية
      const bakPath = absFile + '.bak';
      if (fs.existsSync(absFile)) fs.copyFileSync(absFile, bakPath);
      fs.writeFileSync(absFile, body, 'utf8'); // body الأصلي بدون trim لحفظ المسافات
      await deleteAdminSession(senderID);
      await sendMessage(api,
        `╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n│ › الملف : ${fileName}\n│ › تم حفظ نسخة احتياطية : ${fileName}.bak\n│\n│ › هل تريد إعادة تشغيل البوت لتطبيق التغييرات؟\n│ › ارسل 《 ريست 》 أو تجاهل الرسالة\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
    } catch (e) {
      await sendMessage(api, `╮───∙⋆⋅「 خطأ 」\n│\n│ › ❌ فشل حفظ الملف\n│ › ${e.message}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    }
    return;
  }

  // ══════════════════════════════════════════
  // حالة: تأكيد حذف الملف
  // ══════════════════════════════════════════
  if (session.state === 'FILES_DELETE_CONFIRM') {
    if (text === 'رجوع') {
      const { msg: fmsg } = buildFileMenu(session.currentFile);
      await setAdminSession(senderID, { ...session, state: 'FILES_FILE_MENU' });
      await sendMessage(api, fmsg, threadID);
      return;
    }
    if (text === 'تأكيد') {
      const absFile  = resolveSafe(session.currentFile);
      const fileName = path.basename(session.currentFile);
      try {
        fs.unlinkSync(absFile);
        // عودة للمجلد بعد الحذف
        const absDir = resolveSafe(session.relPath);
        const { dirs, files } = listDir(absDir);
        const { msg, items } = buildDirMsg(session.relPath, dirs, files);
        await setAdminSession(senderID, { state: 'FILES_BROWSE', relPath: session.relPath, items, history: session.history || [] });
        await sendMessage(api, `╮───∙⋆⋅「 تم الحذف 🗑️ 」\n│\n│ › ${fileName}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n${msg}`, threadID);
      } catch (e) {
        await sendMessage(api, `╮───∙⋆⋅「 خطأ 」\n│\n│ › ❌ فشل الحذف\n│ › ${e.message}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      }
      return;
    }
    await sendMessage(api, `⚠️ ارسل 《 تأكيد 》 للحذف أو 《 رجوع 》 للإلغاء`, threadID);
    return;
  }

  // ══════════════════════════════════════════
  // حالة: نسخ الملف — انتظار الاسم الجديد
  // ══════════════════════════════════════════
  if (session.state === 'FILES_COPY_AWAIT') {
    if (text === 'رجوع') {
      const { msg: fmsg } = buildFileMenu(session.currentFile);
      await setAdminSession(senderID, { ...session, state: 'FILES_FILE_MENU' });
      await sendMessage(api, fmsg, threadID);
      return;
    }
    const newName  = text.trim();
    const absFile  = resolveSafe(session.currentFile);
    const destRel  = path.join(session.relPath, newName);
    const absDest  = resolveSafe(destRel);
    if (!absDest) { await sendMessage(api, `⚠️ اسم غير صالح`, threadID); return; }
    if (fs.existsSync(absDest)) { await sendMessage(api, `⚠️ يوجد ملف بنفس الاسم، اختر اسماً آخر`, threadID); return; }
    try {
      fs.copyFileSync(absFile, absDest);
      await deleteAdminSession(senderID);
      await sendMessage(api, `╮───∙⋆⋅「 تم النسخ ✅️ 」\n│\n│ › الأصل : ${path.basename(session.currentFile)}\n│ › النسخة : ${newName}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    } catch (e) {
      await sendMessage(api, `╮───∙⋆⋅「 خطأ 」\n│\n│ › ❌ فشل النسخ\n│ › ${e.message}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    }
    return;
  }

  // ══════════════════════════════════════════
  // حالة: إنشاء ملف جديد — انتظار الاسم
  // ══════════════════════════════════════════
  if (session.state === 'FILES_NEW_FILE') {
    if (text === 'رجوع') {
      const absPath = resolveSafe(session.relPath);
      const { dirs, files } = listDir(absPath);
      const { msg, items } = buildDirMsg(session.relPath, dirs, files);
      await setAdminSession(senderID, { state: 'FILES_BROWSE', relPath: session.relPath, items, history: session.history || [] });
      await sendMessage(api, msg, threadID);
      return;
    }
    const newName = text.trim();
    if (!newName || newName.includes('/') || newName.includes('\\')) {
      await sendMessage(api, `⚠️ اسم غير صالح`, threadID); return;
    }
    const newRel  = path.join(session.relPath, newName);
    const absNew  = resolveSafe(newRel);
    if (!absNew) { await sendMessage(api, `⚠️ مسار غير مسموح`, threadID); return; }
    if (fs.existsSync(absNew)) { await sendMessage(api, `⚠️ الملف موجود مسبقاً`, threadID); return; }
    try {
      fs.writeFileSync(absNew, '', 'utf8');
      await setAdminSession(senderID, { ...session, state: 'FILES_NEW_FILE_CONTENT', newFileRel: newRel, newFileName: newName });
      await sendMessage(api,
        `╮───∙⋆⋅「 ملف جديد › ${newName} 」\n│\n│ › تم إنشاء الملف ✅️\n│ › ارسل المحتوى الآن\n│ › او ارسل 《 فارغ 》 لتركه فارغاً\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
    } catch (e) {
      await sendMessage(api, `╮───∙⋆⋅「 خطأ 」\n│\n│ › ❌ ${e.message}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    }
    return;
  }

  // ══════════════════════════════════════════
  // حالة: إنشاء ملف جديد — انتظار المحتوى
  // ══════════════════════════════════════════
  if (session.state === 'FILES_NEW_FILE_CONTENT') {
    const absNew = resolveSafe(session.newFileRel);
    const content = text === 'فارغ' ? '' : (body || '');
    try {
      fs.writeFileSync(absNew, content, 'utf8');
      await deleteAdminSession(senderID);
      await sendMessage(api,
        `╮───∙⋆⋅「 تم الحفظ ✅️ 」\n│\n│ › الملف : ${session.newFileName}\n│ › الحجم : ${Buffer.byteLength(content, 'utf8')} بايت\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
    } catch (e) {
      await sendMessage(api, `╮───∙⋆⋅「 خطأ 」\n│\n│ › ❌ ${e.message}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    }
    return;
  }

  // ══════════════════════════════════════════
  // حالة: إنشاء مجلد جديد — انتظار الاسم
  // ══════════════════════════════════════════
  if (session.state === 'FILES_NEW_DIR') {
    if (text === 'رجوع') {
      const absPath = resolveSafe(session.relPath);
      const { dirs, files } = listDir(absPath);
      const { msg, items } = buildDirMsg(session.relPath, dirs, files);
      await setAdminSession(senderID, { state: 'FILES_BROWSE', relPath: session.relPath, items, history: session.history || [] });
      await sendMessage(api, msg, threadID);
      return;
    }
    const dirName = text.trim();
    if (!dirName || dirName.includes('/') || dirName.includes('\\')) {
      await sendMessage(api, `⚠️ اسم غير صالح`, threadID); return;
    }
    const newRel = path.join(session.relPath, dirName);
    const absNew = resolveSafe(newRel);
    if (!absNew) { await sendMessage(api, `⚠️ مسار غير مسموح`, threadID); return; }
    if (fs.existsSync(absNew)) { await sendMessage(api, `⚠️ المجلد موجود مسبقاً`, threadID); return; }
    try {
      fs.mkdirSync(absNew, { recursive: true });
      const absPath = resolveSafe(session.relPath);
      const { dirs, files } = listDir(absPath);
      const { msg, items } = buildDirMsg(session.relPath, dirs, files);
      await setAdminSession(senderID, { state: 'FILES_BROWSE', relPath: session.relPath, items, history: session.history || [] });
      await sendMessage(api, `╮───∙⋆⋅「 تم الإنشاء ✅️ 」\n│\n│ › 📁 ${dirName}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n${msg}`, threadID);
    } catch (e) {
      await sendMessage(api, `╮───∙⋆⋅「 خطأ 」\n│\n│ › ❌ ${e.message}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    }
    return;
  }
}

module.exports = { handleFiles, handleFilesSession };
