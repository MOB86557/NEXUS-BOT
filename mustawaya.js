// ─── mustawaya.js — أمر مستواي وتفاصيل الـ XP ───
const { sendReply } = require('./utils');

async function handleMustawaya(api, event, player) {
  const { threadID } = event;
  const text = (event.body || '').trim();

  if (!['مستواي', 'المستوى', 'Lvl', 'lvl'].includes(text)) return false;

  if (!player) {
    await sendReply(api, `⚠️ يجب التسجيل أولاً لمعاينة مستواك.`, event.messageID, threadID);
    return true;
  }

  const level = player.level || 1;
  const xp = player.xp || 0;
  const requiredXp = 45 + (level * 5);
  const remainingXp = parseFloat((requiredXp - xp).toFixed(1));
  const percentage = Math.min(100, Math.floor((xp / requiredXp) * 100));
  const filledBlocks = Math.min(10, Math.floor((xp / requiredXp) * 10));
  const emptyBlocks = 10 - filledBlocks;
  const progressBar = '▰'.repeat(filledBlocks) + '▱'.repeat(emptyBlocks);

  const xpDetailsMsg =
    `╗══〔 ✦ تفاصيل المستوى ✦ 〕══╔\n\n` +
    `👤 الـمـسـتـوى الـحـالـي : 『 ${level} 』\n` +
    `╮──────────────╭\n` +
    `│ 📈 الـتـقـدم للترقية.      │\n` +
    `╯──────────────╰\n` +
    `${progressBar} ${percentage}%\n` +
    `⚡ الـخـبـرة ( XP ) : 『 ${xp} / ${requiredXp} 』\n` +
    `✨ المتبقي للترقية :『 ${remainingXp} XP 』\n` +
    `╗═══〔 ✦ مـصـادر XP ✦ 〕═══╔\n` +
    `✵ الحفر/ الجمع / الصيد : 5 XP\n` +
    `✵ بيع الموارد في السوق : 4 XP\n` +
    `✵ بيع المصنعات والادوات بالسوق : 10 XP\n` +
    `✵الشراء من المتجر : 10 XP \n` +
    `✵ دعوة لاعب جديد : 30 XP \n` +
    `✵ الربح من كوينز النشر : 10 XP \n` +
    `✵ الهجوم بسلاح    : 20 XP\n` +
    `✵ قتل لاعب : 100 XP\n` +
    `✵ الربح في لعبة بالوضع الفردي : 5 XP \n` +
    `✵ الربح في لعبة بوضع التحدي : 10 XP \n` +
    `✵ الاستثمار في البنك : 15 XP\n` +
    `✵ الفوز بمسابقة النشر : 40 XP\n` +
    `✵ الفوز بمسابقة الدعوات : 40 XP\n` +
    `╝═════════════════╚`;

  await sendReply(api, xpDetailsMsg, event.messageID, threadID);
  return true;
}

module.exports = { handleMustawaya };
