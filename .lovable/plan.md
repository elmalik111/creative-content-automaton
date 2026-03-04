
# خطة إصلاح المشاكل الأربع — ✅ تم التنفيذ

## ما تم إصلاحه

### 1. ✅ ElevenLabs — cooldown + حذف Google TTS
- إصلاح حساب الـ cooldown: `minutes * 60_000` بدل `3_000`
- حذف `generateGoogleTTS` والـ fallback بالكامل
- `unusual_activity` → cooldown 30 دقيقة (بدل تعطيل دائم)
- `429 rate limit` → cooldown 2 دقيقة
- إضافة تأخير عشوائي 1-3 ثوانٍ قبل كل طلب
- تقليل `stability` إلى 0.5

### 2. ✅ Pollinations — تحديث URL
- تغيير من `image.pollinations.ai/prompt/` إلى `gen.pollinations.ai/image/`
- إضافة `key` كـ query parameter بدل Authorization header

### 3. ✅ Gemini — إصلاح dead code في generateVideoMetadata
- السطر `"Script:\n" + script.slice(0, 800);` كان تعبير معلّق
- تم دمج السكربت مباشرة في الـ prompt عبر `script.slice(0, 800)`

### 4. ✅ Telegram — تنظيف وتحسين logging
- حذف السطر المكرر لـ `نوع_يوتيوب`
- إضافة logging للطلبات الواردة
