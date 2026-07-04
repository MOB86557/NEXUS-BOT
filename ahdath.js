// ahdath.js
// معالجة أحداث (events) القروب: دخول أعضاء، تغيير اسم/صورة القروب، إعطاء صلاحية أدمن
const config = require('./config.json');

const { handleBotJoin } = require('./dukhul');
const {
  handleAdminGranted, handleProtection,
  kickFromAllGroups, getPermanentBan
} = require('./admin');
const { handleIntruderJoin } = require('./dakhil');

// يعالج أحداث event.type === 'event'
// يرجع true إذا تمت معالجة الحدث (يعني الراوتر الرئيسي لازم يعمل return بعدها)
async function handleAhdathEvent(api, event, BOT_ID) {
  const lt = event.logMessageType;

  if (lt === 'log:subscribe') {
    const addedParticipants = event.logMessageData?.addedParticipants || [];
    const pids = addedParticipants.map(p => String(p.userFbId));
    const botId = String(config.cookies?.find(c => c.key === 'c_user')?.value || BOT_ID || '');
    const { handlePlayerJoinSubscribe } = require('./dukhul');

    const botJoined = pids.some(id => String(id) === botId);
    const realNewPlayers = pids.filter(id => String(id) !== botId);

    await Promise.allSettled([
      botJoined ? handleBotJoin(api, event) : Promise.resolve(),
      realNewPlayers.length > 0
        ? handlePlayerJoinSubscribe(api, { ...event, participantIDs: realNewPlayers }, BOT_ID)
        : Promise.resolve(),
      handleIntruderJoin(api, event, BOT_ID),
      ...realNewPlayers.map(async (pid) => {
        try {
          const ban = await getPermanentBan(String(pid));
          if (ban) await kickFromAllGroups(api, String(pid));
        } catch (err) {
          console.error(`[ WARN ] فشل معالجة طرد العضو المحظور ${pid}:`, err.message);
        }
      })
    ]);
    return true;
  }

  if (lt === 'log:user-nickname' || lt === 'log:thread-name' || lt === 'log:thread-image') {
    await handleProtection(api, event, BOT_ID);
    return true;
  }

  if (lt === 'log:thread-admins') {
    await handleAdminGranted(api, event);
  }
  return true;
}

module.exports = { handleAhdathEvent };
