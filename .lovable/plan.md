

# خطة إكمال تكامل Telegram Bot

## الهدف
تفعيل نظام إنشاء الفيديوهات التلقائي عبر Telegram بحيث يستطيع المستخدم إرسال أمر `/create` ويحصل على فيديو كامل منشور على منصات التواصل.

---

## الخطوة 1: تحديث config.toml

إضافة الـ Edge Functions الناقصة:

```toml
[functions.telegram-webhook]
verify_jwt = false

[functions.ai-generate]
verify_jwt = false

[functions.publish-video]
verify_jwt = false
```

**السبب**: Telegram يرسل طلبات بدون JWT، والـ functions الداخلية تستخدم Service Role Key.

---

## الخطوة 2: إضافة TELEGRAM_WEBHOOK_SECRET

1. اختر كلمة سر عشوائية (32-64 حرف)
2. أضفها كـ Secret في Supabase باسم `TELEGRAM_WEBHOOK_SECRET`

---

## الخطوة 3: تسجيل Webhook مع Telegram

بعد نشر المشروع، نفذ هذا الطلب (استبدل القيم):

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://cidxcujlfkrzvvmljxqs.supabase.co/functions/v1/telegram-webhook",
    "secret_token": "<YOUR_TELEGRAM_WEBHOOK_SECRET>"
  }'
```

---

## الخطوة 4: إدخال توكن البوت في Dashboard

من الداشبورد: Settings → Telegram Bot → أدخل توكن البوت

---

## الخطوة 5: نشر Edge Functions

نشر كل الـ Functions المحدثة:
- telegram-webhook
- ai-generate
- publish-video

---

## ملخص التغييرات التقنية

| الملف | التغيير |
|-------|---------|
| `supabase/config.toml` | إضافة 3 entries للـ functions |

**الجهد المطلوب**: تغيير بسيط جدًا (3 أسطر فقط)

---

## اختبار النظام

بعد التنفيذ:
1. أرسل `/start` للبوت → يجب أن يرد برسالة ترحيب
2. أرسل `/create` مع البيانات → يجب أن يبدأ بإنشاء الفيديو
3. أرسل `/status` → لمتابعة حالة المهام

