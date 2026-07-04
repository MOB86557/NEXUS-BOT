// ─── taqrir.js — التقرير الاقتصادي للممالك ───
const { sendMessage, H, kingdomNames } = require('./utils');
const { getAllPlayers } = require('./database');

async function handleTaqrir(api, event) {
  const { threadID } = event;
  const text = (event.body || '').trim();

  if (text !== 'تقرير') return false;

  const allPlayers = await getAllPlayers();
  const kingdoms = ['solfare', 'niravil', 'murdak'];

  const stats = kingdoms.map(k => {
    const kp = allPlayers.filter(p => p.kingdom === k);
    const totalCoins = kp.reduce((sum, p) => sum + (p.coins || 0), 0);
    const sortedPlayers = [...kp].sort((a, b) => (b.coins || 0) - (a.coins || 0));
    return {
      key: k,
      name: kingdomNames[k] || k.toUpperCase(),
      totalCoins,
      memberCount: kp.length,
      topPlayers: sortedPlayers.slice(0, 3)
    };
  });

  stats.sort((a, b) => b.totalCoins - a.totalCoins);

  const medals = ['🥇', '🥈', '🥉'];
  let reportMsg = ` ╗══ 👑  تــقــريــر الـمـمـالـك 👑 ══╔\n          🏆 الترتيب حسب الكوينز🏆\n`;

  stats.forEach((kStat, index) => {
    const medal = medals[index] || '•';
    const formattedCoins = kStat.totalCoins.toLocaleString('en-US');

    reportMsg += `╣═══════════════════╠\n`;
    reportMsg += `┃          ${medal}↬ 『 ${H}${kStat.name} 』\n`;
    reportMsg += `┃ 💰 الكوينز ↬ ${formattedCoins}\n`;
    reportMsg += `┃ 👥 الأعضاء ↬ ${kStat.memberCount} لاعب\n`;
    reportMsg += `┃ 👑 الأغنى:\n`;

    if (kStat.topPlayers.length === 0) {
      reportMsg += `┃ ├ لا يوجد لاعبون بعد\n`;
    } else {
      kStat.topPlayers.forEach((p, pIdx) => {
        const isLast = pIdx === kStat.topPlayers.length - 1;
        const prefix = isLast ? '└' : '├';
        const pCoins = (p.coins || 0).toLocaleString('en-US');
        reportMsg += `┃ ${prefix} ⚜ ${pIdx + 1} ↬ ${H}${p.nickname} — ${pCoins}\n`;
      });
    }
  });

  reportMsg += `╝═══════════════════╚\n\n`;

  const overallTotalCoins = allPlayers.reduce((sum, p) => sum + (p.coins || 0), 0);
  reportMsg += `━━━➤ 📜 إجمالي الممالك: 3\n`;
  reportMsg += `━━━➤ 👥 إجمالي اللاعبين: ${allPlayers.length}\n`;
  reportMsg += `━━━➤ 💎 إجمالي الكوينز: ${overallTotalCoins.toLocaleString('en-US')}`;

  await sendMessage(api, reportMsg, threadID);
  return true;
}

module.exports = { handleTaqrir };
