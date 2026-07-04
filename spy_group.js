const fs = require('fs');
const path = require('path');
const os = require('os');

const SPY_IMAGE = path.join(__dirname, 'attached_assets', '39edf31f8033915c1811f908390dadfd_1778618782172.jpg');

// كاش الرسائل: messageID => { body, senderID, threadID, attachments: [{type, url}] }
const messageCache = new Map();
const MAX_CACHE = 1000;

const { getBotConfig, setBotConfig } = require('./database');

// ===== حالة ميزة الجاسوس (مخزنة في MongoDB) =====

async function loadSpyState() {
  const val = await getBotConfig('spyEnabled');
  if (val !== null) spyEnabled = val;
  return val !== null ? val : true; // الافتراضي true
}

async function saveSpyState(val) {
  await setBotConfig('spyEnabled', !!val);
}

let spyEnabled = true; // افتراضي، يُحدَّث عند loadSpyState() في بداية التشغيل

async function setSpyEnabled(val) {
  spyEnabled = !!val;
  await saveSpyState(spyEnabled);
}
function isSpyEnabled() { return spyEnabled; }

// ===== تنزيل ملف مع دعم التحويلات =====
function downloadFile(url, dest, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    const proto = url.startsWith('https') ? require('https') : require('http');
    const file = fs.createWriteStream(dest);
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return downloadFile(res.headers.location, dest, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    });
  });
}

function getAttachmentUrl(attach) {
  return attach.url || attach.largePreviewUrl || attach.previewUrl || attach.playableUrl || null;
}

function getContentLabel(cached) {
  if (!cached) return '🚫 غير متاحة';
  if (cached.body) return cached.body;

  const types = (cached.attachments || []).map(a => {
    if (a.type === 'photo') return '📷 صورة';
    if (a.type === 'sticker') return '🎭 ستيكر';
    if (a.type === 'animated_image') return '🎞️ GIF';
    if (a.type === 'video') return '🎥 فيديو';
    if (a.type === 'audio') return '🎵 صوتية';
    if (a.type === 'file') return '📎 ملف';
    return '📦 مرفق';
  });

  return types.length ? types.join(' + ') : '🚫 غير متاحة';
}

// ===== رسائل حذفها البوت (يتم تجاهلها في التجسس) =====
const botDeletedMessages = new Set();

function markBotDeleted(messageID) {
  botDeletedMessages.add(String(messageID));
  setTimeout(() => botDeletedMessages.delete(String(messageID)), 30000);
}

// ===== كاش الرسالة =====
function cacheMessage(event) {
  if (!spyEnabled) return;
  if (!event.messageID) return;

  if (messageCache.size >= MAX_CACHE) {
    const firstKey = messageCache.keys().next().value;
    messageCache.delete(firstKey);
  }

  const attachments = (event.attachments || []).map(a => ({
    type: a.type,
    url: getAttachmentUrl(a)
  })).filter(a => a.url);

  messageCache.set(event.messageID, {
    body: (event.body || '').trim(),
    senderID: String(event.senderID),
    threadID: String(event.threadID),
    attachments
  });
}

// ===== معالجة الحذف =====
async function handleUnsend(api, event) {
  if (!spyEnabled) return;

  // تجاهل الرسائل التي حذفها البوت بنفسه
  if (botDeletedMessages.has(String(event.messageID))) {
    botDeletedMessages.delete(String(event.messageID));
    messageCache.delete(event.messageID);
    return;
  }

  const threadID = String(event.threadID);
  const cached = messageCache.get(event.messageID);
  const senderID = cached ? cached.senderID : String(event.senderID || '');

  // جلب اسم الحساب
  let senderName = senderID;
  try {
    await new Promise((resolve) => {
      api.getUserInfo([senderID], (err, data) => {
        if (!err && data && data[senderID]) senderName = data[senderID].name || senderID;
        resolve();
      });
    });
  } catch (_) {}

  const content = getContentLabel(cached);
  const textMsg = `ياااا شفت وش حذفت 👀\n\nاسم الحساب ⟸ ${senderName}\nالرسالة المحذوفة ⟸ ${content}`;

  // إرسال رسالة الكشف
  await new Promise((resolve) => {
    api.sendMessage({ body: textMsg }, threadID, () => resolve());
  });

  // إرسال صورة القط منفصلة
  await new Promise((resolve) => {
    api.sendMessage({ attachment: fs.createReadStream(SPY_IMAGE) }, threadID, () => resolve());
  });

  // إعادة إرسال المرفقات (صور/فيديو...) إن وجدت
  const attachments = cached ? cached.attachments : [];
  const tmpFiles = [];
  const streams = [];

  for (const attach of attachments) {
    if (!attach.url) continue;
    try {
      const ext = attach.type === 'video' ? '.mp4' : attach.type === 'audio' ? '.mp3' : '.jpg';
      const tmpFile = path.join(os.tmpdir(), `spy_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
      await downloadFile(attach.url, tmpFile);
      tmpFiles.push(tmpFile);
      streams.push(fs.createReadStream(tmpFile));
    } catch (_) {}
  }

  if (streams.length > 0) {
    await new Promise((resolve) => {
      api.sendMessage({ attachment: streams }, threadID, () => resolve());
    });
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
  }

  // حذف من الكاش بعد الكشف
  messageCache.delete(event.messageID);
}

module.exports = { cacheMessage, handleUnsend, markBotDeleted, setSpyEnabled, isSpyEnabled, loadSpyState };
