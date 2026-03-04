

# خطة شاملة لحل المشاكل الأربع

## تحليل المشاكل

### المشكلة 1: جودة الصوت (ElevenLabs)
**السبب الجذري:**
- حساب الـ cooldown خاطئ: يستخدم `3_000` بدل `60_000` (3 ثوانٍ بدل دقيقة)
- عند فشل كل المفاتيح يُستخدم Google TTS كبديل (جودة سيئة جداً، 200 حرف فقط)
- خطأ `unusual_activity` يعني أن ElevenLabs يحظر السيرفرات السحابية للحسابات المجانية — يحتاج cooldown أطول (30-60 دقيقة) وليس إيقاف دائم

**الحل:**
- إصلاح حساب الـ cooldown (`minutes * 60_000`)
- حذف Google TTS fallback بالكامل — ElevenLabs فقط
- تطبيق cooldown ذكي حسب نوع الخطأ:
  - `unusual_activity` → cooldown 30 دقيقة (ليس تعطيل دائم)
  - `429 rate limit` → cooldown 2 دقيقة
  - `quota_exceeded` / `invalid_api_key` → تعطيل دائم فقط لهذين
- إضافة تأخير عشوائي (1-3 ثوانٍ) قبل كل طلب لتقليل احتمال الحظر
- تقليل `stability` إلى 0.5 واستخدام `style: 0.0` لتقليل الاستهلاك

### المشكلة 2: توليد الصور (Pollinations)
**السبب الجذري:**
- الكود يستخدم `image.pollinations.ai` وهو الرابط القديم
- وثائق Pollinations الجديدة تؤكد أن الرابط الصحيح هو `gen.pollinations.ai/image/{prompt}`
- المفتاح يُرسل كـ `Authorization` header وهذا صحيح حسب الوثائق

**الحل:**
- تحديث URL من `image.pollinations.ai/prompt/` إلى `gen.pollinations.ai/image/`
- إضافة `key` كـ query parameter كبديل (حسب الوثائق)
- التأكد من إرسال المعلمات الصحيحة (`model`, `width`, `height`, `seed`, `nologo`)

### المشكلة 3: السكربت وصورة واحدة فقط
**السبب الجذري — خطأ حرج في gemini.ts:**
- السطر 253: `"Script:\n" + script.slice(0, 800);` — هذا تعبير معلّق (dead code) لا يُضاف للـ prompt
- يعني أن `generateVideoMetadata` لا يتضمن نص السكربت في الـ prompt!
- بالنسبة لصورة واحدة: المشكلة في ترتيب العمليات — إذا فشلت الصور بسبب Pollinations القديم، يتم توليد صور fallback ضعيفة

**الحل:**
- إصلاح السطر 253 ليكون جزءاً من المتغير `metadataPrompt` بشكل صحيح
- إصلاح Pollinations (المشكلة 2) سيحل مشكلة الصور تلقائياً
- مراجعة prompt السكربت للتأكد من أنه يُنتج محتوى بالطول المطلوب

### المشكلة 4: استلام رسائل تلجرام
**الأسباب المحتملة:**
- لا توجد logs نهائياً — الـ webhook قد لا يكون مسجلاً
- سطر مكرر (273-274) في `parseCreateCommand` — لا يسبب خطأ لكنه يحتاج تنظيف
- الـ function قد تحتاج إعادة deploy

**الحل:**
- إعادة deploy الـ telegram-webhook function
- حذف السطر المكرر
- إضافة logging أوضح لتتبع الطلبات الواردة
- التأكد من أن `verify_jwt = false` في config.toml (موجود ✓)

---

## التغييرات التقنية

### ملف 1: `supabase/functions/_shared/elevenlabs.ts`
- إصلاح `setCooldown`: `minutes * 60_000` بدل `minutes * 3_000`
- إصلاح `cooldownMinutesLeft`: `/ 60_000` بدل `/ 3_000`
- حذف دالة `generateGoogleTTS` بالكامل
- حذف كود الـ fallback في `generateSpeech` (سطور 151-158)
- تعديل cooldown لـ `unusual_activity` إلى 30 دقيقة بدل تعطيل
- إضافة `await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000))` قبل كل طلب API

### ملف 2: `supabase/functions/_shared/huggingface.ts`
- تحديث `tryPollinationsModel`: تغيير URL من `image.pollinations.ai/prompt/` إلى `gen.pollinations.ai/image/`
- إضافة `key` query parameter كبديل للـ Authorization header

### ملف 3: `supabase/functions/_shared/gemini.ts`
- إصلاح السطر 252-253: دمج `"Script:\n" + script.slice(0, 800)` في المتغير `metadataPrompt` بشكل صحيح بدلاً من التعبير المعلق

### ملف 4: `supabase/functions/telegram-webhook/index.ts`
- حذف السطر المكرر 274
- إضافة `console.log` في بداية المعالج لتسجيل كل طلب وارد

