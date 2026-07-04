/*
 * ═══════════════════════════════════════════════════════════════════════
 *  ranks.js — نظام الرتب والترقيات والكنية التلقائية واليدوية في نيكسوس
 * ═══════════════════════════════════════════════════════════════════════
 */

'use strict';

const { getDB, updatePlayer, getPlayer } = require('./database');
const { sendMessage, sendReply } = require('./utils');
const config = require('./config.json');

// الرتب بالترتيب التصاعدي (أصبحت حارس رتبة يدوية تحت مدرب مباشرة)
const RANKS_ORDER = [
  'متدرب',
  'مجند',
  'جندي',
  'مخضرم',
  'محارب',
  'حارس',
  'مدرب',
  'قائد',
  'جنرال',
  'نائب الحاكم',
  'الحاكم',
  'نائب الامبراطور',
  'الامبراطور'
];

// صلاحيات ووصف كل رتبة (بما في ذلك التحديث الجديد لصلاحيات الحارس)
const RANK_PRIVILEGES = {
  'متدرب': 'انت قيد التدريب وملزم بتنفيذ اوامر المدرب ، القائد ، الجنرال ، نائب الحاكم ، والحاكم لمملكتك فقط ، والامبراطور ، سيرشدك المدرب في بدايتك ويعلمك طريقة استخدام البوت وطريقة عمل نضام نيكسوس حتى تحترف اللعبة',
  'مجند': 'انت مجند لاتزال في بداية الرحلة تعلم واكتسب الخبرة من مراقبة اللاعبين المحترفين انت ملزم بتنفيذ اوامر القائد ، الجنرال ، نائب الحاكم ، والحاكم لمملكتك فقط ، والامبراطور',
  'جندي': 'انت جندي لديك خبرة كافية لتعتمد على نفسك قم بتطوير نفسك اجمع الاسلحة والكوينز والمهارات واستعد للدفاع عن نفسك وعلى مملكتك في اي وقت انت ملزم بتنفيذ اوامر القائد ، الجنرال ، نائب الحاكم ، والحاكم في مملكتك فقط ، والامبراطور',
  'مخضرم': 'انت لاعب محترف لديك خبرة وافية ويمكن للقادة الاعتماد عليك في المهام الصعبة والمهمة انت ملزم بتنفيذ اوامر المدرب ، القائد ، الجنرال ، نائب الحاكم ، والحاكم في مملكتك فقط ، والامبراطور',
  'محارب': 'انت لاعب متمرس تخطيت الكثير من التحديات انت الان وصلت لاخر رتبة غير ادارية لست ملزما بتنفيذ اوامر المدرب او القائد ، ملزم بتنفيذ اوامر نائب الحاكم والحاكم في مملكتك فقط والامبراطور',
  'حارس': 'انت حارس مسؤول عن امن مدينة المملكة الموجود فيها ابلغ عن من يخالف القوانين اكتشف الجواسيس من الممالك الاخرى واحمي مملكتك انت ملزم بتنفيذ اوامر القائد و  الجنرال والحاكم ونائبه في مملكتك فقط والامبراطور ونائبه',
  'مدرب': 'انت مسؤول عن اللاعبين الجدد قم بتدريبهم و توجيههم عليك الاجابة على كل اسئلتهم وتعليمهم طريقة استعمال البوت مدة تدريب اللاعب الجديد هي 3 ايام بعدها يصبح مجندا ، انت ملزم بتنفيذ اوامر القائد ، الجنرال ، الحاكم ونائب الحاكم ، والامبراطور',
  'قائد': 'انت مسؤول عن المدينة التي انت فيها بالمملكة حيث تقوم بتوجيه اللاعبين حسب الخطط التي تضعها او اوامر الجنرال و الحاكم لك للمملكة',
  'جنرال': 'انت مسؤول عن الجيش كاملا في جميع مدن المملكة والذي يشمل ( المجندين ، الجنود ، المخضرمين و الحراس ) انت المسؤول عن الخطط في حالة الحرب واستراتيجيات الهجوم',
  'نائب الحاكم': 'انت نائب الحاكم مساعده ومستشاره على مدن المملكة',
  'الحاكم': 'انت حاكم المملكة مسؤول عن جميع المدن التي تنتمي لمملكتك وعن كل الرتب الاقل منك',
  'نائب الامبراطور': 'مساعد الامبراطور ومستشاره في كافة شؤون وإدارة نظام نيكسوس والممالك الثلاث',
  'الامبراطور': 'انت قائد النظام الأعلى والمسؤول عن إدارة جميع الممالك والقرارات العليا والتحكم بالرتب'
};

/**
 * دالة التحقق من شروط الترقيات التلقائية وتطبيقها للاعب معين
 */
