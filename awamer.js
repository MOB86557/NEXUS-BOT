// awamer.js — نظام عرض ومناولة صفحات أوامر البوت
const { getKingdomByThreadId } = require('./utils');
const { getPlayer, getCustomCommands } = require('./database');

const PAGE_SIZE = 12;

const DEFAULT_COMMANDS = [
  { text: '➤  ملفي ┇عرض تفاصيل اللاعب', kingdoms: [] },
  { text: '➤ فيفا ┇عرض تفاصيل منتخبك وجدول مبارياته بكأس العالم 2026', kingdoms: [] },
  { text: '➤ الحقيبة┇عرض حقيبة الاغراض والموارد', kingdoms: [] },
  { text: '➤ تحويل (عدد) كوينز الى (لقب) ┇ لتحويل الكوينز للاعب اخر', kingdoms: [] },
  { text: '➤ ارسال (اسم الغرض ) الى (لقب) ┇ ارسال غرض من الحقيبة للاعب اخر', kingdoms: [] },
  { text: '➤ صيد ┇ صيد الموارد', kingdoms: ['solfare'] },
  { text: '➤ حفر ┇التنقيب عن الموارد', kingdoms: ['murdak'] },
  { text: '➤ جمع ┇البحث عن الموارد', kingdoms: ['niravil'] },
  { text: '➤ تصنيع┇صنع الاسلحة والدروع والمستلزمات والمواد', kingdoms: [] },
  { text: '➤ المتجر┇متجر نيكسوس الرسمي', kingdoms: [] },
  { text: '➤ السوق  ┇ اشتري وبع وتبادل الموارد والاغراض مع اللاعبين الاخرين', kingdoms: [] },
  { text: '➤ هجوم (اسم السلاح) على (لقب)┇لاستعمال اي سلاح على شخص اخر', kingdoms: [] },
  { text: '➤وضعية القتال ┇الانتقال لوضع القتال', kingdoms: [] },
  { text: '➤ تجهيز الدرع ┇ لتجهيز الدرع من اجل حمايتك تلقائيا اذا تم الهجوم عليك', kingdoms: [] },
  { text: '➤ استعمال (اسم الغرض ) ┇ لاستعمال المواد او الاغراض القابلة للاستعمال', kingdoms: [] },
  { text: '➤ كوينز النشر┇ربح الكوينز من نشر المنشورات', kingdoms: [] },
  { text: '➤ تقرير┇تقرير عن اقتصاد الممالك الثلاثة واغنى اللاعبين', kingdoms: [] },
  { text: '➤البنك┇استثمر او اقترض او خزن كوينزك لدى بنك نيكسوس', kingdoms: [] },
  { text: '➤ مسابقة الدعوات ┇مسابقة يومية وجوائز للاعبين الاكثر دعوة', kingdoms: [] },
  { text: '➤مسابقة النشر ┇مسابقة يومية وجوائز للاعبين الاكثر نشرا', kingdoms: [] },
  { text: '➤ دار الالعاب ┇ العاب جماعية وفردية ممتعة', kingdoms: [] },
  { text: '➤ الاعدادات ┇ ضبط إعدادت اخرى', kingdoms: [] },
  { text: '➤ ايجنت ┇ تحدث مع الذكاء الاصطناعي المتاح', kingdoms: [] },
  { text: '➤ قروب ┇ رابط قروب نظام نيكسوس الرسمي', kingdoms: [] },
  { text: '➤ ترجمة┇ ترجمة اي رسالة لاي لغة تريد', kingdoms: [] },
  { text: '➤ رسم (الوصف) ┇ انشاء صور بالذكاء الاصطناعي', kingdoms: [] },
  { text: '➤ قول (النص) ┇ اجعل الذكاء الاصطناعي يتكلم', kingdoms: [] },
  { text: '➤ بحث ┇ ايجاد اسم الانمي وتفاصيله من صورة', kingdoms: [] },
  { text: '➤ ايديت ┇ تعديل الصور', kingdoms: [] },
  { text: '➤ اقتراح انمي ┇ يقترح لك انمي حسب التصنيف الذي تريده', kingdoms: [] }
];

async function fetchCommandsList() {
  try {
    const list = await getCustomCommands();
    return list || DEFAULT_COMMANDS;
  } catch (e) {
    return DEFAULT_COMMANDS;
  }
}

function getFilteredCommands(rawList, kingdom) {
  return rawList
    .filter(cmd => {
      if (cmd.kingdoms && cmd.kingdoms.length > 0) {
        return cmd.kingdoms.includes(kingdom);
      }
      return true;
    })
    .map(cmd => cmd.text);
}

async function sendCommandsPage(api, event, pageNum = 1) {
  const { threadID, senderID, messageID } = event;
  const kingdom = getKingdomByThreadId(threadID);
  if (!kingdom) return;

  const player = await getPlayer(senderID);
  if (!player) {
    await new Promise((resolve) => {
      api.sendMessage(
        { body: `𓆫─━━࿇━━━──━━━࿇━━─𓆫\n              『 تنبيه ⚠ 』\n\nيجب التسجيل اولاً\nارسل 《 تسجيل 》للانضمام\n\n     𓆫─━━࿇━━━──━━━࿇━━─𓆫` },
        threadID, () => resolve()
      );
    });
    return;
  }

  const rawList = await fetchCommandsList();
  const cmds = getFilteredCommands(rawList, kingdom);
  const totalPages = Math.ceil(cmds.length / PAGE_SIZE);
  const page = Math.max(1, Math.min(pageNum, totalPages));
  const start = (page - 1) * PAGE_SIZE;
  const pageCmds = cmds.slice(start, start + PAGE_SIZE);

  const body =
    `╗═════━━━❖━━━═════╔\n` +
    ` ⊱                   الاوامر.                     ⊰  \n` +
    `╝═════━━━❖━━━═════╚\n` +
    pageCmds.join('\n') +
    `\n━════════════════━\n` +
    `● الصفحة ${page}/${totalPages}\n` +
    `● عدد الاوامر : ${cmds.length}\n` +
    `● للانتقال لصفحة اخرى رد على هذه الرسالة برقم الصفحة\n` +
    `━════════════════━`;

  await new Promise((resolve) => {
    api.sendMessage({ body }, threadID, () => resolve());
  });
}

async function handleAwamer(api, event) {
  await sendCommandsPage(api, event, 1);
}

async function handleAwamerPage(api, event, pageNum) {
  await sendCommandsPage(api, event, pageNum);
}

module.exports = { handleAwamer, handleAwamerPage, DEFAULT_COMMANDS, fetchCommandsList };