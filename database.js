const { MongoClient } = require('mongodb');

let db = null;

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('❌ متغير MONGODB_URI غير موجود في Secrets');
  const client = new MongoClient(uri);
  await client.connect();
  db = client.db('nexus');
  console.log('✅ تم الاتصال بقاعدة البيانات');
  return db;
}

function getDB() {
  if (!db) throw new Error('قعادة البيانات غير متصلة');
  return db;
}

// ─── كاش الجلسات المؤقت في الذاكرة لمنع ضغط قاعدة البيانات ───
const activeSessionUsers = new Set();

function hasActiveSession(fbId) {
  return activeSessionUsers.has(String(fbId));
}

function registerActiveSession(fbId) {
  activeSessionUsers.add(String(fbId));
}

async function checkAndRemoveFromCache(fbId) {
  const id = String(fbId);
  try {
    const database = getDB();
    const results = await Promise.all([
      database.collection('temp_sessions').findOne({ fbId: id }),
      database.collection('item_transfer_sessions').findOne({ fbId: id }),
      database.collection('disabled_cmd_sessions').findOne({ fbId: id }),
      database.collection('join_sessions').findOne({ userId: id }),
      database.collection('nashr_sessions').findOne({ fbId: id }),
      database.collection('market_sessions').findOne({ fbId: id }),
      database.collection('use_sessions').findOne({ fbId: id }),
      database.collection('bank_sessions').findOne({ fbId: id }),
      database.collection('world_cup_sessions').findOne({ fbId: id })
    ]);
    const stillHasSession = results.some(doc => doc !== null);
    if (!stillHasSession) {
      activeSessionUsers.delete(id);
    }
  } catch (e) {
    activeSessionUsers.delete(id);
  }
}

async function initSessionCache() {
  activeSessionUsers.clear();
  try {
    const database = getDB();
    const collections = [
      'temp_sessions',
      'item_transfer_sessions',
      'disabled_cmd_sessions',
      'join_sessions',
      'nashr_sessions',
      'market_sessions',
      'use_sessions',
      'bank_sessions',
      'world_cup_sessions'
    ];
    for (const colName of collections) {
      const docs = await database.collection(colName).find({}, { projection: { fbId: 1, userId: 1 } }).toArray();
      for (const doc of docs) {
        const id = doc.fbId || doc.userId;
        if (id) activeSessionUsers.add(String(id));
      }
    }
    console.log(`ℹ️ [Cache] تم تحميل ${activeSessionUsers.size} مستخدم نشط في الذاكرة المؤقتة للـ Cache.`);
  } catch (err) {
    console.error('❌ خطأ أثناء تحميل كاش الجلسات:', err.message);
  }
}

// ===== اللاعبون =====

async function getPlayer(fbId) {
  return await getDB().collection('players').findOne({ fbId: String(fbId) });
}

async function getPlayerByNickname(nickname) {
  return await getDB().collection('players').findOne({
    nickname: { $regex: new RegExp(`^${escapeRegex(nickname)}$`, 'i') }
  });
}

async function createPlayer(data) {
  await getDB().collection('players').insertOne(data);
}

async function updatePlayer(fbId, update) {
  await getDB().collection('players').updateOne(
    { fbId: String(fbId) },
    { $set: update }
  );
}

async function deletePlayer(fbId) {
  await getDB().collection('players').deleteOne({ fbId: String(fbId) });
}

async function getAllPlayers(kingdom) {
  const filter = kingdom ? { kingdom } : {};
  return await getDB().collection('players').find(filter).toArray();
}

// ===== نظام إضافة ومراقبة الـ XP والترقيات =====

