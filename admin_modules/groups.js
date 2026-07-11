const fs = require('fs');
const path = require('path');
const config = require('../config.json');
const { sendMessage, kingdomNamesAr, generateNickname, buildOfficialNickname } = require('../utils');
const { getGroupSetting, updateGroupSetting, getAllPlayers, setAdminSession, deleteAdminSession, getDB } = require('../database');
const { setTitle, downloadPhoto, addUserToGroup } = require('./helpers');

// ═════════════════════════════════════════════════════════════════════
//   زمن التأخير بين كل تغيير كنية أثناء "إعادة ضبط الكنيات" (بالميلي ثانية)
//   افتراضياً 2 ثانية — قابل للتعديل من قبل الأدمن عبر أمر إعادة ضبط
// ═════════════════════════════════════════════════════════════════════
let resetNicknameDelayMs = 2000;
let resetDelayLoaded = false;

async function loadResetDelay() {
  if (resetDelayLoaded) return;
  resetDelayLoaded = true;
  try {
    const { getBotConfig } = require('../database');
    if (typeof getBotConfig === 'function') {
      const val = await getBotConfig('resetNicknameDelay');
      if (val !== undefined && val !== null && !isNaN(val)) {
        resetNicknameDelayMs = Math.round(Number(val) * 1000);
      }
    }
  } catch (e) {}
}

async function saveResetDelay(seconds) {
  resetNicknameDelayMs = Math.round(seconds * 1000);
  try {
    const { setBotConfig } = require('../database');
    if (typeof setBotConfig === 'function') await setBotConfig('resetNicknameDelay', seconds);
  } catch (e) {}
}

