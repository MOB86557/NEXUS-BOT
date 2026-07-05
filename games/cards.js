/*
 * ═══════════════════════════════════════════════════════════════════════
 *  games/cards.js — لعبة البطاقات (وضع التحدي فقط - لا يوجد وضع فردي)
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const { getDB, addXP } = require('../database');
const { sendReply, sendMessage, H } = require('../utils');
const { shuffleArray } = require('./_shared');

const KEY = 'cards';
const SINGLE_PLAYER_DISABLED = true; // هذه اللعبة لا تدعم الوضع الفردي

function init() {
  const deck = Array.from({ length: 10 }, (_, i) => i + 1);
  shuffleArray(deck);
  return {
    p1_cards: deck.slice(0, 5),
    p2_cards: deck.slice(5, 10),
    p1_selection: null,
    p2_selection: null,
    p1_score: 0,
    p2_score: 0,
    round: 1,
    roundMode: Math.random() > 0.5 ? 'الأكبر' : 'الأصغر'
  };
}

async function processChallenge(api, event, session, text) {
  const { threadID, senderID, messageID } = event;
  const db = getDB();
  const state = session.gameState;

  const opponentId = session.players.find(p => p !== String(senderID));
  const t1 = session.playerThreads[senderID];
  const t2 = session.playerThreads[opponentId];

  const p1 = session.players[0];
  const p2 = session.players[1];

  const isP1 = (String(senderID) === p1);
  const letter = text.toUpperCase();

  const currentCards = isP1 ? state.p1_cards : state.p2_cards;
  const letters = ['A', 'B', 'C', 'D', 'E'];
  const idx = letters.indexOf(letter);

  if (idx === -1 || idx >= currentCards.length || currentCards[idx] === null) {
    await sendReply(api, `${H}⚠️ يرجى إرسال حرف بطاقة متوفر وصحيح من قائمتك النشطة.`, messageID, threadID);
    return;
  }

  const value = currentCards[idx];

  if (isP1) {
    if (state.p1_selection !== null) {
      await sendReply(api, `${H}⚠️ لقد قمت بتحديد بطاقتك بالفعل لهذه الجولة وبانتظار الخصم!`, messageID, threadID);
      return;
    }
    state.p1_selection = { value, letter, idx };
  } else {
    if (state.p2_selection !== null) {
      await sendReply(api, `${H}⚠️ لقد قمت بتحديد بطاقتك بالفعل لهذه الجولة وبانتظار الخصم!`, messageID, threadID);
      return;
    }
    state.p2_selection = { value, letter, idx };
  }

  await sendMessage(api, `✅ تم تسجيل بطاقتك المختارة بنجاح وبانتظار تحديد الخصم لبطاقته...`, threadID);

  if (state.p1_selection !== null && state.p2_selection !== null) {
    const v1 = state.p1_selection.value;
    const v2 = state.p2_selection.value;

    let roundWinner = null;
    if (state.roundMode === 'الأكبر') {
      if (v1 > v2) roundWinner = p1;
      else if (v2 > v1) roundWinner = p2;
    } else {
      if (v1 < v2) roundWinner = p1;
      else if (v2 < v1) roundWinner = p2;
    }

    let resMsg = `📊 جولة رقم ${state.round} انتهت!\n🎯 هدف الجولة كان: ⟦ ${state.roundMode} ⟧\n`;
    resMsg += `👤 بطاقة ⟦ ${session.playerNames[p1]} ⟧ كانت: ${v1} (الحرف: ${state.p1_selection.letter})\n`;
    resMsg += `👤 بطاقة ⟦ ${session.playerNames[p2]} ⟧ كانت: ${v2} (الحرف: ${state.p2_selection.letter})\n\n`;

    if (roundWinner === p1) {
      state.p1_score++;
      resMsg += `🏆 فوز الجولة لـ: ⟦ ${session.playerNames[p1]} ⟧!`;
    } else if (roundWinner === p2) {
      state.p2_score++;
      resMsg += `🏆 فوز الجولة لـ: ⟦ ${session.playerNames[p2]} ⟧!`;
    } else {
      resMsg += `🤝 تعادل الجولة دون فائز!`;
    }

    state.p1_cards[state.p1_selection.idx] = null;
    state.p2_cards[state.p2_selection.idx] = null;

    state.p1_selection = null;
    state.p2_selection = null;
    state.round++;
    state.roundMode = Math.random() > 0.5 ? 'الأكبر' : 'الأصغر';

    await sendMessage(api, resMsg, t1);
    if (t1 !== t2) await sendMessage(api, resMsg, t2);

    if (state.round > 5) {
      let matchWinner = null;
      if (state.p1_score > state.p2_score) matchWinner = p1;
      else if (state.p2_score > state.p1_score) matchWinner = p2;

      const prize = session.bet * 2;
      let finalMsg = `🎮 انتهت مباراة البطاقات بالكامل بعد 5 جولات دامت بالتنافس!\n`;
      finalMsg += `🏁 النتيجة النهائية: ⟦ ${session.playerNames[p1]}: ${state.p1_score} ⟧ مقابل ⟦ ${session.playerNames[p2]}: ${state.p2_score} ⟧\n\n`;

      if (matchWinner) {
        if (session.bet > 0) {
          await db.collection('players').updateOne({ fbId: String(matchWinner) }, { $inc: { coins: prize } });
        }
        await addXP(String(matchWinner), 10, api, t1).catch(() => {});

        finalMsg += `🏆 الفائز العام بالمباراة هو اللاعب الممتاز ⟦ ${session.playerNames[matchWinner]} ⟧ وحصل على مبلغ الرهان: ${prize} كوينز!`;
      } else {
        if (session.bet > 0) {
          await db.collection('players').updateOne({ fbId: String(p1) }, { $inc: { coins: session.bet } });
          await db.collection('players').updateOne({ fbId: String(p2) }, { $inc: { coins: session.bet } });
        }
        finalMsg += `🤝 انتهى التحدي العام بالتعادل التام بين اللاعبين وتمت إعادة كوينز الرهان للجميع!`;
      }

      await sendMessage(api, finalMsg, t1);
      if (t1 !== t2) await sendMessage(api, finalMsg, t2);

      await db.collection('active_game_sessions').deleteOne({ _id: session._id });
    } else {
      await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
      await promptTurn(api, session, p1);
      await promptTurn(api, session, p2);
    }
  } else {
    await db.collection('active_game_sessions').updateOne({ _id: session._id }, { $set: { gameState: state } });
  }
}

async function promptTurn(api, session, targetPlayerId) {
  const t = session.playerThreads[targetPlayerId];
  const state = session.gameState;
  const isP1 = (targetPlayerId === session.players[0]);
  const cards = isP1 ? state.p1_cards : state.p2_cards;
  const letters = ['A', 'B', 'C', 'D', 'E'];

  let cardsStr = `🃏 بطاقاتك المتبقية لهذه الجولة رقم ${state.round}:\n`;
  cards.forEach((v, idx) => {
    if (v !== null) {
      cardsStr += `   ✦ الحرف ${letters[idx]}  ◀  البطاقة رقم ${v}\n`;
    }
  });

  cardsStr += `\n🎯 هدف الجولة الحالي: ⟦ ${state.roundMode} ⟧\n`;
  cardsStr += `👉 أرسل حرف البطاقة الذي تود اللعب به بالسر للمنافسة في هذه الجولة:`;

  await sendMessage(api, cardsStr, t);
}

module.exports = { KEY, SINGLE_PLAYER_DISABLED, init, processChallenge, promptTurn };
