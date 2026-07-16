/*
 * ═══════════════════════════════════════════════════════════════════════
 *  interaction_coins.js — نظام كوينز التفاعل الذكي
 * ═══════════════════════════════════════════════════════════════════════
 */

const { getDB, addNotification } = require('./database');
const { sendMessage, sendReply } = require('./utils');
const config = require('./config.json');
const { ObjectId } = require('mongodb');

// دالة مساعدة لتحميل الصورة وإرسالها مع نص إلى الأدمن
function sendSubmissionToAdmin(api, threadId, text, imgUrl) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const http = require('http');
    const lib = imgUrl.startsWith('https') ? https : http;

    lib.get(imgUrl, (response) => {
      if (response.statusCode !== 200) {
        api.sendMessage({ body: text }, threadId, (err, info) => {
          if (err) return reject(err);
          resolve(info);
        });
        return;
      }
      api.sendMessage({ body: text, attachment: response }, threadId, (err, info) => {
        if (err) return reject(err);
        resolve(info);
      });
    }).on('error', (err) => {
      api.sendMessage({ body: text }, threadId, (err, info) => {
        if (err) return reject(err);
        resolve(info);
      });
    });
  });
}

// 1. معالجة أمر الإعدادات للأدمن
async function handleAdminSettings(api, event) {
  const { senderID, threadID } = event;
  const { setAdminSession } = require('./database');
  
  await setAdminSession(senderID, { state: 'INTERACTION_SETTINGS_MAIN' });
  
  const msg = 
    `╮───∙⋆⋅「 اعدادات كوينز التفاعل 」\n` +
    `│ 1 ❖ اضافة رابط منشور \n` +
    `│ 2 ❖ حذف الروابط\n` +
    `│ 3 ❖ خروج \n` +
    `╯───────∙⋆⋅ ※ ⋅⋆∙\n` +
    `› اختر رقم الخيار المطلوب:`;
    
  await sendMessage(api, msg, threadID);
}

