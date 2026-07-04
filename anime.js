const fs = require('fs');
const path = require('path');
const { sendReply, H } = require('./utils');

// ذاكرة مؤقتة لحفظ جلسات اقتراح الأنمي في النظام
const animeSessions = new Map();

// قاموس لتعريب التصنيفات الشائعة للأنمي من AniList
const genreTranslations = {
  "Action": "أكشن",
  "Adventure": "مغامرة",
  "Comedy": "كوميديا",
  "Drama": "دراما",
  "Fantasy": "خيالي",
  "Maho Shojo": "فتيات ساحرات",
  "Mecha": "آليات",
  "Music": "موسيقى",
  "Mystery": "غموض",
  "Psychological": "نفسي",
  "Romance": "رومانسي",
  "Sci-Fi": "خيال علمي",
  "Slice of Life": "شريحة من الحياة",
  "Sports": "رياضي",
  "Supernatural": "خارق للطبيعة",
  "Thriller": "إثارة"
};

// قائمة التصنيفات المتاحة للاقتراح
const categories = {
  "1": { nameAr: "كوميدي", nameEn: "Comedy" },
  "2": { nameAr: "أكشن", nameEn: "Action" },
  "3": { nameAr: "مغامرة", nameEn: "Adventure" },
  "4": { nameAr: "دراما", nameEn: "Drama" },
  "5": { nameAr: "خيالي", nameEn: "Fantasy" },
  "6": { nameAr: "غموض", nameEn: "Mystery" },
  "7": { nameAr: "رومانسي", nameEn: "Romance" },
  "8": { nameAr: "خيال علمي", nameEn: "Sci-Fi" },
  "9": { nameAr: "خارق للطبيعة", nameEn: "Supernatural" },
  "10": { nameAr: "إثارة", nameEn: "Thriller" },
  "11": { nameAr: "نفسي", nameEn: "Psychological" },
  "12": { nameAr: "رياضي", nameEn: "Sports" }
};

/**
 * دالة مساعدة لمعالجة وتنسيق بيانات الأنمي المسترجعة من واجهة AniList
 */
function formatAnimeData(media) {
  const uniqueParts = new Set([media.id]);
  let totalEpisodesSum = media.episodes || 0;

  if (media.relations && media.relations.edges) {
    for (const edge of media.relations.edges) {
      if (edge.node.type === 'ANIME') {
        const relType = edge.relationType;
        const format = edge.node.format;
        if (['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE'].includes(relType) && 
            ['TV', 'OVA', 'ONA', 'MOVIE'].includes(format)) {
          uniqueParts.add(edge.node.id);
          totalEpisodesSum += (edge.node.episodes || 0);
        }
      }
    }
  }

  const titleEnglish = media.title?.english || media.title?.romaji || 'غير متوفر';
  const titleNative = media.title?.native || 'غير متوفر';
  const numberOfParts = uniqueParts.size;
  const genresArabic = (media.genres || []).map(g => genreTranslations[g] || g).join(' - ') || 'غير متوفر';
  const rating = media.averageScore ? `${(media.averageScore / 10).toFixed(1)}/10` : 'غير متوفر';

  return {
    titleEnglish,
    titleNative,
    numberOfParts,
    totalEpisodesSum,
    genresArabic,
    rating
  };
}

/**
 * دالة التحقق من وجود جلسة اقتراح نشطة للمستخدم
 */
function hasAnimeSession(userId) {
  return animeSessions.has(String(userId));
}

/**
 * دالة بدء واجهة اقتراح الأنمي وعرض التصنيفات للمستخدم
 */
