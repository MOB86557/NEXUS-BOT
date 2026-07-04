/*
 * ═══════════════════════════════════════════════════════════════════════
 *  dakhil.js — نظام كشف الدخلاء والترحيب بالوافدين الجدد للممالك (معدل)
 * ═══════════════════════════════════════════════════════════════════════
 */

const { getPlayer, getPermanentBan, updatePlayer } = require('./database');
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

function buildAlertMessage(intruderDisplay, intruderKingdom, adderDisplay) {
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
  msg += `╯━━━━━━━━━━━━━━━━━━━╰`;
  return msg;
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
        // زيادة الإنذارات وتحديثها بقاعدة البيانات [3]
        const currentWarnings = (player.warnings || 0) + 1;
        await updatePlayer(pidStr, { warnings: currentWarnings });

        // تحديث كنية الدخيل في القروب لإظهار كرات الإنذار [1]
        try {
          const { changePlayerNickname } = require('./dukhul');
          await changePlayerNickname(api, threadID, pidStr, player.nickname, player.rank || 'مجند', player.class, currentWarnings);
        } catch (nickErr) {
          console.error('فشل تحديث لقب الدخيل عند الانضمام:', nickErr.message);
        }

        const intruderDisplay = player.nickname;
        const intruderKingdom = kingdomNamesAr[player.kingdom] || player.kingdom;
        let adderDisplay = 'انضم بنفسه';
        const authorStr = author ? String(author) : null;
        if (authorStr && authorStr !== pidStr) {
          const fbName = await getUserName(api, authorStr);
          adderDisplay = fbName || authorStr;
        }
        await sendMessage(api, buildAlertMessage(intruderDisplay, intruderKingdom, adderDisplay), threadID);
        const kicked = await kickUser(api, pidStr, threadID);
        if (kicked) await sendMessage(api, `${H}تم طرد الدخيل بنجاح ✅️ وتلقى إنذاراً جديداً 🚨`, threadID);

      } else if (cityDoc) {
        const playerCity = player.registeredCityName || null;
        const playerRegThread = player.registeredThreadId || null;
        const isCapital = !playerCity;
        const isThisCity = playerRegThread === String(threadID);

        if (!isCapital && !isThisCity) {
          // زيادة الإنذارات وتحديثها بقاعدة البيانات للمدينة الخاطئة [3]
          const currentWarnings = (player.warnings || 0) + 1;
          await updatePlayer(pidStr, { warnings: currentWarnings });

          // تحديث كنية اللاعب في القروب لإظهار كرات الإنذار [1]
          try {
            const { changePlayerNickname } = require('./dukhul');
            await changePlayerNickname(api, threadID, pidStr, player.nickname, player.rank || 'مجند', player.class, currentWarnings);
          } catch (nickErr) {
            console.error('فشل تحديث لقب اللاعب في المدينة الخاطئة:', nickErr.message);
          }

          await sendMessage(api, buildWrongCityMessage(player.nickname, kingdomNamesAr[groupKingdom]), threadID);
          const kicked = await kickUser(api, pidStr, threadID);
          if (kicked) await sendMessage(api, `${H}تم طرد اللاعب من المدينة ✅️ وتلقى إنذاراً جديداً 🚨`, threadID);
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
    // زيادة الإنذارات وتحديثها بقاعدة البيانات [3]
    const currentWarnings = (player.warnings || 0) + 1;
    await updatePlayer(String(senderID), { warnings: currentWarnings });

    // تحديث كنية الدخيل في القروب لإظهار كرات الإنذار [1]
    try {
      const { changePlayerNickname } = require('./dukhul');
      await changePlayerNickname(api, threadID, String(senderID), player.nickname, player.rank || 'مجند', player.class, currentWarnings);
    } catch (nickErr) {
      console.error('فشل تحديث لقب الدخيل عند التفاعل بالرسائل:', nickErr.message);
    }

    const intruderDisplay = player.nickname;
    const intruderKingdom = kingdomNamesAr[player.kingdom] || player.kingdom;
    await sendMessage(api, buildAlertMessage(intruderDisplay, intruderKingdom, null), threadID);
    const kicked = await kickUser(api, String(senderID), threadID);
    if (kicked) await sendMessage(api, `${H}تم طرد الدخيل بنجاح ✅️ وتلقى إنذاراً جديداً 🚨`, threadID);
    return true;
  }

  const cityDoc = await getCityByThreadId(threadID);
  if (cityDoc) {
    const playerRegThread = player.registeredThreadId || null;
    const playerCity = player.registeredCityName || null;
    const isCapital = !playerCity;
    const isThisCity = playerRegThread === String(threadID);
    if (!isCapital && !isThisCity) {
      // زيادة الإنذارات وتحديثها بقاعدة البيانات للمدينة الخاطئة [3]
      const currentWarnings = (player.warnings || 0) + 1;
      await updatePlayer(String(senderID), { warnings: currentWarnings });

      // تحديث كنية اللاعب في القروب لإظهار كرات الإنذار [1]
      try {
        const { changePlayerNickname } = require('./dukhul');
        await changePlayerNickname(api, threadID, String(senderID), player.nickname, player.rank || 'مجند', player.class, currentWarnings);
      } catch (nickErr) {
        console.error('فشل تحديث لقب اللاعب في المدينة الخاطئة (رسائل):', nickErr.message);
      }

      await sendMessage(api, buildWrongCityMessage(player.nickname, kingdomNamesAr[groupKingdom]), threadID);
      const kicked = await kickUser(api, String(senderID), threadID);
      if (kicked) await sendMessage(api, `${H}تم طرد اللاعب من المدينة ✅️ وتلقى إنذاراً جديداً 🚨`, threadID);
      return true;
    }
  }

  return false;
}

module.exports = { handleIntruderJoin, handleIntruderMessage };