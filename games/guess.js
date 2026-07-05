/*
 * ═══════════════════════════════════════════════════════════════════════
 *  games/guess.js — لعبة تخمين الرقم (الفردي + التحدي)
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const { getDB, addXP } = require('../database');
const { sendReply, sendMessage, H } = require('../utils');

const KEY = 'guess';

function init() {
  return {
    secretNumber: Math.floor(Math.random() * 100) + 1,
    attemptsLeft: 7
  };
}

async function startSingle(api, event, sessionData) {
  const { threadID, messageID } = event;
  const db = getDB();
  await db.collection('active_game_sessions').insertOne(sessionData);
  await sendReply(api, `${H}🔢 تم اختيار رقم سري بين 1 و 100 عشوائياً. لديك 7 محاولات لتخمينه!\nتنبيه: يفوز التخمين الصحيح أو الذي يبعد بفارق 3 درجات فقط. أرسل تخمينك الأول:`, messageID, threadID);
}

async function processSingle(api, event, session, text) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();
  const state = session.gameState;

  const guessNum = parseInt(text, 10);
  if (isNaN(guessNum) || guessNum < 1 || guessNum > 100) {
    await sendReply(api, `${H}⚠️ يرجى إدخال رقم تخمين صحيح بين 1 و 100:`, messageID, threadID);
    return;
  }

  state.attemptsLeft = (state.attemptsLeft !== undefined ? state.attemptsLeft : 7) - 1;

  const diff = Math.abs(guessNum - state.secretNumber);
  if (diff <= 3) {
    await sendReply(api, `🎉 مبروك! التخمين صحيح وصائب (الرقم السري كان: ${state.secretNumber}). لقد فزت بـ 2 كوينز!`, messageID, threadID);
    await db.collection('players').updateOne({ fbId: String(senderID) }, { $inc: { coins: 2 } });
    await addXP(String(senderID), 5, api, threadID).catch(() => {});
    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
  } else if (state.attemptsLeft <= 0) {
    await sendReply(api, `😢 نفدت محاولاتك السبع! الرقم السري كان: ${state.secretNumber}. حظاً أوفر في المرة القادمة.`, messageID, threadID);
    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
  } else {
    const hint = guessNum < state.secretNumber ? 'أكبر 🔼' : 'أقل 🔽';
    await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
    await sendReply(api, `❌ التخمين خاطئ! الرقم السري هو ${hint} من تخمينك.\n🔄 محاولات متبقية: ${state.attemptsLeft}/7\nأرسل تخميناً آخر:`, messageID, threadID);
  }
}

async function processChallenge(api, event, session, text) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();
  const state = session.gameState;

  const opponentId = session.players.find(p => p !== String(senderID));
  const t1 = session.playerThreads[senderID];
  const t2 = session.playerThreads[opponentId];

  if (session.turn !== String(senderID)) {
    await sendReply(api, `${H}⚠️ انتظر دور خصمك للعب حركته أولاً!`, messageID, threadID);
    return;
  }

  const guessNum = parseInt(text, 10);
  if (isNaN(guessNum)) {
    await sendReply(api, `${H}⚠️ يرجى إدخال رقم تخمين صحيح بين 1 و 100:`, messageID, threadID);
    return;
  }

  const diff = Math.abs(guessNum - state.secretNumber);
  if (diff <= 3) {
    const prize = session.bet * 2;
    if (session.bet > 0) {
      await db.collection('players').updateOne({ fbId: String(senderID) }, { $inc: { coins: prize } });
    }
    await addXP(String(senderID), 10, api, threadID).catch(() => {});

    const guessWinMsg = `🏆 فاز ⟦ ${session.playerNames[senderID]} ⟧ بتخمين الرقم السري ${state.secretNumber} وحصد الرهان: ${prize} كوينز!`;
    await sendMessage(api, guessWinMsg, t1);
    if (t1 !== t2) await sendMessage(api, guessWinMsg, t2);

    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
  } else {
    const hint = guessNum < state.secretNumber ? 'أكبر 🔼' : 'أقل 🔽';
    session.turn = opponentId;
    await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { turn: opponentId } });

    if (t1 === t2) {
      await sendMessage(api, `❌ خطأ من ⟦ ${session.playerNames[senderID]} ⟧! الرقم السري هو ${hint}.\n🎮 دور ⟦ ${session.playerNames[opponentId]} ⟧ الآن للتخمين:`, t1);
    } else {
      await sendMessage(api, `❌ تخمينك خاطئ! الرقم السري هو ${hint} من تخمين اللاعب. تم نقل الدور للخصم...`, t1);
      await sendMessage(api, `🎮 جاء دورك للتخمين! اللاعب الآخر خمن رقم وكانت نتيجته أن الرقم السري هو ${hint}.\nأرسل تخمينك الآن:`, t2);
    }
  }
}

async function promptTurn(api, session, targetPlayerId) {
  const t = session.playerThreads[targetPlayerId];
  await sendMessage(api, `🎮 جاء دورك الآن لتخمين الرقم السري! أرسل تخمينك المفضل بين 1 و 100:`, t);
}

module.exports = { KEY, init, startSingle, processSingle, processChallenge, promptTurn };
