/*
 * world_cup.js — نظام كأس العالم 2026 الذكي
 */

const { getDB, registerActiveSession, checkAndRemoveFromCache, getPlayer } = require('./database');
const { sendReply } = require('./utils');

const H = '\u061C'; // الحرف الخفي لتنسيق النصوص العربي
const API_TOKEN = '27fbf65ddfcd4a12a13739cdcb17b441';

// الذاكرة المؤقتة لمنع حظر الحساب بسبب قيود الطلبات (Rate Limit)
const cache = {
  teams: null,
  teamsTimestamp: 0,
  matches: null,
  matchesTimestamp: 0
};

const CACHE_TTL_TEAMS = 12 * 60 * 60 * 1000; // 12 ساعة
const CACHE_TTL_MATCHES = 3 * 60 * 1000;      // 3 دقائق (مثالي لتحديث المباريات الجارية)

// قاموس مطابقة الأعلام والدول باللغتين العربية والإنجليزية
const COUNTRIES_DB = {
  'Saudi Arabia': { ar: 'السعودية', flag: '🇸🇦' },
  'Morocco': { ar: 'المغرب', flag: '🇲🇦' },
  'Egypt': { ar: 'مصر', flag: '🇪🇬' },
  'Tunisia': { ar: 'تونس', flag: '🇹🇳' },
  'Algeria': { ar: 'الجزائر', flag: '🇩🇿' },
  'Qatar': { ar: 'قطر', flag: '🇶🇦' },
  'France': { ar: 'فرنسا', flag: '🇫🇷' },
  'Argentina': { ar: 'الأرجنتين', flag: '🇦🇷' },
  'Brazil': { ar: 'البرازيل', flag: '🇧🇷' },
  'Spain': { ar: 'إسبانيا', flag: '🇪🇸' },
  'Germany': { ar: 'ألمانيا', flag: '🇩🇪' },
  'Portugal': { ar: 'البرتغال', flag: '🇵🇹' },
  'England': { ar: 'إنجلترا', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  'Italy': { ar: 'إيطاليا', flag: '🇮🇹' },
  'Belgium': { ar: 'بلجيكا', flag: '🇧🇪' },
  'Croatia': { ar: 'كرواتيا', flag: '🇭🇷' },
  'USA': { ar: 'أمريكا', flag: '🇺🇸' },
  'United States': { ar: 'أمريكا', flag: '🇺🇸' },
  'Mexico': { ar: 'المكسيك', flag: '🇲🇽' },
  'Canada': { ar: 'كندا', flag: '🇨🇦' },
  'Japan': { ar: 'اليابان', flag: '🇯🇵' },
  'South Korea': { ar: 'كوريا الجنوبية', flag: '🇰🇷' },
  'Senegal': { ar: 'السنغال', flag: '🇸🇳' },
  'Cameroon': { ar: 'الكاميرون', flag: '🇨🇲' },
  'Ghana': { ar: 'غانا', flag: '🇬🇭' },
  'Uruguay': { ar: 'أوروغواي', flag: '🇺🇾' },
  'Netherlands': { ar: 'هولندا', flag: '🇳🇱' },
  'Switzerland': { ar: 'سويسرا', flag: '🇨🇭' },
  'Denmark': { ar: 'الدنمارك', flag: '🇩🇰' },
  'Australia': { ar: 'أستراليا', flag: '🇦🇺' },
  'Poland': { ar: 'بولندا', flag: '🇵🇱' },
  'Ecuador': { ar: 'الإكوادور', flag: '🇪🇨' },
  'Iran': { ar: 'إيران', flag: '🇮🇷' },
  'Wales': { ar: 'ويلز', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
  'Costa Rica': { ar: 'كوستاريكا', flag: '🇨🇷' },
  'Serbia': { ar: 'صربيا', flag: '🇷🇸' }
};

const EMOJI_TO_COUNTRY = {
  '🇸🇦': 'Saudi Arabia', '🇲🇦': 'Morocco', '🇪🇬': 'Egypt', '🇹🇳': 'Tunisia',
  '🇩🇿': 'Algeria', '🇶🇦': 'Qatar', '🇫🇷': 'France', '🇦🇷': 'Argentina',
  '🇧🇷': 'Brazil', '🇪🇸': 'Spain', '🇩🇪': 'Germany', '🇵🇹': 'Portugal',
  '🏴󠁧󠁢󠁥󠁮󠁧󠁿': 'England', '🇮🇹': 'Italy', '🇧🇪': 'Belgium', '🇭🇷': 'Croatia',
  '🇺🇸': 'USA', '🇲🇽': 'Mexico', '🇨🇦': 'Canada', '🇯🇵': 'Japan',
  '🇰🇷': 'South Korea', '🇸🇳': 'Senegal', '🇨🇲': 'Cameroon', '🇬🇭': 'Ghana',
  '🇺🇾': 'Uruguay', '🇳🇱': 'Netherlands', '🇨🇭': 'Switzerland', '🇩🇰': 'Denmark',
  '🇦🇺': 'Australia', '🇵🇱': 'Poland', '🇪🇨': 'Ecuador', '🇮🇷': 'Iran',
  '🏴󠁧󠁢󠁷󠁬󠁳󠁿': 'Wales', '🇨🇷': 'Costa Rica', '🇷🇸': 'Serbia'
};

const ARABIC_INPUT_MAP = {
  'الجزائر': 'Algeria', 'جزائر': 'Algeria',
  'السعودية': 'Saudi Arabia', 'السعوديه': 'Saudi Arabia', 'سعودية': 'Saudi Arabia', 'سعوديه': 'Saudi Arabia', 'المملكة العربية السعودية': 'Saudi Arabia',
  'المغرب': 'Morocco', 'مغرب': 'Morocco',
  'مصر': 'Egypt',
  'تونس': 'Tunisia',
  'قطر': 'Qatar',
  'فرنسا': 'France',
  'الارجنتين': 'Argentina', 'الأرجنتين': 'Argentina',
  'البرازيل': 'Brazil',
  'اسبانيا': 'Spain', 'إسبانيا': 'Spain',
  'المانيا': 'Germany', 'ألمانيا': 'Germany',
  'البرتغال': 'Portugal',
  'انجلترا': 'England', 'إنجلترا': 'England',
  'ايطاليا': 'Italy', 'إيطاليا': 'Italy',
  'بلجيكا': 'Belgium',
  'كرواتيا': 'Croatia',
  'امريكا': 'USA', 'أمريكا': 'USA', 'الولايات المتحدة': 'USA',
  'المكسيك': 'Mexico',
  'كندا': 'Canada',
  'اليابان': 'Japan',
  'كوريا الجنوبية': 'South Korea', 'كوريا الجنوبيه': 'South Korea',
  'السنغال': 'Senegal',
  'الكاميرون': 'Cameroon',
  'غانا': 'Ghana',
  'اوروغواي': 'Uruguay', 'أوروغواي': 'Uruguay',
  'هولندا': 'Netherlands',
  'سويسرا': 'Switzerland',
  'الدنمارك': 'Denmark',
  'استراليا': 'Australia', 'أستراليا': 'Australia',
  'بولندا': 'Poland',
  'الاكوادور': 'Ecuador', 'الإكوادور': 'Ecuador',
  'ايران': 'Iran', 'إيران': 'Iran',
  'ويلز': 'Wales',
  'كوستاريكا': 'Costa Rica',
  'صربيا': 'Serbia'
};

const STAGE_TRANSLATIONS = {
  'GROUP_STAGE': 'دور المجموعات 🏟️',
  'ROUND_OF_16': 'دور الـ 16 🏆',
  'LAST_16': 'دور الـ 16 🏆',
  'QUARTER_FINALS': 'دور ربع النهائي ✨',
  'SEMI_FINALS': 'دور نصف النهائي 🔥',
  'THIRD_PLACE': 'مباراة تحديد المركز الثالث 🥉',
  'FINAL': 'المباراة النهائية 👑'
};

function normalizeArabic(text) {
  if (!text) return '';
  return text
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

function findCountryByInput(input) {
  const cleanInput = input.trim();
  
  if (EMOJI_TO_COUNTRY[cleanInput]) {
    return EMOJI_TO_COUNTRY[cleanInput];
  }
  
  for (const emoji of Object.keys(EMOJI_TO_COUNTRY)) {
    if (cleanInput.includes(emoji)) {
      return EMOJI_TO_COUNTRY[emoji];
    }
  }

  const normalized = normalizeArabic(cleanInput);
  if (ARABIC_INPUT_MAP[normalized]) {
    return ARABIC_INPUT_MAP[normalized];
  }

  for (const [key, value] of Object.entries(ARABIC_INPUT_MAP)) {
    if (normalized.includes(normalizeArabic(key))) {
      return value;
    }
  }
  return null;
}

async function getWCTeams() {
  const now = Date.now();
  if (cache.teams && (now - cache.teamsTimestamp < CACHE_TTL_TEAMS)) {
    return cache.teams;
  }
  try {
    const response = await fetch('https://api.football-data.org/v4/competitions/WC/teams', {
      headers: { 'X-Auth-Token': API_TOKEN }
    });
    if (!response.ok) throw new Error('API Error');
    const data = await response.json();
    cache.teams = data.teams || [];
    cache.teamsTimestamp = now;
    return cache.teams;
  } catch (e) {
    console.error('[WC API] خطأ أثناء جلب المنتخبات:', e.message);
    return cache.teams || [];
  }
}

async function getWCMatches() {
  const now = Date.now();
  if (cache.matches && (now - cache.matchesTimestamp < CACHE_TTL_MATCHES)) {
    return cache.matches;
  }
  try {
    const response = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': API_TOKEN }
    });
    if (!response.ok) throw new Error('API Error');
    const data = await response.json();
    cache.matches = data.matches || [];
    cache.matchesTimestamp = now;
    return cache.matches;
  } catch (e) {
    console.error('[WC API] خطأ أثناء جلب المباريات:', e.message);
    return cache.matches || [];
  }
}

function getArabicName(englishName) {
  const c = COUNTRIES_DB[englishName];
  return c ? `${c.ar} ${c.flag}` : englishName;
}

function getArabicNameOnly(englishName) {
  const c = COUNTRIES_DB[englishName];
  return c ? c.ar : englishName;
}

function getFlag(englishName) {
  const c = COUNTRIES_DB[englishName];
  return c ? c.flag : '🏳️';
}

async function getWorldCupSession(fbId) {
  return await getDB().collection('world_cup_sessions').findOne({ fbId: String(fbId) });
}

async function setWorldCupSession(fbId, data) {
  registerActiveSession(fbId);
  await getDB().collection('world_cup_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteWorldCupSession(fbId) {
  await getDB().collection('world_cup_sessions').deleteOne({ fbId: String(fbId) });
  await checkAndRemoveFromCache(fbId);
}

async function subscribeWorldCup(fbId) {
  await getDB().collection('world_cup_subscribers').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), subscribedAt: new Date() } },
    { upsert: true }
  );
}

