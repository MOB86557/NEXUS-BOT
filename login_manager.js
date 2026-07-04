// login_manager.js — منطق تسجيل الدخول والتعامل مع الحسابات
//
// ترتيب الأولويات عند كل تشغيل:
//
//  1. إذا حدد الأدمن حساباً معيناً (activeBotId في DB):
//     → ابدأ بذلك الحساب
//     → إذا فشل، جرب الباقين المتاحين
//     → إذا فشلوا كلهم، ارجع لـ secrets
//     → إذا فشل secrets → أطفئ السيرفر
//
//  2. إذا لم يحدد الأدمن شيئاً (activeBotId = null):
//     → ابدأ بـ secrets أولاً
//     → إذا فشل، جرب المتاحين في DB
//     → إذا فشلوا كلهم → أطفئ السيرفر
//
//  الفشل الدائم = login_blocked / checkpoint / Not logged in / auth
//  → يُصنَّف الحساب كـ failed في DB ولا يُستخدم مجدداً
//     إلا إذا عدّل الأدمن كوكيزه من أمر البوتات (يعود active)
//
//  secrets لا يُصنَّف كـ failed في DB (ليس له سجل فيها)
//  → إذا فشل secrets يُضاف لـ temporarilyFailedBots فقط خلال هذه الجلسة
//

const login = require('@dongdev/fca-unofficial');
const { getBots, getBotConfig, setBotConfig } = require('./database');
const {
  getEnvCookies,
  getEnvCUser,
} = require('./bot_rotation');

// حسابات فشلت مؤقتاً في هذه الجلسة فقط (تُمسح عند إعادة التشغيل)
const temporarilyFailedBots = new Set();

