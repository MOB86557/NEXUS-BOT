/*
 * ═══════════════════════════════════════════════════════════════════════
 *  settings.js — الإعدادات العامة المشتركة بين الملفات
 * ═══════════════════════════════════════════════════════════════════════
 */

// التأخير العام قبل الرد (بالثواني)
let responseDelay = 0;

function getResponseDelay() {
  return responseDelay;
}

function setResponseDelay(seconds) {
  responseDelay = Number(seconds) || 0;
}

module.exports = { getResponseDelay, setResponseDelay };