async function checkAndApplyPromotions(fbId, api, threadID) {
  try {
    const player = await getPlayer(fbId);
    if (!player) return;

    const currentRank = player.rank || 'متدرب';
    
    // إذا كانت رتبته يدوية بالفعل (حارس فما فوق)، لا تنطبق عليه الترقيات التلقائية لمنع تخفيض رتبته
    const currentRankIndex = RANKS_ORDER.indexOf(currentRank);
    if (currentRankIndex >= RANKS_ORDER.indexOf('حارس')) return;

    let nextRank = null;

    // 1. من متدرب إلى مجند (بعد 3 أيام من التسجيل)
    if (currentRank === 'متدرب') {
      const regTime = player.registeredAt ? new Date(player.registeredAt).getTime() : Date.now();
      const diffDays = (Date.now() - regTime) / (1000 * 60 * 60 * 24);
      if (diffDays >= 3) {
        nextRank = 'مجند';
      }
    }

    // 2. من مجند إلى جندي (المستوى 4)
    if (currentRank === 'مجند') {
      if ((player.level || 1) >= 4) {
        nextRank = 'جندي';
      }
    }

    // 3. من جندي إلى مخضرم (مستوى 10 + هجومين بسلاح + 5 منشورات نشر مقبولة)
    if (currentRank === 'جندي') {
      const levelOk = (player.level || 1) >= 10;
      const attacksOk = (player.weaponAttacksCount || 0) >= 2;
      const nashrOk = (player.successfulNashrCount || 0) >= 5;

      if (levelOk && attacksOk && nashrOk) {
        nextRank = 'مخضرم';
      }
    }

    // 4. من مخضرم إلى محارب (تلقائي عند الوصول لمستوى 12)
    if (currentRank === 'مخضرم') {
      if ((player.level || 1) >= 12) {
        nextRank = 'محارب';
      }
    }

    if (nextRank) {
      // حفظ الترقية في قاعدة البيانات ووسمها للإشعار لاحقاً عند أول رسالة يرسلها
      await updatePlayer(fbId, {
        rank: nextRank,
        pendingPromotionNotify: {
          oldRank: currentRank,
          newRank: nextRank
        }
      });

      // تغيير كنية اللاعب تلقائياً لمطابقة رتبته الجديدة بالقروب
      const { changePlayerNickname } = require('./dukhul');
      const groupId = config.groupes[player.kingdom];
      if (groupId) {
        try {
          await changePlayerNickname(api, groupId, fbId, player.nickname, nextRank, player.class);
        } catch (e) {
          console.error('[Ranks] Error changing nickname on auto promotion:', e);
        }
      }

      // تاريخ الوصول للغرض الإحصائي
      if (nextRank === 'مخضرم') {
        await updatePlayer(fbId, { reachedMokhtharamAt: new Date() });
      }

      // التحقق التكراري لرؤية ما إذا كان مؤهلاً لرتبة أبعد مباشرة
      await checkAndApplyPromotions(fbId, api, threadID);
    }
  } catch (err) {
    console.error('[Ranks] خطأ أثناء فحص الترقيات التلقائية:', err);
  }
}

/**
 * التحقق من قيود الأعداد القصوى للرتب الإدارية اليدوية
 */
async function checkManualRankLimits(targetRank, targetKingdom, targetCityName) {
  const db = getDB();
  
  if (targetRank === 'الامبراطور') {
    const count = await db.collection('players').countDocuments({ rank: 'الامبراطور' });
    if (count >= 1) return { allowed: false, reason: 'لا يمكن تعيين أكثر من إمبراطور واحد في النظام بأكمله!' };
  }

  if (['الحاكم', 'نائب الحاكم', 'جنرال'].includes(targetRank)) {
    const count = await db.collection('players').countDocuments({ rank: targetRank, kingdom: targetKingdom });
    if (count >= 1) return { allowed: false, reason: `يوجد بالفعل لاعب برتبة (${targetRank}) في مملكة ${targetKingdom} (الحد الأقصى: 1 لكل مملكة)` };
  }

  if (targetRank === 'قائد') {
    const count = await db.collection('players').countDocuments({ rank: 'قائد', registeredCityName: targetCityName, kingdom: targetKingdom });
    if (count >= 1) return { allowed: false, reason: `يوجد بالفعل قائد معين لهذه المدينة (${targetCityName}) في هذه المملكة.` };
  }

  if (targetRank === 'مدرب') {
    const count = await db.collection('players').countDocuments({ rank: 'مدرب', registeredCityName: targetCityName, kingdom: targetKingdom });
    if (count >= 2) return { allowed: false, reason: `تم الوصول للحد الأقصى من المدربين في هذه المدينة (${targetCityName}) (الحد الأقصى: 2 مدربين لكل مدينة)` };
  }

  return { allowed: true };
}

/**
 * عرض تفاصيل رتبة اللاعب والمهام المطلوبة للرتبة القادمة
 */