// ─────────────────────────────────────────────────────────────
// قراءة كوكيز secrets (FB_COOKIES من bot_rotation أو APPSTATE)
// ─────────────────────────────────────────────────────────────
function getSecretsCookies() {
  // أولاً جرب FB_COOKIES (المستخدم في bot_rotation)
  const fromRotation = getEnvCookies();
  if (fromRotation && fromRotation.length > 0) return fromRotation;

  // ثانياً جرب APPSTATE أو COOKIES (المتغيرات البديلة)
  const raw = process.env.APPSTATE || process.env.COOKIES;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function getSecretsCUser() {
  // أولاً من bot_rotation
  const cu = getEnvCUser();
  if (cu) return cu;
  // ثانياً من الكوكيز مباشرة
  const cookies = getSecretsCookies();
  if (!cookies) return null;
  const found = cookies.find(x => x.key === 'c_user');
  return found ? String(found.value) : null;
}

// ─────────────────────────────────────────────────────────────
// بناء قائمة المرشحين بالترتيب الصحيح
// ─────────────────────────────────────────────────────────────
async function getLoginCandidates() {
  const candidates = [];
  let activeBotId = null;

  try {
    activeBotId = await getBotConfig('activeBotId');
  } catch (e) {}

  let bots = [];
  try {
    bots = await getBots();
  } catch (e) {
    console.error('[login_manager] خطأ في جلب الحسابات من DB:', e.message);
  }

  const secretsCookies = getSecretsCookies();
  const secretsCUser   = getSecretsCUser();

  // ── هل حساب secrets موجود أيضاً في DB كـ failed؟ ──
  // إذا كان كذلك لا نتجاهله، secrets يتجاوز حالة DB دائماً
  // لأن الأدمن يُعدّل الكوكيز في الملف وليس في DB

  // ─── حالة 1: الأدمن حدد حساباً معيناً ───
  if (activeBotId && activeBotId !== 'ENV' && !temporarilyFailedBots.has(String(activeBotId))) {
    const chosen = bots.find(b => String(b._id) === String(activeBotId));
    if (chosen && chosen.status !== 'failed' && chosen.status !== 'disabled' && chosen.cookies && chosen.cookies.length > 0) {
      candidates.push({
        source: 'db',
        botId: String(chosen._id),
        botName: chosen.name,
        cookies: typeof chosen.cookies === 'string' ? JSON.parse(chosen.cookies) : chosen.cookies,
        isChosen: true,
      });
    }
  }

  // ─── حالة 2: الأدمن اختار ENV صراحةً ───
  // secrets أولاً، ثم حسابات DB كاحتياط إذا فشل
  if (activeBotId === 'ENV' && !temporarilyFailedBots.has('ENV')) {
    if (secretsCookies && secretsCookies.length > 0) {
      candidates.push({
        source: 'env',
        botId: null,
        botName: 'حساب secrets',
        cookies: secretsCookies,
        isChosen: true,
      });
    }
  }

  // ─── إذا لم يختر الأدمن شيئاً → secrets أولاً ───
  if (!activeBotId && !temporarilyFailedBots.has('ENV')) {
    if (secretsCookies && secretsCookies.length > 0) {
      candidates.push({
        source: 'env',
        botId: null,
        botName: 'حساب secrets',
        cookies: secretsCookies,
        isSecretsFirst: true,
      });
    }
  }

  // ─── باقي حسابات DB المتاحة (باستثناء المختار المضاف أعلاه) ───
  const dbActive = bots.filter(b => {
    if (b.status === 'failed' || b.status === 'disabled') return false;
    if (temporarilyFailedBots.has(String(b._id))) return false;
    if (activeBotId && activeBotId !== 'ENV' && String(b._id) === String(activeBotId)) return false;
    if (!b.cookies || !b.cookies.length) return false;
    return true;
  });

  // ── إذا كل حسابات DB مصنّفة failed، جرّبها على أي حال كملاذ أخير ──
  // (يحدث عندما الكود القديم صنّفها فاشلة بشكل غلط)
  const dbFallback = dbActive.length === 0
    ? bots.filter(b => {
        if (b.status === 'disabled') return false;
        if (temporarilyFailedBots.has(String(b._id))) return false;
        if (activeBotId && activeBotId !== 'ENV' && String(b._id) === String(activeBotId)) return false;
        if (!b.cookies || !b.cookies.length) return false;
        return true;
      })
    : dbActive;

  for (const b of dbFallback) {
    const isFailed = b.status === 'failed';
    candidates.push({
      source: 'db',
      botId: String(b._id),
      botName: b.name + (isFailed ? ' (كان فاشلاً — إعادة محاولة)' : ''),
      cookies: typeof b.cookies === 'string' ? JSON.parse(b.cookies) : b.cookies,
    });
  }

  // ─── secrets كاحتياطي أخير (إذا لم يُضَف أعلاه) ───
  // يُضاف فقط إذا:
  //  - لم يُضَف بالفعل (لم يكن activeBotId=ENV ولم يكن isSecretsFirst)
  //  - لم يفشل في هذه الجلسة
  const secretsAlreadyAdded = candidates.some(c => c.source === 'env');
  if (!secretsAlreadyAdded && !temporarilyFailedBots.has('ENV')) {
    if (secretsCookies && secretsCookies.length > 0) {
      candidates.push({
        source: 'env',
        botId: null,
        botName: 'حساب secrets (احتياطي)',
        cookies: secretsCookies,
        isFallback: true,
      });
    }
  }

  return candidates;
}

// ─────────────────────────────────────────────────────────────
// تحديد إذا كان الخطأ دائماً (يستوجب تصنيف failed)
// ─────────────────────────────────────────────────────────────
function isPermanentFailure(errMsg) {
  const msg = (errMsg || '').toLowerCase();
  return (
    msg.includes('login_blocked') ||
    msg.includes('checkpoint')    ||
    msg.includes('not logged in') ||
    msg.includes('auth')          ||
    msg.includes('locked')        ||
    msg.includes('disabled')
  );
}

// ─────────────────────────────────────────────────────────────
// محاولة تسجيل الدخول
// ─────────────────────────────────────────────────────────────
function tryLogin(cookies) {
  return new Promise((resolve, reject) => {
    login({ appState: cookies }, (err, api) => {
      if (err) return reject(err);
      resolve(api);
    });
  });
}

module.exports = {
  getLoginCandidates,
  tryLogin,
  temporarilyFailedBots,
  isPermanentFailure,
  getSecretsCookies,
  getSecretsCUser,
};
