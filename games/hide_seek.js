/*
 * ═══════════════════════════════════════════════════════════════════════
 *  games/hide_seek.js — لعبة الغميضة (الفردي + التحدي)
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const { getDB, addXP } = require('../database');
const { sendReply, sendMessage, H } = require('../utils');

const KEY = 'hide_seek';

function init(p1) {
  return {
    hidingBox: null,
    seekerAttempts: 3,
    hider: p1
  };
}

async function startSingle(api, event, sessionData) {
  const { threadID, messageID } = event;
  const db = getDB();

  const gameState = sessionData.gameState;
  gameState.hidingBox = Math.floor(Math.random() * 10) + 1;
  gameState.seekerAttempts = 5;

  await db.collection('active_game_sessions').insertOne(sessionData);
  await db.collection('active_game_sessions').updateOne({ _id: sessionData._id }, { $set: { gameState: gameState } });
  await sendReply(api, `📦 اختبأ البوت في صندوق عشوائي من بين 10 صناديق.\nلديك 5 محاولات للبحث عنه!\nأرسل رقم الصندوق من 1 إلى 10 للبحث:`, messageID, threadID);
}

async function processSingle(api, event, session, text) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();
  const state = session.gameState;

  const guess = parseInt(text, 10);
  if (isNaN(guess) || guess < 1 || guess > 10) {
    await sendReply(api, `${H}⚠️ أرسل رقم صندوق صحيح للبحث من 1 إلى 10:`, messageID, threadID);
    return;
  }

  state.seekerAttempts--;
  if (guess === state.hidingBox) {
    await sendReply(api, `🎉 رائع! تمكنت من العثور على البوت المختبئ في الصندوق رقم ${state.hidingBox}! حصلت على 2 كوينز!`, messageID, threadID);
    await db.collection('players').updateOne({ fbId: String(senderID) }, { $inc: { coins: 2 } });
    await addXP(String(senderID), 5, api, threadID).catch(() => {});
    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
  } else {
    if (state.seekerAttempts <= 0) {
      await sendReply(api, `😢 نفدت محاولاتك! لم تجد البوت وكان يختبئ في الصندوق رقم: ${state.hidingBox}.`, messageID, threadID);
      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
      await sendReply(api, `❌ لم تجده هناك! الصندوق فارغ.\nمتبقي لديك: ${state.seekerAttempts} محاولات. أرسل رقم صندوق آخر:`, messageID, threadID);
    }
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

  if (state.hidingBox === null) {
    if (String(senderID) !== String(state.hider)) {
      await sendReply(api, `${H}⚠️ انتظر حتى يختار الخصم المختبئ صندوق الاختباء أولاً!`, messageID, threadID);
      return;
    }

    const box = parseInt(text, 10);
    if (isNaN(box) || box < 1 || box > 10) {
      await sendReply(api, `${H}⚠️ أرسل رقم صندوق صحيح لتختبئ داخله (من 1 إلى 10):`, messageID, threadID);
      return;
    }

    state.hidingBox = box;
    session.turn = opponentId;
    await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state, turn: opponentId } });

    if (t1 === t2) {
      await sendMessage(api, `🔒 اختبأ ⟦ ${session.playerNames[senderID]} ⟧ في صندوق سري!\n🎮 دور ⟦ ${session.playerNames[opponentId]} ⟧ الآن للبحث — لديه 3 محاولات.\nأرسل رقم الصندوق من 1 إلى 10:`, t1);
    } else {
      await sendMessage(api, `🔒 تم تسجيل صندوق اختبائك السري بنجاح!\nالآن سيبدأ خصمك بالبحث عنك ولديه 3 محاولات.`, t1);
      await sendMessage(api, `🎮 لقد اختبأ خصمك في أحد الصناديق السرية!\nلديك 3 محاولات لإيجاده.\nأرسل رقم الصندوق من 1 إلى 10 لبدء البحث:`, t2);
    }
    return;
  }

  const guess = parseInt(text, 10);
  if (isNaN(guess) || guess < 1 || guess > 10) {
    await sendReply(api, `${H}⚠️ أرسل رقم صندوق صحيح للبحث من 1 إلى 10:`, messageID, threadID);
    return;
  }

  state.seekerAttempts--;
  if (guess === state.hidingBox) {
    const prize = session.bet * 2;
    if (session.bet > 0) {
      await db.collection('players').updateOne({ fbId: String(senderID) }, { $inc: { coins: prize } });
    }
    await addXP(String(senderID), 10, api, threadID).catch(() => {});

    const foundMsg = `🏆 وجد ⟦ ${session.playerNames[senderID]} ⟧ المختبئ في الصندوق رقم ${state.hidingBox} وفاز بالرهان: ${prize} كوينز!`;
    await sendMessage(api, foundMsg, t1);
    if (t1 !== t2) await sendMessage(api, foundMsg, t2);

    await db.collection('active_game_sessions').deleteOne({ _id: session._id });
  } else {
    if (state.seekerAttempts <= 0) {
      const prize = session.bet * 2;
      if (session.bet > 0) {
        await db.collection('players').updateOne({ fbId: String(state.hider) }, { $inc: { coins: prize } });
      }
      await addXP(String(state.hider), 10, api, threadID).catch(() => {});

      const hideWinMsg = `🏆 فاز ⟦ ${session.playerNames[state.hider]} ⟧ بالاختباء! نفدت محاولات الباحث — الصندوق كان: ${state.hidingBox}. الرهان: ${prize} كوينز.`;
      await sendMessage(api, hideWinMsg, t1);
      if (t1 !== t2) await sendMessage(api, hideWinMsg, t2);

      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
      if (t1 === t2) {
        await sendMessage(api, `❌ الصندوق رقم ${guess} فارغ! بحث فيه ⟦ ${session.playerNames[senderID]} ⟧.\nمتبقي لديه: ${state.seekerAttempts} محاولات. أرسل رقم صندوق آخر:`, t1);
      } else {
        await sendMessage(api, `👀 بحث خصمك في الصندوق رقم ${guess} ولم يجدك هناك!\nمتبقي لديه: ${state.seekerAttempts} محاولات.`, t1);
        await sendMessage(api, `❌ الصندوق رقم ${guess} فارغ!\nمتبقي لديك: ${state.seekerAttempts} محاولات. أرسل رقم صندوق آخر للبحث:`, t2);
      }
    }
  }
}

async function promptTurn(api, session, targetPlayerId) {
  const t = session.playerThreads[targetPlayerId];
  const state = session.gameState;
  if (targetPlayerId === state.hider && state.hidingBox === null) {
    await sendMessage(api, `🎮 لقد حان دورك لتختبئ سرياً! الصناديق المتوفرة من 1 إلى 10.\nأرسل رقم صندوقك السري لتختبئ بداخله:`, t);
  }
}

module.exports = { KEY, init, startSingle, processSingle, processChallenge, promptTurn };
