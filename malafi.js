/*
 * ═══════════════════════════════════════════════════════════════════════
 *  malafi.js — نظام عرض الملف الشخصي للاعبين (معدل)
 * ═══════════════════════════════════════════════════════════════════════
 */

const { getPlayer } = require('./database');
const { sendReply, drawBar, classSymbols, kingdomNamesAr, getKingdomByThreadId } = require('./utils');

async function handleMalafi(api, event) {
  const { threadID, senderID, messageID } = event;
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await sendReply(api,
      `𓆫─━━࿇━━━──━━━࿇━━─𓆫\n              『 تنبيه ⚠ 』\n\nأنت غير مسجل في نظام نيكسوس\nارسل 《 تسجيل 》للانضمام\n\n     𓆫─━━࿇━━━──━━━࿇━━─𓆫`,
      messageID, threadID);
    return;
  }

  const symbol = classSymbols[player.class] || '✹';
  const hpBar = drawBar(player.hp || 1000);
  const epBar = drawBar(player.ep || 1000);
  const kingdomAr = kingdomNamesAr[player.kingdom] || player.kingdom;
  const level = player.level || 1;
  const rank = player.rank || 'مجند';
  const coins = player.coins || 0;

  // آلية عرض الرتب اليدوية القيادية مع اسم المملكة أو اسم المدينة بدقة
  let rankDisplay = rank;
  if (['الحاكم', 'نائب الحاكم', 'الجنرال'].includes(rank)) {
    rankDisplay = `${rank} ${kingdomAr}`;
  } else if (['قائد', 'مدرب', 'حارس'].includes(rank)) {
    const cityName = player.registeredCityName || 'العاصمة';
    rankDisplay = `${rank} مدينة ${cityName}`;
  }

  // إعداد سطر الرتبة مع الإنذارات تلقائياً إن وجدت
  const rankLine = player.warnings && player.warnings > 0 
    ? ` 『 الرتبة 』                ❮◄ ${rankDisplay}\n 『 الإنذارات 』            ❮◄ ${'🔴'.repeat(player.warnings)}`
    : ` 『 الرتبة 』                ❮◄ ${rankDisplay}`;

  const now = Date.now();
  const activeEffects = [];

  if (player.speedBoost && new Date(player.speedBoost.expires).getTime() > now) {
    const remaining = new Date(player.speedBoost.expires).getTime() - now;
    const totalSec = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const timeStr = hours > 0 ? `${hours} ساعة و ${mins} دقيقة` : `${mins} دقيقة`;
    activeEffects.push(`◆ مسرع الزمن ⚡ ( يبقى ${timeStr} )`);
  }

  if (player.rageBoost && new Date(player.rageBoost.expires).getTime() > now) {
    const remaining = new Date(player.rageBoost.expires).getTime() - now;
    const totalSec = Math.floor(remaining / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const timeStr = hours > 0 ? `${hours} ساعة و ${mins} دقيقة` : `${mins} دقيقة`;
    activeEffects.push(`◆ خلطة الثور الغاضب 🔥 ( يبقى ${timeStr} )`);
  }

  if (player.lifeElixir) {
    activeEffects.push(`◆ إكسير الحياة 💎 ( نشط - يُفعّل عند الموت )`);
  }

  const effectsLine = `『 التأثيرات 』❮◄\n` +
    (activeEffects.length > 0 ? activeEffects.join('\n') : '◆ لا يوجد تأثيرات نشطة');

  const effectsSection = activeEffects.length > 0
    ? `\n═════════════════\n${effectsLine}`
    : '';

  // 🛡️ التحقق مما إذا كان اللاعب هو الإمبراطور أو نائب الإمبراطور لإلغاء عرض سطر المملكة تماماً
  const isEmperorOrDeputy = player.rank === 'الامبراطور' || player.rank === 'نائب الامبراطور';
  const kingdomSection = isEmperorOrDeputy 
    ? '' 
    : `\n『 المملكة 』       ❮◄ ${kingdomAr}`;

  const msg = `⟣─────━ ⊰${symbol}⊱━─────⟢

 『 اللقب 』   ❮◄ ${player.nickname}${kingdomSection}
『 الفئة 』                ❮◄ ${player.class}

      𖤗 ═════════════ 𖤗   

『 الكوينز 』   ❮◄ ${coins}
『 المستوى 』      ❮◄ ${level}
 ${rankLine}

═════════════════
        𝑬𝑷┇${epBar} ${player.ep || 1000}
            
       𝑯𝑷┇${hpBar} ${player.hp || 1000}${effectsSection}
             
⟣─────━ ⊰${symbol}⊱━─────⟢`;

  await sendReply(api, msg, messageID, threadID);
}

module.exports = { handleMalafi };