const config = require('./config.json');
const { getResponseDelay } = require('./settings');

// الحرف الخفي لتنسيق الرسائل
const H = '\u061C';

// عداد الأخطاء المتتالية للإرسال والحد الأقصى المسموح به قبل تفعيل التدوير التلقائي
let consecutiveSendFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 4;

// رموز الفئات
const classSymbols = {
  'فارس': '✹',
  'معالج': '⚘',
  'ساحر': '𖤝'
};

// أسماء الممالك
const kingdomNames = {
  solfare: '𝑺𝑶𝑳𝑽𝑨𝑹𝑨',
  niravil: '𝑵𝑰𝑹𝑨𝑽𝑰𝑳',
  murdak: '𝑴𝑶𝑹𝑫𝑨𝑲'
};

const kingdomNamesAr = {
  solfare: 'سولفارا',
  niravil: 'نيرافيل',
  murdak: 'مورداك'
};

// تحديد المملكة من معرف المجموعة (العواصم فقط)
function getKingdomByThreadId(threadId) {
  const id = String(threadId);
  if (id === String(config.groupes.solfare)) return 'solfare';
  if (id === String(config.groupes.niravil)) return 'niravil';
  if (id === String(config.groupes.murdak))  return 'murdak';
  return null;
}

// البحث عن مدينة من معرف المجموعة (async — تستعلم قاعدة البيانات)
async function getCityByThreadId(threadId) {
  try {
    const { getDB } = require('./database');
    const city = await getDB().collection('cities').findOne({ threadId: String(threadId) });
    return city || null; // يُرجع { threadId, name, kingdom, ... } أو null
  } catch (e) {
    return null;
  }
}

// تحديد المملكة من معرف المجموعة — يشمل العواصم والمدن (async)
async function getKingdomByThreadIdFull(threadId) {
  const capital = getKingdomByThreadId(threadId);
  if (capital) return capital;
  const city = await getCityByThreadId(threadId);
  return city ? city.kingdom : null;
}

// توليد الكنية (معدلة لإضافة كرات الإنذار تلقائياً في نهاية اللقب)
// statusFlags: { hospital: bool, ignored: bool } — تضيف 🏥 و/أو 🔇 بنهاية الكنية دون فراغات بينهما
function generateNickname(nickname, rank, playerClass, warnings = 0, statusFlags = {}) {
  const symbol = classSymbols[playerClass] || '✹';
  const warningBalls = '🔴'.repeat(warnings || 0);
  let base = `╮ ⟦ ${nickname} ⟧⤷ ${rank} ⌈${symbol}⌋ ╭${warningBalls}`;
  if (statusFlags && statusFlags.hospital) base += '🏥';
  if (statusFlags && statusFlags.ignored) base += '🔇';
  return base;
}

// الكنية الرسمية الثابتة لأي عضو في قروبات الممالك/المدن غير مسجل بنظام اللعبة
const UNREGISTERED_NICKNAME = '⟦ غير مسجل ⟧';

// بناء الكنية "الرسمية" الكاملة والحية للاعب اعتماداً على حالته الفعلية بقاعدة البيانات الآن
// (الرتبة + الفئة + الإنذارات + حالة الإنعاش 🏥 + حالة التجاهل 🔇)
// يُرجع UNREGISTERED_NICKNAME إن لم يكن مسجلاً، ولا يرمي أي استثناء أبداً
async function buildOfficialNickname(fbId) {
  try {
    const { getPlayer, getDB } = require('./database');
    const player = await getPlayer(fbId);
    if (!player) return UNREGISTERED_NICKNAME;

    const now = Date.now();
    const hospital = !!(player.recoveryUntil && new Date(player.recoveryUntil).getTime() > now);

    let ignored = false;
    try {
      const rec = await getDB().collection('ignored_players').findOne({ fbId: String(fbId) });
      if (rec && rec.until && new Date(rec.until).getTime() > now) ignored = true;
    } catch (e) {}

    return generateNickname(player.nickname, player.rank || 'مجند', player.class, player.warnings || 0, { hospital, ignored });
  } catch (e) {
    return UNREGISTERED_NICKNAME;
  }
}

// استخراج الايدي من رابط فيسبوك
function extractFbId(text) {
  // رابط مباشر بالايدي
  const idMatch = text.match(/profile\.php\?id=(\d+)/);
  if (idMatch) return idMatch[1];

  // رابط /groups/ وما شابه
  const groupMatch = text.match(/facebook\.com\/groups\/(\d+)/);
  if (groupMatch) return groupMatch[1];

  // رابط بالمعرف الرقمي في نهاية الرابط
  const numericEnd = text.match(/facebook\.com\/(?:[^\/]+\/)*(\d{10,})/);
  if (numericEnd) return numericEnd[1];

  // رقم مباشر
  const directNum = text.match(/\b(\d{10,})\b/);
  if (directNum) return directNum[1];

  return null;
}

// استخراج اليوزرنيم من رابط فيسبوك
function extractUsername(text) {
  const match = text.match(/facebook\.com\/([a-zA-Z0-9._]+)/);
  if (match && match[1] !== 'profile.php' && match[1] !== 'groups') {
    return match[1];
  }
  return null;
}

// رسم شريط HP/EP
function drawBar(value, max = 1000) {
  const filled = Math.floor(value / 100);
  const empty = Math.floor(max / 100) - filled;
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, empty));
}