// 2. معالجة جلسة الإعدادات التفاعلية للأدمن
async function handleAdminSettingsSession(api, event, session) {
  const { senderID, threadID, body } = event;
  const text = (body || '').trim();
  const db = getDB();
  const { setAdminSession, deleteAdminSession } = require('./database');

  if (text === 'خروج' || text === '3') {
    await deleteAdminSession(senderID);
    await sendMessage(api, `╮───∙⋆⋅「 تم الخروج بنجاح 」\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return true;
  }

  const s = session.state;

  if (s === 'INTERACTION_SETTINGS_MAIN') {
    if (text === '1') {
      await setAdminSession(senderID, { state: 'INTERACTION_ADD_LINK' });
      await sendMessage(api, `ارسل رابط المنشور`, threadID);
      return true;
    }
    if (text === '2') {
      const posts = await db.collection('interaction_posts').find({}).toArray();
      if (!posts || posts.length === 0) {
        await deleteAdminSession(senderID);
        await sendMessage(api, `⚠️ لا توجد روابط مضافة حالياً.`, threadID);
        return true;
      }

      await setAdminSession(senderID, { state: 'INTERACTION_DELETE_SELECT' });
      let listMsg = `╮───∙⋆⋅「 حذف الروابط 」\nالرجاء إدخال رقم الرابط الذي ترغب بحذفه:\n\n`;
      posts.forEach((post, idx) => {
        const limitStr = post.limit === '+' ? '+' : post.limit;
        const dateStr = post.createdAt ? new Date(post.createdAt).toLocaleDateString('ar-EG') : 'غير محدد';
        listMsg += `│ [${idx + 1}] الرابط: ${post.link}\n│     التفاعلات المقبولة: ${post.acceptedCount} / المطلوبة: ${limitStr}\n│     تاريخ الإضافة: ${dateStr}\n│ ┈──┈──┈──┈──\n`;
      });
      listMsg += `╯───────∙⋆⋅ ※ ⋅⋆∙\n› أدخل الرقم المطلوب أو "خروج"`;
      await sendMessage(api, listMsg, threadID);
      return true;
    }
    await sendMessage(api, `⚠️ خيار غير صحيح. اختر 1 أو 2 أو 3.`, threadID);
    return true;
  }

  if (s === 'INTERACTION_ADD_LINK') {
    await setAdminSession(senderID, { state: 'INTERACTION_ADD_LIMIT', link: text });
    await sendMessage(api, `يرجى ارسال عدد التفاعلات المطلوبة ( ارسل + لعدم وضع حد )`, threadID);
    return true;
  }

  if (s === 'INTERACTION_ADD_LIMIT') {
    const isNoLimit = text === '+';
    const limitNum = parseInt(text, 10);
    if (!isNoLimit && (isNaN(limitNum) || limitNum <= 0)) {
      await sendMessage(api, `⚠️ يرجى إدخال رقم صحيح أكبر من 0 أو علامة + فقط.`, threadID);
      return true;
    }

    await setAdminSession(senderID, { 
      state: 'INTERACTION_ADD_EMOJI', 
      link: session.link, 
      limit: isNoLimit ? '+' : limitNum 
    });
    await sendMessage(api, `ارسل الاموجي المطلوب`, threadID);
    return true;
  }

  if (s === 'INTERACTION_ADD_EMOJI') {
    await setAdminSession(senderID, { 
      state: 'INTERACTION_ADD_COINS', 
      link: session.link, 
      limit: session.limit, 
      emoji: text 
    });
    await sendMessage(api, `ارسل كوينز كل تفاعل`, threadID);
    return true;
  }

  if (s === 'INTERACTION_ADD_COINS') {
    const coinsNum = parseInt(text, 10);
    if (isNaN(coinsNum) || coinsNum <= 0) {
      await sendMessage(api, `⚠️ يرجى إدخال عدد كوينز صحيح (رقم أكبر من 0).`, threadID);
      return true;
    }

    await db.collection('interaction_posts').insertOne({
      link: session.link,
      limit: session.limit,
      emoji: session.emoji,
      coins: coinsNum,
      acceptedCount: 0,
      createdAt: new Date()
    });

    await deleteAdminSession(senderID);
    await sendMessage(api, `تم اضافة الرابط بنجاح`, threadID);
    return true;
  }

  if (s === 'INTERACTION_DELETE_SELECT') {
    const posts = await db.collection('interaction_posts').find({}).toArray();
    const idx = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= posts.length) {
      await sendMessage(api, `⚠️ رقم غير صحيح. الرجاء اختيار رقم من القائمة المتاحة.`, threadID);
      return true;
    }

    const targetPost = posts[idx];
    await setAdminSession(senderID, { 
      state: 'INTERACTION_DELETE_CONFIRM', 
      postIdToDelete: targetPost._id, 
      postLinkToDelete: targetPost.link 
    });

    await sendMessage(api, `هل انت متأكد من حذف الرابط ...\n${targetPost.link}\n\nارسل موافق او الغاء`, threadID);
    return true;
  }

  if (s === 'INTERACTION_DELETE_CONFIRM') {
    if (text === 'موافق') {
      await db.collection('interaction_posts').deleteOne({ _id: new ObjectId(session.postIdToDelete) });
      await deleteAdminSession(senderID);
      await sendMessage(api, `✅ تم حذف الرابط بنجاح!`, threadID);
      return true;
    } else if (text === 'الغاء' || text === 'إلغاء') {
      await deleteAdminSession(senderID);
      await sendMessage(api, `❌ تم إلغاء عملية الحذف.`, threadID);
      return true;
    }
    await sendMessage(api, `⚠️ الرجاء كتابة "موافق" لتأكيد الحذف أو "الغاء" للتراجع.`, threadID);
    return true;
  }

  return false;
}

// 3. أمر اللاعبين: كوينز التفاعل
async function handlePlayerCoinsCommand(api, event) {
  const { threadID, senderID } = event;
  const db = getDB();

  // جلب المنشورات التي سبق للاعب إرسال تفاعل عليها وهي حالياً معلقة أو مقبولة، لاستبعادها
  // (المنشورات المرفوضة لا تُستبعد، لكي تظهر للاعب مجدداً ليتمكن من إعادة المحاولة)
  const playerSubmissions = await db.collection('interaction_submissions').find({
    fbId: String(senderID),
    status: { $in: ['pending', 'accepted', 'skipped'] }
  }).toArray();
  const excludedPostIds = playerSubmissions.map(sub => sub.postId);

  // جلب المهام النشطة فقط التي لم تتجاوز حد التفاعل ولم يسبق للاعب التفاعل معها (أو تم رفضها سابقاً)
  const posts = await db.collection('interaction_posts').find({
    _id: { $nin: excludedPostIds },
    $or: [
      { limit: '+' },
      { $expr: { $lt: ["$acceptedCount", "$limit"] } }
    ]
  }).toArray();

  if (!posts || posts.length === 0) {
    await sendMessage(api, `╮───∙⋆⋅「 كوينز التفاعل 」\n│ › لا توجد أي منشورات تفاعل جديدة متاحة لك حالياً.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  for (const post of posts) {
    const formattedMsg = 
      `؜╮───∙⋆⋅「 كوينز التفاعل  」\n` +
      `│ › تفاعل مع هذا المنشور  ب (${post.emoji}) للحصول على (${post.coins}) كوينز \n` +
      `│ وهنا  رابط المنشور \n` +
      `│ ${post.link}\n` +
      `│ ⚠️ بعد اداء المهمة رد على هذه الرسالة بلقطة شاشة تثبت تفاعلك \n` +
      `│ ⏭️ لتخطي هذا المنشور رد على البوت بكلمة 《 تخطي 》\n` +
      `╯───────∙⋆⋅ ※ ⋅⋆∙`;

    const info = await sendMessage(api, formattedMsg, threadID);
    if (info && info.messageID) {
      await db.collection('interaction_sent_messages').insertOne({
        messageId: info.messageID,
        postId: post._id,
        userId: senderID,
        createdAt: new Date()
      });
    }
  }
}

// 4. التقاط ردود اللاعبين بالسكرينات ومعالجة ردود الأدمن للقبول/الرفض
async function handleSubmissionReply(api, event) {
  const { threadID, senderID, messageReply, attachments, body } = event;
  const text = (body || '').trim();
  const db = getDB();

  // أ. التحقق إذا كان اللاعب يرد بصورة لقطة شاشة على رسالة البوت النشطة
  if (messageReply && messageReply.messageID) {
    const mapping = await db.collection('interaction_sent_messages').findOne({
      messageId: messageReply.messageID
    });

    if (mapping) {
      // معالجة طلب تخطي المنشور
      if (text === 'تخطي') {
        const post = await db.collection('interaction_posts').findOne({ _id: mapping.postId });
        if (!post) {
          await sendReply(api, `⚠️ عذراً، هذا المنشور لم يعد نشطاً أو تم حذفه من قبل الإدارة.`, event.messageID, threadID);
          return true;
        }

        const existing = await db.collection('interaction_submissions').findOne({
          fbId: String(senderID),
          postId: post._id,
          status: { $in: ['pending', 'accepted', 'skipped'] }
        });

        if (existing) {
          await sendReply(api, `⚠️ تم تجاوز هذا المنشور مسبقاً أو لديك طلب بشأنه قيد المعالجة.`, event.messageID, threadID);
          return true;
        }

        await db.collection('interaction_submissions').insertOne({
          fbId: String(senderID),
          postId: post._id,
          postLink: post.link,
          status: 'skipped',
          createdAt: new Date()
        });

        await sendReply(api, `⏭️ تم تخطي هذا المنشور، لن يظهر لك مجدداً.`, event.messageID, threadID);
        return true;
      }

      const hasImage = attachments && attachments.length > 0 && attachments[0].type === 'photo';
      if (!hasImage) {
        await sendReply(api, `⚠️ يرجى الرد على الرسالة بلقطة شاشة (صورة سكرين) تثبت تفاعلك ليتم التحقق منها، أو اكتب "تخطي" لتجاوز هذا المنشور.`, event.messageID, threadID);
        return true;
      }

      const post = await db.collection('interaction_posts').findOne({ _id: mapping.postId });
      if (!post) {
        await sendReply(api, `⚠️ عذراً، هذا المنشور لم يعد نشطاً أو تم حذفه من قبل الإدارة.`, event.messageID, threadID);
        return true;
      }

      // التحقق من عدم تكرار المشاركة لنفس المنشور
      const existing = await db.collection('interaction_submissions').findOne({
        fbId: String(senderID),
        postId: post._id,
        status: { $in: ['pending', 'accepted', 'skipped'] }
      });

      if (existing) {
        if (existing.status === 'pending') {
          await sendReply(api, `⚠️ لديك طلب معلق بالفعل لهذا المنشور قيد المراجعة لدى الإدارة.`, event.messageID, threadID);
        } else if (existing.status === 'skipped') {
          await sendReply(api, `⚠️ لقد قمت بتخطي هذا المنشور مسبقاً ولا يمكن إرسال إثبات له.`, event.messageID, threadID);
        } else {
          await sendReply(api, `⚠️ لقد حصلت على الكوينز لهذا المنشور سابقاً بالفعل!`, event.messageID, threadID);
        }
        return true;
      }

      // جلب معلومات اللاعب
      const player = await db.collection('players').findOne({ fbId: String(senderID) });
      const playerName = player ? (player.name || 'عضو فيسبوك') : 'غير مسجل';
      const playerNickname = player ? (player.nickname || 'لا يوجد') : 'غير مسجل';

      // إدراج طلب التحقق في قاعدة البيانات
      await db.collection('interaction_submissions').insertOne({
        fbId: String(senderID),
        playerName,
        playerNickname,
        postId: post._id,
        postLink: post.link,
        emoji: post.emoji,
        coins: post.coins,
        screenshotUrl: attachments[0].url,
        status: 'pending',
        createdAt: new Date()
      });

      // الرد على اللاعب مباشرة
      const replyMsg = 
        `تم ارسال التفاصيل للادارة للتحقق سيتم ارسال الكوينز لك في حالة القبول\n` +
        `⚠️ لاتزيل التفاعل حتى بعد القبول لكي لاتحصل على انذار ويخصم منك الكوينز`;
      await sendReply(api, replyMsg, event.messageID, threadID);

      // إرسال إشعار فوري للأدمن والامبراطور
      const adminId = config.adminId || "61575440740189";
      const notifyIds = config.adminIds && Array.isArray(config.adminIds) ? [...config.adminIds] : [];
      if (!notifyIds.includes(adminId)) notifyIds.unshift(adminId);

      // إضافة الامبراطور إن وُجد في قاعدة البيانات
      try {
        const emperors = await db.collection('players').find(
          { rank: 'الامبراطور' },
          { projection: { fbId: 1 } }
        ).toArray();
        for (const emp of emperors) {
          if (emp.fbId && !notifyIds.includes(String(emp.fbId))) {
            notifyIds.push(String(emp.fbId));
          }
        }
      } catch (e) {}

      for (const aid of notifyIds) {
        try {
          await api.sendMessage({ body: `+👥️` }, String(aid));
        } catch (e) {}
      }
      return true;
    }

    // ب. التحقق إذا كان الأدمن يرد بـ "قبول" أو "رفض" على رسالة تفاصيل الطلب
    const { isAdmin } = require('./admin');
    if (isAdmin(senderID)) {
      const submission = await db.collection('interaction_submissions').findOne({
        adminMessageId: messageReply.messageID,
        status: 'pending'
      });

      if (submission) {
        if (text === 'قبول') {
          await db.collection('interaction_submissions').updateOne(
            { _id: submission._id },
            { $set: { status: 'accepted', processedAt: new Date(), processedBy: senderID } }
          );

          await db.collection('interaction_posts').updateOne(
            { _id: submission.postId },
            { $inc: { acceptedCount: 1 } }
          );

          await db.collection('players').updateOne(
            { fbId: submission.fbId },
            { $inc: { coins: submission.coins } }
          );

          // إرسال إشعار فوري للاعب في حسابه
          const acceptNotif = `🎉 تهانينا! تم قبول لقطة الشاشة الخاصة بك لطلب التفاعل وحصلت على ${submission.coins} كوينز!`;
          await addNotification(submission.fbId, acceptNotif).catch(() => {});

          await sendReply(api, `✅ تم قبول الطلب وإضافة ${submission.coins} كوينز للاعب [${submission.playerNickname}] بنجاح!`, event.messageID, threadID);
          return true;
        }

        if (text === 'رفض') {
          await db.collection('interaction_submissions').updateOne(
            { _id: submission._id },
            { $set: { status: 'rejected', processedAt: new Date(), processedBy: senderID } }
          );

          // إرسال إشعار فوري للاعب بالرفض
          const rejectNotif = `❌ نأسف، لقد تم رفض لقطة الشاشة الخاصة بك لطلب التفاعل لعدم مطابقة الشروط أو عدم وضوح الصورة.`;
          await addNotification(submission.fbId, rejectNotif).catch(() => {});

          await sendReply(api, `❌ تم رفض الطلب بنجاح وإرسال إشعار للاعب.`, event.messageID, threadID);
          return true;
        }
      }
    }
  }

  return false;
}

// 5. عرض الطلبات المعلقة للأدمن عبر أمر "تفاعلات"
async function handleAdminReviewCommand(api, event) {
  const { threadID, senderID } = event;
  const { isAdmin } = require('./admin');

  if (!isAdmin(senderID)) return;

  const db = getDB();
  const pendingCount = await db.collection('interaction_submissions').countDocuments({ status: 'pending' });

  if (pendingCount === 0) {
    await sendMessage(api, `╮───∙⋆⋅「 تفاعلات 」\n│ › لا توجد أي طلبات معلقة للمراجعة حالياً.\n╯───────∙⋆⋅ ※ ⋅⋆∙`, threadID);
    return;
  }

  const submission = await db.collection('interaction_submissions').findOne({ status: 'pending' });
  if (!submission) return;

  // جلب الاسم الحقيقي من فيسبوك بدلاً من الاعتماد على القيمة المخزّنة
  let realName = submission.playerName || '—';
  try {
    const userInfo = await new Promise((resolve) => {
      api.getUserInfo(String(submission.fbId), (err, info) => {
        resolve(err || !info ? null : (info[String(submission.fbId)] || null));
      });
    });
    if (userInfo && userInfo.name) realName = userInfo.name;
  } catch (e) {}

  const msgText =
    `الطلبات المتبقية : ${pendingCount}\n` +
    `لقب اللاعب : ${submission.playerNickname}\n` +
    `اسم حسابه : ${realName}\n` +
    `رابط المنشور : ${submission.postLink}`;

  const info = await sendSubmissionToAdmin(api, threadID, msgText, submission.screenshotUrl);
  if (info && info.messageID) {
    await db.collection('interaction_submissions').updateOne(
      { _id: submission._id },
      { $set: { adminMessageId: info.messageID, adminThreadId: threadID } }
    );
  }
}

module.exports = {
  handleAdminSettings,
  handleAdminSettingsSession,
  handlePlayerCoinsCommand,
  handleSubmissionReply,
  handleAdminReviewCommand
};