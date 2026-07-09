const config = require('./config.json');
const { sendReply, kingdomNamesAr } = require('./utils');
const {
  handleAdminCommand, isAdmin, kickFromAllGroups
} = require('./admin');
const { getPlayer, updatePlayer, getAdminSession, deleteAdminSession, setAdminSession } = require('./database');
const { RANKS_ORDER, checkManualRankLimits } = require('./ranks');
const { notifyAdmins } = require('./musa3idat');
const groupsHandlers = require('./admin_modules/groups');

// خريطة توزيع حالات الجلسات الخاصة بلوحة التحكم (groups.js) على دوالها الصحيحة
const GROUPS_SESSION_STATE_MAP = {
  'DATA_MAIN': 'handleDataSession',
  'DATA_AWAIT_NAME': 'handleDataSession',
  'DATA_AWAIT_PHOTO': 'handleDataSession',
  'DATA_AWAIT_BOT_NICK': 'handleDataSession',
  'RESET_MAIN': 'handleEadatDabtSession',
  'QAROBAAT_MAIN': 'handleQarobaatSession',
  'QAROBAAT_EDIT_SELECT': 'handleQarobaatSession',
  'QAROBAAT_EDIT_AWAIT_ID': 'handleQarobaatSession',
  'IDAFA_MAIN': 'handleIdafaSession',
  'CITIES_MAIN': 'handleCitiesSession',
  'CITIES_ADD_KINGDOM': 'handleCitiesSession',
  'CITIES_ADD_AWAIT_NAME': 'handleCitiesSession',
  'CITIES_ADD_AWAIT_GROUP_NAME': 'handleCitiesSession',
  'CITIES_ADD_AWAIT_THREAD_ID': 'handleCitiesSession',
  'CITIES_EDIT_SELECT': 'handleCitiesSession',
  'CITIES_EDIT_MAIN': 'handleCitiesSession',
  'CITIES_EDIT_AWAIT_NAME': 'handleCitiesSession',
  'CITIES_EDIT_AWAIT_GROUP_NAME': 'handleCitiesSession',
  'CITIES_EDIT_AWAIT_THREAD_ID': 'handleCitiesSession',
  'CITIES_DELETE_SELECT': 'handleCitiesSession',
  'BOT_GROUPS_MAIN': 'handleBotGroupsSession',
  'MSG_REQS_MAIN': 'handleMessageRequestsSession',
  'MSG_REQS_ACTION': 'handleMessageRequestsSession'
};

global.lastMuteTitleCheck = global.lastMuteTitleCheck || {};

async function initMutedGroups() {
  if (global.mutedGroupsLoaded) return;
  global.mutedGroups = global.mutedGroups || {};
  try {
    const db = require('./database').getDB();
    const list = await db.collection('muted_groups').find({}).toArray();
    for (const item of list) {
      global.mutedGroups[String(item.threadId)] = true;
    }
    global.mutedGroupsLoaded = true;
  } catch (e) {
    console.error('[Muted Groups Init] Error:', e);
  }
}

// دالة موحدة لبناء الكنية ديناميكياً شاملة الرتب والرموز التعبيرية وحالة المشفى والتجاهل عبر ملف الحماية الرئيسي
async function getDynamicNicknameForRouter(player, forceMute = false) {
  const { getDynamicNickname } = require('./admin_modules/protection');
  return getDynamicNickname(player, forceMute);
}

async function isAuthorizedForIgnore(senderID) {
  if (isAdmin(senderID)) return true;
  const player = await getPlayer(senderID);
  if (player && (player.rank === 'الامبراطور' || player.rank === 'نائب الامبراطور')) {
    return true;
  }
  return false;
}

