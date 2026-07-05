/*
 * ═══════════════════════════════════════════════════════════════════════
 *  games/word_disassemble.js — لعبة تفكيك الكلمات (الفردي + التحدي)
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const { getDB, addXP } = require('../database');
const { sendReply } = require('../utils');
const { NEXUS_WORDS } = require('./_shared');

const KEY = 'word_disassemble';

function init() {
  const word = NEXUS_WORDS[Math.floor(Math.random() * NEXUS_WORDS.length)];
  return {
    word,
    scrambled: word.split('').join(' ')
  };
}

async function startSingle(api, event, sessionData) {
  const { threadID, messageID } = event;
  const db = getDB();
  await db.collection('active_game_sessions').insertOne(sessionData);
  await sendReply(api, `🔤 قم بتفكيك الكلمة التالية بوضع مسافة واحدة بين كل حرف وحرف:\n『 ${sessionData.gameState.word} 』\n\nأرسل الكلمة المفككة:`, messageID, threadID);
}

async function processSingle(api, event, session, text) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();
  const state = session.gameState;

  if (text === state.scrambled) {
    await sendReply(api, `🎉 تفكيك صحيح وممتاز! حصلت على 2 كوينز!`, messageID, threadID);
    await db.collection('players').updateOne({ fbId: String(senderID) }, { $inc: { coins: 2 } });
    await addXP(String(senderID), 5, api, threadID).catch(() => {});
  } else {
    await sendReply(api, `❌ تفكيك خاطئ! التفكيك الصحيح للكلمة هو: ⟦ ${state.scrambled} ⟧.`, messageID, threadID);
  }
  await db.collection('active_game_sessions').deleteOne({ _id: session._id });
}

function buildChallengeStartMessage(state) {
  return `🔤 أسرع بتفكيك الكلمة التالية بوضع مسافة واحدة بين كل حرف وحرف:\n『 ${state.word} 』\n\nأرسل الكلمة المفككة فوراً للفوز بالرهان!`;
}

function checkChallengeAnswer(state, text) {
  return text === state.scrambled;
}

function getAnswerDisplay(state) {
  return state.scrambled;
}

module.exports = {
  KEY,
  init,
  startSingle,
  processSingle,
  buildChallengeStartMessage,
  checkChallengeAnswer,
  getAnswerDisplay
};
