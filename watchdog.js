// watchdog.js
let lastEventTime = Date.now();
let keepaliveInterval = null;
let watchdogInterval = null;
let currentApi = null;

const processedEvents = new Set();
const DEDUP_MAX = 200;

function isDuplicate(eventType, messageID) {
  if (!messageID) return false;
  const key = `${eventType}:${messageID}`;
  if (processedEvents.has(key)) return true;
  processedEvents.add(key);
  if (processedEvents.size > DEDUP_MAX) {
    const first = processedEvents.values().next().value;
    processedEvents.delete(first);
  }
  return false;
}

function startKeepalive(api, botStatus) {
  if (keepaliveInterval) clearInterval(keepaliveInterval);
  currentApi = api;
  const botId = api.getCurrentUserID();
  
  keepaliveInterval = setInterval(() => {
    if (!currentApi) return;
    try {
      currentApi.getUserInfo([String(botId)], (err, data) => {
        if (err) {
          const msg = err.error || err.message || JSON.stringify(err) || String(err);
          console.log(`[ WARN ] ⚠️ [Keepalive] الاتصال يبدو منقطعاً: ${msg}`);
          botStatus.lastError = `keepalive فشل: ${msg}`;
        } else {
          lastEventTime = Date.now();
          console.log('[ INFO ] 💓 [Keepalive] الاتصال نشط');
        }
      });
    } catch (e) {
      console.log(`[ WARN ] ⚠️ [Keepalive] استثناء: ${e.message}`);
    }
  }, 120000);
}

function startWatchdog(botStatus, restartBotCallback, stopListenerCallback) {
  if (watchdogInterval) clearInterval(watchdogInterval);

  watchdogInterval = setInterval(() => {
    const silentFor = Math.floor((Date.now() - lastEventTime) / 1000);
    if (silentFor > 300) {
      botStatus.lastError = `لا يوجد نشاط منذ ${silentFor} ثانية — يُشتبه بانقطاع الاتصال`;
      console.log(`[ WARN ] ⚠️ Watchdog: لا يوجد نشاط منذ ${silentFor}ث — جاري إعادة الاتصال...`);
      botStatus.running = false;
      
      clearInterval(watchdogInterval);
      watchdogInterval = null;
      if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
      currentApi = null;
      
      stopListenerCallback();
      setTimeout(() => restartBotCallback(), 3000);
    } else {
      console.log(`[ INFO ] 💓 Watchdog: البوت نشط — آخر حدث منذ ${silentFor}ث`);
    }
  }, 60000);
}

function updateLastEvent() {
  lastEventTime = Date.now();
}

function clearAllIntervals() {
  if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
  if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
  currentApi = null;
}

module.exports = {
  isDuplicate,
  startKeepalive,
  startWatchdog,
  updateLastEvent,
  clearAllIntervals
};