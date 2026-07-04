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
// statusEmoji: إيموجي حالة اختياري يُضاف بنهاية الكنية (مثال: 🏥 للإنعاش)
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

// ─── نظام الترحيب المجمّع والمفلتر للأعضاء الجدد ───
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

  // انتظار 4 ثوان لاستيعاب من دخلوا دفعة واحدة
  buffer.timeout = setTimeout(async () => {
    const pidsToWelcome = [...buffer.userIds];
    joinBuffers.delete(threadID);

    if (pidsToWelcome.length === 0) return;

    try {
      const { getPlayer } = require('./database');

      // ─── تصنيف المنضمين: مسجلين مسبقاً (عودة) أو أعضاء جدد فعلياً ───
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

      // إذا الكل كانوا مسجلين مسبقاً، لا داعي لإكمال رسالة الترحيب الكاملة
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

      // تنسيق التاريخ
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, '0');
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const yyyy = today.getFullYear();
      const formattedDate = `${dd}/${mm}/${yyyy}`;

      // بانر الترحيب حسب المملكة
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
        // ─── ترحيب بشخص واحد ───
        const pid = newPids[0];
        const name = info[pid] ? info[pid].name : `مستخدم نيكسوس (${pid})`;
        mentions = [{ tag: name, id: pid }];

        finalWelcomeMsg =
          `${headerBanner}\n` +
          `✧ 𓆩 تــــــــــــــرحــــــــــــــيــــــــــــــب 𓆪 ✧\n\n` +
          `؜╮∙⋆⋅「 ${name} 」\n` +
          `│ › تاريخ الانضمام  ◄ ${formattedDate}\n` +
          `│ › اضافه  ◄ ${adderName}\n` + // تم تحويل "Kanato" إلى الاسم الحقيقي ديناميكياً [1]
          `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
          `اهلا بك ايها المجند دخولك عالم نيكسوس ليس صدفة اكتب " تسجيل " ، ابدء مغامرتك وانقش اسمك على اعالي الامبراطورية \n` +
          `───────∙⋆⋅ ※ ⋅⋆∙───────\n` +
          `✦ للتسجيل في النضام اكتب " تسجيل "\n` +
          `✦ يمكنك سؤال المساعد الذكي عن اي شيئ بالنضام بكتابة " المساعد "\n` +
          `───────∙⋆⋅ ※ ⋅⋆∙───────`;

      } else {
        // ─── ترحيب بأكثر من شخص ───
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
  handlePlayerJoinSubscribe
};