async function handleWorldCupCommand(api, event) {
  const { senderID, threadID, messageID } = event;
  const player = await getPlayer(senderID);

  if (!player) {
    await sendReply(api, `𓆫─━━࿇━━━──━━━࿇━━─𓆫\n              『 تنبيه ⚠ 』\n\nيجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام\n\n     𓆫─━━࿇━━━──━━━࿇━━─𓆫`, messageID, threadID);
    return;
  }

  await setWorldCupSession(senderID, { step: 'AWAITING_COUNTRY' });
  await sendReply(api, `مرحبا [ ${player.nickname} ] من فضلك ارسل اسم او اموجي علم بلدك لرؤية تفاصيل منتخبك في البطولة 🏆`, messageID, threadID);
}

async function handleWorldCupSession(api, event, session) {
  const { senderID, threadID, messageID, body } = event;
  const text = (body || '').trim();

  const englishName = findCountryByInput(text);
  if (!englishName) {
    await deleteWorldCupSession(senderID);
    await sendReply(api, `للاسف بلدك لم تتأهل لبطولة كأس العالم 2026 💔`, messageID, threadID);
    return true;
  }

  const qualifiedTeams = await getWCTeams();
  const teamObj = qualifiedTeams.find(t => 
    t.name.toLowerCase() === englishName.toLowerCase() ||
    t.shortName.toLowerCase() === englishName.toLowerCase()
  );

  if (!teamObj) {
    await deleteWorldCupSession(senderID);
    await sendReply(api, `للاسف بلدك لم تتأهل لبطولة كأس العالم 2026 💔`, messageID, threadID);
    return true;
  }

  const allMatches = await getWCMatches();
  const teamMatches = allMatches.filter(m => m.homeTeam.id === teamObj.id || m.awayTeam.id === teamObj.id);

  if (teamMatches.length === 0) {
    await deleteWorldCupSession(senderID);
    await sendReply(api, `ℹ️ لا توجد مباريات جارية أو مجدولة مسجلة لهذا المنتخب حالياً.`, messageID, threadID);
    return true;
  }

  const activeMatches = teamMatches.filter(m => !['FINISHED', 'CANCELLED'].includes(m.status));
  const finishedMatches = teamMatches.filter(m => m.status === 'FINISHED');

  if (activeMatches.length === 0 && finishedMatches.length > 0) {
    const isTournamentRunning = allMatches.some(m => !['FINISHED', 'CANCELLED'].includes(m.status));

    if (isTournamentRunning) {
      const sortedFinished = [...finishedMatches].sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));
      const lastMatch = sortedFinished[0];
      const stageName = STAGE_TRANSLATIONS[lastMatch.stage] || lastMatch.stage;
      
      await deleteWorldCupSession(senderID);
      await sendReply(api, `للاسف، تم إقصاء ${getArabicName(englishName)} من البطولة في دور [ ${stageName} ]. 💔`, messageID, threadID);
      return true;
    }
  }

  const sortedActive = [...activeMatches].sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  const nextMatch = sortedActive[0] || finishedMatches[finishedMatches.length - 1];

  const isHome = nextMatch.homeTeam.id === teamObj.id;
  const opponentName = isHome ? nextMatch.awayTeam.name : nextMatch.homeTeam.name;

  const matchDate = new Date(nextMatch.utcDate);
  const dateStr = matchDate.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
  const timeStrMecca = matchDate.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Riyadh' });
  const timeStrMaghreb = matchDate.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Algiers' });

  const isLive = ['IN_PLAY', 'PAUSED', 'LIVE'].includes(nextMatch.status);
  const statusText = isLive ? 'يجري الان 🔴' : 'لم يبدأ بعد ⏳';

  let scoreLine = '';
  if (isLive) {
    const homeScore = nextMatch.score.fullTime.home ?? 0;
    const awayScore = nextMatch.score.fullTime.away ?? 0;
    scoreLine = `📊 النتيجة الحالية:\n${getArabicName(nextMatch.homeTeam.name)} [ ${homeScore} ] - [ ${awayScore} ] ${getArabicName(nextMatch.awayTeam.name)}\n`;
  }

  const headerMsg = 
    `${H}╗══════════════════╔\n` +
    `          🏆 [ كأس العالم 2026  ] 🏆\n` +
    `╝══════════════════╚\n` +
    `📅 المباريات القادمة لبلدك : ${getFlag(englishName)}\n\n` +
    `⚽ ${getArabicName(englishName)} 🆚 ${getArabicName(opponentName)}\n` +
    `🕒 ${dateStr} - الساعة ${timeStrMecca} (مكة) / ${timeStrMaghreb} (المغرب)\n` +
    `📌 الحالة  : ${statusText}\n` +
    `${scoreLine}` +
    `━━━━━━━━━━━━━━━━━━━━`;

  const footerMsg = 
    `${H}━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ للحصول على اشعارات بشأن بدأ المباريات والاهداف  والنتيجة رد على هذه الرسالة بكلمة 《 اشعار 》\n` +
    `⚠️ ارسل كلمة 《مباريات》  لعرض جميع المباريات الجارية الان\n` +
    `⚠️ ارسل كلمة  《 كأس 》 لعرض جميع المباريات القادمة والتوقيت بالنسبة لبلدك\n` +
    `🔥 نتمنى التوفيق لـ ${getArabicName(englishName)}\n` +
    `━━━━━━━━━━━━━━━━━━━━`;

  await deleteWorldCupSession(senderID);
  
  await sendReply(api, headerMsg, messageID, threadID);
  await sendReply(api, footerMsg, messageID, threadID);

  return true;
}

