/*
 * ═══════════════════════════════════════════════════════════════════════
 *  dakhil.js — نظام كشف الدخلاء والترحيب بالوافدين الجدد للممالك (معدل)
 * ═══════════════════════════════════════════════════════════════════════
 */

const { getPlayer, getPermanentBan, updatePlayer, getDB } = require('./database');
const { getKingdomByThreadId, getCityByThreadId, kingdomNamesAr, sendMessage, H } = require('./utils');
const config = require('./config.json');

// دالة مساعدة للتحقق من الأدمن بشكل آمن بدون circular dependency
function checkIsAdmin(fbId) {
  try {
    return require('./admin').isAdmin(String(fbId));
  } catch (e) {
    return false;
  }
}

async function getGroupAdmins(api, threadID) {
  return new Promise((resolve) => {
    try {
      api.getThreadInfo(threadID, (err, info) => {
        if (err || !info) return resolve([]);
        const admins = (info.adminIDs || []).map(a => String(a.id || a));
        resolve(admins);
      });
    } catch (e) {
      resolve([]);
    }
  });
}

async function getUserName(api, fbId) {
  return new Promise((resolve) => {
    try {
      api.getUserInfo([String(fbId)], (err, data) => {
        if (err || !data || !data[String(fbId)]) return resolve(null);
        resolve(data[String(fbId)].name || null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function getFormattedDate() {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = now.getFullYear();
  return `${d}/${m}/${y}`;
}

function buildAlertMessage(intruderDisplay, intruderKingdom, adderDisplay, adderWarned) {
  let msg =
    `${H}¤   🚨┃⚠️ تـــنـــبـــيـــه ⚠️┃🚨   ¤\n` +
    `╮━━━━━━━━━━━━━━━━━━╭\n` +
    `    ⛔ تم رصد دخيل من مملكة اخرى\n \n` +
    `╞═════ ⋘ التقرير ⋙ ═════╡\n` +
    `✦ الدخيل ↜⟦ ${intruderDisplay} ⟧\n` +
    `✦ مملكته ↜⟦ ${intruderKingdom} ⟧\n`;
  if (adderDisplay) {
    msg += `✦ من اضافه ↜⟦ ${adderDisplay} ⟧\n`;
  }
  if (adderWarned) {
    msg += `✦ الحالة ↜⟦ تلقى المُضيف إنذاراً 🚨 ⟧\n`;
  }
  msg += `╯━━━━━━━━━━━━━━━━━━━╰`;
  return msg;
}

// إرسال إشعار دائم لمن أضاف الدخيل، يظهر له لاحقاً عبر نظام الإشعارات (isharat.js)
async function notifyAdderWarned(adderId, intruderDisplay, intruderKingdomAr) {
  try {
    const db = getDB();
    await db.collection('notifications').insertOne({
      fbId: String(adderId),
      message: `⚠️ لقد قمت بإضافة دخيل ⟦ ${intruderDisplay} ⟧ من مملكة ⟦ ${intruderKingdomAr} ⟧ إلى قروب لا يخصه، وتلقيت إنذاراً بسبب ذلك 🚨`,
      createdAt: new Date(),
      sent: false
    });
  } catch (e) {
    console.error('فشل إرسال إشعار الإنذار للمُضيف:', e.message);
  }
}

function buildWrongCityMessage(nickname, kingdomAr) {
  return `𒂭━══════════════━𒂭
         『 موقع  خاطئ ⚠️』      

ايها اللاعب ${nickname}  انت في مملكة ${kingdomAr} لاكنك في مدينة اخرى وليس لديك ترخيص للتواجد هنا 
   
𒂭━══════════════━𒂭`;
}

function buildWelcomeMessage(kingdom, userName, dateStr, adderName) {
  let headerDeco = '';
  if (kingdom === 'murdak') {
    headerDeco = `╗═━────༺☠༻────━═╔\n          ⌬ 𝙈𝙊𝙍𝘿𝘼𝙆 𝙆𝑰𝙉𝙂𝘿𝙊𝙈 ⌬\n╝═━────༺☠༻────━═╚`;
  } else if (kingdom === 'solfare') {
    headerDeco = `╗═━────༺☀༻────━═╔\n          ⌬ 𝙎𝙊𝙇𝙑𝘼𝙍𝘼 𝙆𝙄𝙉𝙂𝘿𝙊𝙈 ⌬\n╝═━────༺☀༻────━═╚`;
  } else if (kingdom === 'niravil') {
    headerDeco = `╗═━────༺✨༻────━═╔\n          ⌬ 𝙉𝑰𝙍𝘼𝙑𝑰𝙇 𝙆𝙄𝙉𝙂𝘿𝙊𝙈 ⌬\n╝═━────༺✨༻────━═╚`;
  } else {
    headerDeco = `╗═━────༺✨༻────━═╔\n          ⌬ ${kingdom.toUpperCase()} KINGDOM ⌬\n╝═━────༺✨༻────━═╚`;
  }

  return `${H}${headerDeco}\n` +
         `✧ 𓆩 تــــــــــــــرحــــــــــــــيــــــــــــــب 𓆪 ✧\n\n` +
         `؜╮∙⋆⋅「 ${userName} 」\n` +
         `│ › تاريخ الانضمام  ◄ ${dateStr}\n` +
         `│ › اضافه  ◄ ${adderName}\n` +
         `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
         `اهلا بك ايها المجند دخولك عالم نيكسوس ليس صدفة اكتب " تسجيل " ، ابدء مغامرتك وانقش اسمك على اعالي الامبراطورية \n` +
         `───────∙⋆⋅ ※ ⋅⋆∙───────\n` +
         `✦ للتسجيل في النضام اكتب " تسجيل "\n` +
         `✦ يمكنك سؤال المساعد الذكي عن اي شيئ بالنضام بكتابة " المساعد "\n` +
         `───────∙⋆⋅ ※ ⋅⋆∙───────`;
}

async function kickUser(api, fbId, threadID) {
  return new Promise((resolve) => {
    try {
      api.removeUserFromGroup(String(fbId), threadID, (err) => {
        resolve(!err);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

// ===== كشف الدخيل والترحيب بالجدد عند الانضمام =====

async function handleIntruderJoin(api, event, botId) {
  const { threadID, author } = event;

  let groupKingdom = getKingdomByThreadId(threadID);
  let cityDoc = null;
  if (!groupKingdom) {
    cityDoc = await getCityByThreadId(threadID);
    if (cityDoc) groupKingdom = cityDoc.kingdom;
  }
  if (!groupKingdom) return;

  const admins = await getGroupAdmins(api, threadID);

  let addedIDs = [];
  if (event.logMessageData && Array.isArray(event.logMessageData.addedParticipants)) {
    addedIDs = event.logMessageData.addedParticipants.map(p => String(p.userFbId || p.user_id));
  }

  for (const pidStr of addedIDs) {
    if (pidStr === String(botId)) continue;
    if (admins.includes(pidStr)) continue;
    if (checkIsAdmin(pidStr)) continue;

    const player = await getPlayer(pidStr);

    if (player) {
      // 🛡️ استثناء الإمبراطور ونائبه من فحص الطرد والدخلاء عند الانضمام
      if (player.rank === 'الامبراطور' || player.rank === 'نائب الامبراطور') {
        continue;
      }

      if (player.kingdom !== groupKingdom) {
        const intruderDisplay = player.nickname;
        const intruderKingdom = kingdomNamesAr[player.kingdom] || player.kingdom;

        // تحديد من قام بإضافة الدخيل (إن وجد) — هو من يتحمل الإنذار وليس الدخيل
        const authorStr = author ? String(author) : null;
        let adderDisplay = 'انضم بنفسه';
        let adderPlayer = null;
        if (authorStr && authorStr !== pidStr) {
          adderPlayer = await getPlayer(authorStr).catch(() => null);
          const fbName = await getUserName(api, authorStr);
          adderDisplay = fbName || authorStr;
        }

        // إذا كان المُضيف لاعباً مسجلاً (وليس أدمن مُعفى)، يتلقى هو الإنذار والإشعار
        let adderWarned = false;
        if (adderPlayer && !checkIsAdmin(authorStr)) {
          const adderWarnings = (adderPlayer.warnings || 0) + 1;
          await updatePlayer(authorStr, { warnings: adderWarnings });
          try {
            const { changePlayerNickname } = require('./dukhul');
            await changePlayerNickname(api, threadID, authorStr, adderPlayer.nickname, adderPlayer.rank || 'مجند', adderPlayer.class, adderWarnings);
          } catch (nickErr) {
            console.error('فشل تحديث لقب المُضيف بعد الإنذار:', nickErr.message);
          }
          await notifyAdderWarned(authorStr, intruderDisplay, intruderKingdom);
          adderWarned = true;
        }

        await sendMessage(api, buildAlertMessage(intruderDisplay, intruderKingdom, adderDisplay, adderWarned), threadID);
        const kicked = await kickUser(api, pidStr, threadID);
        if (kicked) await sendMessage(api, `${H}تم طرد الدخيل بنجاح ✅️`, threadID);

      } else if (cityDoc) {
        const playerRegThread = player.registeredThreadId || null;
        const isThisCity = playerRegThread === String(threadID);

        // أي لاعب — سواء من العاصمة (بلا مدينة مسجلة) أو من مدينة أخرى —
        // لا يُسمح له بدخول قروب مدينة غير مدينته المسجلة (طرد بدون إنذار)
        if (!isThisCity) {
          await sendMessage(api, buildWrongCityMessage(player.nickname, kingdomNamesAr[groupKingdom]), threadID);
          const kicked = await kickUser(api, pidStr, threadID);
          if (kicked) await sendMessage(api, `${H}تم طرد اللاعب من المدينة ✅️`, threadID);
        }
      }
    } else {
      // العضو الجديد غير المسجّل — الترحيب يتولاه dukhul.js (handlePlayerJoinSubscribe)
      const ban = await getPermanentBan(pidStr);
      if (ban) {
        await kickUser(api, pidStr, threadID);
      }
    }
  }
}

// ===== كشف الدخيل عبر الرسائل =====

async function handleIntruderMessage(api, event, player, groupKingdom) {
  const { threadID, senderID } = event;

  if (checkIsAdmin(String(senderID))) return false;

  const admins = await getGroupAdmins(api, threadID);
  if (admins.includes(String(senderID))) return false;

  // 🛡️ استثناء الإمبراطور ونائبه من فحص الدخلاء والطرد عند التفاعل بالرسائل
  if (player.rank === 'الامبراطور' || player.rank === 'نائب الامبراطور') {
    return false;
  }

  if (player.kingdom !== groupKingdom) {
    // لا يتلقى الدخيل نفسه إنذاراً هنا؛ لم يعُد بالإمكان تحديد من أضافه في هذه المرحلة (رسالة لاحقة وليست انضمام)
    const intruderDisplay = player.nickname;
    const intruderKingdom = kingdomNamesAr[player.kingdom] || player.kingdom;
    await sendMessage(api, buildAlertMessage(intruderDisplay, intruderKingdom, null), threadID);
    const kicked = await kickUser(api, String(senderID), threadID);
    if (kicked) await sendMessage(api, `${H}تم طرد الدخيل بنجاح ✅️`, threadID);
    return true;
  }

  const cityDoc = await getCityByThreadId(threadID);
  if (cityDoc) {
    const playerRegThread = player.registeredThreadId || null;
    const isThisCity = playerRegThread === String(threadID);
    // أي لاعب — سواء من العاصمة (بلا مدينة مسجلة) أو من مدينة أخرى —
    // لا يُسمح له بالتفاعل في قروب مدينة غير مدينته المسجلة (طرد بدون إنذار)
    if (!isThisCity) {
      await sendMessage(api, buildWrongCityMessage(player.nickname, kingdomNamesAr[groupKingdom]), threadID);
      const kicked = await kickUser(api, String(senderID), threadID);
      if (kicked) await sendMessage(api, `${H}تم طرد اللاعب من المدينة ✅️`, threadID);
      return true;
    }
  }

  return false;
}

module.exports = { handleIntruderJoin, handleIntruderMessage };