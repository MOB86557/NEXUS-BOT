const fs = require('fs');
const path = require('path');
const { sendMessage } = require('../utils');
const { setAdminSession, deleteAdminSession, getAllAgents, countAgentConversations, getAgentByName, clearAllAgentConversations, clearAgentConversationsByName, addAgent, updateAgent, deleteAgent } = require('../database');

const _cfgRead = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8')); } catch(_) { return {}; } };
const _cfgWrite = (c) => { try { fs.writeFileSync(path.join(__dirname, '../config.json'), JSON.stringify(c, null, 2), 'utf8'); } catch(e) {} };

function getMemoryLimit()         { return parseInt(_cfgRead().memoryLimit) || 10; }
function getConversationTimeout() { return parseInt(_cfgRead().conversationTimeout) || 20; }
function saveMemoryLimit(n)       { const c = _cfgRead(); c.memoryLimit = n; _cfgWrite(c); }
function saveConvTimeout(m)       { const c = _cfgRead(); c.conversationTimeout = m; _cfgWrite(c); }

async function handleNexusAI(api, event) {
  const { threadID, senderID } = event;
  const agents = await getAllAgents();
  const lines  = agents.length ? agents.map((a, i) => `│ ${i + 1}. ◈ ${a.name}`).join('\n') : `│ › لا يوجد وكلاء مضافون بعد`;
  await setAdminSession(senderID, { state: 'NEXUS_AI_MAIN', agents: agents.map(a => a.name) });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦  نيكسوس — الذكاء الاصطناعي  ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الوكلاء الحاليون 」\n${lines}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n│ 1 › اضافة وكيل جديد\n│ 2 › تعديل برومت وكيل\n│ 3 › حذف وكيل\n│ 4 › خروج\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleZakira(api, event, sub) {
  const { threadID } = event;
  if (!sub) {
    const agents  = await getAllAgents();
    const lines   = agents.length ? (await Promise.all(agents.map(async a => { const cnt = await countAgentConversations(a.name); return `│  ◈ ${a.name}  ←  ${cnt} محادثة`; }))).join('\n') + '\n' : `│  لا يوجد وكلاء\n`;
    const total   = await countAgentConversations(null);
    await sendMessage(api,
      `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n      🧠  إدارة ذاكرة الوكلاء\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
      `╮───∙⋆⋅「 الإعداد الحالي 」\n│  حد الذاكرة : ${getMemoryLimit()} تبادل\n│  انتهاء المحادثة : بعد ${getConversationTimeout()} دقيقة\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
      `╮───∙⋆⋅「 المحادثات المخزنة 」\n${lines}│  الإجمالي: ${total} محادثة\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
      `╮───∙⋆⋅「 الأوامر 」\n│  ذاكرة تحديد [رقم]\n│  ذاكرة وقت [دقائق]\n│  ذاكرة مسح\n│  ذاكرة مسح [اسم الوكيل]\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID); return;
  }
  const setM = sub.match(/^تحديد\s+(\d+)$/);
  if (setM) { const n = parseInt(setM[1]); if (n < 1 || n > 100) { await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › الرقم بين 1 و 100\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; } saveMemoryLimit(n); await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › ✅ تم تحديث الحد إلى ${n} تبادل\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  if (sub === 'مسح') { const cnt = await clearAllAgentConversations(); await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › ✅ تم مسح ${cnt} محادثة\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const clrM = sub.match(/^مسح\s+(.+)$/);
  if (clrM) { const nm = clrM[1].trim(); if (!(await getAgentByName(nm))) { await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › لا يوجد وكيل باسم "${nm}"\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; } const cnt = await clearAgentConversationsByName(nm); await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › ✅ تم مسح ذاكرة ${nm} (${cnt})\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  const tmM = sub.match(/^وقت\s+(\d+)$/);
  if (tmM) { const m = parseInt(tmM[1]); if (m < 1 || m > 1440) { await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › الوقت بين 1 و 1440 دقيقة\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; } saveConvTimeout(m); const h = m >= 60 ? ` (${(m/60).toFixed(1)} ساعة)` : ''; await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › ✅ وقت الانتهاء : ${m} دقيقة${h}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  await sendMessage(api, `╮───∙⋆⋅「 ذاكرة 」\n│\n│ › أمر غير معروف\n│ › أرسل 《 ذاكرة 》 لعرض الأوامر\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

async function handleNexusAISession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج' || text === '4') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  if (session.state === 'NEXUS_AI_MAIN') {
    if (text === '1') { await setAdminSession(senderID,{state:'NEXUS_ADD_NAME'}); await sendMessage(api,`╮───∙⋆⋅「 اضافة وكيل 」\n│\n│ › اكتب اسم الوكيل\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
    if (text === '2') { const a = await getAllAgents(); if (!a.length){await sendMessage(api,`⚠️ لا يوجد وكلاء`,threadID);await deleteAdminSession(senderID);return;} let m=`╮───∙⋆⋅「 تعديل البرومت 」\n│\n`;a.forEach((x,i)=>{m+=`│ ${i+1}. ${x.name}\n`;}); m+=`│\n│ › اكتب رقم الوكيل\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`; await setAdminSession(senderID,{state:'NEXUS_EDIT_SELECT',agents:a.map(x=>x.name)}); await sendMessage(api,m,threadID); return; }
    if (text === '3') { const a = await getAllAgents(); if (!a.length){await sendMessage(api,`⚠️ لا يوجد وكلاء`,threadID);await deleteAdminSession(senderID);return;} let m=`╮───∙⋆⋅「 حذف وكيل 」\n│\n`;a.forEach((x,i)=>{m+=`│ ${i+1}. ${x.name}\n`;}); m+=`│\n│ › اكتب رقم الوكيل\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`; await setAdminSession(senderID,{state:'NEXUS_DELETE_SELECT',agents:a.map(x=>x.name)}); await sendMessage(api,m,threadID); return; }
    await sendMessage(api, `⚠️ اختر من 1 إلى 4`, threadID); return;
  }
  if (session.state === 'NEXUS_ADD_NAME') { if (!text||text.length<2){await sendMessage(api,`⚠️ اسم قصير جداً`,threadID);return;} if (await getAgentByName(text)){await sendMessage(api,`⚠️ يوجد وكيل بهذا الاسم`,threadID);return;} await setAdminSession(senderID,{state:'NEXUS_ADD_KEY',agentName:text}); await sendMessage(api,`╮───∙⋆⋅「 مفتاح Groq 」\n│\n│ › الوكيل : ${text}\n│\n│ › أرسل مفتاح API من Groq\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
  if (session.state === 'NEXUS_ADD_KEY') { if (!text.startsWith('gsk_')||text.length<20){await sendMessage(api,`⚠️ المفتاح يجب أن يبدأ بـ gsk_\nأعد المحاولة أو 《 خروج 》`,threadID);return;} await setAdminSession(senderID,{state:'NEXUS_ADD_PROMPT',agentName:session.agentName,apiKey:text}); await sendMessage(api,`╮───∙⋆⋅「 الشخصية والبرومت 」\n│\n│ › الوكيل : ${session.agentName}\n│\n│ › الآن اكتب البرومت\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
  if (session.state === 'NEXUS_ADD_PROMPT') { if (!text||text.length<10){await sendMessage(api,`⚠️ البرومت قصير جداً`,threadID);return;} await addAgent({ name: session.agentName, apiKey: session.apiKey, prompt: text, status: 'active' }); await deleteAdminSession(senderID); await sendMessage(api,`╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦ تم إضافة الوكيل ✅️ ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n╮───∙⋆⋅「 التفاصيل 」\n│ › الاسم  : ${session.agentName}\n│ › الحالة : نشط 🟢\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\nاكتب 《 ايجنت 》 لرؤيته`,threadID); return; }
  if (session.state === 'NEXUS_EDIT_SELECT') { const idx=parseInt(text,10)-1; if(isNaN(idx)||idx<0||idx>=(session.agents||[]).length){await sendMessage(api,`⚠️ رقم غير صحيح`,threadID);return;} await setAdminSession(senderID,{state:'NEXUS_EDIT_PROMPT',agentName:session.agents[idx]}); await sendMessage(api,`╮───∙⋆⋅「 تعديل برومت 」\n│\n│ › الوكيل : ${session.agents[idx]}\n│\n│ › اكتب البرومت الجديد\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
  if (session.state === 'NEXUS_EDIT_PROMPT') { if (!text||text.length<10){await sendMessage(api,`⚠️ البرومت قصير جداً`,threadID);return;} await updateAgent(session.agentName,{prompt:text}); await deleteAdminSession(senderID); await sendMessage(api,`╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n│ › الوكيل : ${session.agentName}\n│ › البرومت : تم تحديثه\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
  if (session.state === 'NEXUS_DELETE_SELECT') { const idx=parseInt(text,10)-1; if(isNaN(idx)||idx<0||idx>=(session.agents||[]).length){await sendMessage(api,`⚠️ رقم غير صحيح`,threadID);return;} const name=session.agents[idx]; await deleteAgent(name); await deleteAdminSession(senderID); await sendMessage(api,`╮───∙⋆⋅「 تم الحذف 🗑️ 」\n│\n│ › الوكيل : ${name}\n│ › تم حذفه بنجاح\n╯───────∙⋆⋅ ※ ⋅⋆∙`,threadID); return; }
}

module.exports = {
  handleNexusAI,
  handleZakira,
  handleNexusAISession
};