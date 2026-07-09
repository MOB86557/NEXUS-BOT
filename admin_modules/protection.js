const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const { generateNickname, getKingdomByThreadId, kingdomNamesAr, sendMessage } = require('../utils');
const { getAllPlayers, getPlayer, getProtectedState, saveProtectedState, getProtectionSettings, saveProtectionSettings, getGroupSetting, setAdminSession, deleteAdminSession } = require('../database');
const { setTitle, downloadPhoto } = require('./helpers');

const _protectionLocks = new Set();

function _lock(key, ms) {
  _protectionLocks.add(key);
  setTimeout(() => _protectionLocks.delete(key), ms);
}

async function snapshotNicknames() {
  const players = await getAllPlayers();
  const snap    = {};
  for (const p of players) {
    snap[String(p.fbId)] = generateNickname(p.nickname, p.rank || 'مجند', p.class, p.warnings || 0);
  }
  const existing = await getProtectedState('global') || {};
  await saveProtectedState('global', { ...existing, nicknames: snap });
}

async function snapshotGroupNames() {
  const snap = {};
  // حفظ أسماء العواصم الثلاث
  for (const k of ['solfare', 'niravil', 'murdak']) {
    const setting = await getGroupSetting(k);
    snap[k] = (setting && setting.customName) ? setting.customName : `مملكة ${kingdomNamesAr[k]}`;
  }
  // حفظ أسماء المدن (الأفرع) بمفتاح threadId
  try {
    const { getDB } = require('../database');
    const cities = await getDB().collection('cities').find().toArray();
    for (const city of cities) {
      if (city.threadId && city.name) {
        snap[`city_${city.threadId}`] = city.name;
      }
    }
  } catch (e) { console.error('[حماية] خطأ تحميل أسماء المدن:', e.message); }
  const existing = await getProtectedState('global') || {};
  await saveProtectedState('global', { ...existing, groupNames: snap });
}

async function snapshotGroupPhotos() {
  const snap = {};
  // حفظ صور العواصم الثلاث
  for (const k of ['solfare', 'niravil', 'murdak']) {
    const setting = await getGroupSetting(k);
    const base64 = setting && setting.photoBase64;
    const url    = setting && (setting.defaultPhotoUrl || setting.photoUrl);
    if (base64) snap[k] = { base64, url };
    else if (url) snap[k] = { url };
    else console.warn(`[حماية] ⚠️ لا توجد صورة محفوظة لـ ${k}`);
  }
  // حفظ صور المدن بمفتاح city_threadId
  try {
    const { getDB } = require('../database');
    const cities = await getDB().collection('cities').find().toArray();
    for (const city of cities) {
      if (!city.threadId) continue;
      const base64 = city.photoBase64;
      const url    = city.photoUrl;
      if (base64) snap[`city_${city.threadId}`] = { base64, url };
      else if (url) snap[`city_${city.threadId}`] = { url };
    }
  } catch (e) { console.error('[حماية] خطأ تحميل صور المدن:', e.message); }
  const existing = await getProtectedState('global') || {};
  await saveProtectedState('global', { ...existing, groupPhotos: snap });
}

async function snapshotBotNickname() {
  const setting = await getGroupSetting('bot_global');
  const nick = setting && setting.botNickname ? setting.botNickname : null;
  const existing = await getProtectedState('global') || {};
  await saveProtectedState('global', { ...existing, botNickname: nick });
}

