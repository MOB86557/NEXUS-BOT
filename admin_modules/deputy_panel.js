// admin_modules/deputy_panel.js — لوحة تحكم نائب الامبراطور (بانكاي، معلومات، عقوبة، تجاهل، اضافة، مهام)

const config = require('../config.json');
const { sendReply, kingdomNamesAr } = require('../utils');
const { isAdmin } = require('./auth');
const { kickFromAllGroups } = require('./helpers');
const { getPlayer, updatePlayer, setAdminSession, deleteAdminSession, getDB } = require('../database');
const { notifyAdmins } = require('../musa3idat');
const { checkMutedGroupMessage, checkAndCleanExpiredIgnores } = require('./ignore_system');

// يعالج أوامر لوحة تحكم نائب الامبراطور (لوحة التحكم، بانكاي، معلومات، عقوبة، تجاهل، فك التجاهل، اضافة، مهام)
async function handleDeputyEmperorCommands(api, event, player) {
  const { senderID, threadID } = event;
  const text = (event.body || '').trim();
  const db = getDB();

  const isEmperor = player && player.rank === 'الامبراطور';
  const isDeputy  = player && player.rank === 'نائب الامبراطور';
  if (!isEmperor && !isDeputy) return false;

  // فحص الصمت أولاً في المجموعات
  if (await checkMutedGroupMessage(api, event)) return true;

  // تنظيف جلسات التجاهل المنتهية
  await checkAndCleanExpiredIgnores(api).catch(() => {});

  if (text === 'لوحة التحكم') {
    const panelTitle = isEmperor ? 'لوحة تحكم الامبراطور' : 'لوحة تحكم نائب الامبراطور';
    const panelMsg =
      `╗═════━━━❖━━━═════╔\n` +
      `         ${panelTitle}           \n` +
      `╝═════━━━❖━━━═════╚\n\n` +
      `❖ بانكاي《طرد اي لاعب 》\n` +
      `❖ معلومات《 عرض معلومات اللاعب 》\n` +
      `❖ عقوبة 《اضافة انذار للاعب 》\n` +
      `❖ تجاهل / فك التجاهل 《 التحكم في تجاهل اللاعبين 》\n` +
      `❖ اضافة 《 اضافتك لقروبات النظام 》\n` +
      (isDeputy ? `❖ مهام 《المهام الواجب تنفيذها 》` : ``);
    await sendReply(api, panelMsg, event.messageID, threadID);
    return true;
  }

  if (text === 'بانكاي' || text.startsWith('بانكاي ')) {
    if (!event.messageReply) {
      await sendReply(api, `رد على رسالة الشخص الذي تود طرده بكلمة بانكاي ..`, event.messageID, threadID);
      return true;
    }
    const targetID = String(event.messageReply.senderID);

    // حماية الإدارة والامبراطور
    const victimPlayer = await getPlayer(targetID);
    const targetIsAdminOrEmp = isAdmin(targetID) || (victimPlayer && victimPlayer.rank === 'الامبراطور');
    if (targetIsAdminOrEmp) {
      await sendReply(api, `❌ خطأ: لا يمكنك طرد (بانكاي) الإمبراطور أو المشرفين.`, event.messageID, threadID);
      return true;
    }

    const victimNick = victimPlayer ? victimPlayer.nickname : targetID;
    const victimKingdom = victimPlayer ? (kingdomNamesAr[victimPlayer.kingdom] || victimPlayer.kingdom) : 'مجهولة';
    const victimCity = victimPlayer ? (victimPlayer.registeredCityName || 'العاصمة') : 'العاصمة';

    try {
      await kickFromAllGroups(api, targetID);

      const alertMsg = `🚨 إشعار طرد:\nبأن نائب الحاكم (${player.nickname}) طرد اللاعب (${victimNick}) من مملكة (${victimKingdom}) من عاصمة (${victimCity})`;
      await notifyAdmins(api, alertMsg);

      await sendReply(api, `✅ تم طرد اللاعب [${victimNick}] من كافة القروبات وإرسال إشعار للإدارة.`, event.messageID, threadID);
    } catch (e) {
      await sendReply(api, `❌ فشل في طرد العضو أو إرسال الإشعار.`, event.messageID, threadID);
    }
    return true;
  }

  if (text === 'معلومات') {
    if (!event.messageReply) {
      await sendReply(api, `❌ يرجى الرد على رسالة اللاعب المستهدف لعرض معلوماته.`, event.messageID, threadID);
      return true;
    }
    const targetID = String(event.messageReply.senderID);

    // حماية الإدارة والامبراطور
    const victimPlayer = await getPlayer(targetID);
    const targetIsAdminOrEmp = isAdmin(targetID) || (victimPlayer && victimPlayer.rank === 'الامبراطور');
    if (targetIsAdminOrEmp) {
      await sendReply(api, `❌ خطأ: لا يمكنك استعراض معلومات الإمبراطور أو المشرفين.`, event.messageID, threadID);
      return true;
    }

    const moderation = require('./moderation');
    await moderation.handleMa3loomat(api, event, targetID);
    return true;
  }

  if (text === 'عقوبة') {
    if (!event.messageReply) {
      await sendReply(api, `❌ يرجى الرد على رسالة اللاعب المستهدف لتطبيق العقوبة (إضافة إنذار).`, event.messageID, threadID);
      return true;
    }
    const targetID = String(event.messageReply.senderID);

    // حماية الإدارة والامبراطور
    const victimPlayer = await getPlayer(targetID);
    const targetIsAdminOrEmp = isAdmin(targetID) || (victimPlayer && victimPlayer.rank === 'الامبراطور');
    if (targetIsAdminOrEmp) {
      await sendReply(api, `❌ خطأ: لا يمكنك معاقبة الإمبراطور أو المشرفين.`, event.messageID, threadID);
      return true;
    }

    if (!victimPlayer) {
      await sendReply(api, `❌ هذا المستخدم غير مسجل في نظام نيكسوس.`, event.messageID, threadID);
      return true;
    }

    const currentWarnings = (victimPlayer.warnings || 0) + 1;
    await updatePlayer(targetID, { warnings: currentWarnings });

    try {
      const gid = config.groupes[victimPlayer.kingdom];
      if (gid) {
        const { changePlayerNickname } = require('../dukhul');
        await changePlayerNickname(
          api, gid, targetID, victimPlayer.nickname, victimPlayer.rank || 'مجند', victimPlayer.class, currentWarnings
        );
      }
    } catch (nickErr) {
      console.error('[Deputy Punishment] Failed to update nickname:', nickErr.message);
    }

    await sendReply(api, `⚠️ تم إضافة إنذار للاعب [${victimPlayer.nickname}].\nعدد الإنذارات الحالي: ${'🔴'.repeat(currentWarnings)}`, event.messageID, threadID);

    const { checkAndEnforceWarnings } = require('./moderation');
    await checkAndEnforceWarnings(api, targetID, victimPlayer.nickname, victimPlayer.kingdom, currentWarnings).catch(() => {});

    return true;
  }

  if (text === 'اضافة' || text === 'إضافة') {
    const allCities = await db.collection('cities').find().toArray();
    const groupsList = [
      { threadId: String(config.groupes.murdak), name: 'العاصمة - مورداك' },
      { threadId: String(config.groupes.niravil), name: 'العاصمة - نيرافيل' },
      { threadId: String(config.groupes.solfare), name: 'العاصمة - سولفارا' }
    ];

    allCities.forEach(city => {
      const kAr = kingdomNamesAr[city.kingdom] || city.kingdom;
      groupsList.push({
        threadId: String(city.threadId),
        name: `${city.name} - ${kAr}`
      });
    });

    let listMsg = `╮───∙⋆⋅「 ⛩️ إضافة للمجموعات 」\nالرجاء كتابة رقم المجموعة المطلوبة للانضمام إليها:\n\n`;
    groupsList.forEach((grp, idx) => {
      listMsg += `${idx + 1} ❖ ${grp.name}\n`;
    });
    listMsg += `\n⚠️ اكتب رقم المدينة لاضافتك\n⚠️ اكتب خروج للخروج`;

    await setAdminSession(senderID, {
      state: 'DEPUTY_ADD_GROUP',
      groupsList
    });

    await sendReply(api, listMsg, event.messageID, threadID);
    return true;
  }

  if (text === 'مهام') {
    const expiryDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeTasks = await db.collection('tasks').find({
      targetRank: 'نائب الامبراطور',
      createdAt: { $gte: expiryDate }
    }).toArray();

    if (activeTasks.length === 0) {
      await sendReply(api, `╮───∙⋆⋅「 📋 مهام الرتبة 」\n│\n│ › 🕊️ لا توجد مهام نشطة حالياً لرتبتك.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.messageID, threadID);
      return true;
    }

    let tasksMsg = `╮───∙⋆⋅「 📋 مهام نائب الامبراطور النشطة 」\n`;
    activeTasks.forEach((task, idx) => {
      const ageHours = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60));
      const remainingHours = 24 - ageHours;
      tasksMsg += `│\n│ ❖ المهمة ${idx + 1}: ${task.title}\n│ 📝 التفاصيل: ${task.details}\n│ ⏳ متبقي: ${remainingHours} ساعة\n`;
    });
    tasksMsg += `╯───────∙⋆⋅ ※ ⋅⋆∙`;

    await sendReply(api, tasksMsg, event.messageID, threadID);
    return true;
  }

  return false;
}

// يعالج جلسة اختيار قروب للإضافة (DEPUTY_ADD_GROUP)
async function handleDeputyAddGroupSession(api, event, adminSession) {
  const { senderID, threadID } = event;
  const text = (event.body || '').trim();

  if (text === 'خروج') {
    await deleteAdminSession(senderID);
    await sendReply(api, `╮───∙⋆⋅「 تم إلغاء العملية 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.messageID, threadID);
    return true;
  }

  const selectionIdx = parseInt(text, 10) - 1;
  const groupsList = adminSession.groupsList || [];
  if (isNaN(selectionIdx) || selectionIdx < 0 || selectionIdx >= groupsList.length) {
    await sendReply(api, `⚠️ رقم غير صحيح، يرجى كتابة الرقم المقابل للمجموعة أو اكتب 《 خروج 》.`, event.messageID, threadID);
    return true;
  }

  const targetGroup = groupsList[selectionIdx];
  await deleteAdminSession(senderID);

  api.addUserToGroup(senderID, targetGroup.threadId, (err) => {
    if (err) {
      sendReply(api, `❌ تعذر إضافتك للمجموعة: ${targetGroup.name}\nتأكد أن البوت موجود في المجموعة ولديه صلاحية الإضافة.`, event.messageID, threadID).catch(() => {});
    } else {
      sendReply(api, `✅ تم إضافتك بنجاح إلى: ${targetGroup.name}`, event.messageID, threadID).catch(() => {});
    }
  });
  return true;
}

module.exports = {
  handleDeputyEmperorCommands,
  handleDeputyAddGroupSession
};
