/*
 * bot_rotation.js — محرك دوران الحسابات
 */

const { getBots, getBotConfig, setBotConfig, getDB } = require('./database');

let _currentBotId    = null;
let _autoRotateTimer = null;
let _restartBotFn    = null;
let _activeApi       = null;

// ───── حفظ الـ API النشط (لإرسال إشعارات التبديل التلقائي) ─────
function setActiveApi(api) {
  _activeApi = api;
}

// ───── كوكيز ملف secrets ─────────────────────────────────────
function getEnvCookies() {
  const raw = process.env.FB_COOKIES;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function getEnvCUser() {
  const c = getEnvCookies();
  if (!c) return null;
  const cu = c.find(x => x.key === 'c_user');
  return cu ? String(cu.value) : null;
}

// ───── إدارة حالة الحسابات ─────────────────────────────────
async function markBotFailed(botId) {
  if (!botId) return;
  try {
    const { ObjectId } = require('mongodb');
    await getDB().collection('bots').updateOne(
      { _id: new ObjectId(String(botId)) },
      { $set: { status: 'failed', failedAt: new Date() } }
    );
  } catch (e) {
    console.error('markBotFailed error:', e.message);
  }
}

async function markBotActive(botId) {
  if (!botId) return;
  try {
    const { ObjectId } = require('mongodb');
    await getDB().collection('bots').updateOne(
      { _id: new ObjectId(String(botId)) },
      { $set: { status: 'active', failedAt: null } }
    );
  } catch (e) {}
}

// ───── التنقل بين الحسابات ────────────────────────────────
// يُستخدم من التبديل التلقائي فقط — يعيد الحساب التالي المتاح في DB
// إذا لم يجد أي حساب، يعيد null (التبديل التلقائي سيتوقف)
async function getNextBot(currentBotId) {
  let bots = [];
  try { bots = await getBots(); } catch (e) {}
  const active = bots.filter(
    b => b.status !== 'failed' && b.status !== 'disabled' && b.cookies && b.cookies.length > 0
  );
  if (!active.length) return null;
  if (!currentBotId || active.length === 1) return active[0];
  const idx = active.findIndex(b => String(b._id) === String(currentBotId));
  if (idx === -1) return active[0];
  return active[(idx + 1) % active.length];
}

function getCurrentBotId()   { return _currentBotId; }
function setCurrentBotId(id) { _currentBotId = id ? String(id) : null; }

// تبديل يدوي من أمر "تبديل" — يحفظ الاختيار ويُعيد التشغيل من خارجه
async function switchToBot(botId) {
  _currentBotId = botId ? String(botId) : null;
  await setBotConfig('activeBotId', _currentBotId).catch(() => {});
}

// ───── التبديل التلقائي الدوري ───────────────────────────────
function _scheduleAutoRotate(minutes) {
  if (_autoRotateTimer) clearInterval(_autoRotateTimer);

  _autoRotateTimer = setInterval(async () => {
    try {
      const next = await getNextBot(_currentBotId);

      if (!next) {
        // لا يوجد حساب DB متاح → أوقف التبديل التلقائي تلقائياً
        console.warn('[Rotation] ⚠️ لا توجد حسابات متاحة للتبديل التلقائي — تم إيقاف المؤقت.');
        stopAutoRotationSync();
        return;
      }

      const nextId = String(next._id);
      if (nextId === _currentBotId) return; // نفس الحساب، لا داعي للتبديل

      // ── إرسال إشعار التبديل لجميع القروبات ──
      if (_activeApi) {
        const config = require('./config.json');
        const { sendMessage } = require('./utils');
        const ROTATION_MSG =
          `\u200c\n` +
          `╭──〔 NEXUS SYSTEM 〕──╮\n` +
          `⌬ نظام التبديل التلقائي\n` +
          `↻ جارِ تحويل حساب البوت ...\n` +
          `╯──────────────────╰`;
        const groupIds = Object.values(config.groupes).map(String).filter(Boolean);
        for (const gid of groupIds) {
          try { await sendMessage(_activeApi, ROTATION_MSG, gid); } catch (e) {}
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      // حفظ الحساب الجديد كالنشط — عند إعادة التشغيل سيبدأ منه
      _currentBotId = nextId;
      await setBotConfig('activeBotId', nextId).catch(() => {});

      if (_restartBotFn) _restartBotFn();
    } catch (e) {
      console.error('[Rotation] autoRotate error:', e.message);
    }
  }, minutes * 60 * 1000);
}

async function startAutoRotation(minutes, restartFn) {
  stopAutoRotationSync();
  _restartBotFn = restartFn;
  await setBotConfig('autoRotateEnabled', true).catch(() => {});
  await setBotConfig('autoRotateMinutes', Number(minutes)).catch(() => {});
  _scheduleAutoRotate(Number(minutes));
}

async function stopAutoRotation() {
  stopAutoRotationSync();
  await setBotConfig('autoRotateEnabled', false).catch(() => {});
}

function stopAutoRotationSync() {
  if (_autoRotateTimer) { clearInterval(_autoRotateTimer); _autoRotateTimer = null; }
}

// استئناف التبديل التلقائي عند إعادة التشغيل (إذا كان مُفعَّلاً)
async function initAutoRotation(restartFn) {
  _restartBotFn = restartFn;
  try {
    const enabled = await getBotConfig('autoRotateEnabled');
    const minutes = await getBotConfig('autoRotateMinutes');
    if (enabled && minutes && Number(minutes) > 0) {
      _scheduleAutoRotate(Number(minutes));
      console.log(`[Rotation] ✅ التبديل التلقائي نشط — كل ${minutes} دقيقة`);
    }
  } catch (e) {}
}

function isAutoRotateActive() { return _autoRotateTimer !== null; }

function triggerRestart() {
  if (typeof _restartBotFn === 'function') {
    _restartBotFn();
  } else {
    setTimeout(() => process.exit(0), 500);
  }
}

// ───── اسم حساب secrets ──────────────────────────────────
async function getEnvBotName() {
  try {
    const saved = await getBotConfig('envBotName');
    if (saved) return saved;
  } catch (e) {}
  const cu = getEnvCUser();
  return cu ? `المتغير البيئي (${cu})` : 'المتغير البيئي';
}

async function setEnvBotName(name) {
  try { await setBotConfig('envBotName', name); } catch (e) {}
}

module.exports = {
  markBotFailed,
  markBotActive,
  getNextBot,
  getCurrentBotId,
  setCurrentBotId,
  switchToBot,
  startAutoRotation,
  stopAutoRotation,
  stopAutoRotationSync,
  initAutoRotation,
  isAutoRotateActive,
  getEnvCookies,
  getEnvCUser,
  getEnvBotName,
  setEnvBotName,
  triggerRestart,
  setActiveApi,
};