async function handleTa3deel(api, event) {
  const { threadID, senderID } = event;
  const botNickSetting = await getGroupSetting('bot_global');
  const currentBotNick = (botNickSetting && botNickSetting.botNickname) ? botNickSetting.botNickname : 'غير محدد';
  await setAdminSession(senderID, { state: 'DATA_MAIN' });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n         ✦ تعديل القروبات ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n│ 1 › تعديل اسم سولفارا (العاصمة)\n│ 2 › تعديل اسم نيرافيل (العاصمة)\n│ 3 › تعديل اسم مورداك (العاصمة)\n` +
    `│ 4 › تعديل صورة سولفارا (العاصمة)\n│ 5 › تعديل صورة نيرافيل (العاصمة)\n│ 6 › تعديل صورة مورداك (العاصمة)\n` +
    `│ 7 › تعديل كنية البوت (على جميع المجموعات)\n` +
    `│    ↳ الحالية: ${currentBotNick}\n` +
    `│ 8 › 🏙️ إدارة مدن الممالك (أفرع الممالك الثلاث)\n` +
    `│ 9 › خروج\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleDataSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج' || text === '9') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  
  if (session.state === 'DATA_MAIN') {
    const kMap = { '1':'solfare','2':'niravil','3':'murdak','4':'solfare','5':'niravil','6':'murdak' };
    if (['1','2','3'].includes(text)) {
      await setAdminSession(senderID, { state: 'DATA_AWAIT_NAME', kingdom: kMap[text] });
      await sendMessage(api, `╮───∙⋆⋅「 تعديل الاسم 」\n│\n│ › ارسل الاسم الجديد لـ ${kingdomNamesAr[kMap[text]]}\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
    }
    if (['4','5','6'].includes(text)) {
      await setAdminSession(senderID, { state: 'DATA_AWAIT_PHOTO', kingdom: kMap[text] });
      await sendMessage(api, `╮───∙⋆⋅「 تعديل الصورة 」\n│\n│ › ارسل الصورة الجديدة لـ ${kingdomNamesAr[kMap[text]]}\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
    }
    if (text === '7') {
      const s = await getGroupSetting('bot_global');
      const cur = (s && s.botNickname) ? s.botNickname : 'غير محدد';
      await setAdminSession(senderID, { state: 'DATA_AWAIT_BOT_NICK' });
      await sendMessage(api, `╮───∙⋆⋅「 تعديل كنية البوت 」\n│\n│ › الكنية الحالية : ${cur}\n│\n│ › ارسل الكنية الجديدة للبوت\n│ › (ستُطبق على جميع القروبات)\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
    }
    if (text === '8') {
      await setAdminSession(senderID, { state: 'CITIES_MAIN' });
      const msg = 
        `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n      ✦ إدارة مدن الممالك ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
        `╮───∙⋆⋅「 الخيارات 」\n` +
        `│ 1 › عرض كافة المدن الحالية وتفاصيلها\n` +
        `│ 2 › إضافة مدينة جديدة (فرع تحت مملكة)\n` +
        `│ 3 › تعديل بيانات مدينة مسجلة\n` +
        `│ 4 › حذف مدينة\n` +
        `│ 5 › رجوع للقائمة السابقة\n` +
        `╯───────∙⋆⋅ ※ ⋅⋆∙`;
      await sendMessage(api, msg, threadID);
      return;
    }
    await sendMessage(api, `⚠️ اختر رقماً من 1 إلى 9`, threadID); return;
  }
  
  if (session.state === 'DATA_AWAIT_NAME') {
    const k = session.kingdom;
    await updateGroupSetting(k, { customName: text, defaultName: text });
    const gid = config.groupes[k]; if (gid) await setTitle(api, text, gid);
    try {
      const { snapshotGroupNames } = require('./protection');
      await snapshotGroupNames();
    } catch (e) { console.error('خطأ تحديث snapshot الأسماء:', e.message); }
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم التعديل 」\n│\n│ › اسم ${kingdomNamesAr[k]} : ${text}\n│ › تم حفظه كاسم افتراضي ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  
  if (session.state === 'DATA_AWAIT_PHOTO') {
    const k = session.kingdom;
    const photo = (event.attachments || []).find(a => a.type === 'photo' || a.type === 'sticker');
    if (!photo) { await sendMessage(api, `⚠️ لم يتم إرسال صورة، أرسل صورة أو 《 خروج 》`, threadID); return; }
    const photoUrl = photo.url || photo.previewUrl || photo.largePreviewUrl;
    if (!photoUrl) { await sendMessage(api, `⚠️ تعذر الحصول على رابط الصورة`, threadID); return; }
    const gid = config.groupes[k];
    const tmp = path.join(require('os').tmpdir(), `group_photo_${Date.now()}.jpg`);
    let photoBase64 = null;
    try {
      await downloadPhoto(photoUrl, tmp);
      photoBase64 = require('fs').readFileSync(tmp).toString('base64');
    } catch (e) { console.error('خطأ تنزيل صورة القروب:', e); }
    await updateGroupSetting(k, { photoUrl, defaultPhotoUrl: photoUrl, photoBase64 });
    try {
      const { snapshotGroupPhotos } = require('./protection');
      await snapshotGroupPhotos();
    } catch (e) { console.error('خطأ تحديث snapshot الصور:', e.message); }
    if (gid && photoBase64) {
      try {
        await new Promise(r => api.changeGroupImage(fs.createReadStream(tmp), gid, () => { try { require('fs').unlinkSync(tmp); } catch (_) {} r(); }));
      } catch (e) { console.error('خطأ تغيير صورة القروب:', e); }
    } else { try { require('fs').unlinkSync(tmp); } catch (_) {} }
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم التعديل 」\n│\n│ › تم تحديث صورة ${kingdomNamesAr[k]} ✅️\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  
  if (session.state === 'DATA_AWAIT_BOT_NICK') {
    if (!text || text.length < 1) { await sendMessage(api, `⚠️ الكنية قصيرة جداً`, threadID); return; }
    await updateGroupSetting('bot_global', { botNickname: text });
    const botId = api.getCurrentUserID ? (typeof api.getCurrentUserID === 'function' ? api.getCurrentUserID() : api.getCurrentUserID) : null;
    if (botId) {
      for (const gid of Object.values(config.groupes).filter(Boolean)) {
        try { await new Promise(r => api.changeNickname(text, String(gid), String(botId), () => r())); } catch(e) {}
      }
    }
    try {
      const { snapshotBotNickname } = require('./protection');
      await snapshotBotNickname();
    } catch(e) {}
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n│ › كنية البوت الجديدة : ${text}\n│ › تم تطبيقها على جميع القروبات\n│ › تم حفظها كقيمة افتراضية\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
}

// ═════════════════════════════════════════════════════════════════════
//   إدارة مدن الممالك (أفرع الممالك)
// ═════════════════════════════════════════════════════════════════════

async function handleCitiesSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  const db = getDB();
  
  if (text === 'خروج') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }
  
  if (session.state === 'CITIES_MAIN') {
    if (text === '1') {
      const cities = await db.collection('cities').find().toArray();
      if (cities.length === 0) {
        await sendMessage(api, `╮───∙⋆⋅「 المدن المسجلة 」\n│\n│ › لا توجد أي مدن حالياً في قاعدة البيانات.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
        return;
      }
      let m = `╮───∙⋆⋅「 المدن الحالية 」\n`;
      cities.forEach((c, i) => {
        m += `│ ${i + 1}. ${c.name} (تابعة لـ: ${kingdomNamesAr[c.kingdom]})\n│    ↳ اسم القروب: ${c.groupName || c.name}\n│    ↳ ID: ${c.threadId}\n`;
      });
      m += `╯───────∙⋆⋅ ※ ⋅⋆∙`;
      await sendMessage(api, m, threadID);
      return;
    }
    if (text === '2') {
      await setAdminSession(senderID, { state: 'CITIES_ADD_KINGDOM' });
      await sendMessage(api, `╮───∙⋆⋅「 إضافة مدينة 」\n│\n│ اختر المملكة التي ستتبع لها هذه المدينة:\n│ 1 › سولفارا\n│ 2 › نيرافيل\n│ 3 › مورداك\n│\n│ › او اكتب 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    if (text === '3') {
      const cities = await db.collection('cities').find().toArray();
      if (cities.length === 0) {
        await sendMessage(api, `⚠️ لا توجد مدن مسجلة حالياً لتعديلها.`, threadID);
        return;
      }
      let m = `╮───∙⋆⋅「 تعديل مدينة 」\n│\n`;
      cities.forEach((c, i) => {
        m += `│ ${i + 1}. ${c.name} [مملكة ${kingdomNamesAr[c.kingdom]}]\n│    ↳ القروب: ${c.groupName || c.name}\n`;
      });
      m += `│\n│ › ارسل رقم المدينة لتعديلها\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
      await setAdminSession(senderID, { state: 'CITIES_EDIT_SELECT', citiesList: cities });
      await sendMessage(api, m, threadID);
      return;
    }
    if (text === '4') {
      const cities = await db.collection('cities').find().toArray();
      if (cities.length === 0) {
        await sendMessage(api, `⚠️ لا توجد مدن مسجلة لحذفها.`, threadID);
        return;
      }
      let m = `╮───∙⋆⋅「 حذف مدينة 」\n│\n`;
      cities.forEach((c, i) => {
        m += `│ ${i + 1}. ${c.name} [مملكة ${kingdomNamesAr[c.kingdom]}]\n│    ↳ القروب: ${c.groupName || c.name}\n`;
      });
      m += `│\n│ › ارسل رقم المدينة لحذفها نهائياً\n│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
      await setAdminSession(senderID, { state: 'CITIES_DELETE_SELECT', citiesList: cities });
      await sendMessage(api, m, threadID);
      return;
    }
    if (text === '5') {
      await deleteAdminSession(senderID);
      await handleTa3deel(api, event);
      return;
    }
    await sendMessage(api, `⚠️ الرجاء اختيار خيار صحيح من القائمة (1 - 5).`, threadID);
    return;
  }
  
  if (session.state === 'CITIES_ADD_KINGDOM') {
    const kMap = { '1': 'solfare', '2': 'niravil', '3': 'murdak' };
    const k = kMap[text];
    if (!k) {
      await sendMessage(api, `⚠️ خيار غير صحيح. اختر من (1 - 3).`, threadID);
      return;
    }
    await setAdminSession(senderID, { state: 'CITIES_ADD_AWAIT_NAME', kingdom: k });
    await sendMessage(api,
      `╮───∙⋆⋅「 إضافة مدينة - الخطوة 1/3 」\n│\n` +
      `│ › المملكة: ${kingdomNamesAr[k]}\n│\n` +
      `│ ارسل اسم المدينة كما سيظهر في الخريطة:\n` +
      `│ (هذا الاسم لن يتغير تلقائياً)\n│\n` +
      `│ › او اكتب 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }
  
  if (session.state === 'CITIES_ADD_AWAIT_NAME') {
    if (!text || text.length < 2) {
      await sendMessage(api, `⚠️ اسم المدينة قصير جداً، حاول مجدداً.`, threadID);
      return;
    }
    await setAdminSession(senderID, { state: 'CITIES_ADD_AWAIT_GROUP_NAME', kingdom: session.kingdom, cityName: text });
    await sendMessage(api,
      `╮───∙⋆⋅「 إضافة مدينة - الخطوة 2/3 」\n│\n` +
      `│ › اسم المدينة (الخريطة): ${text}\n│\n` +
      `│ ارسل اسم القروب الفعلي:\n` +
      `│ (هذا الاسم سيُطبق على القروب وقد يتغير)\n│\n` +
      `│ › او اكتب 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  if (session.state === 'CITIES_ADD_AWAIT_GROUP_NAME') {
    if (!text || text.length < 2) {
      await sendMessage(api, `⚠️ اسم القروب قصير جداً، حاول مجدداً.`, threadID);
      return;
    }
    await setAdminSession(senderID, { state: 'CITIES_ADD_AWAIT_ID', kingdom: session.kingdom, cityName: session.cityName, groupName: text });
    await sendMessage(api,
      `╮───∙⋆⋅「 إضافة مدينة - الخطوة 3/3 」\n│\n` +
      `│ › اسم المدينة (الخريطة): ${session.cityName}\n` +
      `│ › اسم القروب: ${text}\n│\n` +
      `│ ارسل الآن ايدي (معرف) قروب هذه المدينة:\n│\n` +
      `│ › او اكتب 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }
  
  if (session.state === 'CITIES_ADD_AWAIT_ID') {
    if (!/^\d+$/.test(text)) {
      await sendMessage(api, `⚠️ ايدي غير صحيح. يجب إدخال ايدي رقمي لقروب فيسبوك.`, threadID);
      return;
    }
    await db.collection('cities').insertOne({
      threadId: text,
      name: session.cityName,
      groupName: session.groupName,
      kingdom: session.kingdom,
      photoUrl: '',
      photoBase64: ''
    });
    // تطبيق اسم القروب على المجموعة فعلياً
    try { await setTitle(api, session.groupName, text); } catch(e) {}
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم إنشاء فرع المدينة 🎉 」\n│\n` +
      `│ › اسم المدينة (الخريطة): ${session.cityName}\n` +
      `│ › اسم القروب: ${session.groupName}\n` +
      `│ › المملكة: ${kingdomNamesAr[session.kingdom]}\n` +
      `│ › ايدي القروب: ${text}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }
  
  if (session.state === 'CITIES_EDIT_SELECT') {
    const list = session.citiesList || [];
    const idx = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= list.length) {
      await sendMessage(api, `⚠️ رقم غير صحيح.`, threadID);
      return;
    }
    const city = list[idx];
    await setAdminSession(senderID, { state: 'CITIES_EDIT_CHOICE', targetCityId: city.threadId, cityName: city.name, groupName: city.groupName || city.name });
    await sendMessage(api,
      `╮───∙⋆⋅「 تعديل مدينة 」\n│\n` +
      `│ › اسم المدينة (الخريطة): ${city.name}\n` +
      `│ › اسم القروب الحالي: ${city.groupName || city.name}\n│\n` +
      `│ اختر ما تريد تعديله:\n` +
      `│ 1 › تعديل اسم المدينة (الخريطة)\n` +
      `│ 2 › تعديل اسم القروب\n` +
      `│ 3 › تعديل ايدي القروب\n` +
      `│ 4 › تعديل صورة القروب الرسمية\n` +
      `│ 5 › إلغاء ورجوع\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }
  
  if (session.state === 'CITIES_EDIT_CHOICE') {
    if (text === '1') {
      await setAdminSession(senderID, { state: 'CITIES_EDIT_AWAIT_NAME', targetCityId: session.targetCityId, cityName: session.cityName, groupName: session.groupName });
      await sendMessage(api,
        `╮───∙⋆⋅「 تعديل اسم المدينة (الخريطة) 」\n│\n` +
        `│ › الاسم الحالي في الخريطة: ${session.cityName}\n│\n` +
        `│ › ارسل الاسم الجديد للمدينة:\n` +
        `│ › (لن يؤثر على اسم القروب)\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    if (text === '2') {
      await setAdminSession(senderID, { state: 'CITIES_EDIT_AWAIT_GROUP_NAME', targetCityId: session.targetCityId, cityName: session.cityName, groupName: session.groupName });
      await sendMessage(api,
        `╮───∙⋆⋅「 تعديل اسم القروب 」\n│\n` +
        `│ › اسم القروب الحالي: ${session.groupName}\n│\n` +
        `│ › ارسل الاسم الجديد للقروب:\n` +
        `│ › (لن يؤثر على اسم المدينة في الخريطة)\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    if (text === '3') {
      await setAdminSession(senderID, { state: 'CITIES_EDIT_AWAIT_ID', targetCityId: session.targetCityId, cityName: session.cityName, groupName: session.groupName });
      await sendMessage(api, `╮───∙⋆⋅「 تعديل الايدي 」\n│\n│ › الايدي الحالي: ${session.targetCityId}\n│ › ارسل الايدي الجديد للقروب:\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    if (text === '4') {
      await setAdminSession(senderID, { state: 'CITIES_EDIT_AWAIT_PHOTO', targetCityId: session.targetCityId, cityName: session.cityName, groupName: session.groupName });
      await sendMessage(api, `╮───∙⋆⋅「 تعديل صورة المدينة 」\n│\n│ › ارسل الصورة الجديدة كأرفاق مباشر في المحادثة:\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    if (text === '5') {
      await setAdminSession(senderID, { state: 'CITIES_MAIN' });
      await sendMessage(api, `╮───∙⋆⋅「 رجوع لقائمة المدن 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    await sendMessage(api, `⚠️ خيار غير صحيح.`, threadID);
    return;
  }
  
  if (session.state === 'CITIES_EDIT_AWAIT_NAME') {
    if (!text || text.length < 2) {
      await sendMessage(api, `⚠️ اسم قصير جداً.`, threadID);
      return;
    }
    await db.collection('cities').updateOne({ threadId: session.targetCityId }, { $set: { name: text } });
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n` +
      `│ › تم تغيير اسم المدينة في الخريطة\n` +
      `│ › من: "${session.cityName}"\n` +
      `│ › إلى: "${text}"\n` +
      `│ › اسم القروب لم يتغير: ${session.groupName}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  if (session.state === 'CITIES_EDIT_AWAIT_GROUP_NAME') {
    if (!text || text.length < 2) {
      await sendMessage(api, `⚠️ اسم قصير جداً.`, threadID);
      return;
    }
    await db.collection('cities').updateOne({ threadId: session.targetCityId }, { $set: { groupName: text } });
    try { await setTitle(api, text, session.targetCityId); } catch(e) {}
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n` +
      `│ › تم تغيير اسم القروب\n` +
      `│ › من: "${session.groupName}"\n` +
      `│ › إلى: "${text}"\n` +
      `│ › اسم المدينة في الخريطة لم يتغير: ${session.cityName}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }
  
  if (session.state === 'CITIES_EDIT_AWAIT_ID') {
    if (!/^\d+$/.test(text)) {
      await sendMessage(api, `⚠️ الرجاء إرسال ايدي رقمي صحيح.`, threadID);
      return;
    }
    await db.collection('cities').updateOne({ threadId: session.targetCityId }, { $set: { threadId: text } });
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n│ › المدينة: ${session.cityName}\n│ › تم تعديل الايدي إلى: ${text}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }
  
  if (session.state === 'CITIES_EDIT_AWAIT_PHOTO') {
    const photo = (event.attachments || []).find(a => a.type === 'photo' || a.type === 'sticker');
    if (!photo) { await sendMessage(api, `⚠️ لم تقم بإرفاق صورة. يرجى إرسال الصورة أو 《 خروج 》`, threadID); return; }
    const photoUrl = photo.url || photo.previewUrl || photo.largePreviewUrl;
    if (!photoUrl) { await sendMessage(api, `⚠️ تعذر استخراج رابط الصورة.`, threadID); return; }
    
    const tmp = path.join(require('os').tmpdir(), `city_pic_${Date.now()}.jpg`);
    let photoBase64 = null;
    try {
      await downloadPhoto(photoUrl, tmp);
      photoBase64 = fs.readFileSync(tmp).toString('base64');
    } catch(e) { console.error('Error handling city photo download:', e); }
    
    await db.collection('cities').updateOne({ threadId: session.targetCityId }, { $set: { photoUrl, photoBase64 } });
    
    if (photoBase64) {
      try {
        await new Promise(r => api.changeGroupImage(fs.createReadStream(tmp), session.targetCityId, () => { try { fs.unlinkSync(tmp); } catch (_) {} r(); }));
      } catch(e) { console.error('Error pushing city image:', e); }
    } else { try { fs.unlinkSync(tmp); } catch (_) {} }
    
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n│ › تم تحديث صورة قروب المدينة "${session.cityName}" بنجاح.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }
  
  if (session.state === 'CITIES_DELETE_SELECT') {
    const list = session.citiesList || [];
    const idx = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= list.length) {
      await sendMessage(api, `⚠️ رقم غير صحيح.`, threadID);
      return;
    }
    const city = list[idx];
    await setAdminSession(senderID, { state: 'CITIES_DELETE_CONFIRM', targetCityId: city.threadId, cityName: city.name });
    await sendMessage(api, `╮───∙⋆⋅「 تأكيد الحذف 」\n│\n│ هل تود حقاً حذف فرع مدينة "${city.name}"؟\n│\n│ ارسل 《 تأكيد 》 للحذف\n│ ارسل 《 إلغاء 》 للتراجع والعودة\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }
  
  if (session.state === 'CITIES_DELETE_CONFIRM') {
    if (text === 'تأكيد') {
      await db.collection('cities').deleteOne({ threadId: session.targetCityId });
      await deleteAdminSession(senderID);
      await sendMessage(api, `╮───∙⋆⋅「 تم حذف المدينة 🗑️ 」\n│\n│ › تم حذف مدينة "${session.cityName}" من السجلات بنجاح.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    } else {
      await setAdminSession(senderID, { state: 'CITIES_MAIN' });
      await sendMessage(api, `╮───∙⋆⋅「 تم الإلغاء 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    }
    return;
  }
}

// ═════════════════════════════════════════════════════════════════════
//   قروبات البوت وتصفيتها
// ═════════════════════════════════════════════════════════════════════

async function handleBotGroups(api, event) {
  const { threadID, senderID } = event;
  await sendMessage(api, `... جاري تحميل قائمة قروبات البوت، يرجى الانتظار`, threadID);
  
  api.getThreadList(100, null, ["INBOX"], async (err, list) => {
    if (err) {
      await sendMessage(api, `❌ خطأ في جلب مجموعات البوت: ${err.message}`, threadID);
      return;
    }
    // تصفية المجموعات الحقيقية النشطة فقط — استبعاد المؤرشفة والفارغة
    const groups = (list || []).filter(t =>
      t.isGroup &&
      !t.isArchived &&
      t.threadID &&
      t.participantIDs && t.participantIDs.length > 0
    );
    if (groups.length === 0) {
      await sendMessage(api, `╮───∙⋆⋅「 قروبات البوت 」\n│\n│ › البوت غير متصل بأي مجموعات حالياً.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    
    const kingdomIds = Object.values(config.groupes).filter(Boolean).map(String);
    let cityIds = [];
    try {
      const cities = await getDB().collection('cities').find().toArray();
      cityIds = cities.map(c => String(c.threadId));
    } catch(e) {}
    
    let msg = `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦ مجموعات البوت النشطة ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n`;
    const activeList = [];
    
    groups.forEach((g, i) => {
      const isKingdom = kingdomIds.includes(String(g.threadID));
      const isCity = cityIds.includes(String(g.threadID));
      let tag = ' 👤 [قروب خارجي]';
      if (isKingdom) tag = ' 👑 [مملكة عاصمة]';
      else if (isCity) tag = ' 🏙️ [مدينة تابعة]';
      
      msg += `│ ${i + 1}. ${g.name || 'مجموعة بلا اسم'}\n│    ↳ ID: ${g.threadID}${tag}\n`;
      activeList.push({ threadID: g.threadID, name: g.name, isKingdom, isCity });
    });
    
    msg += `\n╮───∙⋆⋅「 الخيارات 」\n` +
           `│ › ارسل [رقم المجموعة] لتجعل البوت يغادرها فوراً\n` +
           `│ › اكتب 《 تنظيف 》 لمغادرة كل القروبات الخارجية وإبقاء الممالك والمدن فقط\n` +
           `│ › اكتب 《 خروج 》 للإلغاء\n` +
           `╯───────∙⋆⋅ ※ ⋅⋆∙`;
           
    await setAdminSession(senderID, { state: 'BOT_GROUPS_MAIN', activeList });
    await sendMessage(api, msg, threadID);
  });
}

async function handleBotGroupsSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  
  if (text === 'خروج') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }
  
  const botId = typeof api.getCurrentUserID === 'function' ? api.getCurrentUserID() : api.getCurrentUserID;

  // التحقق من وجود ايدي البوت قبل المتابعة
  if (!botId) {
    await sendMessage(api, `❌ تعذر الحصول على ايدي البوت، لا يمكن مغادرة المجموعة.`, threadID);
    await deleteAdminSession(senderID);
    return;
  }
  
  if (text === 'تنظيف') {
    const list = session.activeList || [];
    let leaveCount = 0;
    for (const g of list) {
      if (!g.isKingdom && !g.isCity) {
        try {
          await new Promise((resolve, reject) => {
            const cb = (err) => { if (err) reject(err); else resolve(); };
            if (typeof api.leaveThread === 'function') {
              api.leaveThread(String(g.threadID), cb);
            } else {
              api.removeUserFromGroup(String(botId), String(g.threadID), cb);
            }
          });
          // حذف المحادثة من القائمة بعد الخروج
          try { await new Promise(r => api.deleteThread(String(g.threadID), () => r())); } catch(e2) {}
          leaveCount++;
        } catch(e) {
          console.error(`خطأ أثناء مغادرة المجموعة ${g.threadID}:`, e);
        }
      }
    }
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تنظيف المجموعات 」\n│\n│ › تم الخروج من ${leaveCount} قروب خارجي بالكامل ✅\n│ › يتواجد البوت الآن فقط في قروبات الممالك والمدن الرسمية.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }
  
  const idx = parseInt(text, 10) - 1;
  const list = session.activeList || [];
  if (isNaN(idx) || idx < 0 || idx >= list.length) {
    await sendMessage(api, `⚠️ رقم غير صحيح من القائمة.`, threadID);
    return;
  }
  
  const target = list[idx];
  try {
    await new Promise((resolve, reject) => {
      const cb = (err) => { if (err) reject(err); else resolve(); };
      if (typeof api.leaveThread === 'function') {
        api.leaveThread(String(target.threadID), cb);
      } else {
        api.removeUserFromGroup(String(botId), String(target.threadID), cb);
      }
    });
    // حذف المحادثة من قائمة الدردشة حتى لا تبقى ظاهرة بعد الخروج
    try {
      await new Promise(r => api.deleteThread(String(target.threadID), () => r()));
    } catch(e2) { console.error('خطأ حذف المحادثة:', e2); }
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 مغادرة قروب 」\n│\n│ › تم الخروج من: ${target.name || target.threadID} ✅\n│ › تم حذف المحادثة من القائمة ✅\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
  } catch(e) {
    await deleteAdminSession(senderID);
    await sendMessage(api, `❌ تعذر مغادرة المجموعة: ${e.message || e}`, threadID);
  }
}

// ═════════════════════════════════════════════════════════════════════
//   إعادة ضبط النظام الشاملة (دعم الممالك والمدن)
// ═════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════
//   إعادة ضبط — القائمة الرئيسية
// ═════════════════════════════════════════════════════════════════════

async function handleEadatDabt(api, event) {
  const { threadID, senderID } = event;
  await loadResetDelay();
  const delaySec = resetNicknameDelayMs / 1000;
  await setAdminSession(senderID, { state: 'EADATDABT_MAIN' });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n         ✦ إعادة ضبط ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n` +
    `│ 1 › إعادة ضبط صور القروبات (الممالك والمدن)\n` +
    `│ 2 › إعادة ضبط أسماء القروبات (الممالك والمدن)\n` +
    `│ 3 › إعادة ضبط الكنيات (اللاعبين + كنية البوت)\n` +
    `│ 4 › إعادة ضبط الكل\n` +
    `│ 5 › تغيير زمن التأخير ⟦ الحالي : ${delaySec}ث ⟧\n` +
    `│ 6 › خروج\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleEadatDabtSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();

  if (session.state === 'EADATDABT_MAIN') {
    if (text === 'خروج' || text === '6') {
      await deleteAdminSession(senderID);
      await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    if (text === '1') { await deleteAdminSession(senderID); await handleEadatDabtPhotos(api, event); return; }
    if (text === '2') { await deleteAdminSession(senderID); await handleEadatDabtNames(api, event); return; }
    if (text === '3') { await deleteAdminSession(senderID); await handleEadatDabtNicknames(api, event); return; }
    if (text === '4') {
      await deleteAdminSession(senderID);
      await handleEadatDabtPhotos(api, event);
      await handleEadatDabtNames(api, event);
      await handleEadatDabtNicknames(api, event);
      await sendMessage(api, `╮───∙⋆⋅「 تم إعادة الضبط الشاملة بالكامل ✅ 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    if (text === '5') {
      await loadResetDelay();
      await setAdminSession(senderID, { state: 'EADATDABT_DELAY' });
      await sendMessage(api,
        `╮───∙⋆⋅「 تغيير زمن التأخير 」\n│\n` +
        `│ › الحالي : ${resetNicknameDelayMs / 1000}ث\n│\n` +
        `│ › ارسل عدد الثواني الجديد بين كل تغيير كنية (رقم أكبر من 0)\n` +
        `│ › او 《 خروج 》\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
        threadID);
      return;
    }
    await sendMessage(api, `⚠️ اختر رقماً من 1 إلى 6`, threadID);
    return;
  }

  if (session.state === 'EADATDABT_DELAY') {
    if (text === 'خروج') {
      await deleteAdminSession(senderID);
      await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      return;
    }
    const seconds = parseFloat(text);
    if (isNaN(seconds) || seconds <= 0) {
      await sendMessage(api, `⚠️ الرجاء إدخال رقم صحيح أكبر من 0 (بالثواني) أو 《 خروج 》`, threadID);
      return;
    }
    await saveResetDelay(seconds);
    await deleteAdminSession(senderID);
    await sendMessage(api,
      `╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n│ › زمن التأخير الجديد بين كل تغيير كنية : ${seconds}ث\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return;
  }
}

// ═════════════════════════════════════════════════════════════════════
//   إعادة ضبط الصور (العواصم الثلاثة + كافة المدن)
// ═════════════════════════════════════════════════════════════════════

async function handleEadatDabtPhotos(api, event) {
  const { threadID } = event;
  await sendMessage(api, `╮───∙⋆⋅「 إعادة ضبط الصور 」\n│\n│ › جارِ إعادة ضبط صور القروبات...\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);

  for (const k of ['solfare', 'niravil', 'murdak']) {
    const setting = await getGroupSetting(k);
    const gid = config.groupes[k];
    if (gid && setting && (setting.photoBase64 || setting.defaultPhotoUrl || setting.photoUrl)) {
      try {
        const tmp = path.join(require('os').tmpdir(), `reset_${k}_${Date.now()}.jpg`);
        let downloaded = false;
        if (setting.photoBase64) {
          try { fs.writeFileSync(tmp, Buffer.from(setting.photoBase64, 'base64')); downloaded = true; } catch (e2) {}
        }
        if (!downloaded) {
          const url = setting.defaultPhotoUrl || setting.photoUrl;
          if (url) { try { await downloadPhoto(url, tmp); downloaded = true; } catch (e2) {} }
        }
        if (downloaded) {
          await new Promise(r => api.changeGroupImage(fs.createReadStream(tmp), gid, () => { try { fs.unlinkSync(tmp); } catch (_) {} r(); }));
        } else { try { fs.unlinkSync(tmp); } catch (_) {} }
      } catch (e) {}
    }
  }

  try {
    const cities = await getDB().collection('cities').find().toArray();
    for (const city of cities) {
      if (city.threadId && (city.photoBase64 || city.photoUrl)) {
        try {
          const tmp = path.join(require('os').tmpdir(), `reset_city_${city.threadId}_${Date.now()}.jpg`);
          let downloaded = false;
          if (city.photoBase64) {
            fs.writeFileSync(tmp, Buffer.from(city.photoBase64, 'base64'));
            downloaded = true;
          } else if (city.photoUrl) {
            await downloadPhoto(city.photoUrl, tmp);
            downloaded = true;
          }
          if (downloaded) {
            await new Promise(r => api.changeGroupImage(fs.createReadStream(tmp), city.threadId, () => { try { fs.unlinkSync(tmp); } catch (_) {} r(); }));
          } else { try { fs.unlinkSync(tmp); } catch (_) {} }
        } catch (e) {}
      }
    }
  } catch (e) {
    console.error('Error resetting cities photos:', e.message);
  }

  await sendMessage(api, `╮───∙⋆⋅「 تم إعادة ضبط الصور ✅ 」\n│\n│ › صور قروبات العواصم والمدن أُعيدت بنجاح\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   إعادة ضبط الأسماء (العواصم الثلاثة + كافة المدن)
// ═════════════════════════════════════════════════════════════════════

async function handleEadatDabtNames(api, event) {
  const { threadID } = event;
  await sendMessage(api, `╮───∙⋆⋅「 إعادة ضبط الأسماء 」\n│\n│ › جارِ إعادة ضبط أسماء القروبات...\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);

  for (const k of ['solfare', 'niravil', 'murdak']) {
    const setting = await getGroupSetting(k);
    const defaultName = (setting && setting.defaultName) ? setting.defaultName : `مملكة ${kingdomNamesAr[k]}`;
    await updateGroupSetting(k, { customName: defaultName });
    const gid = config.groupes[k];
    if (gid) { try { await setTitle(api, defaultName, gid); } catch (e) {} }
  }

  try {
    const cities = await getDB().collection('cities').find().toArray();
    for (const city of cities) {
      if (city.threadId) { try { await setTitle(api, city.name, city.threadId); } catch (e) {} }
    }
  } catch (e) {
    console.error('Error resetting cities names:', e.message);
  }

  await sendMessage(api, `╮───∙⋆⋅「 تم إعادة ضبط الأسماء ✅ 」\n│\n│ › أسماء قروبات العواصم والمدن أُعيدت بنجاح\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
}

// ═════════════════════════════════════════════════════════════════════
//   إعادة ضبط الكنيات — كنية البوت + كنيات كل الأعضاء (مسجلين وغير مسجلين)
//   الترتيب: مورداك (العاصمة) ثم مدنها، ثم سولفارا وعاصمتها ومدنها، ثم نيرافيل
//   مع تأخير قابل للتعديل بين كل تغيير كنية لتجنب حظر فيسبوك للتغيير المتكرر
// ═════════════════════════════════════════════════════════════════════

// إعادة ضبط كنيات كافة أعضاء قروب واحد (بالواحد تلو الآخر مع تأخير)
async function resetGroupMemberNicknames(api, threadID) {
  let info;
  try {
    info = await new Promise((resolve, reject) => {
      api.getThreadInfo(threadID, (err, res) => { if (err) reject(err); else resolve(res); });
    });
  } catch (e) {
    console.error(`[EadatDabt] فشل جلب معلومات القروب ${threadID}:`, e.message || e);
    return { done: 0, failed: 0 };
  }

  const participantIDs = (info && info.participantIDs) || [];
  let done = 0, failed = 0;

  for (const pid of participantIDs) {
    const fbId = String(pid);
    try {
      const officialNick = await buildOfficialNickname(fbId);
      await new Promise((resolve, reject) => {
        api.changeNickname(officialNick, threadID, fbId, (err) => { if (err) reject(err); else resolve(); });
      });
      done++;
    } catch (e) {
      failed++;
      console.error(`[EadatDabt] فشل تغيير كنية ${fbId} في ${threadID}:`, e.message || e);
    }
    await new Promise(r => setTimeout(r, resetNicknameDelayMs));
  }

  return { done, failed };
}

async function handleEadatDabtNicknames(api, event) {
  const { threadID } = event;
  await loadResetDelay();
  await sendMessage(api,
    `╮───∙⋆⋅「 إعادة ضبط الكنيات 」\n│\n│ › جارِ إعادة ضبط كنية البوت...\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);

  // 1. كنية البوت في كافة القروبات (العواصم + المدن)
  const botNickSetting = await getGroupSetting('bot_global');
  const defaultBotNick = botNickSetting && botNickSetting.botNickname ? botNickSetting.botNickname : null;
  if (defaultBotNick) {
    const botId = api.getCurrentUserID ? (typeof api.getCurrentUserID === 'function' ? api.getCurrentUserID() : api.getCurrentUserID) : null;
    if (botId) {
      const allGroupIds = [...Object.values(config.groupes).filter(Boolean)];
      try {
        const cities = await getDB().collection('cities').find().toArray();
        cities.forEach(c => { if (c.threadId) allGroupIds.push(c.threadId); });
      } catch (e) {}
      for (const gid of allGroupIds) {
        try { await new Promise(r => api.changeNickname(defaultBotNick, String(gid), String(botId), () => r())); } catch (e) {}
      }
    }
  }

  // 2. كنيات الأعضاء حسب الترتيب المطلوب: مورداك ← مدنها ← سولفارا ← مدنها ← نيرافيل ← مدنها
  const order = ['murdak', 'solfare', 'niravil'];
  let totalDone = 0, totalFailed = 0;
  const db = getDB();

  for (const k of order) {
    const capitalId = config.groupes[k];
    if (capitalId) {
      await sendMessage(api, `╮───∙⋆⋅「 إعادة ضبط الكنيات 」\n│\n│ › جارِ معالجة عاصمة ${kingdomNamesAr[k]}...\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID).catch(() => {});
      const res = await resetGroupMemberNicknames(api, String(capitalId));
      totalDone += res.done; totalFailed += res.failed;
    }

    let cities = [];
    try { cities = await db.collection('cities').find({ kingdom: k }).toArray(); } catch (e) {}
    for (const city of cities) {
      if (!city.threadId) continue;
      await sendMessage(api, `╮───∙⋆⋅「 إعادة ضبط الكنيات 」\n│\n│ › جارِ معالجة مدينة ${city.name}...\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID).catch(() => {});
      const res = await resetGroupMemberNicknames(api, String(city.threadId));
      totalDone += res.done; totalFailed += res.failed;
    }
  }

  await sendMessage(api,
    `╮───∙⋆⋅「 تم إعادة ضبط الكنيات ✅ 」\n│\n│ › تم تعديل ${totalDone} كنية بنجاح\n│ › فشل تعديل ${totalFailed} كنية\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleQarobaat(api, event) {
  const { threadID, senderID } = event;
  const g = config.groupes;
  const msg =
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦  قروبات الممالك  ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 الايديهات الحالية 」\n│ › سولفارا : ${g.solfare || 'غير محدد'}\n│ › نيرافيل : ${g.niravil || 'غير محدد'}\n│ › مورداك  : ${g.murdak  || 'غير محدد'}\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
    `╮───∙⋆⋅「 الخيارات 」\n│ 1 › تعديل ايدي سولفارا\n│ 2 › تعديل ايدي نيرافيل\n│ 3 › تعديل ايدي مورداك\n│ 4 › خروج\n╯───────∙⋆⋅ ※ ⋅⋆∙`;
  await setAdminSession(senderID, { state: 'QAROBAAT_MAIN' });
  await sendMessage(api, msg, threadID);
}

async function handleQarobaatSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();
  if (text === 'خروج' || text === '4') { await deleteAdminSession(senderID); await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
  if (session.state === 'QAROBAAT_MAIN') {
    const map = { '1':'solfare','2':'niravil','3':'murdak' }, arMap = { solfare:'سولفارا', niravil:'نيرافيل', murdak:'مورداك' };
    if (!map[text]) { await sendMessage(api, `⚠️ اختر من 1 إلى 4`, threadID); return; }
    const kingdom = map[text];
    await setAdminSession(senderID, { state: 'QAROBAAT_AWAIT_ID', kingdom });
    await sendMessage(api, `╮───∙⋆⋅「 تعديل ايدي ${arMap[kingdom]} 」\n│\n│ › الايدي الحالي : ${config.groupes[kingdom] || 'غير محدد'}\n│\n│ › ارسل الايدي الجديد\n│ › او اكتب 《 خروج 》\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  if (session.state === 'QAROBAAT_AWAIT_ID') {
    const arMap = { solfare:'سولفارا', niravil:'نيرافيل', murdak:'مورداك' }, kingdom = session.kingdom;
    if (!/^\d{5,}$/.test(text)) { await sendMessage(api, `⚠️ الايدي غير صحيح\nأعد المحاولة او اكتب 《 خروج 》`, threadID); return; }
    const oldId = config.groupes[kingdom]; config.groupes[kingdom] = text; await require('../database').setBotConfig('groupes', config.groupes);
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم التعديل ✅️ 」\n│\n│ › المملكة  : ${arMap[kingdom]}\n│ › الايدي القديم : ${oldId || 'غير محدد'}\n│ › الايدي الجديد : ${text}\n│\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
}

async function handleIdafa(api, event) {
  const { threadID, senderID } = event;
  await setAdminSession(senderID, { state: 'IDAFA_SELECT' });
  await sendMessage(api,
    `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦  اضافة للقروبات  ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n` +
    `╮───∙⋆⋅「 اختر القروب 」\n│ 1 › سولفارا\n│ 2 › نيرافيل\n│ 3 › مورداك\n│ 4 › الكل\n│ 5 › خروج\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);
}

async function handleIdafaSession(api, event, session) {
  const { threadID, senderID } = event;
  const text = (event.body || '').trim();
  const arNames = { solfare: 'سولفارا', niravil: 'نيرافيل', murdak: 'مورداك' };

  if (text === 'خروج' || text === '5') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return;
  }
  const map = { '1':'solfare','2':'niravil','3':'murdak','4':'all' };
  const choice = map[text];
  if (!choice) { await sendMessage(api, `⚠️ اختر رقماً من 1 إلى 5`, threadID); return; }

  await deleteAdminSession(senderID);

  if (choice === 'all') {
    const results = [];
    for (const [k, gid] of Object.entries(config.groupes)) {
      const ok = await addUserToGroup(api, senderID, String(gid));
      results.push(`│ › ${arNames[k] || k} : ${ok ? '✅' : '❌'}`);
    }
    await sendMessage(api, `╮───∙⋆⋅「 اضافة للكل 」\n${results.join('\n')}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
  } else {
    const gid = config.groupes[choice];
    if (!gid) { await sendMessage(api, `╮───∙⋆⋅「 اضافة 」\n│\n│ › لم يتم تحديد ايدي هذا القروب\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID); return; }
    const ok = await addUserToGroup(api, senderID, String(gid));
    await sendMessage(api, `╮───∙⋆⋅「 اضافة 」\n│\n│ › المملكة : ${arNames[choice]}\n│ › النتيجة : ${ok ? '✅ تمت الإضافة' : '❌ فشلت الإضافة'}\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
  }
}

// ═════════════════════════════════════════════════════════════════════
//   إدارة طلبات المراسلة (طلبات المراسلة العادية والاحتيالية)
// ═════════════════════════════════════════════════════════════════════

async function handleMessageRequests(api, event) {
  const { threadID, senderID } = event;
  await sendMessage(api, `⏳ جارِ جلب طلبات المراسلة والطلبات الاحتيالية...`, threadID);

  // جلب الطلبات المعلقة العادية
  api.getThreadList(20, null, ["PENDING"], (err1, pendingList) => {
    // جلب الطلبات الاحتيالية/الأخرى (السبام)
    api.getThreadList(20, null, ["OTHER"], async (err2, otherList) => {
      if (err1 && err2) {
        await sendMessage(api, `❌ فشل جلب طلبات المراسلة: ${err1?.message || err2?.message || 'خطأ غير معروف'}`, threadID);
        return;
      }

      const pList = pendingList || [];
      const oList = otherList || [];

      if (pList.length === 0 && oList.length === 0) {
        await sendMessage(api, `╮───∙⋆⋅「 طلبات المراسلة 」\n│\n│ › 🎉 لا توجد أي طلبات مراسلة حالياً (سواء عادية أو احتيالية).\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
        return;
      }

      let msg = `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦ طلبات المراسلة الواردة ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n`;
      const reqsList = [];

      let index = 1;
      pList.forEach(t => {
        msg += `│ ${index}. 👤 ${t.name || 'مستخدم غير معروف'}\n│    ↳ النوع: عادية\n│    ↳ الرسالة: ${t.snippet || 'لا يوجد نص رسالة'}\n│    ↳ ID: ${t.threadID}\n\n`;
        reqsList.push({ threadID: t.threadID, name: t.name, snippet: t.snippet, folder: 'عادية', isPending: true });
        index++;
      });

      oList.forEach(t => {
        msg += `│ ${index}. ⚠️ ${t.name || 'مستخدم غير معروف'}\n│    ↳ النوع: احتيالية / سبام\n│    ↳ الرسالة: ${t.snippet || 'لا يوجد نص رسالة'}\n│    ↳ ID: ${t.threadID}\n\n`;
        reqsList.push({ threadID: t.threadID, name: t.name, snippet: t.snippet, folder: 'احتيالية', isPending: false });
        index++;
      });

      msg += `╮───∙⋆⋅「 الخيارات 」\n` +
             `│ › ارسل [رقم الطلب] لرؤية التفاصيل وقبولها أو رفضها\n` +
             `│ › اكتب 《 خروج 》 للإلغاء\n` +
             `╯───────∙⋆⋅ ※ ⋅⋆∙`;

      await setAdminSession(senderID, { state: 'MSG_REQS_MAIN', reqsList });
      await sendMessage(api, msg, threadID);
    });
  });
}

async function handleMessageRequestsSession(api, event, session) {
  const { threadID, senderID, body } = event;
  const text = (body || '').trim();

  if (text === 'خروج') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  if (session.state === 'MSG_REQS_MAIN') {
    const idx = parseInt(text, 10) - 1;
    const list = session.reqsList || [];
    if (isNaN(idx) || idx < 0 || idx >= list.length) {
      await sendMessage(api, `⚠️ رقم غير صحيح من القائمة.`, threadID);
      return;
    }

    const selectedReq = list[idx];
    await setAdminSession(senderID, { state: 'MSG_REQS_ACTION', selectedReq, reqsList: list });

    const msg =
      `╮───∙⋆⋅「 تفاصيل طلب المراسلة 」\n` +
      `│ › الاسم : ${selectedReq.name || 'غير معروف'}\n` +
      `│ › الايدي: ${selectedReq.threadID}\n` +
      `│ › النوع : ${selectedReq.folder}\n` +
      `│ › الرسالة: ${selectedReq.snippet || 'لا يوجد'}\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n` +
      `╮───∙⋆⋅「 الخيارات 」\n` +
      `│ 1 › قبول (نقل إلى الصندوق الوارد)\n` +
      `│ 2 › رفض (تجاهل وحذف الطلب)\n` +
      `│ 3 › رجوع للقائمة\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙`;
    await sendMessage(api, msg, threadID);
    return;
  }

  if (session.state === 'MSG_REQS_ACTION') {
    const req = session.selectedReq;
    if (text === '3' || text === 'رجوع') {
      await deleteAdminSession(senderID);
      await handleMessageRequests(api, event);
      return;
    }

    if (text === '1' || text === 'قبول') {
      try {
        await new Promise((resolve, reject) => {
          api.handleMessageRequest(String(req.threadID), true, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        await deleteAdminSession(senderID);
        await sendMessage(api, `╮───∙⋆⋅「 تم القبول ✅ 」\n│\n│ › تم قبول طلب مراسلة: ${req.name || req.threadID}\n│ › تم نقل المحادثة إلى الصندوق الوارد بنجاح.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      } catch (e) {
        await deleteAdminSession(senderID);
        await sendMessage(api, `❌ فشل قبول الطلب: ${e.message || e}`, threadID);
      }
      return;
    }

    if (text === '2' || text === 'رفض') {
      try {
        await new Promise((resolve, reject) => {
          api.handleMessageRequest(String(req.threadID), false, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        await deleteAdminSession(senderID);
        await sendMessage(api, `╮───∙⋆⋅「 تم الرفض 🗑️ 」\n│\n│ › تم رفض طلب مراسلة: ${req.name || req.threadID}\n│ › تم تجاهل وحذف الطلب بنجاح.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
      } catch (e) {
        await deleteAdminSession(senderID);
        await sendMessage(api, `❌ فشل رفض الطلب: ${e.message || e}`, threadID);
      }
      return;
    }

    await sendMessage(api, `⚠️ الرجاء اختيار: \n1 › قبول\n2 › رفض\n3 › رجوع`, threadID);
  }
}

module.exports = {
  handleTa3deel,
  handleDataSession,
  handleEadatDabt,
  handleEadatDabtSession,
  handleQarobaat,
  handleQarobaatSession,
  handleIdafa,
  handleIdafaSession,
  handleCitiesSession,
  handleBotGroups,
  handleBotGroupsSession,
  handleMessageRequests,
  handleMessageRequestsSession
};