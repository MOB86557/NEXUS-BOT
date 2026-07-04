const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { H } = require('./utils');

// ===== دالة تنزيل الصورة مع دعم كامل للـ redirect =====
function downloadImage(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('عدد إعادة التوجيه تجاوز الحد المسموح'));

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NexusBot/1.0)',
        'Accept': 'image/png,image/jpeg,image/*'
      },
      timeout: 90000
    };

    const req = https.request(options, (res) => {
      // معالجة الـ redirect (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        const newUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://${urlObj.hostname}${res.headers.location}`;
        res.resume();
        return downloadImage(newUrl, dest, redirectCount + 1)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`فشل تحميل الصورة: رمز الحالة ${res.statusCode}`));
      }

      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('انتهت مهلة الاتصال بخادم توليد الصور (90 ثانية)'));
    });

    req.end();
  });
}

// خريطة اللغات للترجمة فقط (لا تستخدم في رسم)
const langMap = {
  'العربية': 'ar', 'عربي': 'ar', 'العربيه': 'ar', 'ar': 'ar',
  'الانجليزية': 'en', 'إنجليزية': 'en', 'إنجليزي': 'en', 'انجليزي': 'en', 'الانجليزيه': 'en', 'en': 'en',
  'الفرنسية': 'fr', 'فرنسي': 'fr', 'الفرنسيه': 'fr', 'fr': 'fr',
  'الاسبانية': 'es', 'إسباني': 'es', 'اسباني': 'es', 'الاسبانيه': 'es', 'es': 'es',
  'التركية': 'tr', 'تركي': 'tr', 'التركيه': 'tr', 'tr': 'tr',
  'اليابانية': 'ja', 'ياباني': 'ja', 'اليابانيه': 'ja', 'ja': 'ja',
  'الصينية': 'zh', 'صيني': 'zh', 'الصينيه': 'zh', 'zh': 'zh',
  'الروسية': 'ru', 'روسي': 'ru', 'الروسيه': 'ru', 'ru': 'ru',
  'الالمانية': 'de', 'ألماني': 'de', 'الماني': 'de', 'الالمانيه': 'de', 'de': 'de',
  'الايطالية': 'it', 'إيطالي': 'it', 'ايطالي': 'it', 'الايطاليه': 'it', 'it': 'it'
};

// دالة الترجمة (للأمر ترجمة فقط)
function translateText(text, targetLang = 'en') {
  return new Promise((resolve, reject) => {
    let langCode = targetLang.toLowerCase();
    if (langMap[langCode]) langCode = langMap[langCode];

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${langCode}&dt=t&q=${encodeURIComponent(text)}`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed[0] && parsed[0][0] && parsed[0][0][0]) {
            resolve(parsed[0][0][0]);
          } else {
            reject(new Error('بنية استجابة غير متوقعة من خادم الترجمة'));
          }
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ===== 1. معالج أمر الرسم =====
async function handleRasm(api, event) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  if (text === 'رسم') {
    api.sendMessage(
      { body: H + '🎨 يرجى كتابة 《 رسم 》 متبوعاً بوصف الصورة التي تود توليدها.\n\nمثال:\nرسم تنين أحمر يطير فوق قلعة صخرية' },
      threadID, () => {}, messageID
    );
    return true;
  }

  const match = text.match(/^رسم\s+(.+)$/i);
  if (!match) return false;

  const prompt = match[1].trim();

  api.setMessageReaction('🎨', messageID, () => {}, true);
  api.sendMessage(
    { body: H + '⏳ جاري توليد الصورة بالذكاء الاصطناعي، يرجى الانتظار...' },
    threadID, () => {}, messageID
  );

  // بناء رابط pollinations.ai مع النموذج flux (مجاني وسريع)
  const seed = Math.floor(Math.random() * 1000000);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=flux&width=1024&height=1024&nologo=true&seed=${seed}&enhance=false`;
  const tempFile = path.join(os.tmpdir(), `draw_${Date.now()}.png`);

  try {
    await downloadImage(imageUrl, tempFile);

    const msg = {
      body: '',
      attachment: fs.createReadStream(tempFile)
    };

    api.sendMessage(msg, threadID, (err) => {
      try { fs.unlinkSync(tempFile); } catch (_) {}
      if (err) console.error('[rasm] خطأ في إرسال الصورة:', err);
    }, messageID);

  } catch (error) {
    console.error('[rasm] خطأ في توليد الصورة:', error.message);
    api.setMessageReaction('❌', messageID, () => {}, true);
    api.sendMessage(
      { body: H + `❌ عذراً، حدث خطأ أثناء توليد الصورة.\nالسبب: ${error.message}\nيرجى المحاولة مرة أخرى لاحقاً.` },
      threadID, () => {}, messageID
    );
    try { fs.unlinkSync(tempFile); } catch (_) {}
  }

  return true;
}

// ===== 2. معالج أمر الترجمة =====
async function handleTarjama(api, event) {
  const { threadID, senderID, messageID, body, messageReply } = event;
  const text = (body || '').trim();

  if (text.startsWith('ترجمة') || text.startsWith('ترجمه')) {
    if ((text === 'ترجمة' || text === 'ترجمه') && !messageReply) {
      api.sendMessage(
        { body: H + 'ℹ️ قم بالرد على الجملة أو الكلمة التي تريد ترجمتها بأمر 《 ترجمة 》 متبوعاً باللغة المراد الترجمة إليها.\n\nمثال:\nترجمة الانجليزية' },
        threadID, () => {}, messageID
      );
      return true;
    }

    if (messageReply && messageReply.body) {
      const match = text.match(/^(?:ترجمة|ترجمه)\s+(.+)$/i);
      if (!match) {
        api.sendMessage(
          { body: H + '⚠️ يرجى تحديد اللغة المراد الترجمة إليها.\nمثال: ترجمة الانجليزية' },
          threadID, () => {}, messageID
        );
        return true;
      }

      const targetLang = match[1].trim();
      const textToTranslate = messageReply.body;

      api.setMessageReaction('⏳', messageID, () => {}, true);

      try {
        const translatedText = await translateText(textToTranslate, targetLang);
        const header =
          `╮──────────────⟢\n` +
          `┆˼🌐 ˹┊ الترجمة للـ ${targetLang} ↶\n` +
          `╯──────────────⟢`;

        api.sendMessage(
          { body: H + `${header}\n${translatedText}` },
          threadID, () => {}, messageReply.messageID
        );
      } catch (err) {
        console.error('[rasm] خطأ في الترجمة:', err);
        api.setMessageReaction('❌', messageID, () => {}, true);
        api.sendMessage(
          { body: H + '❌ فشل تنفيذ الترجمة، يرجى التأكد من كتابة اسم اللغة بشكل صحيح.' },
          threadID, () => {}, messageID
        );
      }
      return true;
    } else {
      api.sendMessage(
        { body: H + '⚠️ يجب الرد على الرسالة التي تريد ترجمتها أولاً ثم كتابة 《 ترجمة [اللغة] 》.' },
        threadID, () => {}, messageID
      );
      return true;
    }
  }

  return false;
}

module.exports = { handleRasm, handleTarjama };
