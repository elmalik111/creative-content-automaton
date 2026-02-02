

# خطة إصلاح نظام إنشاء الفيديوهات عبر Telegram

## الهدف
تفعيل المهمة الثانية بالكامل: استلام أمر من Telegram → توليد محتوى AI → نشر على المنصات

---

## التشخيص الحالي

### ما يعمل بشكل صحيح
- جميع Edge Functions موجودة ومكتوبة بشكل صحيح
- Gemini API مُعد ومفتاحه موجود
- Hugging Face token موجود
- ElevenLabs مفتاح واحد نشط في قاعدة البيانات
- Storage buckets موجودة (temp-files, media-output)
- توكن Telegram محفوظ في جدول settings

### ما لا يعمل ولماذا
1. **Webhook غير مسجل مع Telegram** - لم يتم إرسال أي طلبات للنظام
2. **TELEGRAM_WEBHOOK_SECRET غير موجود** في Supabase Secrets
3. **YouTube token منتهي الصلاحية** (انتهى منذ ساعات)

---

## الخطوة 1: إضافة TELEGRAM_WEBHOOK_SECRET

إضافة Secret جديد في Supabase:
- الاسم: `TELEGRAM_WEBHOOK_SECRET`
- القيمة: كلمة سر عشوائية (32 حرف على الأقل)

---

## الخطوة 2: تسجيل Webhook مع Telegram

بعد إضافة الـ Secret، يجب تنفيذ هذا الأمر (استبدل القيم):

```text
POST https://api.telegram.org/bot<BOT_TOKEN>/setWebhook

{
  "url": "https://cidxcujlfkrzvvmljxqs.supabase.co/functions/v1/telegram-webhook",
  "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
}
```

البوت توكن الحالي: `6086731822:AAFEOi5qL_Ts-gsCj8C_JZ1lnLYb_expaio`

---

## الخطوة 3: إعادة اتصال YouTube

توكن YouTube الحالي منتهي الصلاحية. يجب:
1. الذهاب للداشبورد → Settings → OAuth
2. إعادة ربط YouTube للحصول على توكن جديد

---

## الخطوة 4: اختبار النظام

بعد الإعداد:
1. إرسال `/start` للبوت → يجب أن يرد برسالة ترحيب
2. إرسال `/create` مع البيانات → يجب أن يبدأ بإنشاء الفيديو

---

## القسم التقني

### تدفق البيانات الكامل

```text
المستخدم يرسل /create
        ↓
telegram-webhook يستلم الطلب
        ↓
    يتحقق من X-Telegram-Bot-Api-Secret-Token
        ↓
    يحلل البيانات (عنوان، وصف، نوع صوت، عدد مشاهد، مدة)
        ↓
    ينشئ job في قاعدة البيانات (type: ai_generate)
        ↓
    يطلق ai-generate function
        ↓
ai-generate يبدأ العمل:
    ├── Step 1: Gemini يولد سكربت التعليق الصوتي بالعربية
    ├── Step 2: ElevenLabs يحول النص لصوت
    ├── Step 3: Gemini يولد وصف الصور بالإنجليزية
    ├── Step 4: Flux يولد الصور
    ├── Step 5: FFmpeg يدمج الصور مع الصوت
    └── Step 6: publish-video ينشر على المنصات المتصلة
        ↓
    يرسل إشعار للمستخدم على Telegram
```

### الـ Secrets المطلوبة

| Secret | الحالة | الملاحظات |
|--------|--------|-----------|
| GEMINI_API_KEY | موجود | لتوليد النصوص |
| HF_READ_TOKEN | موجود | لـ Flux و FFmpeg |
| HF_SPACE_URL | موجود | ff.hf.space |
| YOUTUBE_CLIENT_ID | موجود | لـ OAuth |
| YOUTUBE_CLIENT_SECRET | موجود | لـ OAuth |
| TELEGRAM_WEBHOOK_SECRET | غير موجود | يجب إضافته |

### ElevenLabs Keys في قاعدة البيانات

المفاتيح تُخزن في جدول `elevenlabs_keys` وليس كـ environment variables:
- مفتاح واحد نشط حالياً
- النظام يختار المفتاح الأقل استخداماً تلقائياً

### أمر التسجيل الكامل

```bash
curl -X POST "https://api.telegram.org/bot6086731822:AAFEOi5qL_Ts-gsCj8C_JZ1lnLYb_expaio/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://cidxcujlfkrzvvmljxqs.supabase.co/functions/v1/telegram-webhook",
    "secret_token": "YOUR_SECRET_HERE"
  }'
```

---

## ملخص التغييرات

| النوع | التفاصيل |
|-------|----------|
| إضافة Secret | TELEGRAM_WEBHOOK_SECRET |
| إعداد خارجي | تسجيل Webhook مع Telegram API |
| إعادة ربط | YouTube OAuth (اختياري للنشر) |
| تغييرات كود | لا يوجد - الكود جاهز |

