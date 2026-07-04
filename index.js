// index.js

// ─── 🚨 حماية معالج الأخطاء ومنع المكتبات الخارجية من كتم الأخطاء ───
const originalOn = process.on;
const originalAddListener = process.addListener;

// 1. تسجيل مستمع الأخطاء بالتفصيل مباشرة باستخدام الدالة الأصلية لتجنب حظره
originalOn.call(process, 'uncaughtException', (err) => {
  console.error('\n================================================================');
  console.error('🚨 [ خطأ فادح غير معالج في السيرفر - CRITICAL SYSTEM CRASH ] 🚨');
  console.error('================================================================');
  console.error(`📌 نوع الخطأ (Name):    ${err.name || 'SyntaxError/RuntimeError'}`);
  console.error(`📌 رسالة الخطأ (Message): ${err.message}`);
  
  if (err.stack) {
    console.error('\n📂 تتبع مسار وتحديد الملف البرمجي والسطر (Stack Trace):');
    console.error('----------------------------------------------------------------');
    console.error(err.stack);
    console.error('----------------------------------------------------------------');
  } else {
    console.error('\n⚠️ لا يتوفر تتبع للمسار للأسف.');
  }
  
  console.error('================================================================\n');
  process.exit(1);
});

originalOn.call(process, 'unhandledRejection', (reason, promise) => {
  console.error('\n================================================================');
  console.error('🚨 [ رفض غير معالج للوعود البرمجية - UNHANDLED REJECTION ] 🚨');
  console.error('================================================================');
  console.error('📌 السبب (Reason):', reason instanceof Error ? reason.stack : reason);
  console.error('================================================================\n');
  process.exit(1);
});

// 2. حظر أي موديول خارجي من تعديل أو اعتراض أحداث الـ uncaughtException
process.on = function(event, listener) {
  if (event === 'uncaughtException' || event === 'unhandledRejection') {
    // تجاهل الموديولات الأخرى للحفاظ على كاشف الأخطاء بالتفصيل
    return this;
  }
  return originalOn.apply(this, arguments);
};

process.addListener = function(event, listener) {
  if (event === 'uncaughtException' || event === 'unhandledRejection') {
    return this;
  }
  return originalAddListener.apply(this, arguments);
};

// ─── 1. تحميل البيانات السرية ───
const { loadSecrets } = require('./secrets');
loadSecrets();

// ─── 2. استيراد الموديلات العامة ───
const config = require('./config.json');
const { startServer, botStatus } = require('./server');
const {
  isDuplicate,
  startKeepalive,
  startWatchdog,
  updateLastEvent,
  clearAllIntervals
} = require('./watchdog');
const {
  getLoginCandidates,
  tryLogin,
  temporarilyFailedBots,
  isPermanentFailure,
} = require('./login_manager');
const { routeEvent } = require('./event_router');

const { connectDB, getBots, getBotConfig, setBotConfig, addNotification } = require('./database');
const {
  markBotFailed,
  setCurrentBotId,
  initAutoRotation,
  setEnvBotName,
  setActiveApi,
  getCurrentBotId,
} = require('./bot_rotation');

const { initAdminIds, initGroupes, initBotEnabled } = require('./admin');
const { loadSpyState } = require('./spy_group');
const { startConversationCleanup } = require('./agent');
const { tickBankSystem } = require('./bank');
const { tickRecoverySystem } = require('./hala_la3ib');

async function tickInactivityCheck(api) {
  const db = require('./database').getDB();
  const { deletePlayer } = require('./database');
  const { kickUser } = require('./admin_modules/helpers');
  const { sendMessage: _send } = require('./utils');

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  let inactivePlayers;
  try {
    inactivePlayers = await db.collection('players').find({
      lastMessageAt: { $lt: oneWeekAgo, $exists: true }
    }).toArray();
  } catch (e) {
    log('ERROR', '[InactivityTick] فشل جلب اللاعبين:', e.message);
    return;
  }

  if (!inactivePlayers || inactivePlayers.length === 0) return;

  log('INFO', `[InactivityTick] فحص ${inactivePlayers.length} لاعب غير نشط منذ أسبوع...`);

  for (const player of inactivePlayers) {
    try {
      const groupId = player.kingdom ? String(config.groupes[player.kingdom] || '') : '';

      let isInGroup = false;
      if (groupId && api) {
        isInGroup = await new Promise((resolve) => {
          try {
            api.getThreadInfo(groupId, (err, info) => {
              if (err || !info) return resolve(false);
              const ids = (info.participantIDs || []).map(String);
              resolve(ids.includes(String(player.fbId)));
            });
          } catch (e) { resolve(false); }
        });
      }

      const msg =
        `⛔️─────『 ⚠️ 』─────⛔️\n` +
        `اللاعب : ${player.nickname}\n` +
        `بقيت اسبوعا كاملا دون اي نشاط سيتم حذف حسابك في نضام نيكسوس` +
        (isInGroup ? ` وطردك من المملكة` : ``) +
        `\n⛔️─────『 ⚠️ 』─────⛔️`;

      if (isInGroup && groupId) {
        await _send(api, msg, groupId).catch(() => {});
        await kickUser(api, player.fbId, groupId).catch(() => {});
      } else {
        await _send(api, msg, String(player.fbId)).catch(() => {});
      }

      await deletePlayer(player.fbId).catch(() => {});
      log('INFO', `[InactivityTick] تم حذف اللاعب غير النشط: ${player.nickname} (${player.fbId})`);
    } catch (e) {
      log('ERROR', `[InactivityTick] خطأ في معالجة ${player.fbId}:`, e.message);
    }
  }
}
const { sendMessage, H } = require('./utils');

