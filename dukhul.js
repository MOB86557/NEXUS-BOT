const config = require('./config.json');
const { kingdomNames, kingdomNamesAr, getKingdomByThreadId, getKingdomByThreadIdFull, sendMessage } = require('./utils');

// ذاكرة تخزين مؤقت لتجميع طلبات الانضمام المتزامنة لتفادي إغراق الشات
const joinBuffers = new Map();

function getBotIdFromConfig() {
  const cookie = config.cookies.find(c => c.key === 'c_user');
  return cookie ? String(cookie.value) : null;
}

async function handleBotJoin(api, event) {
  const { threadID, participantIDs } = event;
  const botId = getBotIdFromConfig();

  console.log('📥 log:subscribe | threadID:', threadID, '| participantIDs:', participantIDs, '| botId:', botId);

  // تحقق إذا البوت هو من انضم
  if (!botId || (!participantIDs.includes(botId) && !participantIDs.includes(Number(botId)))) {
    console.log('⏩ البوت لم ينضم، تم التجاهل');
    return;
  }

  const kingdom = getKingdomByThreadId(threadID);
  console.log('🏰 kingdom:', kingdom);
  if (!kingdom) return;

  // تغيير كنية البوت
  try {
    await changeBotNickname(api, threadID, botId);
  } catch (e) {
    console.error('خطأ في تغيير الكنية:', e);
  }

  // إرسال رسالة الترحيب
  const welcomeMsg = buildWelcomeMessage(kingdom);
  await sendMessage(api, welcomeMsg, threadID);
}

function buildWelcomeMessage(kingdom) {
  const name = kingdomNames[kingdom];
  const nameAr = kingdomNamesAr[kingdom];

  return `◆━━━━━━━▷ ✦ ◁━━━━━━━◆
❖| 𝑵𝑬𝑿𝑼𝑺 𝑩𝑶𝑻 ┇بوت نضام نيكسوس
❖|    ${name}    ┇    مملكة ${nameAr} 
◆━━━━━━━▷ ✦ ◁━━━━━━━◆`;
}