async function resolveTargetPlayer(target) {
  if (!target) return null;
  const db = require('./database').getDB();
  let player = null;
  
  if (/^\d+$/.test(target)) {
    player = await db.collection('players').findOne({ fbId: target });
  }
  
  if (!player && (target.includes('facebook.com') || target.includes('fb.com'))) {
    const idMatch = target.match(/(?:profile\.php\?id=)?(\d+)/);
    const extractedId = idMatch ? idMatch[1] : null;
    if (extractedId) {
      player = await db.collection('players').findOne({ fbId: extractedId });
    }
    if (!player) {
      player = await db.collection('players').findOne({ link: target });
    }
  }
  
  if (!player) {
    player = await db.collection('players').findOne({ 
      $or: [
        { name: { $regex: new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } },
        { nickname: { $regex: new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } }
      ]
    });
  }
  
  return player;
}

async function checkAndCleanExpiredIgnores(api) {
  try {
    const db = require('./database').getDB();
    const now = new Date();
    const expired = await db.collection('ignored_players').find({ until: { $lt: now } }).toArray();
    for (const exp of expired) {
      const victimPlayer = await getPlayer(exp.fbId);
      if (victimPlayer) {
        const fullNick = await getDynamicNicknameForRouter(victimPlayer, false);
        const victimGroupId = config.groupes[victimPlayer.kingdom];
        if (victimGroupId) {
          try {
            await new Promise(resolve => api.changeNickname(fullNick, victimGroupId, exp.fbId, () => resolve()));
          } catch (e) {}
        }
      }
      await db.collection('ignored_players').deleteOne({ fbId: exp.fbId });
    }
  } catch (e) {
    console.error('[Expired Ignores Cleanup] Error:', e);
  }
}

async function checkMutedGroupMessage(api, event) {
  const { threadID, senderID, messageID } = event;
  if (!threadID || !senderID) return false;

  await initMutedGroups();

  global.mutedGroups = global.mutedGroups || {};
  if (!global.mutedGroups[String(threadID)]) return false;

  const player = await getPlayer(senderID);
  
  const isEmp = player && player.rank === 'الامبراطور';
  const isSysAdmin = isAdmin(senderID);

  if (isEmp || isSysAdmin) {
    return false; 
  }

  const nowTime = Date.now();
  if (!global.lastMuteTitleCheck[String(threadID)] || nowTime - global.lastMuteTitleCheck[String(threadID)] > 15000) {
    global.lastMuteTitleCheck[String(threadID)] = nowTime;
    try {
      api.getThreadInfo(threadID, (err, info) => {
        if (!err && info) {
          const currentTitle = info.threadName || '';
          if (!currentTitle.includes('🔇')) {
            api.setTitle(`${currentTitle} 🔇`.trim(), threadID);
          }
        }
      });
    } catch (titleErr) {}
  }

  if (!player) {
    try {
      api.unsendMessage(messageID, () => {});
      api.removeUserFromGroup(senderID, threadID, (err) => {
        if (err) console.error('[Mute Kick] Failed to kick unregistered user:', err);
      });
    } catch (e) {}
    return true; 
  }

  try {
    api.unsendMessage(messageID, () => {});
  } catch (e) {}

  const currentWarnings = (player.warnings || 0) + 1;
  await updatePlayer(senderID, { warnings: currentWarnings });

  const gid = config.groupes[player.kingdom];
  if (gid) {
    try {
      const updatedPlayer = { ...player, warnings: currentWarnings };
      const fullNick = await getDynamicNicknameForRouter(updatedPlayer);
      await new Promise(r => api.changeNickname(fullNick, gid, senderID, () => r()));
    } catch (nickErr) {}
  }

  const warnMsg = `⚠️ وضع الصمت نشط!\nاللاعب [${player.nickname}]، تم تسجيل إنذار ضدك وحذف رسالتك تلقائياً.\nالإنذارات الحالية: ${'🔴'.repeat(currentWarnings)}`;
  api.sendMessage({ body: warnMsg }, threadID);

  return true; 
}