async function handleAnimeSuggestStart(api, event) {
  const { senderID, threadID, messageID } = event;
  
  // تسجيل جلسة جديدة للمستخدم لمنع التداخل
  animeSessions.set(String(senderID), {
    step: 'CHOOSE_GENRE',
    createdAt: Date.now()
  });

  const menuMessage = 
    `╮─∙⋆⋅「 اكتب رقم التصنيف 」\n` +
    `│\n` +
    `│1 › كوميدي\n` +
    `│2 › أكشن\n` +
    `│3 › مغامرة\n` +
    `│4 › دراما\n` +
    `│5 › خيالي\n` +
    `│6 › غموض\n` +
    `│7 › رومانسي\n` +
    `│8 › خيال علمي\n` +
    `│9 › خارق للطبيعة\n` +
    `│10 › إثارة\n` +
    `│11 › نفسي\n` +
    `│12 › رياضي\n` +
    `│\n` +
    `│ › اكتب رقم التصنيف المطلوب للحصول على اقتراح عشوائي.\n` +
    `│ › أو اكتب "إلغاء" لإنهاء العملية.\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`;

  await sendReply(api, menuMessage, messageID, threadID);
}

/**
 * دالة معالجة إدخال اللاعب خلال جلسة اقتراح الأنمي النشطة
 */
async function handleAnimeSession(api, event) {
  const { senderID, threadID, messageID, body } = event;
  const text = (body || '').trim();

  if (['إلغاء', 'الغاء'].includes(text)) {
    animeSessions.delete(String(senderID));
    await sendReply(api, `🚫 تم إلغاء عملية اقتراح الأنمي بنجاح.`, messageID, threadID);
    return;
  }

  const category = categories[text];
  if (!category) {
    await sendReply(api, `⚠️ رقم غير صحيح. يرجى إدخال رقم من 1 إلى 12، أو اكتب "إلغاء" لإنهاء العملية.`, messageID, threadID);
    return;
  }

  // إنهاء الجلسة بمجرد اختيار الرقم بنجاح والبدء في المعالجة
  animeSessions.delete(String(senderID));
  await sendReply(api, `🔄 جاري اختيار أنمي عشوائي مميز من تصنيف [ ${category.nameAr} ]...`, messageID, threadID);

  try {
    // جلب الأنميات الأكثر شعبية في التصنيف المختار (أول 50 عملاً) لاختيار واحد منها عشوائياً
    const graphqlQuery = `
      query ($genre: String) {
        Page (page: 1, perPage: 50) {
          media (genre: $genre, type: ANIME, sort: POPULARITY_DESC) {
            id
            title {
              romaji
              english
              native
            }
            episodes
            genres
            averageScore
            coverImage {
              extraLarge
              large
            }
            relations {
              edges {
                relationType
                node {
                  id
                  type
                  format
                  episodes
                }
              }
            }
          }
        }
      }
    `;

    const gqlResponse = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { genre: category.nameEn }
      })
    });

    if (!gqlResponse.ok) {
      throw new Error(`استجابة غير صالحة من خادم AniList: ${gqlResponse.status}`);
    }

    const gqlData = await gqlResponse.json();
    const mediaList = gqlData.data?.Page?.media || [];

    if (mediaList.length === 0) {
      await sendReply(api, `❌ عذرًا، لم أتمكن من العثور على أنميات مسجلة لهذا التصنيف حالياً.`, messageID, threadID);
      return;
    }

    // اختيار أنمي عشوائي من النتائج المسترجعة
    const randomMedia = mediaList[Math.floor(Math.random() * mediaList.length)];
    const info = formatAnimeData(randomMedia);

    // صياغة قالب الاقتراح
    const formattedMsg = 
      `┑━━━〔 اقتراح أنمي 〕━━━┍\n` +
      `✦ التصنيف المطلوب : ${category.nameAr}\n` +
      `\u200B┙━━━━━━━━━━━━━━━━┕\n\n` +
      `┑━━〔 معلومات الأنمي 〕━━┍\n` +
      `✦ الاسم بالإنجليزي : ${info.titleEnglish}\n` +
      `✦ الاسم بالياباني : ${info.titleNative}\n` +
      `✦ عدد الأجزاء : ${info.numberOfParts}\n` +
      `✦ مجموع الحلقات : ${info.totalEpisodesSum}\n` +
      `✦ التصنيف : ${info.genresArabic}\n` +
      `✦ التقييم : ${info.rating}\n` +
      `\u200B┙━━━━━━━━━━━━━━┕`;

    // إرسال البيانات النصية أولاً
    await sendReply(api, formattedMsg, messageID, threadID);

    // إرسال بوستر الأنمي المقترح في رسالة منفصلة
    const posterUrl = randomMedia.coverImage?.extraLarge || randomMedia.coverImage?.large;
    if (posterUrl) {
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const tempFilePath = path.join(tempDir, `anime_cover_${Date.now()}.jpg`);

      try {
        const imgRes = await fetch(posterUrl);
        const arrayBuffer = await imgRes.arrayBuffer();
        fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));

        const imageMsg = {
          attachment: fs.createReadStream(tempFilePath)
        };

        api.sendMessage(imageMsg, threadID, (sendErr) => {
          try {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath);
            }
          } catch (cleanupErr) {
            console.error('فشل تنظيف ملف البوستر المؤقت:', cleanupErr.message);
          }
        }, messageID);

      } catch (imgDownloadErr) {
        console.error('فشل تنزيل صورة بوستر الأنمي المقترح منفصلة:', imgDownloadErr.message);
      }
    }

  } catch (error) {
    console.error('حدث خطأ أثناء معالجة اقتراح الأنمي:', error);
    await sendReply(api, `❌ حدث خطأ غير متوقع أثناء الاتصال بالخادم. يرجى المحاولة مرة أخرى لاحقاً.`, messageID, threadID);
  }
}

