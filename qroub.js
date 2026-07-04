// ─── qroub.js — أمر رابط القروب ───
const { sendMessage } = require('./utils');
const config = require('./config.json');

async function handleQroub(api, event) {
  const { threadID } = event;
  const text = (event.body || '').trim();

  if (text === 'قروب') {
    await sendMessage(api, `https://facebook.com/groups/1970196400432434/`, threadID);
    return true;
  }

  return false;
}

module.exports = { handleQroub };