async function handleProtection(api, event, botId) {
  let settings, state;
  try { settings = await getProtectionSettings('global'); state = await getProtectedState('global'); } catch (e) { return; }
  if (!settings || !state) return;

  const eventAuthor = String(
    event.author ||
    (event.logMessageData && event.logMessageData.actorFbId) ||
    ''
  );

  // ── حماية كنية البوت (مستقلة عن حماية كنيات اللاعبين) ──
  if (settings.nicknames && event.logMessageType === 'log:user-nickname' && state.botNickname) {
    const changedIdBot = String(
      (event.logMessageData && (event.logMessageData.participant_id || event.logMessageData.participantId || event.logMessageData.participantID)) || ''
    );
    if (changedIdBot && botId && changedIdBot === String(botId)) {
      const newNickBot = String((event.logMessageData && (event.logMessageData.nickname || event.logMessageData.newNickname)) || '');
      if (newNickBot !== state.botNickname) {
        if (botId && eventAuthor && eventAuthor === String(botId)) return;
        const lockKeyBot = `nick_bot_${event.threadID}`;
        if (_protectionLocks.has(lockKeyBot)) return;
        _lock(lockKeyBot, 6000);
        try { await new Promise(r => api.changeNickname(state.botNickname, event.threadID, String(botId), () => r())); }
        catch(e) { console.error('❌ خطأ حماية كنية البوت:', e.message || e); }
        return;
      }
      return;
    }
  }

  // ── حماية كنيات اللاعبين ──
  if (settings.nicknames && event.logMessageType === 'log:user-nickname') {
    if (!state.nicknames) return;

    const changedId = String(
      (event.logMessageData && (event.logMessageData.participant_id || event.logMessageData.participantId || event.logMessageData.participantID)) || ''
    );
    if (!changedId) return;

    let protectedNick = null;
    const player = await getPlayer(changedId);
    if (player) {
      protectedNick = generateNickname(player.nickname, player.rank || 'مجند', player.class, player.warnings || 0);
    } else if (state.nicknames && state.nicknames[changedId]) {
      protectedNick = state.nicknames[changedId];
    }

    if (!protectedNick) return;

    const newNick = String((event.logMessageData && (event.logMessageData.nickname || event.logMessageData.newNickname)) || '');

    if (newNick === protectedNick) return;
    if (botId && eventAuthor && eventAuthor === String(botId)) return;

    const lockKey = `nick_${changedId}`;
    if (_protectionLocks.has(lockKey)) return;
    _lock(lockKey, 6000);

    try {
      await new Promise((resolve) => {
        api.changeNickname(protectedNick, event.threadID, changedId, () => resolve());
      });
    } catch (e) { console.error('❌ خطأ حماية الكنية:', e.message || e); }
    return;
  }

  if (settings.groupNames && event.logMessageType === 'log:thread-name') {
    if (!state.groupNames) return;

    // فحص العواصم أولاً ثم المدن
    const kingdom = getKingdomByThreadId(event.threadID);
    const cityKey = `city_${event.threadID}`;
    const snapKey = kingdom || (state.groupNames[cityKey] !== undefined ? cityKey : null);
    if (!snapKey) return;

    const protectedName = state.groupNames[snapKey];
    if (!protectedName) return;

    const newName = String((event.logMessageData && event.logMessageData.name) || '');

    if (newName === protectedName) return;
    if (botId && eventAuthor && eventAuthor === String(botId)) return;

    const lockKey = `name_${event.threadID}`;
    if (_protectionLocks.has(lockKey)) return;
    _lock(lockKey, 6000);

    try { await setTitle(api, protectedName, event.threadID); }
    catch (e) { console.error('❌ خطأ حماية الاسم:', e.message || e); }
    return;
  }

  if (settings.groupPhotos && event.logMessageType === 'log:thread-image') {
    if (!state.groupPhotos) return;

    // فحص العواصم أولاً ثم المدن
    const kingdom = getKingdomByThreadId(event.threadID);
    const cityKey = `city_${event.threadID}`;
    const photoEntry = kingdom
      ? state.groupPhotos[kingdom]
      : state.groupPhotos[cityKey];
    if (!photoEntry) return;

    if (botId && eventAuthor && eventAuthor === String(botId)) return;

    const lockKey = `photo_${event.threadID}`;
    if (_protectionLocks.has(lockKey)) return;
    _lock(lockKey, 12000);

    const tmp = path.join(require('os').tmpdir(), `protect_photo_${Date.now()}.jpg`);
    try {
      if (photoEntry.base64) {
        fs.writeFileSync(tmp, Buffer.from(photoEntry.base64, 'base64'));
      } else if (photoEntry.url) {
        await downloadPhoto(photoEntry.url, tmp);
      } else if (typeof photoEntry === 'string') {
        await downloadPhoto(photoEntry, tmp);
      } else {
        _protectionLocks.delete(lockKey);
        return;
      }

      await new Promise((resolve, reject) => {
        api.changeGroupImage(fs.createReadStream(tmp), event.threadID, (err) => {
          try { fs.unlinkSync(tmp); } catch (_) {}
          if (err) return reject(err);
          resolve();
        });
      });
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      console.error('❌ خطأ حماية الصورة:', e.message || e);
      _protectionLocks.delete(lockKey);
    }
    return;
  }
}

async function handleHimaya(api, event) {
  const { threadID, senderID } = event;
  const settings = await getProtectionSettings('global') || {};
  const si = (v) => v ? '🟢' : '🔴';
  const msg =
    `╮───∙⋆⋅「 الحماية 」\n│\n` +
    `│ 1 › حماية الكنيات          ${si(settings.nicknames)}\n` +
    `│ 2 › حماية أسماء القروبات   ${si(settings.groupNames)}\n` +
    `│ 3 › حماية الصور            ${si(settings.groupPhotos)}\n` +
    `│ 4 › حماية الكل\n│ 5 › إيقاف الكل\n│ › 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  await setAdminSession(senderID, { state: 'HIMAYA_MAIN' });
  await sendMessage(api, msg, threadID);
}

async function handleHimayaSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }

  const current   = await getProtectionSettings('global') || {};
  let newSettings = {
    nicknames:   current.nicknames   || false,
    groupNames:  current.groupNames  || false,
    groupPhotos: current.groupPhotos || false,
  };

  if      (text === '1') { newSettings.nicknames   = !current.nicknames;   if (newSettings.nicknames)   await snapshotNicknames();  }
  else if (text === '2') { newSettings.groupNames  = !current.groupNames;  if (newSettings.groupNames)  await snapshotGroupNames(); }
  else if (text === '3') { newSettings.groupPhotos = !current.groupPhotos; if (newSettings.groupPhotos) await snapshotGroupPhotos(); }
  else if (text === '4') {
    newSettings = { nicknames: true, groupNames: true, groupPhotos: true };
    await snapshotNicknames(); await snapshotGroupNames(); await snapshotGroupPhotos();
  }
  else if (text === '5') { newSettings = { nicknames: false, groupNames: false, groupPhotos: false }; }
  else { await sendMessage(api, `⚠️ اختر من 1 إلى 5`, threadID); return; }

  await saveProtectionSettings('global', newSettings);
  await deleteAdminSession(senderID);
  const si = (v) => v ? '🟢' : '🔴';
  await sendMessage(api,
    `╮───∙⋆⋅「 الحماية › تحديث 」\n│\n│ › الكنيات   ${si(newSettings.nicknames)}\n│ › الأسماء   ${si(newSettings.groupNames)}\n│ › الصور     ${si(newSettings.groupPhotos)}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

module.exports = {
  handleHimaya,
  handleHimayaSession,
  handleProtection,
  snapshotNicknames,
  snapshotGroupNames,
  snapshotGroupPhotos,
  snapshotBotNickname
};