async function addXP(fbId, amount, api, threadID) {
  try {
    const db = getDB();
    const player = await db.collection('players').findOne({ fbId: String(fbId) });
    if (!player) return;

    let currentXP = (player.xp || 0) + amount;
    let currentLevel = player.level || 1;
    let bagLevel = player.bagLevel || 1;
    let leveledUp = false;
    const leveledLevels = [];
    const rolledResources = [];

    let reqXP = 45 + (currentLevel * 5);
    while (currentXP >= reqXP) {
      currentXP -= reqXP;
      currentLevel++;
      bagLevel++;
      leveledUp = true;
      leveledLevels.push(currentLevel);

      const ALL_RESOURCES = [
        'صخرة', 'حديد', 'فحم', 'فضة', 'ذهب', 'ياقوت مشع',
        'خشب', 'راتنج', 'اعشاب طبية', 'أعشاب سامة', 'فطر متوهج', 'بذور سحرية',
        'أصداف', 'سمك', 'طحالب بحرية', 'لؤلؤ', 'مرجان', 'كريستال البحر'
      ];
      const res1 = ALL_RESOURCES[Math.floor(Math.random() * ALL_RESOURCES.length)];
      const res2 = ALL_RESOURCES[Math.floor(Math.random() * ALL_RESOURCES.length)];
      rolledResources.push({ res1, res2 });

      reqXP = 45 + (currentLevel * 5);
    }

    const updateData = {
      xp: parseFloat(currentXP.toFixed(1))
    };

    if (leveledUp) {
      updateData.level = currentLevel;
      updateData.bagLevel = bagLevel;
      updateData.coins = (player.coins || 0) + (leveledLevels.length * 30);

      const bag = player.bag || [];
      for (const roll of rolledResources) {
        const idx1 = bag.findIndex(i => i.name === roll.res1 && i.type === 'resource');
        if (idx1 >= 0) {
          bag[idx1].quantity += 2;
        } else {
          bag.push({ name: roll.res1, quantity: 2, type: 'resource' });
        }

        const idx2 = bag.findIndex(i => i.name === roll.res2 && i.type === 'resource');
        if (idx2 >= 0) {
          bag[idx2].quantity += 2;
        } else {
          bag.push({ name: roll.res2, quantity: 2, type: 'resource' });
        }
      }
      updateData.bag = bag;

      try {
        const config = require('./config.json');
        const gid = config.groupes[player.kingdom];
        if (gid && api) {
          await require('./dukhul').changePlayerNickname(
            api, gid, player.fbId, player.nickname, player.rank || 'مجند', player.class, player.warnings || 0
          );
        }
      } catch (nickErr) {
        console.error('[XP Level Up] Failed to update player nickname on level up:', nickErr.message);
      }

      for (let i = 0; i < leveledLevels.length; i++) {
        const lvl = leveledLevels[i];
        const rolls = rolledResources[i];
        const currentBagLevelCalculated = bagLevel - (leveledLevels.length - 1 - i);

        const lvlUpMsg = 
          `᪥──────『 𖣫 』──────᪥\n` +
          `               \n` +
          `   ✨️🆙️ ارتقى مستواك 🆙️✨️\n` +
          `✵ المستوى الجديد 『 ${lvl} 』\n\n` +
          `╮ الجوائز ───────────╭\n` +
          `『 ${rolls.res1} 』 ×2 \n` +
          `『 ${rolls.res2} 』 ×2\n` +
          `『 30 كوينز  』\n` +
          `『 ارتقت حقيبتك للمستوى ${currentBagLevelCalculated} 』\n` +
          `╯───────────────╰\n\n` +
          `᪥──────『 𖣫 』──────᪥`;

        await addNotification(fbId, lvlUpMsg);

        if (api && threadID) {
          const { sendMessage } = require('./utils');
          await sendMessage(api, lvlUpMsg, threadID).catch(() => {});
        }
      }
    }

    await db.collection('players').updateOne(
      { fbId: String(fbId) },
      { $set: updateData }
    );
  } catch (err) {
    console.error('[database.js] Error in addXP function:', err);
  }
}

// ===== التسجيل المؤقت =====

async function getTempSession(fbId) {
  return await getDB().collection('temp_sessions').findOne({ fbId: String(fbId) });
}