async function handleThreadNameChange(api, event) {
  const { threadID, logMessageType, logMessageData } = event;
  if (logMessageType === 'log:thread-name') {
    await initMutedGroups();
    global.mutedGroups = global.mutedGroups || {};
    if (global.mutedGroups[String(threadID)]) {
      const newName = (logMessageData && logMessageData.name) || '';
      if (!newName.includes('🔇')) {
        try {
          api.setTitle(`${newName} 🔇`.trim(), threadID);
        } catch (e) {
          console.error('[Mute Title Auto-Restore] Failed to restore title:', e);
        }
      }
    }
  }
}

async function executeIgnoreCommand(api, event, operatorId, targetID) {
  const targetPlayer = await getPlayer(targetID);
  const operatorPlayer = await getPlayer(operatorId);
  const isOperatorAdminOrEmp = isAdmin(operatorId) || (operatorPlayer && operatorPlayer.rank === 'الامبراطور');
  
  const targetIsAdminOrEmp = isAdmin(targetID) || (targetPlayer && targetPlayer.rank === 'الامبراطور');
  if (targetIsAdminOrEmp && !isOperatorAdminOrEmp) {
    await sendReply(api, `❌ خطأ: لا يمكنك تطبيق عقوبة التجاهل على الإمبراطور أو المشرفين.`, event.messageID, event.threadID);
    return true;
  }
  
  await setAdminSession(operatorId, {
    state: 'AWAITING_IGNORE_DURATION',
    targetPlayerId: targetID,
    threadID: event.threadID
  });
  
  await sendReply(api, `يرجى تحديد وقت التجاهل بالدقائق:`, event.messageID, event.threadID);
  return true;
}