async function handleLiveMatches(api, event) {
  const { threadID, messageID } = event;
  const matches = await getWCMatches();
  const live = matches.filter(m => ['IN_PLAY', 'PAUSED', 'LIVE'].includes(m.status));

  if (live.length === 0) {
    await sendReply(api, `${H}ℹ️ لا توجد مباريات جارية حالياً في بطولة كأس العالم.`, messageID, threadID);
    return;
  }

  let msg = `${H}🔴 المباريات الجارية الآن في كأس العالم 2026:\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  for (const m of live) {
    const home = getArabicName(m.homeTeam.name);
    const away = getArabicName(m.awayTeam.name);
    const hs = m.score.fullTime.home ?? 0;
    const as = m.score.fullTime.away ?? 0;
    msg += `⚽ ${home} [ ${hs} ] 🆚 [ ${as} ] ${away}\n`;
    msg += `🕒 الدقيقة: ${m.minute || 'الآن'}\n`;
    msg += `-------------------\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━━━`;
  await sendReply(api, msg, messageID, threadID);
}

async function handleUpcomingMatches(api, event) {
  const { threadID, messageID } = event;
  const matches = await getWCMatches();
  const upcoming = matches.filter(m => ['SCHEDULED', 'TIMED'].includes(m.status))
                          .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));

  if (upcoming.length === 0) {
    await sendReply(api, `${H}ℹ️ لا توجد مباريات قادمة مجدولة حالياً.`, messageID, threadID);
    return;
  }

  let msg = `${H}📅 المباريات القادمة في كأس العالم 2026:\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  
  const nextMatches = upcoming.slice(0, 5);
  for (const m of nextMatches) {
    const home = getArabicName(m.homeTeam.name);
    const away = getArabicName(m.awayTeam.name);
    const matchDate = new Date(m.utcDate);
    const dateStr = matchDate.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' });
    const timeStrMecca = matchDate.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Riyadh' });
    
    msg += `⚽ ${home} 🆚 ${away}\n`;
    msg += `🕒 ${dateStr} الساعة ${timeStrMecca} (مكة)\n`;
    msg += `-------------------\n`;
  }
  msg += `━━━━━━━━━━━━━━━━━━━━`;
  await sendReply(api, msg, messageID, threadID);
}

module.exports = {
  getWorldCupSession,
  handleWorldCupCommand,
  handleWorldCupSession,
  deleteWorldCupSession,
  subscribeWorldCup,
  handleLiveMatches,
  handleUpcomingMatches
};