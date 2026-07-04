/*
 * ═══════════════════════════════════════════════════════════════════════
 *  isharat.js — نظام الإشعارات والتصفح الذكي بنظام الصفحات
 * ═══════════════════════════════════════════════════════════════════════
 */

const {
  getPendingNotifications,
  markNotificationsSent,
  getDB
} = require('./database');

const { sendReply } = require('./utils');

function formatTimeAgo(date) {
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `قبل ${seconds} ثانية 🕐`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `قبل ${minutes} دقيقة 🕐`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة 🕐`;
  const days = Math.floor(hours / 24);
  return `قبل ${days} يوم 🕐`;
}

// الفحص التلقائي المنبثق عند كتابة العضو لأي رسالة
async function checkAndSendNotifications(api, event) {
  const { senderID, threadID, messageID } = event;

  const pending = await getPendingNotifications(senderID);
  if (!pending || pending.length === 0) return;

  // تعليم جميع الإشعارات كـ مقروءة/مرسلة لمنع تكرار ظهور النافذة المنبثقة
  await markNotificationsSent(senderID);

  // ترتيب الإشعارات غير المقروءة من الأحدث إلى الأقدم
  pending.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // عرض آخر 3 إشعارات فقط
  const showCount = Math.min(3, pending.length);
  const toShow = pending.slice(0, showCount);
  
  // عكس الترتيب لعرض الإشعارات الأحدث بالأسفل
  toShow.reverse();

  let msg = `╮──────────────⟢ـ\n┆˼🔔˹┊ إشعارات جديدة ↶\n╯──────────────⟢ـ\n`;
  
  const formatted = toShow.map(notif => {
    const timeAgo = notif.createdAt ? formatTimeAgo(notif.createdAt) : '';
    return `${notif.message}\n${timeAgo}`;
  });

  msg += formatted.join('\n┈──┈──┈──┈──┈──\n');

  // تنبيه إضافي للمستخدم إذا كان هناك إشعارات أكثر لم تظهر
  const remainingCount = pending.length - showCount;
  if (remainingCount > 0) {
    msg += `\n┈──┈──┈──┈──┈──\n⚠️ يوجد ${remainingCount} إشعارات أخرى لم تقرأها بعد.\nاكتب 《 الاشعارات 》 لعرض كافة الإشعارات.`;
  }

  await sendReply(api, msg, messageID, threadID);
}

// عرض الإشعارات يدوياً بحد أقصى 30 إشعاراً (3 صفحات)
async function handleShowNotifications(api, event, pageNum = 1) {
  const { threadID, senderID, messageID } = event;

  const db = getDB();
  // جلب آخر 30 إشعار مسجل للاعب (سواء مقروء أو مرسل) من الأحدث للأقدم
  const list = await db.collection('notifications')
    .find({ fbId: String(senderID) })
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();

  if (!list || list.length === 0) {
    await sendReply(api, `╮───∙⋆⋅「 الإشعارات 」\n│ › لا يوجد لديك أي إشعارات مسجلة حالياً\n╯───────∙⋆⋅ ※ ⋅⋆∙`, messageID, threadID);
    return;
  }

  const totalPages = Math.ceil(list.length / 10);
  const page = Math.max(1, Math.min(pageNum, totalPages));
  const start = (page - 1) * 10;
  const pageItems = list.slice(start, start + 10);

  // عكس الترتيب لعرض الأحدث بالأسفل داخل الصفحة الواحدة
  pageItems.reverse();

  let msg = `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n       🔔  إشعاراتك الحالية  🔔\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n`;
  
  const formatted = pageItems.map(notif => {
    const timeAgo = notif.createdAt ? formatTimeAgo(notif.createdAt) : '';
    return `${notif.message}\n${timeAgo}`;
  });

  msg += formatted.join('\n\n┈──┈──┈──┈──┈──\n\n');
  msg += `\n\n━════════════════━\n`;
  msg += `● الصفحة ${page}/${totalPages}\n`;
  if (page < totalPages) {
    msg += `● لرؤية الإشعارات السابقة (الأقدم) رد على هذه الرسالة بـ "السابق"\n`;
  }
  msg += `━════════════════━`;

  await sendReply(api, msg, messageID, threadID);
}

// معالجة تصفح الإشعارات السابقة عبر الرد بكلمة "السابق"
async function handleNotificationsReply(api, event) {
  const { threadID, senderID, messageID, body, messageReply } = event;
  const text = (body || '').trim();

  if (!messageReply || !messageReply.body) return false;
  const repliedBody = messageReply.body;

  // التحقق من أن الرسالة التي يتم الرد عليها هي رسالة الإشعارات الخاصة باللاعب نفسه
  if (!repliedBody.includes('إشعاراتك الحالية') || !repliedBody.includes('الصفحة')) return false;
  if (text !== 'السابق') return false;

  const match = repliedBody.match(/● الصفحة (\d+)\/(\d+)/);
  if (!match) return false;

  const currentPage = parseInt(match[1], 10);
  const totalPages = parseInt(match[2], 10);

  if (currentPage >= totalPages) {
    await sendReply(api, `⚠️ لا توجد صفحات سابقة أخرى لعرضها.`, messageID, threadID);
    return true;
  }

  const nextPage = currentPage + 1;
  await handleShowNotifications(api, event, nextPage);
  return true;
}

module.exports = {
  checkAndSendNotifications,
  handleShowNotifications,
  handleNotificationsReply
};