async function setTempSession(fbId, data) {
  registerActiveSession(fbId);
  await getDB().collection('temp_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteTempSession(fbId) {
  await getDB().collection('temp_sessions').deleteOne({ fbId: String(fbId) });
  await checkAndRemoveFromCache(fbId);
}

// ===== الاشعارات =====

async function addNotification(fbId, message) {
  await getDB().collection('notifications').insertOne({
    fbId: String(fbId),
    message,
    createdAt: new Date(),
    sent: false
  });
}

async function getPendingNotifications(fbId) {
  return await getDB().collection('notifications')
    .find({ fbId: String(fbId), sent: false })
    .toArray();
}

async function markNotificationsSent(fbId) {
  await getDB().collection('notifications').updateMany(
    { fbId: String(fbId), sent: false },
    { $set: { sent: true } }
  );
}

// ===== عداد الفئات (تم تعديله للتسلسل: فارس -> ساحر -> معالج) =====

async function getNextClass(kingdom) {
  const order = ['فارس', 'ساحر', 'معالج'];
  const counter = await getDB().collection('counters').findOne({ kingdom });
  const index = counter ? counter.count % 3 : 0;
  const nextClass = order[index];
  await getDB().collection('counters').updateOne(
    { kingdom },
    { $inc: { count: 1 } },
    { upsert: true }
  );
  return nextClass;
}

// ===== الحقيبة =====

async function addItemToBag(fbId, itemName, quantity) {
  const player = await getPlayer(fbId);
  if (!player) return;
  const bag = player.bag || [];
  const idx = bag.findIndex(i => i.name === itemName && i.type === 'resource');
  if (idx >= 0) {
    bag[idx].quantity += quantity;
  } else {
    bag.push({ name: itemName, quantity, type: 'resource' });
  }
  await updatePlayer(fbId, { bag });
}

async function removeItemFromBag(fbId, itemName, quantity) {
  const player = await getPlayer(fbId);
  if (!player) return false;
  const bag = player.bag || [];
  const idx = bag.findIndex(i => i.name === itemName && i.type === 'resource');
  if (idx < 0 || bag[idx].quantity < quantity) return false;
  bag[idx].quantity -= quantity;
  if (bag[idx].quantity === 0) bag.splice(idx, 1);
  await updatePlayer(fbId, { bag });
  return true;
}

// ===== جلسات تحويل الأغراض =====

async function getItemTransferSession(fbId) {
  return await getDB().collection('item_transfer_sessions').findOne({ fbId: String(fbId) });
}

async function setItemTransferSession(fbId, data) {
  registerActiveSession(fbId);
  await getDB().collection('item_transfer_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteItemTransferSession(fbId) {
  await getDB().collection('item_transfer_sessions').deleteOne({ fbId: String(fbId) });
  await checkAndRemoveFromCache(fbId);
}

// ===== المبادل (شراء وبيع الموارد) =====

async function getMubadilSession(fbId) {
  return await getDB().collection('mubadil_sessions').findOne({ fbId: String(fbId) });
}

async function setMubadilSession(fbId, data) {
  registerActiveSession(fbId);
  await getDB().collection('mubadil_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteMubadilSession(fbId) {
  await getDB().collection('mubadil_sessions').deleteOne({ fbId: String(fbId) });
  await checkAndRemoveFromCache(fbId);
}

// تسجيل عملية شراء مورد من المبادل (تُستخدم لاحقاً في حساب الطلب)
async function recordMubadilPurchase(resourceName, fbId, quantity) {
  await getDB().collection('mubadil_purchases').insertOne({
    resourceName: String(resourceName),
    fbId: String(fbId),
    quantity: Number(quantity) || 1,
    createdAt: new Date()
  });
}

// حساب الطلب = عدد مرات شراء هذا المورد خلال آخر 7 أيام
async function getMubadilDemand(resourceName) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return await getDB().collection('mubadil_purchases').countDocuments({
    resourceName: String(resourceName),
    createdAt: { $gte: sevenDaysAgo }
  });
}

// ===== جلسات الأدمن =====

async function getAdminSession(fbId) {
  return await getDB().collection('admin_sessions').findOne({ fbId: String(fbId) });
}

async function setAdminSession(fbId, data) {
  await getDB().collection('admin_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteAdminSession(fbId) {
  await getDB().collection('admin_sessions').deleteOne({ fbId: String(fbId) });
}

// ===== الحظر الدائم =====

async function addPermanentBan(fbId, nickname) {
  await getDB().collection('permanent_bans').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), nickname: nickname || fbId, bannedAt: new Date() } },
    { upsert: true }
  );
}

