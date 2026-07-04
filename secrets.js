// secrets.js
const fs = require('fs');
const path = require('path');

function loadSecrets() {
  const secretsPath = path.join(__dirname, 'secrets.json');

  if (fs.existsSync(secretsPath)) {
    try {
      const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
      
      if (secrets.MONGODB_URI) {
        process.env.MONGODB_URI = secrets.MONGODB_URI;
      }
      
      if (secrets.COOKIES) {
        const cookiesStr = typeof secrets.COOKIES === 'string' 
          ? secrets.COOKIES 
          : JSON.stringify(secrets.COOKIES);
          
        process.env.APPSTATE = cookiesStr;
        process.env.COOKIES = cookiesStr;
        process.env.FB_COOKIES = cookiesStr;
      }
      
      console.log('[  OK  ] ✅ تم تحميل الكوكيز ورابط قاعدة البيانات من ملف secrets.json بنجاح.');
    } catch (error) {
      console.error('[ERROR ] ❌ خطأ أثناء قراءة ملف secrets.json:', error.message);
    }
  } else {
    console.warn('[ WARN ] ⚠️ تنبيه: لم يتم العثور على ملف secrets.json، سيتم الاعتماد على المتغيرات البيئية للنظام.');
  }
}

module.exports = { loadSecrets };