// anime_memes.js
const axios = require('axios');
const FormData = require('form-data');
const { isAdmin } = require('./admin');
const { sendReply, sendMessage } = require('./utils');
const db = require('./database');

// مفتاح ImgBB الخاص بك المستخدم لرفع الصور وحفظ روابطها
const IMGBB_API_KEY = "772f39ab2899778002c47a1082a3ef12";

/**
 * دالة لرفع الصورة الملتقطة من فيسبوك إلى ImgBB وتحويلها لرابط دائم
 */
async function uploadToImgBB(fbAttachmentUrl) {
  try {
    // 1. تحميل الصورة كـ Buffer من سيرفر فيسبوك المؤقت
    const response = await axios.get(fbAttachmentUrl, { responseType: 'arraybuffer' });
    const base64Image = Buffer.from(response.data, 'binary').toString('base64');

    // 2. إرسال الصورة كـ Form Data للـ API
    const form = new FormData();
    form.append('image', base64Image);

    const uploadRes = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, form, {
      headers: form.getHeaders()
    });

    if (uploadRes.data && uploadRes.data.data && uploadRes.data.data.url) {
      return uploadRes.data.data.url; // رابط الصورة المباشر والدائم
    }
    return null;
  } catch (error) {
    console.error("❌ فشل الرفع لخدمة ImgBB:", error.message);
    return null;
  }
}

/**
 * معالج الأوامر (رفع صور انمي، رفع ميمز، رفع، صور انمي، ميمز)
 */
async function handleMediaCommands(api, event) {
  const { threadID, messageID, senderID, body, messageReply } = event;
  const text = (body || '').trim();

  // ──── 1. أوامر الإدارة والمسؤولين (الرفع العام والخاص بالتصنيفات) ────
  if (text === "رفع صور انمي" || text === "رفع ميمز" || text === "رفع") {
    // التحقق من أن المرسل هو مسؤول
    if (!isAdmin(senderID)) {
      return sendReply(api, "❌ عذراً، هذا الأمر مخصص لمديري البوت والمسؤولين فقط.", messageID, threadID);
    }

    // التحقق من وجود رد مقتبس على صورة
    if (!messageReply || !messageReply.attachments || messageReply.attachments.length === 0) {
      return sendReply(api, "⚠️ يجب عليك الرد على الصورة التي تريد رفعها وتخزينها.", messageID, threadID);
    }

    const attachment = messageReply.attachments[0];
    if (attachment.type !== "photo") {
      return sendReply(api, "⚠️ المرفق الذي رددت عليه يجب أن يكون صورة.", messageID, threadID);
    }

    // أداء معالجة الأمر "رفع" العام
    if (text === "رفع") {
      await sendReply(api, "⏳ جاري رفع الصورة سحابياً وتوليد رابط مباشر لها...", messageID, threadID);
      const permanentUrl = await uploadToImgBB(attachment.url);
      
      if (permanentUrl) {
        const msg = 
          `╮───∙⋆⋅「 📥 تم الرفع بنجاح 」\n` +
          `│\n` +
          `│ › الرابط المباشر للرسمة:\n` +
          `│ ${permanentUrl}\n` +
          `╯───────∙⋆⋅ ※ ⋅⋆∙`;
        await sendReply(api, msg, messageID, threadID);
      } else {
        await sendReply(api, "❌ فشل رفع الصورة، يرجى التحقق من صلاحية اتصال الإنترنت بموقع ImgBB.", messageID, threadID);
      }
      return;
    }

    // أداء معالجة رفع وتخزين الصور بالتصنيفات (صور الأنمي والميمز)
    await sendReply(api, "⏳ جاري نقل الصورة وتخزينها في السيرفرات السحابية بأمان...", messageID, threadID);

    const category = text === "رفع صور انمي" ? "anime" : "meme";
    const permanentUrl = await uploadToImgBB(attachment.url);

    if (permanentUrl) {
      // حفظ الرابط النهائي في قاعدة البيانات
      await db.saveMedia(permanentUrl, category);
      await sendReply(api, `✅ تم رفع وتخزين الصورة بنجاح في تصنيف [${category === 'anime' ? 'صور الأنمي' : 'الميمز'}]!`, messageID, threadID);
    } else {
      await sendReply(api, "❌ فشل رفع الصورة، يرجى التحقق من صلاحية اتصال الإنترنت بموقع ImgBB.", messageID, threadID);
    }
    return;
  }

  // ──── 2. أوامر المستخدمين (العرض) ────
  if (text === "صور انمي" || text === "ميمز") {
    const category = text === "صور انمي" ? "anime" : "meme";

    try {
      // جلب رابط صورة عشوائية لم يشاهدها هذا المستخدم بعد
      const imageUrl = await db.getRandomUnseenMedia(senderID, category);

      if (!imageUrl) {
        return sendReply(api, "⚠️ قاعدة البيانات فارغة في هذا التصنيف حالياً. يرجى الطلب من الأدمن رفع بعض الصور أولاً.", messageID, threadID);
      }

      // جلب الصورة كـ Stream من رابط الويب لإرسالها كمرفق بالفيسبوك
      const imageStream = await axios.get(imageUrl, { responseType: 'stream' });

      await api.sendMessage({
        body: `🖼️ إليك لقطة من قسم [ ${category === 'anime' ? 'الأنمي' : 'الميمز'} ]!`,
        attachment: imageStream.data
      }, threadID, messageID);

    } catch (err) {
      console.error("❌ خطأ أثناء معالجة جلب وإرسال الميديا:", err);
      await sendReply(api, "❌ عذراً، واجهنا مشكلة فنية مؤقتة أثناء استرجاع الصورة.", messageID, threadID);
    }
  }
}

module.exports = {
  handleMediaCommands
};