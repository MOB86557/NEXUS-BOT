// image_editor.js — محرر الصور | 38 تأثير
// يعمل مع: Jimp فقط (بدون sharp)
// التثبيت: npm install jimp axios

'use strict';

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const os    = require('os');
const Jimp  = require('jimp');
const { sendMessage } = require('./utils');

const TMP = os.tmpdir();

const EFFECTS = [
  { id: 1,  name: 'أبيض وأسود',       desc: 'يحول الصورة لدرجات الرمادي' },
  { id: 2,  name: 'عكس الألوان',      desc: 'يعكس ألوان الصورة (نيغاتيف)' },
  { id: 3,  name: 'زيادة السطوع',     desc: 'يزيد سطوع الصورة' },
  { id: 4,  name: 'تقليل السطوع',     desc: 'يقلل سطوع الصورة' },
  { id: 5,  name: 'زيادة التباين',    desc: 'يزيد تباين الصورة' },
  { id: 6,  name: 'تقليل التباين',    desc: 'يقلل تباين الصورة' },
  { id: 7,  name: 'ضبابية',           desc: 'يضيف تأثير ضبابي للصورة' },
  { id: 8,  name: 'حدة',              desc: 'يزيد حدة تفاصيل الصورة' },
  { id: 9,  name: 'تدوير 90°',        desc: 'يدور الصورة 90 درجة' },
  { id: 10, name: 'تدوير 180°',       desc: 'يقلب الصورة رأساً على عقب' },
  { id: 11, name: 'تدوير 270°',       desc: 'يدور الصورة 270 درجة' },
  { id: 12, name: 'عكس أفقي',         desc: 'يعكس الصورة أفقياً' },
  { id: 13, name: 'عكس عمودي',        desc: 'يعكس الصورة عمودياً' },
  { id: 14, name: 'دفء',              desc: 'يضيف دفء لألوان الصورة' },
  { id: 15, name: 'برودة',            desc: 'يضيف برودة لألوان الصورة' },
  { id: 16, name: 'بني كلاسيكي',     desc: 'يضيف تأثير البني الكلاسيكي (سيبيا)' },
  { id: 17, name: 'تكبير',            desc: 'يكبر الصورة بنسبة 150%' },
  { id: 18, name: 'تصغير',            desc: 'يصغر الصورة بنسبة 50%' },
  { id: 19, name: 'بيكسل',            desc: 'يضيف تأثير البيكسل على الصورة' },
  { id: 20, name: 'احترافي',          desc: 'يحسن الصورة احترافياً (حدة + تباين)' },
  { id: 21, name: 'غروب',             desc: 'يضيف تأثير ألوان الغروب' },
  { id: 22, name: 'ليلي',             desc: 'يضيف تأثير الليل الداكن' },
  { id: 23, name: 'طبيعة',            desc: 'يعزز الألوان الخضراء للطبيعة' },
  { id: 24, name: 'فضة',              desc: 'يضيف تأثير الفضة المعدني' },
  { id: 25, name: 'ذهبي',             desc: 'يضيف صبغة ذهبية للصورة' },
  { id: 26, name: 'ضوء ناعم',         desc: 'يضيف تأثير ضوء ناعم احترافي' },
  { id: 27, name: 'قديم',             desc: 'يضيف تأثير الصور القديمة' },
  { id: 28, name: 'فن تجريدي',        desc: 'يحول الصورة لفن تجريدي ملون' },
  { id: 29, name: 'تأثير سينمائي',    desc: 'يضيف تأثير الأفلام السينمائية' },
  { id: 30, name: 'HDR',              desc: 'يضيف تأثير HDR احترافي' },
  { id: 31, name: '🌊 موجة سائلة',    desc: 'يشوه الصورة كأنها تحت الماء' },
  { id: 32, name: '💥 نيون',          desc: 'يحول الحواف لنيون صارخ متوهج' },
  { id: 33, name: '🌈 قوس قزح',       desc: 'يضيف تدرج ألوان قوس قزح فوق الصورة' },
  { id: 34, name: '👾 Glitch',        desc: 'تأثير تشويش إلكتروني واقعي' },
  { id: 35, name: '🖼️ إطار ذهبي',    desc: 'يضيف إطاراً ذهبياً فاخراً' },
  { id: 36, name: '🌟 توهج',          desc: 'يضيف توهجاً ساطعاً حول حواف الصورة' },
  { id: 37, name: '🎭 دمج طبقات',     desc: 'يدمج الصورة مع نسخة معكوسة شفافة' },
  { id: 38, name: '🎬 شريط أفلام',    desc: 'يضيف تأثير شريط الأفلام مع أشرطة سوداء' },
];

