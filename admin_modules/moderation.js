/*
 * ═══════════════════════════════════════════════════════════════════════
 *  moderation.js — نظام تعديل عقوبات الصمت والتجاهل والإنذارات للاعبين
 * ═══════════════════════════════════════════════════════════════════════
 */

const { sendMessage, sendReply, kingdomNamesAr, classSymbols } = require('../utils');
const { setAdminSession, deleteAdminSession, getAllPlayers, deletePlayer, addPermanentBan, getAllPermanentBans, removePermanentBan, getPlayer, updatePlayer } = require('../database');
const { resolveTarget, kickFromAllGroups } = require('./helpers');
const auth = require('./auth');
const config = require('../config.json');

const ADMIN_ID = String(config.adminId);

// الايدي المحمي (زوجة الامبراطور) — لا يجوز لأي شخص التحدث معه/الرد عليه دون إذن
const PROTECTED_WIFE_ID = '100067660825935';

global.mutedGroups = global.mutedGroups || {};

// تصفير وإزالة عقوبة كافة إنذارات اللاعب
async function handleEzalatIntharat(api, event, text) {
  const { threadID } = event;
  const query = text.replace(/^ازالة\s+الانذارات\s*/, '').replace(/^إزالة\s+الإنذارات\s*/, '').trim();
  
  let targetID = null;
  if (event.messageReply && event.messageReply.senderID) {
    targetID = String(event.messageReply.senderID);
  } else if (query) {
    const { player, fbId } = await resolveTarget(query, null);
    targetID = fbId;
  }
  
  if (!targetID) {
    await sendMessage(api, `❌ يرجى الرد على اللاعب أو تحديد لقبه/معرفه لإزالة إنذاراته.`, threadID);
    return;
  }
  
  const player = await getPlayer(targetID);
  if (!player) {
    await sendMessage(api, `❌ هذا اللاعب غير مسجل بنظام اللعبة حالياً.`, threadID);
    return;
  }
  
  await updatePlayer(targetID, { warnings: 0 });
  
  // تحديث وإرجاع كنيته الطبيعية بقروب مملكته (warnings: 0)
  const gid = config.groupes[player.kingdom];
  if (gid) {
    const { changePlayerNickname } = require('../dukhul');
    try {
      await changePlayerNickname(api, gid, targetID, player.nickname, player.rank || 'مجند', player.class, 0);
    } catch (e) {}
  }
  
  await sendMessage(api, `╮───∙⋆⋅「 إزالة الإنذارات 」\n│\n│ › ✅ تم تصفير وإزالة جميع إنذارات اللاعب: [${player.nickname}]\n│ › كنيته تم إرجاعها للوضع الطبيعي.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

// تفعيل وضع الصمت بالقروب الحالي مع تحديث الاسم بـ 🔇
async function handleMuteHere(api, event) {
  const { threadID } = event;
  global.mutedGroups = global.mutedGroups || {};
  global.mutedGroups[String(threadID)] = true;

  const db = require('../database').getDB();
  await db.collection('muted_groups').updateOne(
    { threadId: String(threadID) },
    { $set: { threadId: String(threadID), mutedAt: new Date() } },
    { upsert: true }
  );

  await sendMessage(api, `⚠️ وضع الصمت ⚠️\n\n■ ممنوع الكلام اي شخص يتكلم سيتم اضافة انذار له ⛔️`, threadID);

  try {
    api.getThreadInfo(threadID, (err, info) => {
      if (err || !info) return;
      const currentTitle = info.threadName || '';
      if (!currentTitle.includes('🔇')) {
        api.setTitle(`${currentTitle} 🔇`.trim(), threadID);
      }
    });
  } catch (e) {}
}

// تفعيل وضع الصمت بكافة قروبات الممالك معاً
async function handleMuteAll(api, event) {
  const { threadID } = event;
  const groupIds = Object.values(config.groupes);

  const db = require('../database').getDB();
  global.mutedGroups = global.mutedGroups || {};

  for (const gid of groupIds) {
    const stringGid = String(gid);
    global.mutedGroups[stringGid] = true;
    
    await db.collection('muted_groups').updateOne(
      { threadId: stringGid },
      { $set: { threadId: stringGid, mutedAt: new Date() } },
      { upsert: true }
    );

    await sendMessage(api, `⚠️ وضع الصمت ⚠️\n\n■ ممنوع الكلام اي شخص يتكلم سيتم اضافة انذار له ⛔️`, stringGid);

    try {
      api.getThreadInfo(stringGid, (err, info) => {
        if (err || !info) return;
        const currentTitle = info.threadName || '';
        if (!currentTitle.includes('🔇')) {
          api.setTitle(`${currentTitle} 🔇`.trim(), stringGid);
        }
      });
    } catch (e) {}
  }
  
  await sendMessage(api, `✅ تم تفعيل وضع الصمت وتحديث المجموعات للكل بنجاح.`, threadID);
}

// إلغاء وضع الصمت بالقروب الحالي
async function handleUnmuteHere(api, event) {
  const { threadID } = event;
  global.mutedGroups = global.mutedGroups || {};
  delete global.mutedGroups[String(threadID)];

  const db = require('../database').getDB();
  await db.collection('muted_groups').deleteOne({ threadId: String(threadID) });

  await sendMessage(api, `⚠️ تم الغاء وضع الصمت 🟩 ⚠️\nيمكنكم ارسال الرسائل مجددا ✅️`, threadID);

  try {
    api.getThreadInfo(threadID, (err, info) => {
      if (err || !info) return;
      const currentTitle = info.threadName || '';
      const newTitle = currentTitle.replace(/🔇/g, '').replace(/\s+/g, ' ').trim();
      if (currentTitle !== newTitle) {
        api.setTitle(newTitle, threadID);
      }
    });
  } catch (e) {}
}

// إلغاء وضع الصمت من كافة قروبات الممالك معاً
async function handleUnmuteAll(api, event) {
  const { threadID } = event;
  const groupIds = Object.values(config.groupes);

  const db = require('../database').getDB();
  global.mutedGroups = global.mutedGroups || {};

  for (const gid of groupIds) {
    const stringGid = String(gid);
    delete global.mutedGroups[stringGid];
    
    await db.collection('muted_groups').deleteOne({ threadId: stringGid });

    await sendMessage(api, `⚠️ تم الغاء وضع الصمت 🟩 ⚠️\nيمكنكم ارسال الرسائل مجددا ✅️`, stringGid);

    try {
      api.getThreadInfo(stringGid, (err, info) => {
        if (err || !info) return;
        const currentTitle = info.threadName || '';
        const newTitle = currentTitle.replace(/🔇/g, '').replace(/\s+/g, ' ').trim();
        if (currentTitle !== newTitle) {
          api.setTitle(newTitle, stringGid);
        }
      });
    } catch (e) {}
  }
  
  await sendMessage(api, `✅ تم إلغاء وضع الصمت من المجموعات للكل بنجاح.`, threadID);
}

async function handleMa3loomat(api, event, args) {
  const { threadID, senderID } = event;
  if (args && args.trim()) { await showPlayerInfo(api, event, args.trim()); return; }
  // إذا كان الأمر رداً على رسالة لاعب، اعرض معلوماته مباشرة
  if (event.messageReply && event.messageReply.senderID) { await showPlayerInfo(api, event, ''); return; }
  await setAdminSession(senderID, { state: 'MA3LOOMAT_MAIN' });
  await sendMessage(api,
    `╮───∙⋆⋅「 معلومات 」\n│\n│ › اختر المملكة :\n│ 1 › سولفارا\n│ 2 › نيرافيل\n│ 3 › مورداك\n│\n│ › او ارسل لقب لاعب\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleMa3looomatSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const kMap = { '1':'solfare','2':'niravil','3':'murdak' };
  if (kMap[text]) { await deleteAdminSession(senderID); await showKingdomPlayers(api, event, kMap[text]); return; }
  await deleteAdminSession(senderID); await showPlayerInfo(api, event, text);
}

async function showKingdomPlayers(api, event, kingdom) {
  const { threadID } = event;
  const players = await getAllPlayers(kingdom);
  if (!players || !players.length) { await sendMessage(api, `╮───∙⋆⋅「 ${kingdomNamesAr[kingdom]} 」\n│ › لا يوجد لاعبون مسجلون\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const sorted = players.sort((a, b) => (a.level || 1) - (b.level || 1));
  let msg = `╮───∙⋆⋅「 لاعبو ${kingdomNamesAr[kingdom]} 」\n│\n`;
  sorted.forEach((p, i) => { const sym = classSymbols[p.class] || '✹'; msg += `│ ${i + 1}. ${sym} ${p.nickname}\n│    ↳ مستوى ${p.level || 1} ┇ ${p.rank || 'مجند'}\n`; });
  msg += `│\n│ › الإجمالي : ${players.length} لاعب\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  await sendMessage(api, msg, threadID);
}

async function showPlayerInfo(api, event, query) {
  const { threadID } = event;
  const { player, fbId } = await resolveTarget(query, event);
  if (!player) { await sendMessage(api, `⚠️ لم يتم العثور على اللاعب : ${query || 'المستهدف'}`, threadID); return; }

  // جلب اسم حساب الفيسبوك
  let fbName = '—';
  try {
    const userInfo = await new Promise((resolve) => {
      api.getUserInfo(String(player.fbId), (err, info) => {
        resolve(err || !info ? null : (info[String(player.fbId)] || null));
      });
    });
    if (userInfo && userInfo.name) fbName = userInfo.name;
  } catch (e) {}

  // جلب لقب من دعاه إن كان مسجلاً
  let inviterText = 'لا أحد';
  if (player.invitedBy) {
    try {
      const inviter = await getPlayer(String(player.invitedBy));
      inviterText = inviter && inviter.nickname
        ? `${player.invitedBy} (${inviter.nickname})`
        : String(player.invitedBy);
    } catch (e) { inviterText = String(player.invitedBy); }
  }

  const sym = classSymbols[player.class] || '✹';
  const bag = (player.bag || []).map(i => `${i.name} x${i.quantity}`).join(', ') || 'فارغة';
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n  ✦ ملف اللاعب - أدمن ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 البيانات 」\n│ › اللقب     : ${player.nickname}\n│ › اسم الفيس : ${fbName}\n│ › المملكة   : ${kingdomNamesAr[player.kingdom] || player.kingdom}\n│ › الفئة     : ${player.class} ${sym}\n│ › الرتبة    : ${player.rank || 'مجند'}\n│ › المستوى   : ${player.level || 1}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الإحصائيات 」\n│ › HP          : ${player.hp || 1000}\n│ › EP          : ${player.ep || 1000}\n│ › الكوينز    : ${player.coins || 0}\n│ › رصيد البنك : ${player.bankBalance || 0}\n│ › الايدي     : ${player.fbId}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الحقيبة 」\n│ › ${bag}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 أخرى 」\n│ › دعاه    : ${inviterText}\n│ › التسجيل : ${player.registeredAt ? new Date(player.registeredAt).toLocaleDateString('ar') : 'غير محدد'}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleBayaat(api, event, targetText) {
  const { threadID, senderID } = event;
  if (!targetText && !event.messageReply) {
    await setAdminSession(senderID, { state: 'BAYAAT_TARGET' });
    await sendMessage(api, `╮───∙⋆⋅「 بانكاي 」\n│\n│ › ارسل لقب اللاعب او ايدي او رابط\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  const { player, fbId } = await resolveTarget(targetText, event);
  if (!fbId) { await sendMessage(api, `⚠️ لم يتم العثور على اللاعب`, threadID); return; }
  await kickFromAllGroups(api, fbId);
  const nickname = player ? player.nickname : fbId;
  await sendMessage(api, event.messageReply ? `⌯ اللاعب  › ${nickname}\n✧ بلع البانكاي بنجاح 🚮 ✅️` : `✧ بلع البانكاي بنجاح 🚮 ✅️`, threadID);
}

async function handleBayaatMoabad(api, event, targetText) {
  const { threadID, senderID } = event;
  if (!targetText && !event.messageReply) {
    await setAdminSession(senderID, { state: 'BAYAAT_MOABAD_TARGET' });
    await sendMessage(api, `╮───∙⋆⋅「 بانكاي مؤبد 」\n│\n│ › ارسل لقب اللاعب او ايدي او رابط\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  const { player, fbId } = await resolveTarget(targetText, event);
  if (!fbId) { await sendMessage(api, `⚠️ لم يتم العثور على اللاعب`, threadID); return; }
  const nickname = player ? player.nickname : fbId;
  await addPermanentBan(fbId, nickname);
  await kickFromAllGroups(api, fbId);
  if (player) await deletePlayer(fbId);
  await sendMessage(api, event.messageReply ? `⌯ اللاعب  › ${nickname}\n✧ بلع البانكاي بنجاح 🚮 ✅️\n⌯ الحظر › مؤبد 🔒` : `✧ بلع البانكاي بنجاح 🚮 ✅️\n⌯ الحظر › مؤبد 🔒`, threadID);
}

async function handleHadhfAdmin(api, event, targetText) {
  const { threadID, senderID } = event;
  if (!targetText && !event.messageReply) {
    await setAdminSession(senderID, { state: 'HADHF_TARGET' });
    await sendMessage(api, `╮───∙⋆⋅「 حذف لاعب 」\n│\n│ › ارسل لقب اللاعب او ايدي او رابط\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  const { player, fbId } = await resolveTarget(targetText, event);
  if (!fbId || !player) { await sendMessage(api, `⚠️ اللاعب غير موجود في قاعدة البيانات`, threadID); return; }
  await deletePlayer(fbId);
  await sendMessage(api, `╮───∙⋆⋅「 حذف اللاعب 」\n│\n│ › اللاعب : ${player.nickname}\n│ › تم حذف بياناته ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

async function handleHazar(api, event) {
  const { threadID, senderID } = event;
  const bans = await getAllPermanentBans();
  if (!bans || !bans.length) { await sendMessage(api, `╮───∙⋆⋅「 الحظر 」\n│\n│ › لا يوجد أي شخص محظور\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  let msg = `╮───∙⋆⋅「 المحظورون 」\n│\n`;
  bans.forEach((b, i) => { msg += `│ ${i + 1}. ${b.nickname}\n`; });
  msg += `│\n│ › ارسل رقم اللاعب لإلغاء حظره\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  await setAdminSession(senderID, { state: 'HAZAR_LIST', bans: bans.map(b => ({ fbId: b.fbId, nickname: b.nickname })) });
  await sendMessage(api, msg, threadID);
}

async function handleHazarSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const bans = session.bans || [], idx = parseInt(text, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= bans.length) { await sendMessage(api, `⚠️ رقم غير صحيح`, threadID); return; }
  await removePermanentBan(bans[idx].fbId);
  await deleteAdminSession(senderID);
  await sendMessage(api, `╮───∙⋆⋅「 إلغاء الحظر 」\n│\n│ › ${bans[idx].nickname}\n│ › تم رفع الحظر ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

// حماية زوجة الامبراطور: أي شخص يرد على رسالتها (غير الأدمن/الامبراطور) يُضاف له انذار تلقائياً
async function checkAndEnforceWarnings(api, fbId, nickname, kingdom, newWarnings) {
  if (newWarnings < 4) return false;

  const { getPermanentBan } = require('../database');
  const alreadyBanned = await getPermanentBan(String(fbId)).catch(() => null);
  if (alreadyBanned) return false;

  const banMsg =
    `⛔️─────『 ⚠️ 』─────⛔️\n` +
    `اللاعب : ${nickname}\n` +
    `وصلت 4 انذارات وهو الحد الاقصى لذلك سيتم طردك ومنعك من الدخول مجددا \n` +
    `تواصل مع الامبراطور للحصول على اذن الدخول مجددا https://www.facebook.com/profile.php?id=61591467243890\n` +
    `⛔️─────『 ⚠️ 』─────⛔️`;

  try {
    const groupId = kingdom ? config.groupes[kingdom] : null;
    if (groupId) await sendMessage(api, banMsg, String(groupId));
  } catch (e) {
    console.error('[EnforceWarnings] خطأ إرسال الرسالة:', e.message);
  }

  try {
    await kickFromAllGroups(api, String(fbId));
  } catch (e) {
    console.error('[EnforceWarnings] خطأ الطرد:', e.message);
  }

  try {
    await addPermanentBan(String(fbId), nickname);
  } catch (e) {
    console.error('[EnforceWarnings] خطأ الحظر الدائم:', e.message);
  }

  return true;
}

async function checkProtectedWifeReply(api, event, player) {
  const { threadID, senderID, messageReply } = event;

  if (!messageReply || !messageReply.senderID) return false;
  if (String(messageReply.senderID) !== PROTECTED_WIFE_ID) return false;
  if (String(senderID) === PROTECTED_WIFE_ID) return false;

  if (auth.isAdmin(senderID)) return false;
  if (player && player.rank === 'الامبراطور') return false;
  if (!player) return false;

  const newWarnings = (player.warnings || 0) + 1;
  await updatePlayer(String(senderID), { warnings: newWarnings });

  await sendReply(api,
    `؜╮───∙⋆⋅「 تنبيه ⚠️ 」\n│› تكلمت مع زوجة الامبراطور دون اذن ⛔️\n│ › تم اضافة انذار لك المرة القادمة سيتم طردك تلقائيا \n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    event.messageID, threadID);

  await checkAndEnforceWarnings(api, String(senderID), player.nickname, player.kingdom, newWarnings).catch(() => {});

  return true;
}

module.exports = {
  handleMa3loomat,
  handleMa3looomatSession,
  handleBayaat,
  handleBayaatMoabad,
  handleHadhfAdmin,
  handleHazar,
  handleHazarSession,
  handleEzalatIntharat,
  handleMuteHere,
  handleMuteAll,
  handleUnmuteHere,
  handleUnmuteAll,
  checkProtectedWifeReply,
  checkAndEnforceWarnings
};