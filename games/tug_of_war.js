/*
 * ═══════════════════════════════════════════════════════════════════════
 *  games/tug_of_war.js — لعبة شد الحبل (تحدي جماعي خاص - لا يوجد وضع فردي)
 * ═══════════════════════════════════════════════════════════════════════
 *  هذه اللعبة مختلفة عن باقي الألعاب: لا تستخدم active_game_sessions
 *  بل tug_of_war_sessions، ولا تتطلب خصماً محدداً بل تفاعل جماعي بالرد.
 */

'use strict';

const { getDB, getPlayer, addXP } = require('../database');
const { sendReply, sendMessage, H } = require('../utils');

const KEY = 'tug_of_war';
const SINGLE_PLAYER_DISABLED = true; // هذه اللعبة لا تدعم الوضع الفردي

// ===== بدء تحدي شد الحبل الجماعي =====
async function startChallenge(api, event, session) {
  try {
    const { threadID, senderID, messageID } = event;
    const db = getDB();

    await db.collection('dar_alal3ab_sessions').deleteOne({ fbId: String(senderID) });

    const hostPlayer = await getPlayer(senderID);

    const startMsg =
      `📢 ━━━━━━━━━━━━━━━━ 📢\n` +
      `مرحبا انا اللاعب ⟦ ${hostPlayer.nickname} ⟧ شد الحبل معي لافوز!\n` +
      `👉 رد على هذه الرسالة واكتب 《 شد 》 لمساعدتي بالفوز والتغلب على التحدي!\n` +
      `⏱️ اللعبة مفتوحة للتفاعل لمدة 30 ثانية للجميع في المملكة!`;

    const info = await sendReply(api, startMsg, messageID, threadID);
    const botMessageId = info ? info.messageID : null;

    if (!botMessageId) {
      await sendReply(api, `${H}❌ حدث خطأ أثناء تشغيل شد الحبل.`, messageID, threadID);
      return;
    }

    await db.collection('tug_of_war_sessions').insertOne({
      botMessageId: String(botMessageId),
      hostFbId: String(senderID),
      hostNickname: hostPlayer.nickname,
      threadID: String(threadID),
      clicks: 0,
      clickers: [],
      createdAt: new Date()
    });

    setTimeout(async () => {
      try {
        const active = await db.collection('tug_of_war_sessions').findOne({ botMessageId: String(botMessageId) });
        if (active) {
          await db.collection('tug_of_war_sessions').deleteOne({ botMessageId: String(botMessageId) });

          const totalClicks = active.clicks || 0;
          const rewardCoins = Math.min(10, totalClicks);

          if (totalClicks > 0) {
            await db.collection('players').updateOne({ fbId: String(active.hostFbId) }, { $inc: { coins: rewardCoins } });
            await addXP(String(active.hostFbId), 10, api, active.threadID).catch(() => {});

            const endMsg =
              `⏱️ انتهى وقت تحدي شد الحبل!\n` +
              `📊 إجمالي عدد الشدات المحصلة بفضل أصدقائك بالمملكة: ⟦ ${totalClicks} شدة ⟧!\n` +
              `🏆 فوز! ربح اللاعب ⟦ ${active.hostNickname} ⟧ مكافأة قدرها: ⛁ ${rewardCoins} كوينز بفضل تكاتفكم!`;
            await sendMessage(api, endMsg, active.threadID);
          } else {
            await sendMessage(api, `⏱️ انتهى وقت شد الحبل ولم يستجب أحد لرسالتك لتسجيل أي شدة! للاسف لم تحصل على أي مكافأة.`, active.threadID);
          }
        }
      } catch (err) {
        console.error('[TugOfWar] Error ending game:', err);
      }
    }, 30000);
  } catch (err) {
    console.error('[DarAlal3ab] Error in startTugOfWarChallenge:', err);
  }
}

// ===== معالجة الردود بكلمة "شد" =====
async function handleReply(api, event) {
  try {
    const { threadID, senderID, messageID, body, messageReply } = event;
    const text = (body || '').trim();
    if (!messageReply) return false;

    const replyBody = messageReply.body || '';
    if (!replyBody.includes('شد الحبل معي لافوز')) return false;

    if (text !== 'شد' && text !== 'شَد') return false;

    const db = getDB();
    const botMsgId = String(messageReply.messageID);

    const active = await db.collection('tug_of_war_sessions').findOne({ botMessageId: botMsgId });
    if (!active) return false;

    await db.collection('tug_of_war_sessions').updateOne(
      { botMessageId: botMsgId },
      {
        $inc: { clicks: 1 },
        $addToSet: { clickers: String(senderID) }
      }
    );

    api.setMessageReaction('💪', messageID, () => {}, true);
    return true;
  } catch (err) {
    console.error('[DarAlal3ab] Error in handleTugOfWarReply:', err);
    return false;
  }
}

module.exports = { KEY, SINGLE_PLAYER_DISABLED, startChallenge, handleReply };