function buildHelpMsg() {
  let msg = `╮───────∙⋆⋅ ※ ⋅⋆∙───────╭\n     ✦ محرر الصور ✦\n╯───────∙⋆⋅ ※ ⋅⋆∙───────╰\n\n`;
  msg += `╮───∙⋆⋅「 ℹ️ طريقة الاستعمال 」\n│ › رد على الصورة بأمر ايديت\n│ › متبوعاً بالرقم\n│\n│ مثال : ايديت 1\n╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
  msg += `╮───∙⋆⋅「 التأثيرات الأساسية 」\n│\n`;
  EFFECTS.filter(e => e.id <= 30).forEach(e => {
    msg += `│ ${String(e.id).padStart(2,' ')}. ${e.name}\n│     › ${e.desc}\n│\n`;
  });
  msg += `╯───────∙⋆⋅ ※ ⋅⋆∙\n\n`;
  msg += `╮───∙⋆⋅「 التأثيرات المتقدمة ✨ 」\n│\n`;
  EFFECTS.filter(e => e.id > 30).forEach(e => {
    msg += `│ ${String(e.id).padStart(2,' ')}. ${e.name}\n│     › ${e.desc}\n│\n`;
  });
  msg += `╯───────∙⋆⋅ ※ ⋅⋆∙`;
  return msg;
}

async function downloadImage(url) {
  const tmpPath = path.join(TMP, `nexus_img_${Date.now()}.jpg`);
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
  fs.writeFileSync(tmpPath, res.data);
  return tmpPath;
}

function cleanup(...files) {
  for (const f of files) {
    try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch(e) {}
  }
}

// ── معالجة البيكسلات يدوياً (بديل sharp) ──
function processPixels(img, fn) {
  const W = img.getWidth(), H = img.getHeight();
  img.scan(0, 0, W, H, function(x, y, idx) {
    const r = this.bitmap.data[idx];
    const g = this.bitmap.data[idx+1];
    const b = this.bitmap.data[idx+2];
    const a = this.bitmap.data[idx+3];
    const res = fn(r, g, b, a, x, y, W, H);
    this.bitmap.data[idx]   = Math.max(0, Math.min(255, res[0]));
    this.bitmap.data[idx+1] = Math.max(0, Math.min(255, res[1]));
    this.bitmap.data[idx+2] = Math.max(0, Math.min(255, res[2]));
    this.bitmap.data[idx+3] = res[3] !== undefined ? res[3] : a;
  });
}

async function applyEffect(inputPath, effectId) {
  const outPath = path.join(TMP, `nexus_out_${Date.now()}.png`);
  const img = await Jimp.read(inputPath);
  const W = img.getWidth(), H = img.getHeight();

  switch (effectId) {
    // ── الأساسية ──
    case 1:  img.greyscale(); break;
    case 2:  img.invert(); break;
    case 3:  img.brightness(0.3); break;
    case 4:  img.brightness(-0.3); break;
    case 5:  img.contrast(0.5); break;
    case 6:  img.contrast(-0.5); break;
    case 7:  img.blur(5); break;
    case 8:  img.convolute([[0,-1,0],[-1,5,-1],[0,-1,0]]); break;
    case 9:  img.rotate(90); break;
    case 10: img.rotate(180); break;
    case 11: img.rotate(270); break;
    case 12: img.flip(true, false); break;
    case 13: img.flip(false, true); break;
    case 14: img.color([{apply:'red',params:[30]},{apply:'yellow',params:[15]}]); break;
    case 15: img.color([{apply:'blue',params:[30]},{apply:'cyan',params:[15]}]); break;
    case 16: img.greyscale().color([{apply:'red',params:[40]},{apply:'green',params:[20]},{apply:'blue',params:[-10]}]); break;
    case 17: img.resize(Math.round(W*1.5), Math.round(H*1.5)); break;
    case 18: img.resize(Math.round(W*0.5), Math.round(H*0.5)); break;
    case 19: img.resize(Math.max(1,Math.floor(W/10)), Math.max(1,Math.floor(H/10)), Jimp.RESIZE_NEAREST_NEIGHBOR).resize(W, H, Jimp.RESIZE_NEAREST_NEIGHBOR); break;
    case 20: img.contrast(0.4).brightness(0.08).convolute([[0,-1,0],[-1,5,-1],[0,-1,0]]); break;
    case 21: img.color([{apply:'red',params:[50]},{apply:'orange',params:[30]},{apply:'blue',params:[-20]}]).brightness(0.05); break;
    case 22: img.brightness(-0.3).contrast(0.3).color([{apply:'blue',params:[20]}]); break;
    case 23: img.color([{apply:'green',params:[30]},{apply:'blue',params:[10]}]).contrast(0.1).brightness(0.05); break;
    case 24: img.greyscale().brightness(0.15).contrast(0.2); break;
    case 25: img.color([{apply:'red',params:[35]},{apply:'yellow',params:[40]},{apply:'blue',params:[-20]}]).brightness(0.1); break;
    case 26: img.blur(1).brightness(0.15).contrast(-0.1); break;
    case 27: img.greyscale().blur(1).contrast(-0.2).brightness(-0.1).color([{apply:'red',params:[25]},{apply:'green',params:[15]},{apply:'blue',params:[-15]}]); break;
    case 28: img.invert().color([{apply:'hue',params:[90]},{apply:'saturate',params:[50]}]).contrast(0.3); break;
    case 29: img.contrast(0.3).brightness(-0.05).color([{apply:'desaturate',params:[15]},{apply:'blue',params:[10]}]); break;
    case 30: img.contrast(0.4).brightness(0.1).convolute([[0,-1,0],[-1,5,-1],[0,-1,0]]); break;

    // ── المتقدمة ──

    // 31 — موجة سائلة
    case 31: {
      const src = img.clone();
      const amp = Math.round(H * 0.025);
      const freq = (2 * Math.PI) / (W * 0.12);
      img.scan(0, 0, W, H, function(x, y, idx) {
        const sx = Math.max(0, Math.min(W-1, Math.round(x + amp * Math.sin(y * freq))));
        const sy = Math.max(0, Math.min(H-1, Math.round(y + amp * Math.cos(x * freq * 0.7))));
        const srcColor = src.getPixelColor(sx, sy);
        const { r, g, b, a } = Jimp.intToRGBA(srcColor);
        this.bitmap.data[idx]   = r;
        this.bitmap.data[idx+1] = g;
        this.bitmap.data[idx+2] = b;
        this.bitmap.data[idx+3] = a;
      });
      break;
    }

    // 32 — نيون
    case 32: {
      const edgeImg = img.clone().greyscale().convolute([[-1,-1,-1],[-1,8,-1],[-1,-1,-1]]);
      img.greyscale().brightness(-0.6); // خلفية داكنة
      const neonPalette = [[255,0,255],[0,255,255],[255,255,0],[0,255,128],[255,128,0]];
      let pi = 0;
      img.scan(0, 0, W, H, function(x, y, idx) {
        const edge = edgeImg.bitmap.data[idx]; // greyscale → R=G=B
        if (edge > 50) {
          const nc = neonPalette[(pi++) % neonPalette.length];
          const t = Math.min(1, edge / 200);
          this.bitmap.data[idx]   = Math.round(this.bitmap.data[idx]   + nc[0] * t);
          this.bitmap.data[idx+1] = Math.round(this.bitmap.data[idx+1] + nc[1] * t);
          this.bitmap.data[idx+2] = Math.round(this.bitmap.data[idx+2] + nc[2] * t);
        }
      });
      break;
    }

    // 33 — قوس قزح
    case 33: {
      const rainbowColors = [
        [255,0,0],[255,128,0],[255,255,0],
        [0,200,0],[0,100,255],[100,0,200],[200,0,200]
      ];
      img.scan(0, 0, W, H, function(x, y, idx) {
        const ci = Math.floor((x / W) * rainbowColors.length);
        const c = rainbowColors[Math.min(ci, rainbowColors.length-1)];
        this.bitmap.data[idx]   = Math.round(this.bitmap.data[idx]   * 0.6 + c[0] * 0.4);
        this.bitmap.data[idx+1] = Math.round(this.bitmap.data[idx+1] * 0.6 + c[1] * 0.4);
        this.bitmap.data[idx+2] = Math.round(this.bitmap.data[idx+2] * 0.6 + c[2] * 0.4);
      });
      break;
    }

    // 34 — Glitch
    case 34: {
      const slices = 20;
      for (let s = 0; s < slices; s++) {
        const y1 = Math.floor(Math.random() * H);
        const y2 = Math.min(H, y1 + Math.floor(H / 18) + 2);
        const shift = Math.floor((Math.random() - 0.5) * W * 0.07);
        if (shift === 0) continue;
        for (let y = y1; y < y2; y++) {
          for (let x = 0; x < W; x++) {
            const sx = Math.max(0, Math.min(W-1, x + shift));
            const srcColor = Jimp.intToRGBA(img.getPixelColor(sx, y));
            const dstColor = Jimp.intToRGBA(img.getPixelColor(x, y));
            // نحرك قناة الأحمر فقط
            img.setPixelColor(Jimp.rgbaToInt(srcColor.r, dstColor.g, dstColor.b, dstColor.a), x, y);
          }
        }
      }
      // خطوط سوداء عشوائية
      for (let i = 0; i < 6; i++) {
        const y = Math.floor(Math.random() * H);
        for (let x = 0; x < W; x++) {
          img.setPixelColor(Jimp.rgbaToInt(0, 0, 0, 255), x, y);
        }
      }
      break;
    }

    // 35 — إطار ذهبي
    case 35: {
      const t = Math.round(Math.min(W, H) * 0.04); // سماكة الإطار
      // رسم الإطار الذهبي يدوياً
      const goldColors = [[255,215,0],[255,248,220],[218,165,32],[184,134,11]];
      img.scan(0, 0, W, H, function(x, y, idx) {
        const onFrame = x < t || x >= W-t || y < t || y >= H-t;
        if (onFrame) {
          const gc = goldColors[Math.floor((x + y) / 4) % goldColors.length];
          // زخرفة الزوايا
          const cornerDist = Math.min(
            Math.hypot(x, y), Math.hypot(W-x, y),
            Math.hypot(x, H-y), Math.hypot(W-x, H-y)
          );
          const brightness = cornerDist < t * 1.5 ? 1.3 : 1.0;
          this.bitmap.data[idx]   = Math.min(255, Math.round(gc[0] * brightness));
          this.bitmap.data[idx+1] = Math.min(255, Math.round(gc[1] * brightness));
          this.bitmap.data[idx+2] = Math.min(255, Math.round(gc[2] * brightness));
        }
      });
      break;
    }

    // 36 — توهج
    case 36: {
      // نسخة مضيئة مع blur قوي كطبقة توهج
      const glowLayer = img.clone().brightness(1.0).blur(12);
      // نمزج الطبقتين بمعادلة screen
      img.scan(0, 0, W, H, function(x, y, idx) {
        const gr = glowLayer.bitmap.data[idx];
        const gg = glowLayer.bitmap.data[idx+1];
        const gb = glowLayer.bitmap.data[idx+2];
        const br = this.bitmap.data[idx];
        const bg = this.bitmap.data[idx+1];
        const bb = this.bitmap.data[idx+2];
        // screen blend: 1 - (1-a)(1-b)
        this.bitmap.data[idx]   = Math.round(255 - (255-br)*(255-gr)/255);
        this.bitmap.data[idx+1] = Math.round(255 - (255-bg)*(255-gg)/255);
        this.bitmap.data[idx+2] = Math.round(255 - (255-bb)*(255-gb)/255);
      });
      break;
    }

    // 37 — دمج طبقات
    case 37: {
      const flipped = img.clone().flip(true, false);
      img.scan(0, 0, W, H, function(x, y, idx) {
        const fc = Jimp.intToRGBA(flipped.getPixelColor(x, y));
        const t = 0.35; // شفافية النسخة المعكوسة
        // multiply blend
        this.bitmap.data[idx]   = Math.round(this.bitmap.data[idx]   * (1-t) + (this.bitmap.data[idx]   * fc.r / 255) * t);
        this.bitmap.data[idx+1] = Math.round(this.bitmap.data[idx+1] * (1-t) + (this.bitmap.data[idx+1] * fc.g / 255) * t);
        this.bitmap.data[idx+2] = Math.round(this.bitmap.data[idx+2] * (1-t) + (this.bitmap.data[idx+2] * fc.b / 255) * t);
      });
      break;
    }

    // 38 — شريط أفلام
    case 38: {
      // سيبيا خفيف أولاً
      img.greyscale().color([{apply:'red',params:[30]},{apply:'green',params:[15]},{apply:'blue',params:[-10]}]).brightness(-0.05);
      const bh = Math.round(H * 0.1); // ارتفاع الشريط
      const hw = Math.round(W * 0.03); // عرض الثقب
      const hh = Math.round(bh * 0.55); // ارتفاع الثقب
      const hgap = Math.round(W * 0.08); // مسافة بين الثقوب
      img.scan(0, 0, W, H, function(x, y, idx) {
        const inTopBar = y < bh;
        const inBotBar = y >= H - bh;
        if (inTopBar || inBotBar) {
          // الشريط الأسود
          this.bitmap.data[idx]   = 20;
          this.bitmap.data[idx+1] = 20;
          this.bitmap.data[idx+2] = 20;
          // الثقوب البيضاء
          const barY = inTopBar ? y : y - (H - bh);
          const holeY1 = Math.round((bh - hh) / 2);
          const holeY2 = holeY1 + hh;
          if (barY >= holeY1 && barY <= holeY2) {
            const holeX = x % (hgap * 2);
            if (holeX >= hgap * 0.3 && holeX <= hgap * 0.3 + hw) {
              this.bitmap.data[idx]   = 200;
              this.bitmap.data[idx+1] = 200;
              this.bitmap.data[idx+2] = 200;
            }
          }
        }
      });
      break;
    }
  }

  await img.writeAsync(outPath);
  return outPath;
}

async function handleImageEdit(api, event) {
  const { threadID, body, messageReply } = event;
  const text = (body || '').trim();

  if (/^ايديت$/.test(text)) {
    await sendMessage(api, buildHelpMsg(), threadID);
    return true;
  }

  const match = text.match(/^ايديت\s+(\d+)$/);
  if (!match) return false;

  const effectId = parseInt(match[1], 10);
  const effect   = EFFECTS.find(e => e.id === effectId);

  if (!effect) {
    await sendMessage(api,
      `╮───∙⋆⋅「 خطأ 」\n│\n│ › ⚠️ رقم التأثير غير صحيح\n│ › الأرقام المتاحة: 1 - ${EFFECTS.length}\n│ › أرسل 《 ايديت 》 لعرض القائمة\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return true;
  }

  let imageUrl = null;
  if (messageReply?.attachments?.length > 0) {
    const att = messageReply.attachments.find(a => a.type === 'photo' || a.type === 'sticker');
    if (att) imageUrl = att.url || att.previewUrl || att.largePreviewUrl;
  }
  if (!imageUrl && event.attachments?.length > 0) {
    const att = event.attachments.find(a => a.type === 'photo' || a.type === 'sticker');
    if (att) imageUrl = att.url || att.previewUrl || att.largePreviewUrl;
  }

  if (!imageUrl) {
    await sendMessage(api,
      `╮───∙⋆⋅「 ايديت ${effectId} 」\n│\n│ › ⚠️ لم أجد صورة\n│ › رد على صورة بالأمر\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
    return true;
  }

  await sendMessage(api,
    `╮───∙⋆⋅「 جاري المعالجة ⏳ 」\n│\n│ › التأثير: ${effect.name}\n│ › الرقم: ${effectId}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
    threadID);

  let inputPath = null, outputPath = null;
  try {
    inputPath  = await downloadImage(imageUrl);
    outputPath = await applyEffect(inputPath, effectId);
    await new Promise((resolve, reject) => {
      api.sendMessage(
        {
          body: `\u061C╮───∙⋆⋅「 ✅ تم التعديل 」\n│\n│ › التأثير: ${effect.name}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
          attachment: fs.createReadStream(outputPath)
        },
        threadID,
        (err) => err ? reject(err) : resolve()
      );
    });
  } catch (err) {
    await sendMessage(api,
      `╮───∙⋆⋅「 خطأ ❌ 」\n│\n│ › فشل التعديل\n│ › ${err.message || String(err)}\n╯───────∙⋆⋅ ※ ⋅⋆∙`,
      threadID);
  } finally {
    cleanup(inputPath, outputPath);
  }
  return true;
}

module.exports = { handleImageEdit, EFFECTS };