/**
 * دالة البحث والتعرف على الأنمي وعرض تفاصيله (معدلة للرد المباشر على صورة الأنمي)
 */
async function handleAnimeSearch(api, event) {
  const { threadID, messageID } = event;
  let imageUrl = null;
  let targetReplyID = messageID; // بشكل افتراضي يرد على رسالة "بحث"

  // 1. التحقق مما إذا كان اللاعب قد رد على رسالة تحتوي على صورة
  if (event.type === 'message_reply' && event.messageReply && event.messageReply.attachments && event.messageReply.attachments.length > 0) {
    const attachment = event.messageReply.attachments[0];
    if (attachment.type === 'photo' && attachment.url) {
      imageUrl = attachment.url;
      targetReplyID = event.messageReply.messageID; // جعل البوت يرد مباشرة على رسالة صورة الأنمي
    }
  } 
  // 2. أو إذا أرسل اللاعب الصورة مباشرة مع كتابة كلمة "بحث"
  else if (event.attachments && event.attachments.length > 0) {
    const attachment = event.attachments[0];
    if (attachment.type === 'photo' && attachment.url) {
      imageUrl = attachment.url;
      targetReplyID = messageID; // في هذه الحالة يرد على نفس رسالة "بحث" التي تحتوي على الصورة
    }
  }

  // إذا لم يتم العثور على صورة، نرسل الإرشادات للاعب
  if (!imageUrl) {
    await sendReply(api, 
      `╮───∙⋆⋅「 ℹ️ طريقة الاستخدام 」\n` +
      `│\n` +
      `│ › قم بالرد على صورة الأنمي بأمر "بحث" لمعرفة اسمه وتفاصيله.\n` +
      `│ › أو أرسل صورة الأنمي واكتب معها "بحث" في نفس الرسالة.\n` +
      `│\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙`, 
      messageID, threadID);
    return;
  }

  // الرد على الصورة بأنه جاري التعرف عليها
  await sendReply(api, `🔍 جاري البحث والتعرف على الأنمي من الصورة...`, targetReplyID, threadID);

  try {
    // خطوة 1: التعرف على الأنمي وتوقيت المشهد عبر واجهة Trace.moe
    const traceApiUrl = `https://api.trace.moe/search?url=${encodeURIComponent(imageUrl)}`;
    const traceResponse = await fetch(traceApiUrl);
    
    if (!traceResponse.ok) {
      throw new Error(`استجابة غير صالحة من خادم المطابقة: ${traceResponse.status}`);
    }

    const traceData = await traceResponse.json();

    if (!traceData || !traceData.result || traceData.result.length === 0) {
      await sendReply(api, `❌ عذرًا، لم يتم العثور على أي نتائج مطابقة لهذه الصورة.`, targetReplyID, threadID);
      return;
    }

    const bestMatch = traceData.result[0];
    const similarity = (bestMatch.similarity * 100).toFixed(0); // نسبة التطابق المئوية بدون كسور
    const episode = bestMatch.episode || 'غير محدد';
    const anilistId = bestMatch.anilist;

    if (!anilistId) {
      await sendReply(api, `❌ تم مطابقة المشهد ولكن لم نتمكن من الحصول على المعرف الخاص به في AniList.`, targetReplyID, threadID);
      return;
    }

    // خطوة 2: استعلام واجهة AniList الرسمية للحصول على الأجزاء والبيانات الكاملة
    const graphqlQuery = `
      query ($id: Int) {
        Media (id: $id, type: ANIME) {
          id
          title {
            romaji
            english
            native
          }
          episodes
          genres
          averageScore
          coverImage {
            extraLarge
            large
          }
          relations {
            edges {
              relationType
              node {
                id
                type
                format
                episodes
              }
            }
          }
        }
      }
    `;

    const gqlResponse = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables: { id: parseInt(anilistId, 10) }
      })
    });

    if (!gqlResponse.ok) {
      throw new Error(`استجابة غير صالحة من خادم AniList: ${gqlResponse.status}`);
    }

    const gqlData = await gqlResponse.json();
    const media = gqlData.data?.Media;

    if (!media) {
      await sendReply(api, `❌ فشل استرجاع تفاصيل الأنمي من قاعدة بيانات AniList.`, targetReplyID, threadID);
      return;
    }

    const info = formatAnimeData(media);

    // صياغة قالب الرسالة بالشكل المحدد تماماً
    const formattedMsg = 
      `┑━━━〔 نتيجة البحث 〕━━━┍\n` +
      `✦ نسبة التطابق : ${similarity}%\n` +
      `✦ الحلقة : ${episode}\n` +
      `\u200B┙━━━━━━━━━━━━━━━━┕\n\n` +
      `┑━━〔 معلومات الأنمي 〕━━┍\n` +
      `✦ الاسم بالإنجليزي : ${info.titleEnglish}\n` +
      `✦ الاسم بالياباني : ${info.titleNative}\n` +
      `✦ عدد الأجزاء : ${info.numberOfParts}\n` +
      `✦ مجموع الحلقات : ${info.totalEpisodesSum}\n` +
      `✦ التصنيف : ${info.genresArabic}\n` +
      `✦ التقييم : ${info.rating}\n` +
      `\u200B┙━━━━━━━━━━━━━━┕`;

    // ─── أولاً: إرسال نتيجة البحث النصية (يرد مباشرة على رسالة صورة الأنمي) ───
    await sendReply(api, formattedMsg, targetReplyID, threadID);

    // ─── ثانياً: تحميل وإرسال صورة الأنمي منفصلة ───
    const posterUrl = media.coverImage?.extraLarge || media.coverImage?.large;

    if (posterUrl) {
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const tempFilePath = path.join(tempDir, `anime_cover_${Date.now()}.jpg`);

      try {
        // تنزيل الصورة
        const imgRes = await fetch(posterUrl);
        const arrayBuffer = await imgRes.arrayBuffer();
        fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));

        // إرسال الصورة كرسالة منفصلة تماماً (رد مستقل للاعب على الصورة الأصلية للأنمي)
        const imageMsg = {
          attachment: fs.createReadStream(tempFilePath)
        };

        api.sendMessage(imageMsg, threadID, (sendErr) => {
          try {
            if (fs.existsSync(tempFilePath)) {
              fs.unlinkSync(tempFilePath); // حذف الصورة المؤقتة فور الإرسال للحفاظ على المساحة
            }
          } catch (cleanupErr) {
            console.error('فشل تنظيف ملف البوستر المؤقت:', cleanupErr.message);
          }
        }, targetReplyID);

      } catch (imgDownloadErr) {
        console.error('فشل تنزيل صورة بوستر الأنمي منفصلة:', imgDownloadErr.message);
      }
    }

  } catch (error) {
    console.error('حدث خطأ أثناء البحث عن الأنمي:', error);
    await sendReply(api, `❌ حدث خطأ أثناء الاتصال بالخوادم للتعرف على الأنمي.`, targetReplyID, threadID);
  }
}

module.exports = {
  handleAnimeSearch,
  handleAnimeSuggestStart,
  handleAnimeSession,
  hasAnimeSession
};