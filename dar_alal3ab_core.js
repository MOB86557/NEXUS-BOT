/*
 * ═══════════════════════════════════════════════════════════════════════
 *  dar_alal3ab_core.js — نظام دار الألعاب المتكامل لبوت نيكسوس
 *  (الملف الرئيسي - يربط كل ألعاب مجلد games/ مع بعضها)
 * ═══════════════════════════════════════════════════════════════════════
 *  ⚠️ هذا الملف لا يحتوي على منطق أي لعبة بمفردها.
 *  كل لعبة موجودة في ملفها الخاص داخل مجلد games/.
 *  لتعديل لعبة معينة فقط، ارفع ملفها من games/ + هذا الملف.
 *  لإضافة لعبة جديدة: أنشئ ملفها في games/ ثم سجّلها هنا في GAME_MODULES والقائمة GAMES.
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const { getDB, getPlayer, addNotification, addXP } = require('./database');
const { sendReply, sendMessage, H, extractFbId } = require('./utils');
const config = require('./config.json');

// ===== استيراد كل وحدات الألعاب =====
const xo = require('./games/xo');
const guess = require('./games/guess');
const wordAssemble = require('./games/word_assemble');
const wordDisassemble = require('./games/word_disassemble');
const guessFlag = require('./games/guess_flag');
const bomb = require('./games/bomb');
const hideSeek = require('./games/hide_seek');
const pinata = require('./games/pinata');
const cards = require('./games/cards');
const intruder = require('./games/intruder');
const tugOfWar = require('./games/tug_of_war');

// سجل الوحدات: المفتاح (key) -> وحدة اللعبة
const GAME_MODULES = {
  [xo.KEY]: xo,
  [guess.KEY]: guess,
  [wordAssemble.KEY]: wordAssemble,
  [wordDisassemble.KEY]: wordDisassemble,
  [guessFlag.KEY]: guessFlag,
  [bomb.KEY]: bomb,
  [hideSeek.KEY]: hideSeek,
  [pinata.KEY]: pinata,
  [cards.KEY]: cards,
  [intruder.KEY]: intruder,
  [tugOfWar.KEY]: tugOfWar
};

// قائمة الألعاب المتاحة وأسمائها ووصفها (تظهر في القائمة الرئيسية)
const GAMES = {
  1:  { key: 'xo',             name: 'اكس أو',             desc: 'لعبة الذكاء والتخطيط الكلاسيكية. اكس ❌ وأو 🟢.\nالفوز في الفردي يمنحك 2 كوينز.' },
  2:  { key: 'guess',          name: 'تخمين الرقم',         desc: 'خمن الرقم السري بين 1 و 100.\nالفردي: لديك 7 محاولات للتخمين مع تلميحات.\nالفوز يكون بالتخمين الصحيح أو القريب بـ 3 درجات.' },
  5:  { key: 'word_assemble',  name: 'تجميع الكلمات',       desc: 'قم بتجميع الحروف المبعثرة لتكوين كلمة صحيحة من عالم نيكسوس.' },
  6:  { key: 'word_disassemble', name: 'تفكيك الكلمات',    desc: 'قم بتفكيك الكلمة المعطاة إلى حروف مفرقة بمسافات بينها.' },
  7:  { key: 'guess_flag',     name: 'احزر البلد من العلم', desc: 'أرسل اسم البلد الصحيح المطابق لإيموجي العلم المعروض.' },
  8:  { key: 'bomb',           name: 'خيوط القنبلة',        desc: 'قنبلة بـ 10 خيوط ملونة. خيط واحد عشوائي يفجر القنبلة.\nالوضع الفردي: اقطع 5 خيوط سليمة للفوز.\nالتحدي: اقطع الخيوط بالتناوب ومن ينفجر عنده يخسر.' },
  10: { key: 'hide_seek',      name: 'الغميضة',             desc: 'البوت أو الخصم يختبئ في صندوق من 10 صناديق.\nالفردي: لديك 5 محاولات لإيجاده.\nالتحدي: لا يمكن لعبها في نفس المملكة لحفظ السرية.' },
  11: { key: 'pinata',         name: 'ضرب البنياتا',        desc: 'اضرب البنياتا بالتناوب بقوة ضرب عشوائية (3% - 12%).\nالبنياتا قوتها 100%، ومن يكسرها يربح.' },
  12: { key: 'cards',          name: 'البطاقات',            desc: 'لكل لاعب 5 بطاقات عشوائية (1-10).\n5 جولات، في كل جولة يحدد البوت عشوائياً الفوز للأكبر أو الأصغر.' },
  13: { key: 'intruder',       name: 'الدخيل',              desc: 'مجموعة من 31 إيموجي تحتوي على 15 زوجاً متطابقاً وإيموجي واحد دخيل.\nجد الإيموجي الدخيل الفريد للفوز.' },
  14: { key: 'tug_of_war',     name: 'شد الحبل',            desc: 'لعبة جماعية تفاعلية في نفس المملكة فقط.\nمن يجمع \"شدات\" أكثر من أصدقائه خلال 30 ثانية يفوز.\n⚠️ هذه اللعبة للتحدي الجماعي فقط ولا تدعم الوضع الفردي.' }
};

// مفاتيح ألعاب السرعة (تتشارك نفس منطق التحدي: أول إجابة صحيحة تفوز)
const SPEED_GAME_KEYS = ['word_assemble', 'word_disassemble', 'guess_flag', 'intruder'];

// ===== تنظيف الجلسات الميتة والمعلقة تلقائياً =====
async function cleanupExpiredSessions() {
  try {
    const db = getDB();
    const now = new Date();
    const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const twoMinsAgo = new Date(now.getTime() - 2 * 60 * 1000);

    await db.collection('active_game_sessions').deleteMany({ lastActivity: { $lt: tenMinsAgo } });
    await db.collection('dar_alal3ab_sessions').deleteMany({ updatedAt: { $lt: tenMinsAgo } });
    await db.collection('game_invitations').deleteMany({ createdAt: { $lt: tenMinsAgo } });
    // ✅ تنظيف جلسات شد الحبل المنتهية (تدوم 30 ثانية فقط، نحذف بعد دقيقتين)
    await db.collection('tug_of_war_sessions').deleteMany({ createdAt: { $lt: twoMinsAgo } });
  } catch (err) {
    console.error('[DarAlal3ab] Error cleaning expired sessions:', err);
  }
}

// ===== القائمة الرئيسية لدار الألعاب =====
async function handleDarAlal3abMenu(api, event) {
  try {
    const { threadID, senderID, messageID } = event;
    const player = await getPlayer(senderID);
    if (!player) return;

    await cleanupExpiredSessions();

    const db = getDB();
    await db.collection('dar_alal3ab_sessions').updateOne(
      { fbId: String(senderID) },
      { $set: { step: 'MENU', updatedAt: new Date() } },
      { upsert: true }
    );

    const menuMsg =
      `⋇⋆✦⋆⋇───────────⋇⋆✦⋆⋇\n` +
      `⟦ 👾 ⟧ دار الالعــــــــــــــــــــاب ⟦ 👾 ⟧\n` +
      `⋇⋆✦⋆⋇───────────⋇⋆✦⋆⋇\n\n` +
      `『 1 』   「 اكس أو 」\n` +
      `『 2 』   「 تخمين الرقم」\n` +
      `『 5 』   「 تجميع الكلمات 」\n` +
      `『 6 』   「 تفكيك الكلمات 」\n` +
      `『 7 』   「 احزر البلد من العلم  」\n` +
      `『 8 』   「 خيوط القنبلة 」\n` +
      `『 10 』 「 الغميضة 」\n` +
      `『 11 』 「 ضرب البنياتا 」\n` +
      `『 12 』 「 البطاقات 」\n` +
      `『 13 』 「 الدخيل 」\n` +
      `『 14 』 「 شد الحبل 」\n` +
      `⋇⋆✦⋆⋇───────────⋇⋆✦⋆⋇\n` +
      `                『 0 』      ⟦ خروج ⟧\n` +
      ` ⬳ ارسل رقم الامر للدخول \n` +
      `⋇⋆✦⋆⋇───────────⋇⋆✦⋆⋇`;

    await sendReply(api, menuMsg, messageID, threadID);
  } catch (err) {
    console.error('[DarAlal3ab] Error in handleDarAlal3abMenu:', err);
  }
}

// ===== معالجة تفاعلات دار الألعاب بالكامل (لوبي اختيار اللعبة والوضع) =====
async function handleDarAlal3abSession(api, event, session) {
  try {
    const { threadID, senderID, messageID, body } = event;
    const text = (body || '').trim();
    const db = getDB();

    if (text === 'خروج' || (text === '0' && session.step !== 'CHALLENGE_BET')) {
      await db.collection('dar_alal3ab_sessions').deleteOne({ fbId: String(senderID) });
      await sendReply(api, `${H}🚪 تم الخروج من دار الألعاب. طاب يومك!`, messageID, threadID);
      return true;
    }

    // 1. القائمة الرئيسية واختيار اللعبة
    if (session.step === 'MENU') {
      const num = parseInt(text, 10);
      if (isNaN(num) || !GAMES[num]) {
        await sendReply(api, `${H}⚠️ يرجى إرسال رقم لعبة صحيح من القائمة أو 0 للخروج.`, messageID, threadID);
        return true;
      }

      const game = GAMES[num];

      await db.collection('dar_alal3ab_sessions').updateOne(
        { fbId: String(senderID) },
        { $set: { step: 'LOBBY', gameKey: game.key, gameName: game.name } }
      );

      const mod = GAME_MODULES[game.key];
      const isSingleDisabled = mod && mod.SINGLE_PLAYER_DISABLED;

      // ✅ لوبي مخصص لشد الجبل: يخفي خيار الوضع الفردي نهائياً
      let lobbyMsg;
      if (isSingleDisabled) {
        lobbyMsg =
          `╮━─━─━─≪👾≫─━─━─━╭\n` +
          `               ✧ ${game.name} ✧               \n` +
          `╯━─━─━─≪👾≫─━─━─━╰\n\n` +
          `─────؜「 وصف اللعبة 」──────\n` +
          `${game.desc}\n` +
          `─────────────────────\n` +
          `⌬ 2 وضع تحدي جماعي \n` +
          `⌬ 0 الخروج من اللعبة \n` +
          `────────────────────\n` +
          `     🎮 للبدء ارسل رقم الوضع 🎮\n` +
          `────────────────────`;
      } else {
        lobbyMsg =
          `╮━─━─━─≪👾≫─━─━─━╭\n` +
          `               ✧ ${game.name} ✧               \n` +
          `╯━─━─━─≪👾≫─━─━─━╰\n\n` +
          `─────؜「 وصف اللعبة 」──────\n` +
          `${game.desc}\n` +
          `─────────────────────\n` +
          `⌬ 1 الوضع الفردي \n` +
          `⌬ 2 وضع تحدي لاعب اخر \n` +
          `⌬ 0 الخروج من اللعبة \n` +
          `────────────────────\n` +
          `     🎮 للبدء ارسل رقم الوضع 🎮\n` +
          `────────────────────`;
      }

      await sendReply(api, lobbyMsg, messageID, threadID);
      return true;
    }

    // 2. معالجة خيار وضع اللعب داخل اللوبي
    if (session.step === 'LOBBY') {
      const mod = GAME_MODULES[session.gameKey];
      const isSingleDisabled = mod && mod.SINGLE_PLAYER_DISABLED;

      if (text === '1') {
        if (isSingleDisabled) {
          await sendReply(api, `${H}❌ عذراً، هذه اللعبة مخصصة للتحدي الجماعي فقط ولا يمكن لعبها فردياً. يرجى اختيار وضع التحدي (رقم 2) أو إرسال 0 للخروج.`, messageID, threadID);
          return true;
        }
        await startSinglePlayerGame(api, event, session);
        return true;
      } else if (text === '2') {
        // ✅ شد الجبل يبدأ مباشرة بدون رهان أو خصم
        if (session.gameKey === 'tug_of_war') {
          await tugOfWar.startChallenge(api, event, session);
          return true;
        }
        await db.collection('dar_alal3ab_sessions').updateOne(
          { fbId: String(senderID) },
          { $set: { step: 'CHALLENGE_BET' } }
        );
        await sendReply(api, `${H}💰 أرسل قيمة الرهان من الكوينز للمباراة (أو أرسل 0 للعب للمتعة فقط وبدون رهان):`, messageID, threadID);
        return true;
      }

      if (isSingleDisabled) {
        await sendReply(api, `${H}⚠️ يرجى إرسال 2 للتحدي الجماعي، أو 0 للخروج.`, messageID, threadID);
      } else {
        await sendReply(api, `${H}⚠️ يرجى إرسال 1 للعب الفردي، 2 للتحدي، أو 0 للخروج.`, messageID, threadID);
      }
      return true;
    }

    // 3. تحديد الرهان في وضع التحدي
    if (session.step === 'CHALLENGE_BET') {
      const bet = parseInt(text, 10);
      if (isNaN(bet) || bet < 0) {
        await sendReply(api, `${H}⚠️ يرجى إدخال رقم صحيح وصالح للرهان.`, messageID, threadID);
        return true;
      }

      const hostPlayer = await getPlayer(senderID);
      if (hostPlayer.coins < bet) {
        await sendReply(api, `${H}❌ ليس لديك رصيد كافي للرهان بهذا المبلغ! رصيدك الحالي: ${hostPlayer.coins} كوينز. أعد إدخال مبلغ آخر أو أرسل 0:`, messageID, threadID);
        return true;
      }

      await db.collection('dar_alal3ab_sessions').updateOne(
        { fbId: String(senderID) },
        { $set: { step: 'CHALLENGE_OPPONENT', bet: bet } }
      );
      await sendReply(api, `${H}👤 أرسل الآن لقب أو آيدي اللاعب الذي تود تحديه ومنافسته:`, messageID, threadID);
      return true;
    }

    // 4. تحديد الخصم وإرسال الدعوة
    if (session.step === 'CHALLENGE_OPPONENT') {
      let targetPlayer = null;
      const fbId = extractFbId(text);

      if (fbId) targetPlayer = await getPlayer(fbId);
      if (!targetPlayer) targetPlayer = await getPlayerByNicknameRegex(text);

      if (!targetPlayer) {
        await sendReply(api, `${H}❌ لم يتم العثور على هذا اللاعب في نظام نيكسوس. أرسل لقباً صحيحاً أو أرسل خروج للخروج:`, messageID, threadID);
        return true;
      }

      if (String(targetPlayer.fbId) === String(senderID)) {
        await sendReply(api, `${H}❌ لا يمكنك تحدي نفسك! اختر لاعباً آخر:`, messageID, threadID);
        return true;
      }

      const hostPlayer = await getPlayer(senderID);
      const crossKingdomOnly = ['hide_seek', 'cards'];

      if (crossKingdomOnly.includes(session.gameKey) && hostPlayer.kingdom === targetPlayer.kingdom) {
        await sendReply(api, `${H}❌ هذه اللعبة تُلعب فقط مع لاعبي الممالك الأخرى! اختر خصماً من مملكة أخرى أو أرسل خروج للخروج:`, messageID, threadID);
        return true;
      }

      const bet = session.bet || 0;
      if (targetPlayer.coins < bet) {
        await sendReply(api, `${H}❌ اللاعب الآخر لا يملك كوينز كافي للعب بهذا الرهان! أرسل لقب أو آيدي لاعب آخر أو أرسل خروج للخروج:`, messageID, threadID);
        return true;
      }

      await db.collection('dar_alal3ab_sessions').deleteOne({ fbId: String(senderID) });

      const invitationId = `invite_${Date.now()}_${senderID}`;
      await db.collection('game_invitations').insertOne({
        _id: invitationId,
        gameKey: session.gameKey,
        gameName: session.gameName,
        hostFbId: String(senderID),
        hostNickname: hostPlayer.nickname,
        hostThreadId: String(threadID),
        opponentFbId: String(targetPlayer.fbId),
        opponentNickname: targetPlayer.nickname,
        opponentThreadId: config.groupes[targetPlayer.kingdom] || threadID,
        bet: bet,
        createdAt: new Date()
      });

      const inviteMsg =
        `🎮 تلقيت دعوة تحدي جديدة!\n` +
        `👤 من اللاعب: ⟦ ${hostPlayer.nickname} ⟧\n` +
        `🕹️ اللعبة: ⟦ ${session.gameName} ⟧\n` +
        `💰 الرهان: ⟦ ${bet} 🪙 ⟧\n` +
        `👉 رد على هذا الاشعار بـ 《 قبول 》 لقبول التحدي أو 《 رفض 》 لرفضه`;

      await addNotification(String(targetPlayer.fbId), inviteMsg);
      await sendReply(api, `${H}✅ تم إرسال طلب التحدي عبر الإشعارات إلى اللاعب ⟦ ${targetPlayer.nickname} ⟧ بانتظار قبوله...`, messageID, threadID);
      return true;
    }

  } catch (err) {
    console.error('[DarAlal3ab] Error in handleDarAlal3abSession:', err);
    await sendReply(api, `❌ حدث خطأ داخلي أثناء معالجة تفاعلات القائمة.`, event.messageID, event.threadID);
  }

  return false;
}

// ===== معالجة الردود على الدعوات (قبول / رفض) =====
async function handleGameInvitationReply(api, event) {
  try {
    const { threadID, senderID, messageID, body, messageReply } = event;
    const text = (body || '').trim();
    if (!messageReply) return false;

    const replyBody = messageReply.body || '';
    if (!replyBody.includes('تلقيت دعوة تحدي جديدة!')) return false;

    const db = getDB();
    const invitation = await db.collection('game_invitations').findOne({
      opponentFbId: String(senderID)
    });

    if (!invitation) return false;

    if (text === 'قبول') {
      const p1 = await getPlayer(invitation.hostFbId);
      const p2 = await getPlayer(invitation.opponentFbId);

      if (p1.coins < invitation.bet || p2.coins < invitation.bet) {
        await sendReply(api, `${H}❌ فشل بدء التحدي لعدم توفر رصيد الرهان الكافي لدى أحد الطرفين حالياً.`, messageID, threadID);
        await db.collection('game_invitations').deleteOne({ _id: invitation._id });
        return true;
      }

      if (invitation.bet > 0) {
        await db.collection('players').updateOne({ fbId: String(invitation.hostFbId) }, { $inc: { coins: -invitation.bet } });
        await db.collection('players').updateOne({ fbId: String(invitation.opponentFbId) }, { $inc: { coins: -invitation.bet } });
      }

      const sessionData = {
        _id: `game_${Date.now()}`,
        gameKey: invitation.gameKey,
        gameName: invitation.gameName,
        mode: 'challenge',
        players: [invitation.hostFbId, invitation.opponentFbId],
        playerNames: {
          [invitation.hostFbId]: invitation.hostNickname,
          [invitation.opponentFbId]: invitation.opponentNickname
        },
        playerThreads: {
          [invitation.hostFbId]: invitation.hostThreadId,
          [invitation.opponentFbId]: invitation.opponentThreadId
        },
        playerKingdoms: {
          [invitation.hostFbId]: p1.kingdom,
          [invitation.opponentFbId]: p2.kingdom
        },
        bet: invitation.bet,
        status: 'active',
        turn: invitation.hostFbId,
        gameState: await initGameState(invitation.gameKey, invitation.hostFbId, invitation.opponentFbId),
        lastActivity: new Date()
      };

      await db.collection('active_game_sessions').insertOne(sessionData);
      await db.collection('game_invitations').deleteOne({ _id: invitation._id });

      await sendMessage(api, `${H}🎮 تم قبول التحدي! بدأت الآن مباراة ⟦ ${invitation.gameName} ⟧ ضد ⟦ ${invitation.opponentNickname} ⟧! الرهان: ${invitation.bet} كوينز.`, invitation.hostThreadId);
      if (invitation.hostThreadId !== invitation.opponentThreadId) {
        await sendMessage(api, `${H}🎮 بدأت الآن مباراة ⟦ ${invitation.gameName} ⟧ ضد ⟦ ${invitation.hostNickname} ⟧! الرهان: ${invitation.bet} كوينز.`, invitation.opponentThreadId);
      }

      if (SPEED_GAME_KEYS.includes(sessionData.gameKey)) {
        const mod = GAME_MODULES[sessionData.gameKey];
        const puzzleMsg = mod.buildChallengeStartMessage(sessionData.gameState);

        await sendMessage(api, puzzleMsg, invitation.hostThreadId);
        if (invitation.hostThreadId !== invitation.opponentThreadId) {
          await sendMessage(api, puzzleMsg, invitation.opponentThreadId);
        }
      } else if (sessionData.gameKey === 'cards') {
        await promptPlayerTurn(api, sessionData, invitation.hostFbId);
        await promptPlayerTurn(api, sessionData, invitation.opponentFbId);
      } else {
        await promptPlayerTurn(api, sessionData, invitation.hostFbId);
      }
      return true;

    } else if (text === 'رفض') {
      await db.collection('game_invitations').deleteOne({ _id: invitation._id });
      await sendMessage(api, `${H}❌ رفض اللاعب ⟦ ${invitation.opponentNickname} ⟧ طلب التحدي الخاص بك لـ ⟦ ${invitation.gameName} ⟧.`, invitation.hostThreadId);
      await sendReply(api, `${H}🚪 تم رفض الدعوة بنجاح.`, messageID, threadID);
      return true;
    }
  } catch (err) {
    console.error('[DarAlal3ab] Error in handleGameInvitationReply:', err);
  }

  return false;
}

// ===== تهيئة الحالة الداخلية للألعاب =====
async function initGameState(gameKey, p1, p2) {
  const mod = GAME_MODULES[gameKey];
  if (!mod || !mod.init) return {};
  return mod.init(p1, p2);
}

// ===== بدء لعبة الوضع الفردي =====
async function startSinglePlayerGame(api, event, session) {
  try {
    const { threadID, senderID } = event;
    const db = getDB();

    await db.collection('dar_alal3ab_sessions').deleteOne({ fbId: String(senderID) });

    const gameState = await initGameState(session.gameKey, senderID, 'bot');
    const sessionData = {
      _id: `game_single_${Date.now()}_${senderID}`,
      gameKey: session.gameKey,
      gameName: session.gameName,
      mode: 'single',
      players: [senderID],
      playerNames: { [senderID]: 'أنت' },
      playerThreads: { [senderID]: String(threadID) },
      bet: 0,
      status: 'active',
      gameState: gameState,
      lastActivity: new Date()
    };

    const mod = GAME_MODULES[session.gameKey];
    await mod.startSingle(api, event, sessionData);
  } catch (err) {
    console.error('[DarAlal3ab] Error in startSinglePlayerGame:', err);
    await sendReply(api, `❌ حدث خطأ أثناء تشغيل وتثبيت الجلسة الفردية للعبة.`, event.messageID, event.threadID);
  }
}

// ===== معالجة مدخلات اللعب النشط =====
// 🔒 محمية ضد race condition عبر قفل ذري على مستوى الجلسة
async function handleActiveGameInput(api, event) {
  let lockedSessionId = null;
  try {
    const { threadID, senderID, messageID, body } = event;
    const text = (body || '').trim();
    const db = getDB();

    await cleanupExpiredSessions();

    // ✅ التحقق أولاً: هل هذا رد على جلسة شد الجبل؟
    // إذا كان كذلك نتجاهله هنا لأن handleTugOfWarReply يعالجه
    if (event.messageReply) {
      const replyBody = event.messageReply.body || '';
      if (replyBody.includes('شد الحبل معي لافوز')) return false;
    }

    const lockResult = await db.collection('active_game_sessions').findOneAndUpdate(
      { players: String(senderID), status: 'active', processing: { $ne: true } },
      { $set: { processing: true, lastActivity: new Date() } },
      { returnDocument: 'after' }
    );

    const session = lockResult && lockResult.value ? lockResult.value : lockResult;
    if (!session) return false;

    lockedSessionId = session._id;

    if (text === 'استسلام' || text === 'انسحاب') {
      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
      lockedSessionId = null;
      if (session.mode === 'challenge') {
        const opponentId = session.players.find(p => p !== String(senderID));
        const opponentName = session.playerNames[opponentId];

        if (session.bet > 0) {
          await db.collection('players').updateOne({ fbId: String(opponentId) }, { $inc: { coins: (session.bet * 2) } });
        }

        await sendMessage(api, `🚪 انسحب اللاعب ⟦ ${session.playerNames[senderID]} ⟧ من المباراة.\n🏆 تم إعلان اللاعب ⟦ ${opponentName} ⟧ فائزاً بالانسحاب وحصل على قيمة الرهان كاملاً!`, session.playerThreads[opponentId]);
      }
      await sendReply(api, `${H}🚪 تم الانسحاب بنجاح والهروب من المباراة!`, messageID, threadID);
      return true;
    }

    if (session.mode === 'single') {
      await processSinglePlayerInput(api, event, session, text);
    } else {
      await processChallengeInput(api, event, session, text);
    }

    await db.collection('active_game_sessions').updateOne(
      { _id: session._id },
      { $set: { processing: false } }
    );
    lockedSessionId = null;

    return true;
  } catch (err) {
    console.error('[DarAlal3ab] Error in handleActiveGameInput:', err);
    if (lockedSessionId) {
      try {
        await getDB().collection('active_game_sessions').updateOne(
          { _id: lockedSessionId },
          { $set: { processing: false } }
        );
      } catch (_) {}
    }
    return false;
  }
}

// ===== توجيه مدخلات الوضع الفردي =====
async function processSinglePlayerInput(api, event, session, text) {
  const { threadID, messageID } = event;
  const db = getDB();

  const playTimeSec = (Date.now() - new Date(session.lastActivity).getTime()) / 1000;
  if (SPEED_GAME_KEYS.includes(session.gameKey) && playTimeSec > 35) {
    await sendReply(api, `⏱️ انتهت المهلة المحددة للعب (30 ثانية) وخسرت الجولة! حظاً أوفر في المرة القادمة.`, messageID, threadID);
    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    return;
  }

  const mod = GAME_MODULES[session.gameKey];
  if (!mod || !mod.processSingle) return;
  await mod.processSingle(api, event, session, text);
}

// ===== توجيه مدخلات وضع التحدي =====
async function processChallengeInput(api, event, session, text) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();

  if (SPEED_GAME_KEYS.includes(session.gameKey)) {
    const state = session.gameState;
    const mod = GAME_MODULES[session.gameKey];
    const t1 = session.playerThreads[senderID];
    const opponentId = session.players.find(p => p !== String(senderID));
    const t2 = session.playerThreads[opponentId];

    const isCorrect = mod.checkChallengeAnswer(state, text);

    if (isCorrect) {
      const winnerId = String(senderID);
      const prize = session.bet * 2;

      if (session.bet > 0) {
        await db.collection('players').updateOne({ fbId: String(winnerId) }, { $inc: { coins: prize } });
      }
      await addXP(String(winnerId), 10, api, threadID).catch(() => {});

      const winMsg = `🏆 فوز! أرسل اللاعب ⟦ ${session.playerNames[winnerId]} ⟧ الإجابة الصحيحة أولاً وهي: ⟦ ${mod.getAnswerDisplay(state)} ⟧!\nوربح الرهان الكلي المقدر بـ: ${prize} كوينز.`;
      await sendMessage(api, winMsg, t1);
      if (t1 !== t2) await sendMessage(api, winMsg, t2);

      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      await sendReply(api, `❌ إجابة خاطئة! أسرع في المحاولة قبل خصمك...`, messageID, threadID);
    }
    return;
  }

  if (session.gameKey === 'cards') {
    await cards.processChallenge(api, event, session, text);
    return;
  }

  const mod = GAME_MODULES[session.gameKey];
  if (!mod || !mod.processChallenge) return;
  await mod.processChallenge(api, event, session, text);
}

// ===== معالجة الردود بكلمة "شد" للعبة شد الحبل =====
async function handleTugOfWarReply(api, event) {
  return tugOfWar.handleReply(api, event);
}

// ===== توجيه إرشادات الدور =====
async function promptPlayerTurn(api, session, targetPlayerId) {
  const mod = GAME_MODULES[session.gameKey];
  if (!mod || !mod.promptTurn) return;
  await mod.promptTurn(api, session, targetPlayerId);
}

// ===== البحث عن لاعب بواسطة اللقب =====
async function getPlayerByNicknameRegex(nickname) {
  try {
    const db = getDB();
    const cleanNick = nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return await db.collection('players').findOne({
      nickname: { $regex: new RegExp(`^${cleanNick}$`, 'i') }
    });
  } catch {
    return null;
  }
}

module.exports = {
  handleDarAlal3abMenu,
  handleDarAlal3abSession,
  handleActiveGameInput,
  handleGameInvitationReply,
  handleTugOfWarReply
};