async function changeBotNickname(api, threadID, botId) {
  return new Promise((resolve, reject) => {
    api.changeNickname(
      '𖣘┇𝑵𝑬𝑿𝑼𝑺 𝑩𝑶𝑻 ┇𖣘',
      threadID,
      String(botId),
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}

// تغيير كنية لاعب معين
async function changePlayerNickname(api, threadID, playerFbId, nickname, rank, playerClass, warnings, statusEmoji) {
  const { generateNickname } = require('./utils');
  let finalWarnings = warnings;
  if (finalWarnings === undefined) {
    try {
      const p = await require('./database').getPlayer(playerFbId);
      finalWarnings = p ? (p.warnings || 0) : 0;
    } catch (e) {
      finalWarnings = 0;
    }
  }
  let newNickname = generateNickname(nickname, rank, playerClass, finalWarnings);
  if (statusEmoji) {
    newNickname = `${newNickname} ${statusEmoji}`;
  }
  return new Promise((resolve, reject) => {
    api.changeNickname(newNickname, threadID, String(playerFbId), (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// تحديد قائمة القروبات الفعالة التي يتواجد بها اللاعب حالياً لتحديث كنيته فيها
async function getBroadcastThreadIds(api, playerFbId, defaultKingdom, defaultCity) {
  const db = require('./database').getDB();
  const config = require('./config.json');

  const kingdomGroupIds = Object.values(config.groupes).filter(Boolean).map(String);
  let cityGroupIds = [];
  try {
    const cities = await db.collection('cities').find().toArray();
    cityGroupIds = cities.map(c => String(c.threadId)).filter(Boolean);
  } catch (e) {}
  const allSystemGroups = [...new Set([...kingdomGroupIds, ...cityGroupIds])];

  const targetThreadIds = [];

  // 1. فحص كاش المجموعات لتحديد المجموعات التي يتواجد بها اللاعب فعلياً
  if (global.systemGroupMembers) {
    for (const gid of allSystemGroups) {
      if (global.systemGroupMembers[gid] && global.systemGroupMembers[gid].includes(String(playerFbId))) {
        targetThreadIds.push(gid);
      }
    }
  }

  // 2. نظام احتياطي مبني على رتبة اللاعب وقوانين توزيعه الافتراضية في حال لم يكتمل تحميل الكاش
  if (targetThreadIds.length === 0) {
    try {
      const player = await db.collection('players').findOne({ fbId: String(playerFbId) });
      const rank = player ? player.rank : 'متدرب';
      const kingdom = player ? player.kingdom : defaultKingdom;
      const registeredCityName = player ? player.registeredCityName : defaultCity;

      const EMPIRE_WIDE_RANKS = ['الامبراطور', 'نائب الامبراطور'];
      const KINGDOM_WIDE_RANKS = ['الحاكم', 'نائب الحاكم', 'جنرال'];

      if (EMPIRE_WIDE_RANKS.includes(rank)) {
        return allSystemGroups;
      }

      if (KINGDOM_WIDE_RANKS.includes(rank)) {
        if (kingdom && config.groupes[kingdom]) targetThreadIds.push(String(config.groupes[kingdom]));
        try {
          const cities = await db.collection('cities').find({ kingdom }).toArray();
          targetThreadIds.push(...cities.map(c => String(c.threadId)));
        } catch (e) {}
      } else {
        if (!registeredCityName || registeredCityName === 'العاصمة') {
          if (kingdom && config.groupes[kingdom]) targetThreadIds.push(String(config.groupes[kingdom]));
        } else {
          try {
            const cityDoc = await db.collection('cities').findOne({ kingdom, name: registeredCityName });
            if (cityDoc) targetThreadIds.push(String(cityDoc.threadId));
          } catch (e) {}
        }
      }
    } catch (e) {
      console.error('[Broadcast Nickname] Error during fallback resolution:', e.message);
    }
  }

  return [...new Set(targetThreadIds)];
}

// نشر تغيير كنية اللاعب على كل القروبات التي يتواجد بها فعلياً
async function broadcastPlayerNickname(api, player, statusEmoji) {
  if (!player || !player.fbId) return [];

  // التأكد من تحديث كاش تواجد الأعضاء قبل البث لتغطية كافة المجموعات الحالية بدقة
  const { updateSystemGroupMembersCache } = require('./admin_modules/protection');
  await updateSystemGroupMembersCache(api).catch(() => {});

  const threadIds = await getBroadcastThreadIds(api, player.fbId, player.kingdom, player.registeredCityName);

  for (const threadId of threadIds) {
    try {
      await changePlayerNickname(
        api,
        threadId,
        player.fbId,
        player.nickname,
        player.rank || 'مجند',
        player.class,
        player.warnings,
        statusEmoji
      );
    } catch (e) {
      console.error(`[Broadcast Nickname] Failed for thread ${threadId}:`, e.message);
    }
  }
  return threadIds;
}

// نظام الترحيب المجمّع والمفلتر للأعضاء الجدد
async function handlePlayerJoinSubscribe(api, event, BOT_ID) {
  const { threadID, participantIDs } = event;
  const botId = getBotIdFromConfig();

  // تصفية المعرفات واستبعاد حسابات البوت فقط — هؤلاء هم الجدد الفعليين
  const realNewPlayers = participantIDs.filter(
    id => String(id) !== String(botId) && String(id) !== String(BOT_ID)
  );
  if (realNewPlayers.length === 0) return;

  const kingdom = await getKingdomByThreadIdFull(threadID);
  if (!kingdom) return;

  if (!joinBuffers.has(threadID)) {
    joinBuffers.set(threadID, {
      userIds: [],
      timeout: null
    });
  }

  const buffer = joinBuffers.get(threadID);

  // إضافة المنضمين الجدد مع تجنب التكرار
  for (const pid of realNewPlayers) {
    if (!buffer.userIds.includes(String(pid))) {
      buffer.userIds.push(String(pid));
    }
  }

  if (buffer.timeout) {
    clearTimeout(buffer.timeout);
  }

  // انتظار 4 ثوان لاستيعاب من دخلوا دفعة واحدة لتفادي تكرار الرسائل وإغراق الشات
  buffer.timeout = setTimeout(async () => {
    const pidsToWelcome = [...buffer.userIds];
    joinBuffers.delete(threadID);

    if (pidsToWelcome.length === 0) return;

    try {
      const { getPlayer } = require('./database');

      // تصنيف المنضمين: مسجلين مسبقاً (عودة) أو أعضاء جدد فعلياً
      const returningPlayers = [];
      const newPids = [];
      for (const pid of pidsToWelcome) {
        const existingPlayer = await getPlayer(pid);
        if (existingPlayer) {
          returningPlayers.push(existingPlayer);
        } else {
          newPids.push(pid);
        }
      }

      // إرسال رسالة "أهلاً بعودتك" لكل لاعب مسجل مسبقاً
      for (const rp of returningPlayers) {
        const welcomeBackMsg =
          `✦ ━━━━━━━━━━━━━ ✦\n` +
          `👑 أهلاً بعودتك إلى نظام نيكسوس. 👑\n` +
          `✦ ━━━━━━━━━━━━━ ✦\n` +
          `اللاعب ⟦ ${rp.nickname} ⟧\n` +
          `✦ ━━━━━━━━━━━━━ ✦`;
        try {
          await api.sendMessage({ body: welcomeBackMsg, mentions: [{ tag: rp.nickname, id: rp.fbId }] }, threadID);
        } catch (e) {}
      }

      // إذا كان كل الأعضاء مسجلين مسبقاً، ينتهي العمل هنا ولا داعي لإكمال الترحيب العام
      if (newPids.length === 0) return;

      // جلب أسماء الحسابات من فيسبوك للأعضاء الجدد فعلياً فقط
      const info = await new Promise((resolve) => {
        api.getUserInfo(newPids, (err, ret) => {
          if (err) return resolve({});
          resolve(ret || {});
        });
      });

      // جلب اسم الشخص المسؤول عن الإضافة ديناميكياً [1]
      const adderId = event.author;
      let adderName = "انضمام ذاتي";
      if (adderId && String(adderId) !== String(botId) && String(adderId) !== String(BOT_ID)) {
        try {
          const adderInfo = await new Promise((resolve) => {
            api.getUserInfo([String(adderId)], (err, ret) => {
              if (err) return resolve(null);
              resolve(ret || null);
            });
          });
          if (adderInfo && adderInfo[String(adderId)]) {
            adderName = adderInfo[String(adderId)].name || "مستخدم نيكسوس";
          }
        } catch (e) {
          adderName = "مستخدم نيكسوس";
        }
      }

      // تنسيق التاريخ الحالي
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, '0');
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const yyyy = today.getFullYear();
      const formattedDate = `${dd}/${mm}/${yyyy}`;

      // بانر الترحيب المصمم خصيصاً لكل مملكة
      let headerBanner = '';
      if (kingdom === 'solfare') {
        headerBanner = `؜؜╗═━────༺☀༻────━═╔\n          ⌬ 𝙎𝙊𝙇𝙑𝘼𝙍𝘼 𝙆𝙄𝙉𝙂𝘿𝙊𝙈 ⌬\n╝═━────༺☀༻────━═╚`;
      } else if (kingdom === 'niravil') {
        headerBanner = `؜؜╗═━────༺🌿༻────━═╔\n          ⌬ 𝙉𝙄𝙍𝘼𝙑𝙄𝙇 𝙆𝙄𝙉𝙂𝘿𝙊𝙈 ⌬\n╝═━────༺🌿༻────━═╚`;
      } else if (kingdom === 'murdak') {
        headerBanner = `؜؜╗═━────༺𖣘༻────━═╔\n          ⌬ 𝙈𝙊𝙍𝘿𝘼𝙆 𝙆𝙄𝙉𝙂𝘿𝙊𝙈 ⌬\n╝═━────༺𖣘༻────━═╚`;
      }

      let finalWelcomeMsg = '';
      let mentions = [];

      if (newPids.length === 1) {
        // ترحيب بشخص واحد فقط
        const pid = newPids[0];
        const name = info[pid] ? info[pid].name : `مستخدم نيكسوس (${pid})`;
        mentions = [{ tag: name, id: pid }];

        finalWelcomeMsg =
          `${headerBanner}\n` +
          `✧ 𓆩 تــــــــــــــرحــــــــــــــيــــــــــــــب 𓆪 ✧\n\n` +
          `؜╮∙⋆⋅「 ${name} 」\n` +
          `│ › تاريخ الانضمام  ◄ ${formattedDate}\n` +
          `│ › اضافه  ◄ ${adderName}\n` +
          `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
          `اهلا بك ايها المجند دخولك عالم نيكسوس ليس صدفة اكتب " تسجيل " ، ابدء مغامرتك وانقش اسمك على اعالي الامبراطورية \n` +
          `───────∙⋆⋅ ※ ⋅⋆∙───────\n` +
          `✦ للتسجيل في النضام اكتب " تسجيل "\n` +
          `✦ يمكنك سؤال المساعد الذكي عن اي شيئ بالنضام بكتابة " المساعد "\n` +
          `───────∙⋆⋅ ※ ⋅⋆∙───────`;

      } else {
        // ترحيب مجمّع بأكثر من شخص دفعة واحدة لتفادي الحظر وإزعاج الدردشة
        const playersLines = newPids.map(pid => {
          const name = info[pid] ? info[pid].name : `مستخدم نيكسوس (${pid})`;
          return `❖ ${name}`;
        }).join('\n');

        mentions = newPids.map(pid => {
          const name = info[pid] ? info[pid].name : 'مستخدم';
          return { tag: name, id: pid };
        });

        finalWelcomeMsg =
          `${headerBanner}\n` +
          `✧ 𓆩 تــــــــــــــرحــــــــــــــيــــــــــــــب 𓆪 ✧\n\n` +
          `؜╮∙⋆⋅「 اهلا بكم في نيكسوس 」\n` +
          `│ › تاريخ الانضمام  ◄ ${formattedDate}\n` +
          `│ › اللاعبون :\n` +
          `${playersLines}\n\n` +
          `───────∙⋆⋅ ※ ⋅⋆∙───────\n` +
          `✦ للتسجيل في النضام اكتب " تسجيل "\n` +
          `✦ يمكنك سؤال المساعد الذكي عن اي شيئ بالنضام بكتابة " المساعد "\n` +
          `───────∙⋆⋅ ※ ⋅⋆∙───────`;
      }

      await api.sendMessage({ body: finalWelcomeMsg, mentions }, threadID);
    } catch (e) {
      console.error('Error sending consolidated welcome:', e);
    }
  }, 4000);
}

module.exports = {
  handleBotJoin,
  changeBotNickname,
  changePlayerNickname,
  handlePlayerJoinSubscribe,
  broadcastPlayerNickname,
  getBroadcastThreadIds
};