async function getPermanentBan(fbId) {
  return await getDB().collection('permanent_bans').findOne({ fbId: String(fbId) });
}

async function getAllPermanentBans() {
  return await getDB().collection('permanent_bans').find({}).toArray();
}

async function removePermanentBan(fbId) {
  await getDB().collection('permanent_bans').deleteOne({ fbId: String(fbId) });
}

// ===== الأوامر المعطلة =====

async function disableCommand(cmdKey) {
  await getDB().collection('disabled_commands').updateOne(
    { key: cmdKey },
    { $set: { key: cmdKey, disabledAt: new Date() } },
    { upsert: true }
  );
}

async function enableCommand(cmdKey) {
  await getDB().collection('disabled_commands').deleteOne({ key: cmdKey });
}

async function getDisabledCommands() {
  return await getDB().collection('disabled_commands').find({}).toArray();
}

async function isCommandDisabled(cmdKey) {
  const doc = await getDB().collection('disabled_commands').findOne({ key: cmdKey });
  return !!doc;
}

async function addCommandWatcher(fbId, cmdKey) {
  await getDB().collection('command_watchers').updateOne(
    { fbId: String(fbId), cmdKey },
    { $set: { fbId: String(fbId), cmdKey, addedAt: new Date() } },
    { upsert: true }
  );
}

async function getCommandWatchers(cmdKey) {
  return await getDB().collection('command_watchers').find({ cmdKey }).toArray();
}

async function clearCommandWatchers(cmdKey) {
  await getDB().collection('command_watchers').deleteMany({ cmdKey });
}

// ===== البوتات =====

async function getBots() {
  return await getDB().collection('bots').find({}).toArray();
}

async function addBot(name, cookies) {
  const result = await getDB().collection('bots').insertOne({
    name,
    cookies,
    addedAt: new Date()
  });
  return result.insertedId;
}

async function updateBotCookies(botId, cookies) {
  const { ObjectId } = require('mongodb');
  try {
    await getDB().collection('bots').updateOne(
      { _id: new ObjectId(String(botId)) },
      { $set: { cookies, status: 'active', failedAt: null } }
    );
  } catch (e) {
    console.error('updateBotCookies error:', e);
  }
}

async function getBotById(botId) {
  const { ObjectId } = require('mongodb');
  return await getDB().collection('bots').findOne({ _id: new ObjectId(String(botId)) });
}

async function updateBotName(botId, name) {
  const { ObjectId } = require('mongodb');
  await getDB().collection('bots').updateOne(
    { _id: new ObjectId(String(botId)) },
    { $set: { name } }
  );
}

async function deleteBot(botId) {
  const { ObjectId } = require('mongodb');
  await getDB().collection('bots').deleteOne({ _id: new ObjectId(String(botId)) });
}

// ===== إحصائيات الرسائل =====

async function incrementMessageCount(fbId) {
  await getDB().collection('message_stats').updateOne(
    { fbId: String(fbId) },
    { $inc: { count: 1 }, $set: { lastMessageAt: new Date() } },
    { upsert: true }
  );
}

async function getMessageStats(fbId) {
  return await getDB().collection('message_stats').findOne({ fbId: String(fbId) });
}

// ===== إعدادات المجموعات =====

async function getGroupSetting(threadIDOrKingdom, key) {
  if (key === undefined) {
    const doc = await getDB().collection('group_settings').findOne({ kingdom: String(threadIDOrKingdom) });
    return doc || null;
  }
  const doc = await getDB().collection('group_settings').findOne({ threadID: String(threadIDOrKingdom), key });
  return doc ? doc.value : null;
}

async function updateGroupSetting(threadIDOrKingdom, keyOrUpdate, value) {
  if (value === undefined && typeof keyOrUpdate === 'object') {
    await getDB().collection('group_settings').updateOne(
      { kingdom: String(threadIDOrKingdom) },
      { $set: { kingdom: String(threadIDOrKingdom), ...keyOrUpdate, updatedAt: new Date() } },
      { upsert: true }
    );
  } else {
    await getDB().collection('group_settings').updateOne(
      { threadID: String(threadIDOrKingdom), key: keyOrUpdate },
      { $set: { threadID: String(threadIDOrKingdom), key: keyOrUpdate, value, updatedAt: new Date() } },
      { upsert: true }
    );
  }
}