// معالجة ورصد أخطاء الإرسال بذكاء لمنع توقف الاستجابة وحظر الإرسال
async function handleSendError(err) {
  const errMsg = (err.error || err.message || JSON.stringify(err) || '').toLowerCase();

  // تجاهل خطأ MQTT غير المهيأ — خطأ توقيت عند بدء التشغيل وليس حظراً
  if (errMsg.includes('mqtt client is not initialized')) {
    console.warn('[utils] ℹ️ MQTT لم يكتمل بعد — تجاهل الخطأ.');
    return;
  }
  
  // التحقق من الكلمات الدلالية لخطأ حظر الإرسال المؤقت من فيسبوك
  const isBlockError = 
    errMsg.includes('block') || 
    errMsg.includes('restrict') || 
    errMsg.includes('permission') || 
    errMsg.includes('policy') || 
    errMsg.includes('limit') || 
    errMsg.includes('not allowed') ||
    errMsg.includes('cannot send') ||
    errMsg.includes('temp');

  if (isBlockError) {
    // أخطاء الحظر ترفع المؤشر بقيمة أكبر لسرعة تبديل الحساب المتضرر
    consecutiveSendFailures += 2;
  } else {
    consecutiveSendFailures += 1;
  }

  console.warn(`[utils] ⚠️ فشل إرسال الرسالة. عداد الأخطاء المتتالية: ${consecutiveSendFailures}/${MAX_CONSECUTIVE_FAILURES}`);

  if (consecutiveSendFailures >= MAX_CONSECUTIVE_FAILURES) {
    consecutiveSendFailures = 0; // إعادة تصفير العداد لتجنب التداخل
    console.warn(`[utils] 🚨 تم تجاوز الحد المسموح لأخطاء الإرسال المتتالية. جاري تدوير الحساب الحالي...`);
    
    try {
      // استيراد ديناميكي لمنع حدوث تعارضات دائرية (Circular Dependencies) أثناء الإقلاع
      const botRotation = require('./bot_rotation');
      const currentBotId = botRotation.getCurrentBotId();
      if (currentBotId) {
        console.warn(`[utils] 🔴 تم وسم الحساب [${currentBotId}] كفاشل بسبب حظر الإرسال.`);
        await botRotation.markBotFailed(currentBotId);
      }
      botRotation.triggerRestart();
    } catch (e) {
      console.error('[utils] خطأ أثناء تدوير الحساب المتضرر:', e.message);
    }
  }
}

// دالة إرسال رسالة مع الرد على رسالة معينة
function sendReply(api, message, messageId, threadId) {
  return new Promise(async (resolve, reject) => {
    const delay = getResponseDelay();
    if (delay > 0) await new Promise(r => setTimeout(r, delay * 1000));
    const msg = {
      body: H + message,
      mentions: []
    };
    if (messageId) {
      api.sendMessage(msg, threadId, (err, info) => {
        if (err) {
          handleSendError(err).catch(() => {});
          return reject(err);
        }
        consecutiveSendFailures = 0; // تصفير العداد فور نجاح الإرسال
        // الرد على الرسالة
        try {
          api.setMessageReaction('', messageId, threadId, () => {});
        } catch (e) {}
        resolve(info);
      }, messageId);
    } else {
      api.sendMessage(msg, threadId, (err, info) => {
        if (err) {
          handleSendError(err).catch(() => {});
          return reject(err);
        }
        consecutiveSendFailures = 0; // تصفير العداد فور نجاح الإرسال
        resolve(info);
      });
    }
  });
}

// دالة إرسال بسيطة بدون رد
function sendMessage(api, message, threadId) {
  return new Promise(async (resolve, reject) => {
    const delay = getResponseDelay();
    if (delay > 0) await new Promise(r => setTimeout(r, delay * 1000));
    api.sendMessage({ body: H + message }, threadId, (err, info) => {
      if (err) {
        handleSendError(err).catch(() => {});
        return reject(err);
      }
      consecutiveSendFailures = 0; // تصفير العداد فور نجاح الإرسال
      resolve(info);
    });
  });
}

// دالة إرسال صورة من رابط (URL) بشكل منفصل عن أي رسالة نصية
function sendImageFromUrl(api, imageUrl, threadId) {
  return new Promise(async (resolve, reject) => {
    const delay = getResponseDelay();
    if (delay > 0) await new Promise(r => setTimeout(r, delay * 1000));
    try {
      const https = require('https');
      const http = require('http');
      const lib = imageUrl.startsWith('https') ? https : http;

      lib.get(imageUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`فشل تحميل الصورة، رمز الحالة: ${response.statusCode}`));
          return;
        }
        const msg = {
          body: '',
          attachment: response
        };
        api.sendMessage(msg, threadId, (err, info) => {
          if (err) {
            handleSendError(err).catch(() => {});
            return reject(err);
          }
          consecutiveSendFailures = 0;
          resolve(info);
        });
      }).on('error', (err) => {
        reject(err);
      });
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  H,
  classSymbols,
  kingdomNames,
  kingdomNamesAr,
  getKingdomByThreadId,
  getCityByThreadId,
  getKingdomByThreadIdFull,
  generateNickname,
  buildOfficialNickname,
  UNREGISTERED_NICKNAME,
  extractFbId,
  extractUsername,
  drawBar,
  sendReply,
  sendMessage,
  sendImageFromUrl
};