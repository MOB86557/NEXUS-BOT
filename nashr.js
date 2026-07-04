/*
 * ═══════════════════════════════════════════════════════════════════════
 *  nashr.js — نظام كوينز النشر (مصحح بالكامل ومحسن لمطابقة الحسابات)
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const config = require('./config.json');
const { sendMessage, sendReply } = require('./utils');
const {
  getPlayer, updatePlayer,
  getAdminSession, setAdminSession, deleteAdminSession,
  getNashrSession, setNashrSession, deleteNashrSession,
  getNashrPost,    addNashrPost,
  getApifyTokens,  addApifyToken, removeApifyToken,
  incrementTokenUse,
  getNashrSettings, updateNashrSettings,
  addXP
} = require('./database');

// ─────────────────────────────────────────────────────────────────────
//  ثوابت
// ─────────────────────────────────────────────────────────────────────
const DEFAULT_MIN_REACTIONS   = 10;
const DEFAULT_COINS_PER_REACT = 3;
const APIFY_ACTOR             = 'apify~facebook-posts-scraper';
const APIFY_TIMEOUT           = 60;

// مساعد: جلب الإعدادات من DB مع الاحتياطي
async function getSettings() {
  try {
    const s = await getNashrSettings();
    if (!s) return { minReactions: DEFAULT_MIN_REACTIONS, coinsPerReact: DEFAULT_COINS_PER_REACT };
    return {
      minReactions: s.minReactions ?? DEFAULT_MIN_REACTIONS,
      coinsPerReact: s.coinsPerReact ?? DEFAULT_COINS_PER_REACT
    };
  } catch {
    return { minReactions: DEFAULT_MIN_REACTIONS, coinsPerReact: DEFAULT_COINS_PER_REACT };
  }
}

// مساعد: تفاعل البوت على رسالة
function reactTo(api, messageID, threadID, emoji) {
  return new Promise(r => api.setMessageReaction(emoji, messageID, threadID, () => r(), true));
}

// مساعد: جلب معلومات المرسل من فيسبوك للتحقق من هويته
function getUserFacebookInfo(api, userID) {
  return new Promise((resolve) => {
    const uid = String(userID);
    api.getUserInfo(uid, (err, res) => {
      if (err || !res) { resolve(null); return; }
      const data = res[uid] || res[userID] || Object.values(res)[0] || null;
      resolve(data);
    });
  });
}

// مساعد: تنظيف وتوحيد روابط فيسبوك
function normalizePostUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const searchParams = parsed.searchParams;
    const cleanParams = new URLSearchParams();
    
    const keepParams = ['story_fbid', 'id', 'fbid', 'set', 'type'];
    for (const param of keepParams) {
      if (searchParams.has(param)) {
        cleanParams.set(param, searchParams.get(param));
      }
    }
    
    let cleanUrl = parsed.origin + parsed.pathname;
    if (cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }
    
    const paramsStr = cleanParams.toString();
    return paramsStr ? `${cleanUrl}?${paramsStr}` : cleanUrl;
  } catch (e) {
    return url.split('?')[0].replace(/\/$/, '');
  }
}

// ═════════════════════════════════════════════════════════════════════
//  الجزء الأول — Apify
// ═════════════════════════════════════════════════════════════════════

async function fetchPostFromApify(postUrl) {
  const tokens = await getApifyTokens();
  const active  = tokens.filter(t => !t.disabled);

  if (!active.length) throw new Error('NO_TOKENS');

  for (const tokenDoc of active) {
    const endpoint =
      `https://api.apify.com/v2/acts/${APIFY_ACTOR}` +
      `/run-sync-get-dataset-items` +
      `?token=${tokenDoc.token}&timeout=${APIFY_TIMEOUT}&memory=256`;

    try {
      const res = await fetch(endpoint, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          startUrls: [{ url: postUrl }],
          maxPosts : 1,
        }),
      });

      if (res.status === 401 || res.status === 402 || res.status === 403) {
        console.warn(`[nashr] توكن ${tokenDoc.username} أُعطل (HTTP ${res.status})`);
        continue;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Apify HTTP ${res.status}: ${txt.slice(0, 120)}`);
      }

      await incrementTokenUse(tokenDoc._id);

      const items = await res.json();
      if (Array.isArray(items) && items.length > 0) {
        return items[0];
      }
      return null;

    } catch (err) {
      if (err.message.startsWith('Apify HTTP')) throw err;
      throw err;
    }
  }

  throw new Error('ALL_TOKENS_FAILED');
}

async function fetchApifyAccountInfo(token) {
  const [meRes, limitsRes] = await Promise.all([
    fetch(`https://api.apify.com/v2/users/me?token=${token}`),
    fetch(`https://api.apify.com/v2/users/me/limits?token=${token}`),
  ]);

  const me     = meRes.ok     ? (await meRes.json()).data     : null;
  const limits = limitsRes.ok ? (await limitsRes.json()).data : null;

  return { me, limits };
}

// ─────────────────────────────────────────────────────────────────────
//  مساعدات استخراج بيانات المنشور
// ─────────────────────────────────────────────────────────────────────

function parseProfileUrl(url) {
  if (!url) return { numericId: null, username: null };
  
  const groupUserMatch = url.match(/\/user\/(\d+)/i);
  if (groupUserMatch) {
    return { numericId: groupUserMatch[1], username: null };
  }

  const peopleMatch = url.match(/\/people\/[^/]+\/(\d+)/i);
  if (peopleMatch) {
    return { numericId: peopleMatch[1], username: null };
  }

  const idMatch = url.match(/profile\.php\?id=(\d+)/i);
  if (idMatch) {
    return { numericId: idMatch[1], username: null };
  }
  
  const pathMatch = url.match(/facebook\.com\/([a-zA-Z0-9._]+)/i);
  if (pathMatch) {
    const segment = pathMatch[1];
    if (!['profile.php', 'groups', 'pages', 'posts', 'permalink', 'share', 'story', 'watch', 'videos', 'people'].includes(segment.toLowerCase())) {
      const cleanUsername = segment.split(/[?#]/)[0];
      if (/^\d{10,}$/.test(cleanUsername)) {
        return { numericId: cleanUsername, username: null };
      }
      return { numericId: null, username: cleanUsername.toLowerCase() };
    }
  }
  return { numericId: null, username: null };
}

function extractGroupId(url) {
  if (!url) return null;
  const m = url.match(/facebook\.com\/groups\/([a-zA-Z0-9._]+)/i);
  return m ? m[1] : null;
}

function parseApifyPost(data) {
  const canonicalUrl = data.url || data.postUrl || data.link || null;

  const userObj  = data.user || data.author || {};
  const parsedAuthor = {
    id: userObj.id ? String(userObj.id).toLowerCase() : null,
    username: userObj.username ? String(userObj.username).toLowerCase() : null,
    name: userObj.name ? String(userObj.name).toLowerCase().trim() : null,
    numericId: null,
    urlUsername: null,
  };

  const urlToParse = userObj.url || userObj.profileUrl || userObj.link || '';
  if (urlToParse) {
    const parsed = parseProfileUrl(urlToParse);
    if (parsed.numericId) parsedAuthor.numericId = parsed.numericId;
    if (parsed.username) parsedAuthor.urlUsername = parsed.username;
  }

  const groupObj = data.group || {};
  const groupId  = String(
    groupObj.id ||
    data.groupId ||
    data.group_id ||
    extractGroupId(groupObj.url || groupObj.link || '') ||
    extractGroupId(canonicalUrl || '') || ''
  );

  const reactObj  = data.reactions || {};
  const reactions = Number(
    reactObj.total ?? reactObj.count ??
    data.reactionsCount ?? data.likesCount ??
    data.likes ?? data.reactionCount ?? 0
  );

  return { canonicalUrl, parsedAuthor, groupId, reactions };
}

// ═════════════════════════════════════════════════════════════════════
//  الجزء الثاني — ميزة اللاعبين
// ═════════════════════════════════════════════════════════════════════

async function handleKoinezNashr(api, event) {
  const { threadID, senderID, messageID } = event;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api,
      `╮───∙⋆⋅「 خطأ 」\n│ › أنت غير مسجل في اللعبة ❌\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    return;
  }

  const tokens = await getApifyTokens();
  if (!tokens.filter(t => !t.disabled).length) {
    await sendReply(api,
      `╮───∙⋆⋅「 غير متاح ⚠️ 」\n│ › هذه الميزة غير متاحة حالياً\n│ › تواصل مع الأدمن\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    return;
  }

  const { minReactions, coinsPerReact } = await getSettings();

  const info = await sendReply(api,
    `؜╮───∙⋆⋅「 كوينز النشر 」\n` +
    `│ › ◍ طريقة الحصول على الكوينز من خلال النشر في مجموعة النضام\n` +
    `│ › ➊ قم بنشر منشور في مجموعة النضام ​❆ للحصول الى رابطها اكتب《 قروب 》\n` +
    `│ › ➋ انتظر حتى تحصل على تفاعل جيد في منشورك لان كل تفاعل على منشورك = ${coinsPerReact} كوينز \n` +
    `│ › ➌ بعدها قم بنسخ رابط منشورك ورد على هذه الرسالة برابط المنشور \n` +
    `│ › ⚠️  | يجب على منشورك ان يكون فيه ${minReactions} تفاعلات على الاقل \n` +
    `│ › ⚠️  يتم قبول كل منشور مرة واحدة ولا تحصل على كوينز منه مجددا\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    messageID, threadID);

  await setNashrSession(senderID, {
    step        : 'AWAITING_URL',
    botMessageId: info?.messageID || null,
    threadID,
  });
}

async function handleNashrReply(api, event, session) {
  const { threadID, senderID, messageID, body } = event;
  const text = (body || '').trim();

  await deleteNashrSession(senderID);

  if (!text.includes('facebook.com') && !text.includes('fb.com') && !text.includes('fb.watch')) {
    await sendReply(api,
      `╮───∙⋆⋅「 خطأ 」\n│ › الرابط غير صالح ❌\n│ › يجب أن يكون رابط منشور فيسبوك\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    return true;
  }

  reactTo(api, messageID, threadID, '⏳').catch(() => {});

  await sendReply(api,
    `╮───∙⋆⋅「 جاري الفحص ⏳ 」\n│ › يتم التحقق من منشورك، انتظر لحظة...\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    messageID, threadID);

  const { minReactions, coinsPerReact } = await getSettings();

  let postData;
  try {
    postData = await fetchPostFromApify(text);
  } catch (err) {
    console.error('[nashr] Apify error:', err.message);
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    const msg = (err.message === 'NO_TOKENS' || err.message === 'ALL_TOKENS_FAILED')
      ? `╮───∙⋆⋅「 خطأ 」\n│ › ❌ الخدمة غير متاحة حالياً\n│ › حاول مرة أخرى لاحقاً\n╯───────∙⋆⋅ ※ ⋅⋆∙`
      : `╮───∙⋆⋅「 خطأ 」\n│ › ❌ فشل في جلب بيانات المنشور\n│ › تأكد أن المنشور عام وحاول مجدداً\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
    await sendReply(api, msg, messageID, threadID);
    return true;
  }

  if (!postData) {
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    await sendReply(api,
      `╮───∙⋆⋅「 خطأ 」\n│ › ❌ لم يتم العثور على المنشور\n│ › تأكد أن الرابط صحيح وأن المنشور عام\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    return true;
  }

  const parsedPost = parseApifyPost(postData);
  const checkUrl   = normalizePostUrl(parsedPost.canonicalUrl || text);
  const systemGroupId = String(config.systemGroup || '');

  if (!parsedPost.groupId || parsedPost.groupId !== systemGroupId) {
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    await sendReply(api,
      `╮───∙⋆⋅「 مرفوض ❌ 」\n│ › المنشور ليس من مجموعة النضام الرسمية\n│ › اكتب《 قروب 》للحصول على رابط المجموعة\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    await _logAttempt(senderID, text, checkUrl, 'WRONG_GROUP', parsedPost.reactions);
    return true;
  }

  const senderInfo = await getUserFacebookInfo(api, senderID);

  let authorMatches = false;
  const senderIDStr = String(senderID).toLowerCase();
  const senderVanity = senderInfo?.vanity ? String(senderInfo.vanity).toLowerCase() : null;
  const senderName   = senderInfo?.name   ? String(senderInfo.name).toLowerCase().trim() : null;
  const parsedAuthor = parsedPost.parsedAuthor;

  const senderIdentifiers = new Set([senderIDStr]);
  if (senderVanity) senderIdentifiers.add(senderVanity);

  if (senderInfo?.profileUrl) {
    const parsedSender = parseProfileUrl(String(senderInfo.profileUrl));
    if (parsedSender.numericId) senderIdentifiers.add(parsedSender.numericId);
    if (parsedSender.username)  senderIdentifiers.add(parsedSender.username);
  }

  const authorIdentifiers = [
    parsedAuthor.numericId,
    parsedAuthor.id,
    parsedAuthor.username,
    parsedAuthor.urlUsername,
  ].filter(v => v && !/^pfbid/i.test(v))
   .map(v => String(v).toLowerCase());

  for (const authorId of authorIdentifiers) {
    if (senderIdentifiers.has(authorId)) {
      authorMatches = true;
      break;
    }
  }

  if (!authorMatches && senderName && parsedAuthor.name &&
      parsedAuthor.name === senderName) {
    authorMatches = true;
  }

  if (!authorMatches) {
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    await sendReply(api,
      `╮───∙⋆⋅「 مرفوض ❌ 」\n│ › المنشور ليس من حسابك\n│ › يجب أن تكون أنت ناشر المنشور\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    await _logAttempt(senderID, text, checkUrl, 'WRONG_AUTHOR', parsedPost.reactions);
    return true;
  }

  if (parsedPost.reactions < minReactions) {
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    await sendReply(api,
      `╮───∙⋆⋅「 مرفوض ❌ 」\n│ › منشورك لديه ${parsedPost.reactions} تفاعل فقط\n│ › ⚠️ يجب أن يكون لديك ${minReactions} تفاعلات على الأقل\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    await _logAttempt(senderID, text, checkUrl, 'LOW_REACTIONS', parsedPost.reactions);
    return true;
  }

  const existing = await getNashrPost(checkUrl);
  if (existing) {
    reactTo(api, messageID, threadID, '❌').catch(() => {});
    await sendReply(api,
      `╮───∙⋆⋅「 مرفوض ❌ 」\n│ › هذا المنشور سبق قبوله ولا يمكن استخدامه مجدداً\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      messageID, threadID);
    await _logAttempt(senderID, text, checkUrl, 'DUPLICATE', parsedPost.reactions);
    return true;
  }

  // ── تجاوز جميع الفحوصات ← منح الكوينز وزيادة عداد الترقيات ──
  const earned   = parsedPost.reactions * coinsPerReact;
  const player   = await getPlayer(senderID);
  const newCoins = (player?.coins || 0) + earned;
  const successfulNashrCount = (player?.successfulNashrCount || 0) + 1;

  await updatePlayer(senderID, { coins: newCoins, successfulNashrCount });
  await addNashrPost(checkUrl, senderID, parsedPost.reactions, earned);

  // 🆙 منح 10 XP للحصول على كوينز من منشور
  await addXP(senderID, 10, api, threadID).catch(() => {});

  // فحص شروط الترقية التلقائية للاعب فوراً
  try {
    const { checkAndApplyPromotions } = require('./ranks');
    await checkAndApplyPromotions(senderID, api, threadID);
  } catch (e) {
    console.error('[Nashr] Error checking promotion:', e);
  }

  try {
    const { recordNashrCoins } = require('./Mosaba9at');
    await recordNashrCoins(senderID, earned, player?.nickname || String(senderID));
  } catch (compErr) {
    console.error('[Competition] خطأ في تسجيل كوينز النشر بالمسابقة:', compErr);
  }

  reactTo(api, messageID, threadID, '✅').catch(() => {});
  await sendReply(api,
    `╮───∙⋆⋅「 تم القبول ✅ 」\n` +
    `│ › 🎉 تم قبول منشورك بنجاح!\n` +
    `│ › ◍ عدد التفاعلات    : ${parsedPost.reactions}\n` +
    `│ › 💰 الكوينز المكتسبة : ${earned} كوينز\n` +
    `│ › 💎 كوينزك الحالي   : ${newCoins} كوينز\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    messageID, threadID);

  return true;
}

async function _logAttempt(fbId, rawUrl, canonicalUrl, reason, reactions) {
  try {
    const { getDB } = require('./database');
    await getDB().collection('nashr_attempts').insertOne({
      fbId: String(fbId), rawUrl, canonicalUrl,
      reason, reactions: reactions || 0, createdAt: new Date(),
    });
  } catch (_) {}
}

// ═════════════════════════════════════════════════════════════════════
//  الجزء الثالث — لوحة الأدمن
// ═════════════════════════════════════════════════════════════════════

async function handleManshourat(api, event) {
  const { threadID, senderID } = event;

  const { getDB } = require('./database');
  const [accepted, rejected, tokens] = await Promise.all([
    getDB().collection('nashr_posts').countDocuments(),
    getDB().collection('nashr_attempts').countDocuments(),
    getApifyTokens(),
  ]);

  const activeT = tokens.filter(t => !t.disabled).length;

  const { minReactions, coinsPerReact } = await getSettings();

  await setAdminSession(senderID, { state: 'NASHR_MAIN' });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n` +
    `     ✦  إدارة المنشورات  ✦\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الإحصائيات 」\n` +
    `│ › ✅ مقبولة  : ${accepted}\n` +
    `│ › ❌ مرفوضة : ${rejected}\n` +
    `│ › 📊 الكل    : ${accepted + rejected}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 Apify 」\n` +
    `│ › التوكنات : ${tokens.length} (نشط: ${activeT})\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الإعدادات الحالية 」\n` +
    `│ › الحد الأدنى للتفاعلات : ${minReactions}\n` +
    `│ › الكوينز لكل تفاعل     : ${coinsPerReact}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n` +
    `│ 1 › إدارة التوكنات\n` +
    `│ 2 › إحصائيات مفصّلة\n` +
    `│ 3 › إعدادات النشر\n` +
    `│ 4 › خروج\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleManshouraatSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();

  if (text === 'خروج' || text === '4') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  if (session.state === 'NASHR_MAIN') {
    if (text === '1') { await _showTokensMenu(api, event);    return; }
    if (text === '2') { await _showDetailedStats(api, event); return; }
    if (text === '3') { await _showSettingsMenu(api, event);  return; }
    await sendMessage(api, `⚠️ اختر 1 أو 2 أو 3 أو 4`, threadID);
    return;
  }

  if (session.state === 'NASHR_SETTINGS_MAIN') {
    if (text === '1') {
      await setAdminSession(senderID, { state: 'NASHR_SETTINGS_MIN' });
      const { minReactions } = await getSettings();
      await sendMessage(api,
        `╮───∙⋆⋅「 الحد الأدنى للتفاعلات 」\n` +
        `│ › الحالي : ${minReactions}\n│\n` +
        `│ › أرسل الرقم الجديد\n│ › او 《 خروج 》\n` +
        `╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    if (text === '2') {
      await setAdminSession(senderID, { state: 'NASHR_SETTINGS_COINS' });
      const { coinsPerReact } = await getSettings();
      await sendMessage(api,
        `╮───∙⋆⋅「 الكوينز لكل تفاعل 」\n` +
        `│ › الحالي : ${coinsPerReact}\n│\n` +
        `│ › أرسل الرقم الجديد\n│ › او 《 خروج 》\n` +
        `╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    await sendMessage(api, `⚠️ اختر 1 أو 2 أو 《 خروج 》`, threadID);
    return;
  }

  if (session.state === 'NASHR_SETTINGS_MIN') {
    const num = parseInt(text, 10);
    if (isNaN(num) || num < 1) {
      await sendMessage(api, `⚠️ أدخل رقماً صحيحاً أكبر من 0`, threadID);
      return;
    }
    await updateNashrSettings({ minReactions: num });
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم التحديث ✅ 」\n│ › الحد الأدنى للتفاعلات أصبح : ${num}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  if (session.state === 'NASHR_SETTINGS_COINS') {
    const num = parseInt(text, 10);
    if (isNaN(num) || num < 1) {
      await sendMessage(api, `⚠️ أدخل رقماً صحيحاً أكبر من 0`, threadID);
      return;
    }
    await updateNashrSettings({ coinsPerReact: num });
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم التحديث ✅ 」\n│ › الكوينز لكل تفاعل أصبح : ${num}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  if (session.state === 'NASHR_TOKENS_MAIN') {
    if (text === '1') {
      await setAdminSession(senderID, { state: 'NASHR_TOKEN_ADD' });
      await sendMessage(api,
        `╮───∙⋆⋅「 إضافة توكن 」\n│ › أرسل توكن Apify\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }
    if (text === '2') { await _showTokensStatus(api, event);     return; }
    if (text === '3') { await _showTokenDeleteMenu(api, event);  return; }
    await sendMessage(api, `⚠️ اختر 1 أو 2 أو 3`, threadID);
    return;
  }

  if (session.state === 'NASHR_TOKEN_ADD') {
    if (!text || text.length < 10) {
      await sendMessage(api, `⚠️ التوكن قصير جداً، أعد المحاولة`, threadID);
      return;
    }

    await sendMessage(api,
      `╮───∙⋆⋅「 جاري التحقق ⏳ 」\n│ › يتم التحقق من التوكن...\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);

    const { me, limits } = await fetchApifyAccountInfo(text);
    if (!me) {
      await sendMessage(api,
        `╮───∙⋆⋅「 خطأ ❌ 」\n│ › التوكن غير صالح\n│ › أعد المحاولة أو اكتب 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }

    await addApifyToken(text, me.username || 'غير معروف');
    await deleteAdminSession(senderID);

    const plan    = me.plan       || {};
    const cur     = limits?.current || {};
    const lim     = limits?.limits  || {};
    const usedUsd = (cur.monthlyUsageUsd || 0).toFixed(3);
    const maxUsd  = (lim.maxMonthlyUsageUsd || plan.maxMonthlyUsageUsd || 0).toFixed(2);
    const credits = (plan.monthlyUsageCreditsUsd || 0).toFixed(2);
    const remain  = Math.max(0, parseFloat(credits) - parseFloat(usedUsd)).toFixed(3);

    await sendMessage(api,
      `╮───∙⋆⋅「 تمت الإضافة ✅ 」\n` +
      `│ › المستخدم    : ${me.username}\n` +
      `│ › الخطة       : ${plan.id || 'غير معروف'}\n` +
      `│ › الرصيد      : $${credits} / شهر\n` +
      `│ › المستهلك    : $${usedUsd}\n` +
      `│ › المتبقي     : $${remain}\n` +
      `│ › الحد الأقصى : $${maxUsd}\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  if (session.state === 'NASHR_TOKEN_DELETE') {
    const tokens = session.tokens || [];
    const idx    = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= tokens.length) {
      await sendMessage(api, `⚠️ رقم غير صحيح`, threadID);
      return;
    }
    const chosen = tokens[idx];
    await removeApifyToken(chosen._id);
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم الحذف 🗑️ 」\n│ › تم حذف توكن : ${chosen.username}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }
}

async function _showTokensMenu(api, event) {
  const { threadID, senderID } = event;
  const tokens = await getApifyTokens();
  const active  = tokens.filter(t => !t.disabled).length;

  await setAdminSession(senderID, { state: 'NASHR_TOKENS_MAIN' });
  await sendMessage(api,
    `╮───∙⋆⋅「 توكنات Apify 」\n` +
    `│ › الكل   : ${tokens.length}\n` +
    `│ › نشط    : ${active}\n` +
    `│ › معطّل  : ${tokens.length - active}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n` +
    `│ 1 › إضافة توكن جديد\n` +
    `│ 2 › عرض حالة التوكنات والرصيد\n` +
    `│ 3 › حذف توكن\n` +
    `│ › 《 خروج 》\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function _showTokensStatus(api, event) {
  const { threadID, senderID } = event;
  const tokens = await getApifyTokens();

  if (!tokens.length) {
    await sendMessage(api,
      `╮───∙⋆⋅「 التوكنات 」\n│ › لا يوجد توكنات مضافة بعد\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  await sendMessage(api,
    `╮───∙⋆⋅「 جاري جلب البيانات ⏳ 」\n│ › يتم جلب معلومات كل توكن...\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);

  let msg = `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦  حالة التوكنات  ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n`;

  for (let i = 0; i < tokens.length; i++) {
    const t      = tokens[i];
    const status = t.disabled ? '🔴 معطّل' : '🟢 نشط';
    try {
      const { me, limits } = await fetchApifyAccountInfo(t.token);
      if (me && limits) {
        const plan    = me.plan       || {};
        const cur     = limits.current  || {};
        const lim     = limits.limits   || {};
        const usedUsd = (cur.monthlyUsageUsd    || 0).toFixed(3);
        const maxUsd  = (lim.maxMonthlyUsageUsd || plan.maxMonthlyUsageUsd || 0).toFixed(2);
        const credits = (plan.monthlyUsageCreditsUsd || 0).toFixed(2);
        const remain  = Math.max(0, parseFloat(credits) - parseFloat(usedUsd)).toFixed(3);

        msg +=
          `╮───∙⋆⋅「 ${i + 1}. ${t.username} 」\n` +
          `│ › الحالة    : ${status}\n` +
          `│ › الخطة     : ${plan.id || '—'}\n` +
          `│ › الرصيد    : $${credits} / شهر\n` +
          `│ › المستهلك  : $${usedUsd}\n` +
          `│ › المتبقي     : $${remain}\n` +
          `│ › الحد      : $${maxUsd}\n` +
          `│ › فحوصات   : ${t.useCount || 0} مرة\n` +
          `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
      } else {
        msg +=
          `╮───∙⋆⋅「 ${i + 1}. ${t.username} 」\n` +
          `│ › الحالة   : ${status}\n` +
          `│ › ⚠️ فشل في جلب البيانات\n` +
          `│ › فحوصات  : ${t.useCount || 0} مرة\n` +
          `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
      }
    } catch (_) {
      msg +=
        `╮───∙⋆⋅「 ${i + 1}. ${t.username} 」\n` +
        `│ › الحالة   : ${status}\n` +
        `│ › ❌ خطأ في الاتصال\n` +
        `│ › فحوصات  : ${t.useCount || 0} مرة\n` +
        `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
    }
  }

  await setAdminSession(senderID, { state: 'NASHR_MAIN' });
  await sendMessage(api, msg.trimEnd(), threadID);
}

async function _showDetailedStats(api, event) {
  const { threadID, senderID } = event;
  const { getDB } = require('./database');

  const [accepted, wrongGroup, wrongAuthor, lowReactions, duplicate] = await Promise.all([
    getDB().collection('nashr_posts').countDocuments(),
    getDB().collection('nashr_attempts').countDocuments({ reason: 'WRONG_GROUP'   }),
    getDB().collection('nashr_attempts').countDocuments({ reason: 'WRONG_AUTHOR'  }),
    getDB().collection('nashr_attempts').countDocuments({ reason: 'LOW_REACTIONS' }),
    getDB().collection('nashr_attempts').countDocuments({ reason: 'DUPLICATE'     }),
  ]);
  const rejected = wrongGroup + wrongAuthor + lowReactions + duplicate;

  await setAdminSession(senderID, { state: 'NASHR_MAIN' });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n` +
    `   ✦  إحصائيات المنشورات  ✦\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الإجمالي 」\n` +
    `│ › ✅ مقبولة         : ${accepted}\n` +
    `│ › ❌ مرفوضة (كل)    : ${rejected}\n` +
    `│ › 📊 الكل           : ${accepted + rejected}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 أسباب الرفض 」\n` +
    `│ › قروب خاطئ        : ${wrongGroup}\n` +
    `│ › ناشر مختلف       : ${wrongAuthor}\n` +
    `│ › تفاعلات قليلة    : ${lowReactions}\n` +
    `│ › منشور مكرر       : ${duplicate}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function _showSettingsMenu(api, event) {
  const { threadID, senderID } = event;
  const { minReactions, coinsPerReact } = await getSettings();
  await setAdminSession(senderID, { state: 'NASHR_SETTINGS_MAIN' });
  await sendMessage(api,
    `╮───∙⋆⋅「 إعدادات النشر ⚙️ 」\n` +
    `│\n` +
    `│ › الحد الأدنى للتفاعلات : ${minReactions}\n` +
    `│ › الكوينز لكل تفاعل     : ${coinsPerReact}\n` +
    `│\n` +
    `│ 1 › تغيير الحد الأدنى للتفاعلات\n` +
    `│ 2 › تغيير الكوينز لكل تفاعل\n` +
    `│ › 《 خروج 》\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function _showTokenDeleteMenu(api, event) {
  const { threadID, senderID } = event;
  const tokens = await getApifyTokens();

  if (!tokens.length) {
    await sendMessage(api,
      `╮───∙⋆⋅「 حذف توكن 」\n│ › لا يوجد توكنات لحذفها\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }

  let msg = `╮───∙⋆⋅「 حذف توكن 」\n│\n`;
  tokens.forEach((t, i) => {
    msg += `│ ${i + 1}. ${t.username} ${t.disabled ? '🔴' : '🟢'}\n`;
  });
  msg += `│\n│ › ارسل رقم التوكن للحذف\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;

  await setAdminSession(senderID, {
    state : 'NASHR_TOKEN_DELETE',
    tokens: tokens.map(t => ({ _id: String(t._id), username: t.username })),
  });
  await sendMessage(api, msg, threadID);
}

module.exports = {
  handleKoinezNashr,
  handleNashrReply,
  handleManshourat,
  handleManshouraatSession,
};