// استيراد نظام التحكم والمساعد لتليجرام
const { initTelegramBot } = require('./telegram_bot');

let bootReport = [];
let currentStopListening = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(level, msg, extra) {
  const time = new Date().toISOString();
  const prefix = {
    INFO:  '[ INFO ]',
    OK:    '[  OK  ]',
    WARN:  '[ WARN ]',
    ERROR: '[ERROR ]',
    FATAL: '[FATAL ]',
  }[level] || '[ LOG  ]';
  const line = `${time} ${prefix} ${msg}`;
  if (level === 'ERROR' || level === 'FATAL') {
    console.error(line, extra !== undefined ? extra : '');
  } else {
    console.log(line, extra !== undefined ? extra : '');
  }
}

function stopCurrentListener() {
  if (typeof currentStopListening === 'function') {
    try { currentStopListening(); } catch (e) {}
    currentStopListening = null;
    log('INFO', 'تم إغلاق الـ listener القديم');
  }
}

startServer();

// ─────────────────────────────────────────────────────────────
// معالجة فشل حساب أثناء التشغيل — يُستدعى من api.listen
// ─────────────────────────────────────────────────────────────
async function handleRuntimeFailure(loginData, errMsg) {
  log('WARN', `🔄 فشل الحساب [${loginData.botName}] أثناء التشغيل — السبب: ${errMsg}`);

  const failedKey = loginData.source === 'env' ? 'ENV' : String(loginData.botId);
  temporarilyFailedBots.add(failedKey);

  bootReport.push({
    name: loginData.botName,
    status: 'فشل أثناء التشغيل ⛔',
    reason: errMsg,
  });

  if (loginData.source === 'db' && loginData.botId) {
    await markBotFailed(loginData.botId).catch(() => {});
    log('WARN', `🔴 تم تصنيف [${loginData.botName}] كفاشل في قاعدة البيانات`);
  }
}

