// boot.js
// ═══════════════════════════════════════════════════════════════════════
//  نقطة الدخول الجديدة للسيرفر — قبل تشغيل index.js، يتأكد أولاً من أن
//  الملفات المحلية مطابقة لآخر نسخة في مستودع GitHub. إذا كان هناك تحديث،
//  يسحب فقط الملفات التي تغيرت (وليس المستودع كاملاً)، ويحذف محلياً أي
//  ملف تم حذفه من المستودع.
//
//  التشغيل: عوض `node index.js` استعمل الآن `node boot.js`
// ═══════════════════════════════════════════════════════════════════════

const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── إعدادات المستودع ───
const OWNER = 'MOB86557';
const REPO = 'NEXUS-BOT';

// ملف يخزن آخر SHA تم سحبه، حتى نعرف إذا تغير شيء في المرة القادمة
const STATE_FILE = path.join(__dirname, '.sync_state.json');

// جذر المشروع محلياً (حيث تُكتب الملفات المسحوبة)
const PROJECT_ROOT = __dirname;

// ─── ملفات/مجلدات لا يجب لمسها أبداً حتى لو تغيرت أو حُذفت في المستودع ───
const IGNORE_PATTERNS = [
  'node_modules/',
  '.git/',
  'boot.js',           // لا يستبدل نفسه أثناء التنفيذ
  '.sync_state.json',
  'package-lock.json',
];

function isIgnored(filePath) {
  return IGNORE_PATTERNS.some(p =>
    p.endsWith('/') ? filePath.startsWith(p) : filePath === p
  );
}

// ─── أداة بسيطة لطلبات HTTPS مع دعم JSON ───
function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'nexus-bot-sync',
        'Accept': 'application/vnd.github+json',
      },
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 300)}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ─── أداة لتحميل محتوى ملف خام (raw) كنص ───
function httpsGetRaw(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'nexus-bot-sync' } };
    https.get(url, options, (res) => {
      // متابعة أي إعادة توجيه (redirect)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpsGetRaw(res.headers.location));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Raw fetch ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    return { lastSha: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

async function downloadFile(branch, sha, repoPath) {
  const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}/${repoPath}`;
  const content = await httpsGetRaw(url);
  const localPath = path.join(PROJECT_ROOT, repoPath);
  ensureDirFor(localPath);
  fs.writeFileSync(localPath, content);
}

function deleteFile(repoPath) {
  const localPath = path.join(PROJECT_ROOT, repoPath);
  try {
    fs.unlinkSync(localPath);
    console.log(`[SYNC] 🗑️  تم حذف الملف المحلي (لم يعد موجوداً في المستودع): ${repoPath}`);
  } catch (e) {
    // الملف غير موجود أصلاً محلياً، لا مشكلة
  }
}

// ─── السحب الكامل (يُستخدم فقط في أول تشغيل، لا يوجد SHA محفوظ) ───
async function fullSync(branch, sha) {
  console.log('[SYNC] 🚀 أول تشغيل — جاري سحب كامل المستودع...');
  const tree = await httpsGetJson(
    `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/${sha}?recursive=1`
  );

  const files = (tree.tree || []).filter(
    (item) => item.type === 'blob' && !isIgnored(item.path)
  );

  console.log(`[SYNC] 📦 عدد الملفات المراد سحبها: ${files.length}`);

  for (const file of files) {
    try {
      await downloadFile(branch, sha, file.path);
    } catch (e) {
      console.error(`[SYNC] ⚠️ فشل تحميل ${file.path}: ${e.message}`);
    }
  }

  console.log('[SYNC] ✅ تم سحب المستودع بالكامل.');
}

// ─── السحب التفاضلي (فقط الملفات المتغيرة بين آخر SHA والحالي) ───
async function incrementalSync(branch, oldSha, newSha) {
  console.log(`[SYNC] 🔄 تحديث جديد على GitHub — جاري حساب الفروقات...`);
  const compare = await httpsGetJson(
    `https://api.github.com/repos/${OWNER}/${REPO}/compare/${oldSha}...${newSha}`
  );

  const changedFiles = compare.files || [];

  if (changedFiles.length === 0) {
    console.log('[SYNC] ✅ لا توجد ملفات متغيرة فعلياً.');
    return;
  }

  console.log(`[SYNC] 📦 عدد الملفات المتغيرة: ${changedFiles.length}`);

  for (const file of changedFiles) {
    if (isIgnored(file.filename)) continue;

    if (file.status === 'removed') {
      deleteFile(file.filename);
      continue;
    }

    // added, modified, renamed, copied, changed
    try {
      await downloadFile(branch, newSha, file.filename);
      console.log(`[SYNC] ⬇️  تم تحديث: ${file.filename}`);

      // في حالة renamed، احذف الاسم القديم إن وجد
      if (file.status === 'renamed' && file.previous_filename) {
        deleteFile(file.previous_filename);
      }
    } catch (e) {
      console.error(`[SYNC] ⚠️ فشل تحميل ${file.filename}: ${e.message}`);
    }
  }

  console.log('[SYNC] ✅ تم تحديث كل الملفات المتغيرة.');
}

async function syncFromGitHub() {
  const state = loadState();

  // 1. جلب معلومات المستودع (لمعرفة الفرع الافتراضي)
  const repoInfo = await httpsGetJson(`https://api.github.com/repos/${OWNER}/${REPO}`);
  const branch = repoInfo.default_branch || 'main';

  // 2. جلب آخر Commit على هذا الفرع
  const branchInfo = await httpsGetJson(
    `https://api.github.com/repos/${OWNER}/${REPO}/branches/${branch}`
  );
  const latestSha = branchInfo.commit.sha;

  // 3. مقارنة مع آخر SHA محفوظ محلياً
  if (state.lastSha === latestSha) {
    console.log('[SYNC] ✅ لا يوجد تحديث جديد — الملفات مطابقة لآخر نسخة.');
    return;
  }

  if (!state.lastSha) {
    await fullSync(branch, latestSha);
  } else {
    await incrementalSync(branch, state.lastSha, latestSha);
  }

  saveState({ lastSha: latestSha, updatedAt: new Date().toISOString() });
}

// ─── التشغيل ───
(async () => {
  try {
    await syncFromGitHub();
  } catch (e) {
    console.error('[SYNC] ❌ فشلت عملية المزامنة مع GitHub:', e.message);
    console.error('[SYNC] ⏭️  سيتم تشغيل البوت بالملفات المحلية الحالية بدون تحديث.');
  }

  // بعد المزامنة (أو فشلها)، شغّل السيرفر الحقيقي
  require('./index.js');
})();