// ===== إعدادات الحماية (Anti-Spam/Anti-Out) =====

async function getProtectionSettings(threadID) {
  return await getDB().collection('protection_settings').findOne({ threadID: String(threadID) });
}

async function saveProtectionSettings(threadID, settings) {
  await getDB().collection('protection_settings').updateOne(
    { threadID: String(threadID) },
    { $set: { ...settings, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function getProtectedState(threadID) {
  return await getDB().collection('protected_state').findOne({ threadID: String(threadID) });
}

async function saveProtectedState(threadID, state) {
  await getDB().collection('protected_state').updateOne(
    { threadID: String(threadID) },
    { $set: { ...state, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ===== جلسات الأوامر المعطلة =====

async function getDisabledCmdSession(fbId) {
  return await getDB().collection('disabled_cmd_sessions').findOne({ fbId: String(fbId) });
}

async function setDisabledCmdSession(fbId, data) {
  registerActiveSession(fbId);
  await getDB().collection('disabled_cmd_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteDisabledCmdSession(fbId) {
  await getDB().collection('disabled_cmd_sessions').deleteOne({ fbId: String(fbId) });
  await checkAndRemoveFromCache(fbId);
}

// ===== نظام الـ Agents (الوكلاء الذكيين) =====

async function getAllAgents() {
  return await getDB().collection('agents').find({}).toArray();
}

async function getAgentByName(name) {
  return await getDB().collection('agents').findOne({ name });
}

async function addAgent(agentData) {
  await getDB().collection('agents').insertOne({
    ...agentData,
    createdAt: new Date()
  });
}

async function updateAgent(name, update) {
  await getDB().collection('agents').updateOne(
    { name },
    { $set: { ...update, updatedAt: new Date() } }
  );
}

async function deleteAgent(name) {
  await getDB().collection('agents').deleteOne({ name });
}

async function getAgentConversation(threadID, agentName) {
  return await getDB().collection('agent_conversations').findOne({ threadID: String(threadID), agentName });
}

async function saveAgentConversation(threadID, agentName, messages) {
  await getDB().collection('agent_conversations').updateOne(
    { threadID: String(threadID), agentName },
    { $set: { threadID: String(threadID), agentName, messages, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function updateAgentConversation(threadID, agentName, messages) {
  await getDB().collection('agent_conversations').updateOne(
    { threadID: String(threadID), agentName },
    { $set: { messages, updatedAt: new Date() } }
  );
}

async function expireOldConversations(hours = 24) {
  const expiryDate = new Date(Date.now() - hours * 60 * 60 * 1000);
  const result = await getDB().collection('agent_conversations').deleteMany({
    updatedAt: { $lt: expiryDate }
  });
  return result.deletedCount;
}

async function clearAgentConversationsByName(agentName) {
  const result = await getDB().collection('agent_conversations').deleteMany({ agentName });
  return result.deletedCount;
}

async function clearAllAgentConversations() {
  const result = await getDB().collection('agent_conversations').deleteMany({});
  return result.deletedCount;
}

async function countAgentConversations(agentName) {
  return await getDB().collection('agent_conversations').countDocuments({ agentName });
}

async function setAgentStatus(name, status) {
  await getDB().collection('agents').updateOne(
    { name },
    { $set: { status, updatedAt: new Date() } }
  );
}

// ===== إعدادات البوت العامة =====

async function getBotConfig(key) {
  const doc = await getDB().collection('bot_config').findOne({ type: 'main' });
  if (key === undefined) return doc;
  return doc ? doc[key] : null;
}

async function setBotConfig(keyOrObj, value) {
  let update;
  if (value === undefined && typeof keyOrObj === 'object') {
    update = { ...keyOrObj };
  } else {
    update = { [keyOrObj]: value };
  }
  await getDB().collection('bot_config').updateOne(
    { type: 'main' },
    { $set: { type: 'main', ...update, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ===== جلسات الانضمام =====

async function getJoinSession(userId) {
  return await getDB().collection('join_sessions').findOne({ userId: String(userId) });
}

async function setJoinSession(userId, data) {
  registerActiveSession(userId);
  await getDB().collection('join_sessions').updateOne(
    { userId: String(userId) },
    { $set: { userId: String(userId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteJoinSession(userId) {
  await getDB().collection('join_sessions').deleteOne({ userId: String(userId) });
  await checkAndRemoveFromCache(userId);
}

// ===== جلسات النشر =====

async function getNashrSession(fbId) {
  return await getDB().collection('nashr_sessions').findOne({ fbId: String(fbId) });
}

async function setNashrSession(fbId, data) {
  registerActiveSession(fbId);
  await getDB().collection('nashr_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteNashrSession(fbId) {
  await getDB().collection('nashr_sessions').deleteOne({ fbId: String(fbId) });
  await checkAndRemoveFromCache(fbId);
}

// ===== منشورات النشر =====

async function getNashrPost(url) {
  return await getDB().collection('nashr_posts').findOne({ url: String(url) });
}

async function addNashrPost(url, senderID, reactions, earned) {
  const result = await getDB().collection('nashr_posts').insertOne({
    url: String(url),
    senderID: String(senderID),
    reactions,
    earned,
    createdAt: new Date()
  });
  return result.insertedId;
}

// ===== توكنات Apify =====

async function getApifyTokens() {
  return await getDB().collection('apify_tokens').find({}).toArray();
}

async function addApifyToken(token) {
  await getDB().collection('apify_tokens').updateOne(
    { token: String(token) },
    { $set: { token: String(token), uses: 0, addedAt: new Date() } },
    { upsert: true }
  );
}

async function removeApifyToken(idOrToken) {
  const { ObjectId } = require('mongodb');
  try {
    const oid = new ObjectId(String(idOrToken));
    await getDB().collection('apify_tokens').deleteOne({ _id: oid });
  } catch (_) {
    await getDB().collection('apify_tokens').deleteOne({ token: String(idOrToken) });
  }
}

async function incrementTokenUse(token) {
  await getDB().collection('apify_tokens').updateOne(
    { token: String(token) },
    { $inc: { uses: 1 }, $set: { lastUsedAt: new Date() } }
  );
}

// ===== إعدادات النشر =====

async function getNashrSettings() {
  return await getDB().collection('nashr_settings').findOne({ type: 'global' });
}

async function updateNashrSettings(update) {
  await getDB().collection('nashr_settings').updateOne(
    { type: 'global' },
    { $set: { ...update, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ===== جلسات البنك =====

async function getBankSession(fbId) {
  return await getDB().collection('bank_sessions').findOne({ fbId: String(fbId) });
}

async function setBankSession(fbId, data) {
  registerActiveSession(fbId);
  await getDB().collection('bank_sessions').updateOne(
    { fbId: String(fbId) },
    { $set: { fbId: String(fbId), ...data, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function deleteBankSession(fbId) {
  await getDB().collection('bank_sessions').deleteOne({ fbId: String(fbId) });
  await checkAndRemoveFromCache(fbId);
}

// ===== مفاتيح ElevenLabs =====

async function addElevenLabsKey(key) {
  await getDB().collection('elevenlabs_keys').updateOne(
    { key: String(key) },
    { $set: { key: String(key), status: 'active', addedAt: new Date() } },
    { upsert: true }
  );
}

async function removeElevenLabsKey(key) {
  await getDB().collection('elevenlabs_keys').deleteOne({ key: String(key) });
}

async function getAllElevenLabsKeys() {
  return await getDB().collection('elevenlabs_keys').find({}).toArray();
}

async function markElevenLabsKeyFailed(key) {
  await getDB().collection('elevenlabs_keys').updateOne(
    { key: String(key) },
    { $set: { status: 'failed', failedAt: new Date() } }
  );
}

// ===== إدارة الأوامر المخصصة بقاعدة البيانات =====

async function getCustomCommands() {
  const database = getDB();
  const doc = await database.collection('custom_commands_config').findOne({ type: 'main' });
  return doc ? doc.commands : null;
}

async function saveCustomCommands(commands) {
  const database = getDB();
  await database.collection('custom_commands_config').updateOne(
    { type: 'main' },
    { $set: { commands, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ===== دوال تخزين وجلب الميمز وصور الأنمي =====

async function saveMedia(url, category) {
  const database = getDB();
  await database.collection('media_pool').insertOne({
    url,
    category,
    createdAt: new Date()
  });
}

async function getRandomUnseenMedia(fbId, category) {
  const database = getDB();
  const player = await getPlayer(fbId);
  
  const seenKey = category === 'anime' ? 'seenAnime' : 'seenMemes';
  const mediaCol = database.collection('media_pool');

  const allMedia = await mediaCol.find({ category }).toArray();
  if (allMedia.length === 0) return null;

  if (!player) {
    const randomItem = allMedia[Math.floor(Math.random() * allMedia.length)];
    return randomItem.url;
  }

  const seenIds = player[seenKey] || [];

  const unseenMedia = allMedia.filter(item => !seenIds.includes(String(item._id)));

  if (unseenMedia.length === 0) {
    await database.collection('players').updateOne(
      { fbId: String(fbId) },
      { $set: { [seenKey]: [] } }
    );
    const randomItem = allMedia[Math.floor(Math.random() * allMedia.length)];
    await database.collection('players').updateOne(
      { fbId: String(fbId) },
      { $addToSet: { [seenKey]: String(randomItem._id) } }
    );
    return randomItem.url;
  } else {
    const randomItem = unseenMedia[Math.floor(Math.random() * unseenMedia.length)];
    await database.collection('players').updateOne(
      { fbId: String(fbId) },
      { $addToSet: { [seenKey]: String(randomItem._id) } }
    );
    return randomItem.url;
  }
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  connectDB,
  getDB,
  getPlayer,
  getPlayerByNickname,
  createPlayer,
  updatePlayer,
  deletePlayer,
  getAllPlayers,
  addXP,
  getTempSession,
  setTempSession,
  deleteTempSession,
  addNotification,
  getPendingNotifications,
  markNotificationsSent,
  getNextClass,
  addItemToBag,
  removeItemFromBag,
  getItemTransferSession,
  setItemTransferSession,
  deleteItemTransferSession,
  getAdminSession,
  setAdminSession,
  deleteAdminSession,
  addPermanentBan,
  getPermanentBan,
  getAllPermanentBans,
  removePermanentBan,
  disableCommand,
  enableCommand,
  getDisabledCommands,
  isCommandDisabled,
  addCommandWatcher,
  getCommandWatchers,
  clearCommandWatchers,
  getBots,
  addBot,
  updateBotCookies,
  getBotById,
  updateBotName,
  deleteBot,
  incrementMessageCount,
  getMessageStats,
  getGroupSetting,
  updateGroupSetting,
  getProtectionSettings,
  saveProtectionSettings,
  getProtectedState,
  saveProtectedState,
  getDisabledCmdSession,
  setDisabledCmdSession,
  deleteDisabledCmdSession,
  getAllAgents,
  getAgentByName,
  addAgent,
  updateAgent,
  deleteAgent,
  getAgentConversation,
  saveAgentConversation,
  updateAgentConversation,
  expireOldConversations,
  clearAgentConversationsByName,
  clearAllAgentConversations,
  countAgentConversations,
  setAgentStatus,
  getBotConfig,
  setBotConfig,
  getJoinSession,
  setJoinSession,
  deleteJoinSession,
  getNashrSession,
  setNashrSession,
  deleteNashrSession,
  getNashrPost,
  addNashrPost,
  getApifyTokens,
  addApifyToken,
  removeApifyToken,
  incrementTokenUse,
  getNashrSettings,
  updateNashrSettings,
  getBankSession,
  setBankSession,
  deleteBankSession,
  addElevenLabsKey,
  removeElevenLabsKey,
  getAllElevenLabsKeys,
  markElevenLabsKeyFailed,
  hasActiveSession,
  registerActiveSession,
  checkAndRemoveFromCache,
  initSessionCache,
  saveMedia,
  getRandomUnseenMedia,
  getMubadilSession,
  setMubadilSession,
  deleteMubadilSession,
  recordMubadilPurchase,
  getMubadilDemand,
  getCustomCommands,
  saveCustomCommands
};