// ─────────────────────────────────────────────────────────────
// دالة تفعيل البوت
// ─────────────────────────────────────────────────────────────
async function startBot() {
  stopCurrentListener();
  botStatus.restartCount++;

  log('INFO', '🔄 جاري تحضير مرشحي تسجيل الدخول...');
  const candidates = await getLoginCandidates();

  if (candidates.length === 0) {
    log('WARN', '⚠️ لا توجد حسابات متاحة (كلها فاشلة أو محظورة مؤقتاً).');

    if (temporarilyFailedBots.size > 0) {
      log('INFO', '🔄 إعادة تصفير قائمة الحظر المؤقت، محاولة جديدة بعد 30 ثانية...');
      setTimeout(() => {
        temporarilyFailedBots.clear();
        startBot();
      }, 30000);
      return;
    }

    log('FATAL', '🔒 لا توجد كوكيزات متاحة في النظام على الإطلاق.');
    botStatus.lastError = 'لا تتوفر أي حسابات للتفعيل';
    botStatus.running = false;
    process.exit(1);
  }

  let successfulApi = null;
  let loggedInAccount = null;

  for (const candidate of candidates) {
    log('INFO', `🔑 محاولة تسجيل الدخول بالحساب: [${candidate.botName}]`);
    try {
      successfulApi = await tryLogin(candidate.cookies);
      loggedInAccount = candidate;
      log('OK', `✅ نجح تسجيل الدخول: [${candidate.botName}]`);
      break;
    } catch (err) {
      const errMsg = err.error || err.message || JSON.stringify(err);
      log('ERROR', `❌ فشل تسجيل الدخول [${candidate.botName}]: ${errMsg}`);

      bootReport.push({
        name: candidate.botName,
        status: 'فشل تسجيل الدخول ❌',
        reason: errMsg,
      });

      const failedKey = candidate.source === 'env' ? 'ENV' : String(candidate.botId);
      temporarilyFailedBots.add(failedKey);

      if (candidate.source === 'db' && candidate.botId && isPermanentFailure(errMsg)) {
        await markBotFailed(candidate.botId).catch(() => {});
        log('WARN', `🔴 تم تصنيف [${candidate.botName}] كفاشل في قاعدة البيانات`);
      }
    }
  }

  if (!successfulApi || !loggedInAccount) {
    const lastWasSecrets = candidates[candidates.length - 1]?.source === 'env';
    const allDbFailed = candidates.filter(c => c.source === 'db').length > 0 &&
                        candidates.filter(c => c.source === 'db').every(c => temporarilyFailedBots.has(String(c.botId)));

    if (lastWasSecrets && allDbFailed) {
      log('FATAL', '🔒 فشلت كل الحسابات بما فيها secrets — إيقاف السيرفر.');
      botStatus.running = false;
      process.exit(1);
    }

    log('WARN', '⚠️ فشل الاتصال بكل المرشحين. إعادة المحاولة بعد 5 ثوانٍ...');
    setTimeout(() => startBot(), 5000);
    return;
  }

  const api = successfulApi;
  const loginData = loggedInAccount;

  if (loginData.source === 'db' && loginData.botId) {
    await setBotConfig('activeBotId', loginData.botId).catch(() => {});
    setCurrentBotId(loginData.botId);
  } else {
    await setBotConfig('activeBotId', 'ENV').catch(() => {});
    setCurrentBotId(null);
  }

  setActiveApi(api);
  botStatus.running = true;
  botStatus.loginTime = Date.now();
  updateLastEvent();
  log('OK', `✅ الحساب النشط الحالي: [${loginData.botName}]`);

  if (loginData.source === 'db' && loginData.botId) {
    try {
      const { ObjectId } = require('mongodb');
      const { getDB } = require('./database');
      await getDB().collection('bots').updateOne(
        { _id: new ObjectId(loginData.botId) },
        { $set: { status: 'active', lastUsed: new Date(), failedAt: null } }
      );
    } catch (e) {}
  } else {
    try {
      const saved = await getBotConfig('envBotName').catch(() => null);
      if (!saved) {
        const BOT_UID = String(api.getCurrentUserID());
        await setEnvBotName(`المتغير البيئي (${BOT_UID})`);
      }
    } catch (e) {}
  }

  const successKey = loginData.source === 'env' ? 'ENV' : String(loginData.botId);
  temporarilyFailedBots.delete(successKey);

  setTimeout(async () => {
    if (!botStatus.running) return;
    try {
      const bots = await getBots().catch(() => []);
      let reportMsg = `تقرير تشغيل النظام 📊\n\n`;

      reportMsg += `🟢 الحساب النشط:\n` +
                   ` › الاسم: ${loginData.botName}\n` +
                   ` › المصدر: ${loginData.source === 'db' ? 'قاعدة البيانات' : 'ملف secrets'}\n\n`;

      if (bootReport.length > 0) {
        reportMsg += `⚠️ حسابات فشلت أو تم تخطيها:\n`;
        bootReport.forEach((rep, idx) => {
          reportMsg += ` │ ${idx + 1}. [${rep.name}]\n` +
                       ` │    ↳ الحالة: ${rep.status}\n` +
                       ` │    ↳ السبب: ${rep.reason}\n`;
        });
        reportMsg += `\n`;
      }

      reportMsg += `👥 حالة جميع الحسابات في النظام:\n`;
      bots.forEach((b, i) => {
        const statusIcon = b.status === 'failed' ? '🔴 فاشل' : b.status === 'disabled' ? '🟡 معطل' : '🟢 نشط';
        reportMsg += ` │ ${i + 1}. ${b.name} ◀ ${statusIcon}\n`;
      });

      const adminId = config.adminId || "61575440740189";
      await addNotification(adminId, reportMsg).catch(() => {});

      const adminIds = config.adminIds || [];
      if (Array.isArray(adminIds)) {
        for (const extraId of adminIds) {
          await addNotification(extraId, reportMsg).catch(() => {});
        }
      }

      log('INFO', '✅ تم إرسال تقرير التشغيل.');
      bootReport = [];
    } catch (reportErr) {
      log('WARN', 'فشل تسجيل تقرير التشغيل:', reportErr.message);
    }
  }, 4000);

  const BOT_ID = String(api.getCurrentUserID());
  api.setOptions({ listenEvents: true, selfListen: false });

  const { initCompetitions } = require('./Mosaba9at');
  initCompetitions(api).catch(err => log('ERROR', 'خطأ في تهيئة المسابقات:', err));

  startConversationCleanup();
  startWatchdog(botStatus, startBot, stopCurrentListener);
  startKeepalive(api, botStatus);

  setInterval(() => tickBankSystem(api).catch(e => log('ERROR', 'خطأ في tick البنك:', e.message)), 5 * 60 * 1000);
  setInterval(() => tickRecoverySystem(api).catch(e => log('ERROR', 'خطأ في tick الإنعاش:', e.message)), 2 * 60 * 1000);
  setInterval(() => tickInactivityCheck(api).catch(e => log('ERROR', 'خطأ في tick الخمول:', e.message)), 24 * 60 * 60 * 1000);

  (async () => {
    await sleep(5000);
    const STARTUP_MSG =
      `‌\n` +
      `╭──〔 NEXUS SYSTEM 〕──╮\n` +
      `⌬ بوت نيكسوس نشط 🟢\n` +
      `⎔ الحساب المستخدم ↫ ${loginData.botName}\n` +
      `╯──────────────────╰`;
    const groupIds = Object.values(config.groupes).map(String).filter(Boolean);
    for (const gid of groupIds) {
      try {
        if (botStatus.running && api && typeof api.sendMessage === 'function') {
          await sendMessage(api, STARTUP_MSG, gid);
        }
      } catch (e) {}
      await sleep(1000);
    }
  })().catch(() => {});

  currentStopListening = api.listen(async (err, event) => {
    if (err) {
      const errMsg = err.error || err.message || JSON.stringify(err);
      botStatus.lastError = `خطأ في الاستماع: ${errMsg}`;
      log('ERROR', '❌ خطأ في api.listen:', errMsg);

      botStatus.running = false;
      clearAllIntervals();
      stopCurrentListener();

      await handleRuntimeFailure(loginData, errMsg);

      setTimeout(() => startBot(), 2000);
      return;
    }

    updateLastEvent();
    botStatus.lastEvent = new Date().toISOString();

    if (isDuplicate(event.type, event.messageID)) return;

    try {
      await routeEvent(api, event, BOT_ID);
    } catch (e) {
      log('ERROR', `خطأ في معالجة الحدث [${event.type}]:`, e.stack || e.message);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// بدء التهيئة
// ─────────────────────────────────────────────────────────────
async function start() {
  log('INFO', '🚀 بدء تشغيل بوت نيكسوس...');

  try {
    await connectDB();
    log('OK', '✅ تم الاتصال بقاعدة البيانات');

    // ─── تفعيل بوت تليجرام المساعد تلقائياً بعد نجاح اتصال قاعدة البيانات ───
    try {
      initTelegramBot();
    } catch (tgError) {
      log('ERROR', '⚠️ فشل تفعيل بوت تليجرام المساعد:', tgError.message);
    }

    const { initSessionCache } = require('./database');
    await initSessionCache();

    // ─── تحميل المجموعات الصامتة من قاعدة البيانات عند الإقلاع ───
    try {
      const db = require('./database').getDB();
      const list = await db.collection('muted_groups').find({}).toArray();
      global.mutedGroups = global.mutedGroups || {};
      for (const item of list) {
        global.mutedGroups[String(item.threadId)] = true;
      }
      log('OK', `🔇 تم تحميل وضع الصمت النشط لـ (${list.length}) مجموعات.`);
    } catch (muteErr) {
      log('ERROR', '⚠️ خطأ أثناء تحميل القروبات الصامتة من الداتا:', muteErr.message);
    }

  } catch (e) {
    log('FATAL', '❌ فشل الاتصال بقاعدة البيانات:', e.message);
    process.exit(1);
  }

  try {
    await initAdminIds();
    await initGroupes();
    await loadSpyState();
    await initBotEnabled();
    log('OK', '✅ تم تحميل بيانات الإدارة');
  } catch (e) {
    log('ERROR', '⚠️ خطأ في تحميل بيانات الإدارة:', e.message);
  }

  try {
    const { setResponseDelay } = require('./settings');
    const savedDelay = await getBotConfig('responseDelay').catch(() => null);
    if (savedDelay !== null && savedDelay !== undefined) {
      setResponseDelay(savedDelay);
      log('OK', `⏱️ تم تحميل التأخير: ${savedDelay} ثانية`);
    }
  } catch (e) {}

  await initAutoRotation(() => {
    log('INFO', '🔄 تبديل تلقائي — جاري إعادة التشغيل...');
    setTimeout(() => process.exit(0), 1000);
  });

  await startBot();
}

start();