async function handleMyRank(api, event, player) {
  const currentRank = player.rank || 'متدرب';
  const privileges = RANK_PRIVILEGES[currentRank] || 'لا توجد تفاصيل محددة لهذه الرتبة.';
  
  let nextRankName = 'رتبة إدارية يدوية';
  let requirementsText = 'تمنح هذه الرتبة وما يليها يدوياً فقط من قبل الإمبراطور أو نائب الإمبراطور أو مشرفي النظام بناءً على تميزك ونشاطك.';

  const regTime = player.registeredAt ? new Date(player.registeredAt).getTime() : Date.now();
  const diffDays = (Date.now() - regTime) / (1000 * 60 * 60 * 24);

  if (currentRank === 'متدرب') {
    nextRankName = 'مجند';
    requirementsText = `◆ البقاء مسجلاً في البوت لمدة 3 أيام متواصلة.\n › تقدمك الحالي: ${Math.min(3, diffDays).toFixed(1)} / 3 أيام`;
  } 
  else if (currentRank === 'مجند') {
    nextRankName = 'جندي';
    requirementsText = `◆ الوصول إلى مستوى اللاعب 4.\n › مستواك الحالي: مستوى ${player.level || 1} / 4`;
  } 
  else if (currentRank === 'جندي') {
    nextRankName = 'مخضرم';
    const lvl = player.level || 1;
    const att = player.weaponAttacksCount || 0;
    const nsh = player.successfulNashrCount || 0;
    requirementsText = `◆ الوصول إلى مستوى اللاعب 10 (${Math.min(10, lvl)}/10)\n◆ الهجوم مرتين بسلاح على أي لاعب (${Math.min(2, att)}/2)\n◆ نشر 5 منشورات ناجحة في كوينز النشر (${Math.min(5, nsh)}/5)`;
  } 
  else if (currentRank === 'مخضرم') {
    nextRankName = 'محارب';
    requirementsText = `◆ الوصول إلى المستوى 12.\n › مستواك الحالي: مستوى ${player.level || 1} / 12`;
  }
  else if (currentRank === 'محارب') {
    nextRankName = 'حارس';
    requirementsText = `تمنح هذه الرتبة وما يليها يدوياً فقط من قبل الإمبراطور أو نائب الإمبراطور أو مشرفي النظام بناءً على تميزك ونشاطك لحماية مدن وممالك نيكسوس.`;
  }

  const msg = 
    `؜╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n` +
    `                     ✦ الرتبة ✦\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮─∙⋆⋅「 رتبتك الحالية و صلاحياتك」\n` +
    `│\n` +
    `│ › الرتبة     :  ${currentRank}\n` +
    `│ ❐ الصلاحيات  : \n` +
    `│ ${privileges}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮──∙⋆⋅「 مهام الترقية」\n` +
    `│ › الرتبة  التالية : ${nextRankName}\n` +
    `│ ❐ المطلوب للترقية : \n` +
    `${requirementsText.split('\n').map(l => '│ ' + l).join('\n')}\n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙`;

  await sendReply(api, msg, event.messageID, event.threadID);
}

/**
 * عرض وإظهار تقرير "رتب الادارة" حسب كل مملكة والشواغر
 */
async function handleRanksAlIdarah(api, event) {
  const db = getDB();
  const kingdoms = [
    { key: 'murdak', name: 'مورداك' },
    { key: 'niravil', name: 'نيرافيل' },
    { key: 'solfare', name: 'سولفارا' }
  ];
  
  const ranksToQuery = ['الحاكم', 'نائب الحاكم', 'الجنرال', 'قائد', 'مدرب', 'حارس'];
  
  let msg = `╮───────∙⋆⋅「 👑 رتب الإدارة 」\n`;
  
  for (const kd of kingdoms) {
    msg += `\n❐ مملكة ${kd.name} \n`;
    
    const players = await db.collection('players').find({
      kingdom: kd.key,
      rank: { $in: ranksToQuery }
    }).toArray();
    
    const getNicknamesForRank = (rankName) => {
      const matches = players.filter(p => p.rank === rankName);
      if (matches.length === 0) return '🚫';
      // دمج ودعم التعدد مع تنظيم محاذاتهم بشكل منسق تحت بعضهم
      return matches.map(p => p.nickname || p.name || p.fbId).join('\n│             ');
    };
    
    msg += `│ الحاكم  : ${getNicknamesForRank('الحاكم')}\n`;
    msg += `│ نائب الحاكم : ${getNicknamesForRank('نائب الحاكم')}\n`;
    msg += `│ الجنرال : ${getNicknamesForRank('الجنرال')}\n`;
    msg += `│ القائد : ${getNicknamesForRank('قائد')}\n`;
    msg += `│ المدرب : ${getNicknamesForRank('مدرب')}\n`;
    msg += `│ الحارس : ${getNicknamesForRank('حارس')}\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
  }
  
  msg += `╯───────∙⋆⋅ ※ ⋅⋆∙───────◈`;
  await sendMessage(api, msg, event.threadID);
}

module.exports = {
  RANKS_ORDER,
  RANK_PRIVILEGES,
  checkAndApplyPromotions,
  checkManualRankLimits,
  handleMyRank,
  handleRanksAlIdarah
};