async function executeUnignoreCommand(api, event, operatorId, targetID) {
  const db = require('./database').getDB();
  const targetPlayer = await getPlayer(targetID);
  const operatorPlayer = await getPlayer(operatorId);
  const isOperatorAdminOrEmp = isAdmin(operatorId) || (operatorPlayer && operatorPlayer.rank === 'الامبراطور');
  
  const targetIsAdminOrEmp = isAdmin(targetID) || (targetPlayer && targetPlayer.rank === 'الامبراطور');
  if (targetIsAdminOrEmp && !isOperatorAdminOrEmp) {
    await sendReply(api, `❌ خطأ: لا يمكنك فك التجاهل عن الإمبراطور أو المشرفين.`, event.messageID, event.threadID);
    return true;
  }
  
  const victimNick = targetPlayer ? targetPlayer.nickname : targetID;
  const exists = await db.collection('ignored_players').findOne({ fbId: targetID });
  if (!exists) {
    await sendReply(api, `⚠️ اللاعب [${victimNick}] ليس متجاهلاً حالياً.`, event.messageID, event.threadID);
    return true;
  }
  
  await db.collection('ignored_players').deleteOne({ fbId: targetID });
  
  if (targetPlayer) {
    const fullNick = await getDynamicNicknameForRouter(targetPlayer, false);
    const victimGroupId = config.groupes[targetPlayer.kingdom];
    if (victimGroupId) {
      try {
        await new Promise(resolve => api.changeNickname(fullNick, victimGroupId, targetID, () => resolve()));
      } catch (e) {}
    }
  }
  
  await sendReply(api, `╮───∙⋆⋅「 فك التجاهل 」\n│\n│ › ✅ تم فك التجاهل عن اللاعب [${victimNick}] بنجاح.\n│ › تمت إزالة إيموجي (🔇) وإرجاع كنيته الأصلية.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.messageID, event.threadID);
  return true;
}

async function isPlayerIgnored(fbId) {
  try {
    const db = require('./database').getDB();
    const now = new Date();
    const record = await db.collection('ignored_players').findOne({ fbId: String(fbId) });
    if (record) {
      if (record.until > now) {
        return true;
      } else {
        await db.collection('ignored_players').deleteOne({ fbId: String(fbId) });
      }
    }
  } catch (e) {}
  return false;
}

async function handleAdminDM(api, event) {
  const { senderID } = event;
  const text = (event.body || '').trim();

  await checkAndCleanExpiredIgnores(api).catch(() => {});

  const isIgnoreCmd = text.startsWith('تجاهل') || (event.type === 'message_reply' && text === 'تجاهل');
  const isUnignoreCmd = text.startsWith('فك التجاهل') || text.startsWith('فك_التجاهل') || (event.type === 'message_reply' && (text === 'فك التجاهل' || text === 'فك_التجاهل'));

  if (isIgnoreCmd || isUnignoreCmd) {
    const authorized = await isAuthorizedForIgnore(senderID);
    if (authorized) {
      let targetID = null;
      if (isIgnoreCmd) {
        let query = text.replace(/^تجاهل\s*/, '').trim();
        if (event.type === 'message_reply' && event.messageReply.senderID) {
          targetID = String(event.messageReply.senderID);
        } else if (query) {
          const targetPlayer = await resolveTargetPlayer(query);
          if (targetPlayer) targetID = targetPlayer.fbId;
        }
        if (!targetID) {
          await sendReply(api, `❌ يرجى الرد على رسالة اللاعب أو كتابة لقب/ايدي/رابط حسابه لتجاهله.`, event.messageID, event.threadID);
          return true;
        }
        await executeIgnoreCommand(api, event, senderID, targetID);
        return true;
      } else {
        let query = text.replace(/^فك\s+التجاهل\s*/, '').replace(/^فك_التجاهل\s*/, '').trim();
        if (event.type === 'message_reply' && event.messageReply.senderID) {
          targetID = String(event.messageReply.senderID);
        } else if (query) {
          const targetPlayer = await resolveTargetPlayer(query);
          if (targetPlayer) targetID = targetPlayer.fbId;
        }
        if (!targetID) {
          await sendReply(api, `❌ يرجى الرد على رسالة اللاعب أو كتابة لقب/ايدي/رابط حسابه لفك التجاهل.`, event.messageID, event.threadID);
          return true;
        }
        await executeUnignoreCommand(api, event, senderID, targetID);
        return true;
      }
    }
  }

  if (!isAdmin(senderID)) return false;

  const { handleManshourat, handleManshouraatSession } = require('./nashr');
  const adminSessionDM = await getAdminSession(senderID);
  if (adminSessionDM?.state?.startsWith('NASHR_')) {
    await handleManshouraatSession(api, event, adminSessionDM);
    return true;
  }
  if (text === 'منشورات') {
    await handleManshourat(api, event);
    return true;
  }
  const adminHandledDM = await handleAdminCommand(api, event);
  if (adminHandledDM) return true;

  return false;
}

async function handleAdminGroup(api, event) {
  const { senderID } = event;
  const text = (event.body || '').trim();

  await checkAndCleanExpiredIgnores(api).catch(() => {});

  if (await checkMutedGroupMessage(api, event)) return true;

  const isIgnoreCmd = text.startsWith('تجاهل') || (event.type === 'message_reply' && text === 'تجاهل');
  const isUnignoreCmd = text.startsWith('فك التجاهل') || text.startsWith('فك_التجاهل') || (event.type === 'message_reply' && (text === 'فك التجاهل' || text === 'فك_التجاهل'));

  if (isIgnoreCmd || isUnignoreCmd) {
    const authorized = await isAuthorizedForIgnore(senderID);
    if (authorized) {
      let targetID = null;
      if (isIgnoreCmd) {
        let query = text.replace(/^تجاهل\s*/, '').trim();
        if (event.type === 'message_reply' && event.messageReply.senderID) {
          targetID = String(event.messageReply.senderID);
        } else if (query) {
          const targetPlayer = await resolveTargetPlayer(query);
          if (targetPlayer) targetID = targetPlayer.fbId;
        }
        if (!targetID) {
          await sendReply(api, `❌ يرجى الرد على رسالة اللاعب أو كتابة لقب/ايدي/رابط حسابه لتجاهله.`, event.messageID, event.threadID);
          return true;
        }
        await executeIgnoreCommand(api, event, senderID, targetID);
        return true;
      } else {
        let query = text.replace(/^فك\s+التجاهل\s*/, '').replace(/^فك_التجاهل\s*/, '').trim();
        if (event.type === 'message_reply' && event.messageReply.senderID) {
          targetID = String(event.messageReply.senderID);
        } else if (query) {
          const targetPlayer = await resolveTargetPlayer(query);
          if (targetPlayer) targetID = targetPlayer.fbId;
        }
        if (!targetID) {
          await sendReply(api, `❌ يرجى الرد على رسالة اللاعب أو كتابة لقب/ايدي/رابط حسابه لفك التجاهل.`, event.messageID, event.threadID);
          return true;
        }
        await executeUnignoreCommand(api, event, senderID, targetID);
        return true;
      }
    }
  }

  if (!isAdmin(senderID)) return false;

  const { checkAndSendNotifications } = require('./isharat');
  checkAndSendNotifications(api, event).catch(() => {});

  const { handleManshourat, handleManshouraatSession } = require('./nashr');
  const adminSession2 = await getAdminSession(senderID);
  if (adminSession2?.state?.startsWith('NASHR_')) {
    await handleManshouraatSession(api, event, adminSession2);
    return true;
  }
  if (text === 'منشورات') {
    await handleManshourat(api, event);
    return true;
  }
  const adminHandled = await handleAdminCommand(api, event);
  if (adminHandled) return true;

  return false;
}

async function handleAdminSessionState(api, event, adminSession) {
  const { senderID, threadID } = event;
  const text = (event.body || '').trim();

  // ─── توزيع حالات جلسات لوحة تحكم القروبات (groups.js) ───
  // هذه الحالات (RESET_MAIN, DATA_MAIN, CITIES_*, QAROBAAT_*, IDAFA_MAIN, BOT_GROUPS_MAIN, MSG_REQS_*)
  // يتم ضبطها عبر setAdminSession من داخل groups.js، لذا يجب توجيهها هنا لدوالها الصحيحة
  // وإلا ستُفقد الاستجابة بالكامل عند إرسال المستخدم لأي رقم أو نص تالٍ.
  const groupsHandlerName = GROUPS_SESSION_STATE_MAP[adminSession.state];
  if (groupsHandlerName) {
    const fn = groupsHandlers[groupsHandlerName];
    if (typeof fn === 'function') {
      await fn(api, event, adminSession);
    } else {
      console.error(`[Admin Session Router] دالة غير موجودة في groups.js: ${groupsHandlerName}`);
    }
    return true;
  }

  if (adminSession.state === 'AWAITING_IGNORE_DURATION') {
    if (text === 'خروج') {
      await deleteAdminSession(senderID);
      await sendReply(api, `╮───∙⋆⋅「 تم إلغاء العملية 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.messageID, threadID);
      return true;
    }
    
    const minutes = parseInt(text, 10);
    if (isNaN(minutes) || minutes <= 0) {
      await sendReply(api, `⚠️ يرجى إدخال عدد دقائق صحيح (رقم أكبر من 0) أو اكتب 《 خروج 》 للإلغاء.`, event.messageID, threadID);
      return true;
    }
    
    const targetID = adminSession.targetPlayerId;
    const victimPlayer = await getPlayer(targetID);
    const victimNick = victimPlayer ? victimPlayer.nickname : targetID;
    
    const ignoreUntil = new Date(Date.now() + minutes * 60 * 1000);
    const db = require('./database').getDB();
    await db.collection('ignored_players').updateOne(
      { fbId: targetID },
      { $set: { fbId: targetID, until: ignoreUntil, ignoredAt: new Date() } },
      { upsert: true }
    );
    
    if (victimPlayer) {
      const fullNick = await getDynamicNicknameForRouter(victimPlayer, true);
      const victimGroupId = config.groupes[victimPlayer.kingdom];
      if (victimGroupId) {
        try {
          await new Promise(resolve => api.changeNickname(fullNick, victimGroupId, targetID, () => resolve()));
        } catch (e) {
          console.error('[Ignore Nickname Change] Failed to set nickname:', e);
        }
      }
    }
    
    await deleteAdminSession(senderID);
    await sendReply(api, `╮───∙⋆⋅「 تجاهل لاعب 」\n│\n│ › تم تجاهل اللاعب [${victimNick}] لمدة [${minutes}] دقائق.\n│ ◇ لفك التجاهل عنه رد على رسالته بامر فك التجاهل\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.messageID, threadID);
    return true;
  }

  if (adminSession.state === 'DEPUTY_ADD_GROUP') {
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

  if (adminSession.state === 'AWAITING_RANK_CHANGE_NUMBER') {
    if (text === 'خروج') {
      await deleteAdminSession(senderID);
      await sendReply(api, `╮───∙⋆⋅「 تم إلغاء العملية 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.messageID, threadID);
      return true;
    }

    const selectionIdx = parseInt(text, 10) - 1;
    if (isNaN(selectionIdx) || selectionIdx < 0 || selectionIdx >= RANKS_ORDER.length) {
      await sendReply(api, `⚠️ خيار غير صحيح، يرجى كتابة الرقم المقابل للرتبة أو اكتب 《 خروج 》.`, event.messageID, threadID);
      return true;
    }

    const selectedRank = RANKS_ORDER[selectionIdx];
    const targetPlayer = await getPlayer(adminSession.targetPlayerId);

    if (!targetPlayer) {
      await deleteAdminSession(senderID);
      await sendReply(api, `❌ فشل العثور على اللاعب المستهدف.`, event.messageID, threadID);
      return true;
    }

    const limitsCheck = await checkManualRankLimits(
      selectedRank,
      targetPlayer.kingdom,
      targetPlayer.registeredCityName || 'العاصمة',
      targetPlayer.fbId
    );

    if (!limitsCheck.allowed) {
      if (limitsCheck.replaceable && limitsCheck.existingPlayer) {
        await setAdminSession(senderID, {
          state: 'AWAITING_RANK_REPLACE_CONFIRM',
          targetPlayerId: targetPlayer.fbId,
          oldHolderId: limitsCheck.existingPlayer.fbId,
          newRank: selectedRank
        });
        await sendReply(api,
          `⚠️ سيتم استبدال اللاعب [${limitsCheck.existingPlayer.nickname}] باللاعب [${targetPlayer.nickname}]\n` +
          `لرتبة (${selectedRank})\n\n` +
          `› أرسل 《 تأكيد 》 لتنفيذ الاستبدال\n` +
          `› أرسل 《 الغاء 》 لإلغاء العملية`,
          event.messageID, threadID);
        return true;
      }

      await sendReply(api, `❌ تعذر الترقية:\n⚠️ ${limitsCheck.reason}`, event.messageID, threadID);
      return true;
    }

    await applyRankChange(api, targetPlayer, selectedRank);

    await deleteAdminSession(senderID);
    await sendReply(api, `✅ تم تعيين رتبة اللاعب (${targetPlayer.nickname}) إلى (${selectedRank}) بنجاح!\nسيصل الإشعار والتهنئة للاعب عند إرساله لأي رسالة قادمة.`, event.messageID, threadID);
    return true;
  }

  if (adminSession.state === 'AWAITING_RANK_REPLACE_CONFIRM') {
    if (text === 'الغاء' || text === 'إلغاء') {
      await deleteAdminSession(senderID);
      await sendReply(api, `╮───∙⋆⋅「 تم إلغاء عملية الاستبدال 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, event.messageID, threadID);
      return true;
    }

    if (text !== 'تأكيد') {
      await sendReply(api, `⚠️ يرجى إرسال 《 تأكيد 》 لتنفيذ الاستبدال أو 《 الغاء 》 لإلغاء العملية.`, event.messageID, threadID);
      return true;
    }

    const { targetPlayerId, oldHolderId, newRank } = adminSession;
    const targetPlayer = await getPlayer(targetPlayerId);

    if (!targetPlayer) {
      await deleteAdminSession(senderID);
      await sendReply(api, `❌ فشل العثور على اللاعب المستهدف.`, event.messageID, threadID);
      return true;
    }

    const oldHolder = await getPlayer(oldHolderId);

    if (oldHolder) {
      await updatePlayer(oldHolder.fbId, { rank: 'متدرب' });

      const { kickFromGroupsExceptOwnCity } = require('./admin_modules/helpers');
      try {
        await kickFromGroupsExceptOwnCity(api, oldHolder.fbId, oldHolder.kingdom, oldHolder.registeredCityName || 'العاصمة');
      } catch (e) {
        console.error('[Rank Replace] Error kicking old holder from groups:', e.message);
      }

      const gidOld = config.groupes[oldHolder.kingdom];
      if (gidOld) {
        try {
          const fullNickOld = await getDynamicNicknameForRouter({ ...oldHolder, rank: 'متدرب' });
          await new Promise(r => api.changeNickname(fullNickOld, gidOld, oldHolder.fbId, () => r()));
        } catch(e) {}
      }
    }

    await applyRankChange(api, targetPlayer, newRank);

    await deleteAdminSession(senderID);
    await sendReply(api,
      `✅ تم الاستبدال بنجاح!\n` +
      (oldHolder ? `› اللاعب [${oldHolder.nickname}] أصبحت رتبته (متدرب) وتم إخراجه من قروبات مملكته/رتبته السابقة.\n` : '') +
      `› اللاعب [${targetPlayer.nickname}] أصبح برتبة (${newRank}).\n` +
      `سيصل الإشعار والتهنئة للاعبين عند إرسالهم لأي رسالة قادمة.`,
      event.messageID, threadID);
    return true;
  }

  return false;
}

async function applyRankChange(api, targetPlayer, selectedRank) {
  const oldRank = targetPlayer.rank || 'متدرب';
  const updatedPlayer = {
    ...targetPlayer,
    rank: selectedRank,
    pendingPromotionNotify: {
      oldRank: oldRank,
      newRank: selectedRank
    }
  };

  await updatePlayer(targetPlayer.fbId, {
    rank: selectedRank,
    pendingPromotionNotify: {
      oldRank: oldRank,
      newRank: selectedRank
    }
  });

  const gid = config.groupes[targetPlayer.kingdom];
  if (gid) {
    try {
      const fullNick = await getDynamicNicknameForRouter(updatedPlayer);
      await new Promise(r => api.changeNickname(fullNick, gid, targetPlayer.fbId, () => r()));
    } catch (e) {
      console.error('[Router] Error broadcasting nickname on manual promotion:', e.message);
    }
  }
}

async function handleDeputyEmperorCommands(api, event, player) {
  const { senderID, threadID } = event;
  const text = (event.body || '').trim();
  const db = require('./database').getDB();

  const isEmperor = player && player.rank === 'الامبراطور';
  const isDeputy  = player && player.rank === 'نائب الامبراطور';
  if (!isEmperor && !isDeputy) return false;

  if (await checkMutedGroupMessage(api, event)) return true;

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
    
    const victimPlayer = await getPlayer(targetID);
    const targetIsAdminOrEmp = isAdmin(targetID) || (victimPlayer && victimPlayer.rank === 'الامبراطور');
    if (targetIsAdminOrEmp) {
      await sendReply(api, `❌ خطأ: لا يمكنك استعراض معلومات الإمبراطور أو المشرفين.`, event.messageID, threadID);
      return true;
    }

    const moderation = require('./admin_modules/moderation');
    await moderation.handleMa3loomat(api, event, targetID);
    return true;
  }

  if (text === 'عقوبة') {
    if (!event.messageReply) {
      await sendReply(api, `❌ يرجى الرد على رسالة اللاعب المستهدف لتطبيق العقوبة (إضافة إنذار).`, event.messageID, threadID);
      return true;
    }
    const targetID = String(event.messageReply.senderID);
    
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
        const updatedVictim = { ...victimPlayer, warnings: currentWarnings };
        const fullNick = await getDynamicNicknameForRouter(updatedVictim);
        await new Promise(r => api.changeNickname(fullNick, gid, targetID, () => r()));
      }
    } catch (nickErr) {
      console.error('[Deputy Punishment] Failed to update nickname:', nickErr.message);
    }

    await sendReply(api, `⚠️ تم إضافة إنذار للاعب [${victimPlayer.nickname}].\nعدد الإنذارات الحالي: ${'🔴'.repeat(currentWarnings)}`, event.messageID, threadID);

    const { checkAndEnforceWarnings } = require('./admin_modules/moderation');
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

async function handleChangeRankCommand(api, event) {
  const { senderID, threadID } = event;
  const text = (event.body || '').trim();

  const isChangeRankCmd = text.startsWith('تغيير الرتبة') || (event.type === 'message_reply' && text === 'تغيير الرتبة');
  if (!isChangeRankCmd) return false;

  const { getPlayerByNickname } = require('./database');

  const operator = await getPlayer(senderID);
  const isEmp = operator && (operator.rank === 'الامبراطور' || operator.rank === 'نائب الامبراطور');
  const isSysAdmin = isAdmin(senderID);

  if (!isEmp && !isSysAdmin) {
    await sendReply(api, `❌ عذراً، هذا الأمر مخصص فقط للإمبراطور ومساعديه أو مشرفي النظام الأعلى.`, event.messageID, threadID);
    return true;
  }

  let targetId = null;
  let targetNickOrId = text.replace(/^تغيير الرتبة\s*/, '').trim();

  if (event.type === 'message_reply' && event.messageReply.senderID) {
    targetId = String(event.messageReply.senderID);
  } else if (targetNickOrId) {
    let found = await getPlayer(targetNickOrId);
    if (!found) found = await getPlayerByNickname(targetNickOrId);
    if (found) targetId = found.fbId;
  }

  if (!targetId) {
    await sendReply(api, `❌ يرجى تحديد اللاعب المستهدف عبر الرد على رسالته و كتابة "تغيير الرتبة" أو كتابة الأمر متبوعاً باللقب أو الآيدي الخاص به.`, event.messageID, threadID);
    return true;
  }

  const targetPlayer = await getPlayer(targetId);
  if (!targetPlayer) {
    await sendReply(api, `❌ هذا المستخدم غير مسجل بنظام اللعبة حالياً.`, event.messageID, threadID);
    return true;
  }

  await setAdminSession(senderID, {
    state: 'AWAITING_RANK_CHANGE_NUMBER',
    targetPlayerId: targetId
  });

  let menuMsg = `╮───∙⋆⋅「 ⚙️ نظام تعديل الرتب 」\n`;
  menuMsg += `│ اللاعب المستهدف : ${targetPlayer.nickname}\n`;
  menuMsg += `│ رتبته الحالية   : ${targetPlayer.rank || 'متدرب'}\n`;
  menuMsg += `╯───────∙⋆⋅ ※ ⋅⋆∙───────◈\n\n`;
  menuMsg += `الرجاء كتابة رقم الرتبة المطلوبة لنقل اللاعب إليها:\n\n`;

  RANKS_ORDER.forEach((rk, idx) => {
    menuMsg += `${idx + 1} 》 ${rk}\n`;
  });
  menuMsg += `\n› أرسل رقم الرتبة المطلوب أو اكتب 《 خروج 》 للإلغاء.`;

  await sendReply(api, menuMsg, event.messageID, threadID);
  return true;
}

module.exports = {
  handleAdminDM,
  handleAdminGroup,
  handleAdminSessionState,
  handleDeputyEmperorCommands,
  handleChangeRankCommand,
  checkMutedGroupMessage,
  handleThreadNameChange,
  isPlayerIgnored,
  getDynamicNicknameForRouter
};