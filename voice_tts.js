// voice_tts.js
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { H, sendMessage, sendReply } = require('./utils');

// ─── قائمة الأصوات المتاحة ───
const AVAILABLE_VOICES = [
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'آدم',      lang: 'عربي/إنجليزي' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'سارة',     lang: 'عربي/إنجليزي' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'ليام',      lang: 'إنجليزي'      },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'شارلوت',   lang: 'إنجليزي'      },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'دانيال',    lang: 'عربي/إنجليزي' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'كالوم',     lang: 'إنجليزي'      },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'روجر',      lang: 'إنجليزي'      },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'لورا',      lang: 'إنجليزي'      },
];

const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';

// ─── جلب الصوت النشط من DB ───
async function getActiveVoiceId() {
  try {
    const { getDB } = require('./database');
    const doc = await getDB().collection('tts_settings').findOne({ type: 'main' });
    return doc?.voiceId || DEFAULT_VOICE_ID;
  } catch { return DEFAULT_VOICE_ID; }
}

async function saveActiveVoiceId(voiceId) {
  const { getDB } = require('./database');
  await getDB().collection('tts_settings').updateOne(
    { type: 'main' },
    { $set: { voiceId, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ─── توليد الصوت ───
function generateElevenLabsAudio(apiKey, text, voiceId) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    });

    const options = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
        'accept': 'audio/mpeg'
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let e = '';
        res.on('data', c => e += c);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${e}`)));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ═══════════════════════════════════════════════
//  أمر قول — للاعبين
// ═══════════════════════════════════════════════
async function handleSaySpeech(api, event, speechText) {
  try {
    // 1. التحقق من وجود النص ومدى ملاءمته
    if (!speechText || speechText.trim().length === 0) {
      await sendReply(api,
        `╮───∙⋆⋅「 قول 」\n│\n│ › ⚠️ الرجاء كتابة نص لنطقه\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        event.messageID, event.threadID);
      return;
    }

    // 2. التحقق من شرط ألا يتجاوز 90 حرفاً
    if (speechText.length > 90) {
      await sendReply(api,
        `╮───∙⋆⋅「 قول 」\n│\n│ › ⚠️ النص طويل جداً!\n│ › الحد الأقصى المسموح به هو 90 حرفاً فقط.\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        event.messageID, event.threadID);
      return;
    }

    const { getAllElevenLabsKeys, markElevenLabsKeyFailed, getDB } = require('./database');

    const keysDoc = await getAllElevenLabsKeys();
    if (!keysDoc || keysDoc.length === 0) {
      await sendReply(api,
        `╮───∙⋆⋅「 قول 」\n│\n│ › ⚠️ الخدمة غير متاحة حالياً\n│ › تواصل مع الأدمن\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        event.messageID, event.threadID);
      return;
    }

    const voiceId = await getActiveVoiceId();
    const sorted = [...keysDoc].sort((a, b) => (a.status === 'failed' ? 1 : 0) - (b.status === 'failed' ? 1 : 0));
    let audioBuffer = null;

    for (const k of sorted) {
      try {
        audioBuffer = await generateElevenLabsAudio(k.key, speechText, voiceId);
        if (k.status === 'failed') {
          await getDB().collection('elevenlabs_keys').updateOne({ key: k.key }, { $set: { status: 'active' } });
        }
        break;
      } catch (err) {
        console.error(`[ElevenLabs] فشل المفتاح: ${k.key.substring(0, 6)}... بسبب: ${err.message}`);
        await markElevenLabsKeyFailed(k.key);
      }
    }

    if (!audioBuffer) {
      await sendReply(api,
        `╮───∙⋆⋅「 قول 」\n│\n│ › ⚠️ جميع المفاتيح معطلة\n│ › تواصل مع الأدمن\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        event.messageID, event.threadID);
      return;
    }

    const tempFile = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
    try {
      fs.writeFileSync(tempFile, audioBuffer);
      await api.sendMessage(
        { body: H + '🎙️ النطق الصوتي:', attachment: fs.createReadStream(tempFile) },
        event.threadID,
        () => { try { fs.unlinkSync(tempFile); } catch (_) {} },
        event.messageID
      );
    } catch (err) {
      try { fs.unlinkSync(tempFile); } catch (_) {}
      await sendReply(api,
        `╮───∙⋆⋅「 قول 」\n│\n│ › ⚠️ خطأ في إرسال الملف الصوتي\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        event.messageID, event.threadID);
    }
  } catch (globalError) {
    // التقاط أي أخطاء غير متوقعة لمنع انهيار أو توقف البوت بالكامل
    console.error("[TTS Error] حدث خطأ أثناء تنفيذ أمر قول:", globalError);
    try {
      await sendReply(api,
        `╮───∙⋆⋅「 قول 」\n│\n│ › ⚠️ حدث خطأ فني أثناء معالجة النطق.\n│ › يرجى المحاولة لاحقاً.\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        event.messageID, event.threadID);
    } catch (_) {}
  }
}

// ═══════════════════════════════════════════════
//  اعدادات قول — للأدمن
// ═══════════════════════════════════════════════
async function handleTtsSettings(api, event) {
  const { threadID, senderID } = event;
  const { getAllElevenLabsKeys, getAdminSession, setAdminSession } = require('./database');

  const keys = await getAllElevenLabsKeys();
  const activeCount  = keys.filter(k => k.status !== 'failed').length;
  const failedCount  = keys.length - activeCount;
  const voiceId      = await getActiveVoiceId();
  const currentVoice = AVAILABLE_VOICES.find(v => v.id === voiceId) || { name: 'غير معروف' };

  await setAdminSession(senderID, { state: 'TTS_MAIN' });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n` +
    `      ✦  إعدادات قول  ✦\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الحالة 」\n` +
    `│ › المفاتيح  : ${keys.length} (نشط: ${activeCount} | معطل: ${failedCount})\n` +
    `│ › الصوت الحالي : ${currentVoice.name}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n` +
    `│ 1 › إضافة مفتاح\n` +
    `│ 2 › حذف مفتاح\n` +
    `│ 3 › عرض المفاتيح\n` +
    `│ 4 › تغيير الصوت\n` +
    `│ › 《 خروج 》\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleTtsSettingsSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  const {
    getAllElevenLabsKeys, addElevenLabsKey, removeElevenLabsKey,
    setAdminSession, deleteAdminSession
  } = require('./database');

  // خروج
  if (text === 'خروج') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  // ── القائمة الرئيسية ──
  if (session.state === 'TTS_MAIN') {
    if (text === '1') {
      await setAdminSession(senderID, { state: 'TTS_ADD_KEY' });
      await sendMessage(api,
        `╮───∙⋆⋅「 إضافة مفتاح 」\n│\n│ › أرسل مفتاح ElevenLabs\n│ › أو 《 خروج 》\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }
    if (text === '2') {
      await _showDeleteMenu(api, event);
      return;
    }
    if (text === '3') {
      await _showKeysStatus(api, event);
      return;
    }
    if (text === '4') {
      await _showVoiceMenu(api, event);
      return;
    }
    await sendMessage(api, `⚠️ اختر 1 أو 2 أو 3 أو 4`, threadID);
    return;
  }

  // ── إضافة مفتاح ──
  if (session.state === 'TTS_ADD_KEY') {
    if (!text || text.length < 10) {
      await sendMessage(api, `⚠️ المفتاح قصير جداً، أعد المحاولة`, threadID);
      return;
    }
    await addElevenLabsKey(text);
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تمت الإضافة ✅ 」\n│\n│ › تم إضافة المفتاح بنجاح\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  // ── حذف مفتاح ──
  if (session.state === 'TTS_DELETE_KEY') {
    const keys = session.keys || [];
    const idx  = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= keys.length) {
      await sendMessage(api, `⚠️ رقم غير صحيح`, threadID);
      return;
    }
    const chosen = keys[idx];
    await removeElevenLabsKey(chosen.key);
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم الحذف 🗑️ 」\n│\n│ › تم حذف المفتاح : ${chosen.short}\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  // ── تغيير الصوت ──
  if (session.state === 'TTS_VOICE') {
    const idx = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= AVAILABLE_VOICES.length) {
      await sendMessage(api, `⚠️ رقم غير صحيح`, threadID);
      return;
    }
    const chosen = AVAILABLE_VOICES[idx];
    await saveActiveVoiceId(chosen.id);
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم التغيير ✅ 」\n│\n│ › الصوت الجديد : ${chosen.name}\n│ › اللغة : ${chosen.lang}\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }
}

// ── عرض قائمة الحذف ──
async function _showDeleteMenu(api, event) {
  const { threadID, senderID } = event;
  const { getAllElevenLabsKeys, setAdminSession } = require('./database');
  const keys = await getAllElevenLabsKeys();

  if (!keys.length) {
    await sendMessage(api,
      `╮───∙⋆⋅「 حذف مفتاح 」\n│\n│ › لا يوجد مفاتيح مضافة\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  let msg = `╮───∙⋆⋅「 حذف مفتاح 」\n│\n`;
  keys.forEach((k, i) => {
    const short  = k.key.substring(0, 8) + '...' + k.key.slice(-4);
    const status = k.status === 'failed' ? '🔴' : '🟢';
    msg += `│ ${i + 1}. ${status} ${short}\n`;
  });
  msg += `│\n│ › أرسل رقم المفتاح للحذف\n│ › أو 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;

  await setAdminSession(senderID, {
    state: 'TTS_DELETE_KEY',
    keys: keys.map(k => ({
      key: k.key,
      short: k.key.substring(0, 8) + '...' + k.key.slice(-4)
    }))
  });
  await sendMessage(api, msg, threadID);
}

// ── عرض حالة المفاتيح ──
async function _showKeysStatus(api, event) {
  const { threadID, senderID } = event;
  const { getAllElevenLabsKeys, setAdminSession } = require('./database');
  const keys = await getAllElevenLabsKeys();

  if (!keys.length) {
    await sendMessage(api,
      `╮───∙⋆⋅「 المفاتيح 」\n│\n│ › لا يوجد مفاتيح مضافة بعد\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  let msg = `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n    ✦  مفاتيح ElevenLabs  ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n`;
  keys.forEach((k, i) => {
    const short  = k.key.substring(0, 8) + '...' + k.key.slice(-4);
    const status = k.status === 'failed' ? '🔴 معطل' : '🟢 نشط';
    msg += `╮───∙⋆⋅「 ${i + 1} 」\n│ › المفتاح : ${short}\n│ › الحالة  : ${status}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
  });

  await setAdminSession(senderID, { state: 'TTS_MAIN' });
  await sendMessage(api, msg.trimEnd(), threadID);
}

// ── عرض قائمة الأصوات ──
async function _showVoiceMenu(api, event) {
  const { threadID, senderID } = event;
  const { setAdminSession } = require('./database');
  const voiceId      = await getActiveVoiceId();
  const currentVoice = AVAILABLE_VOICES.find(v => v.id === voiceId);

  let msg = `╮───∙⋆⋅「 تغيير الصوت 」\n│\n│ › الصوت الحالي : ${currentVoice?.name || 'غير معروف'}\n│\n`;
  AVAILABLE_VOICES.forEach((v, i) => {
    const cur = v.id === voiceId ? ' ✅' : '';
    msg += `│ ${i + 1}. ${v.name} (${v.lang})${cur}\n`;
  });
  msg += `│\n│ › أرسل رقم الصوت المطلوب\n│ › أو 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;

  await setAdminSession(senderID, { state: 'TTS_VOICE' });
  await sendMessage(api, msg, threadID);
}

module.exports = {
  handleSaySpeech,
  handleTtsSettings,
  handleTtsSettingsSession
};