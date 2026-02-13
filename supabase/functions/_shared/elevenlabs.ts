import { supabase } from "./supabase.ts";

interface ElevenLabsKey {
  id: string;
  api_key: string;
  name: string;
  usage_count: number;
  is_active: boolean;
  last_used_at?: string;
  cooldown_until?: string; // وقت انتهاء فترة التهدئة
  consecutive_failures?: number; // عدد الفشل المتتالي
}

// ذاكرة مؤقتة لتتبع حالة المفاتيح بدون الحاجة للقراءة من قاعدة البيانات كل مرة
const keyStatusCache = new Map<string, {
  inCooldown: boolean;
  cooldownUntil: Date | null;
  consecutiveFailures: number;
}>();

/**
 * جلب جميع المفاتيح النشطة مع استبعاد المفاتيح في فترة تهدئة
 */
async function getActiveKeys(): Promise<ElevenLabsKey[]> {
  const { data: keys, error } = await supabase
    .from("elevenlabs_keys")
    .select("*")
    .eq("is_active", true)
    .order("usage_count", { ascending: true });

  if (error) {
    console.error("Error fetching ElevenLabs keys:", error);
    return [];
  }

  const allKeys = (keys || []) as ElevenLabsKey[];
  const now = new Date();

  // تصفية المفاتيح: استبعاد المفاتيح في فترة تهدئة
  const availableKeys = allKeys.filter(key => {
    // التحقق من فترة التهدئة في قاعدة البيانات
    if (key.cooldown_until) {
      const cooldownDate = new Date(key.cooldown_until);
      if (cooldownDate > now) {
        console.log(`⏳ المفتاح ${key.name} في فترة تهدئة حتى ${cooldownDate.toLocaleString('ar-EG')}`);
        return false;
      }
    }

    // التحقق من الذاكرة المؤقتة
    const cached = keyStatusCache.get(key.id);
    if (cached?.inCooldown && cached.cooldownUntil && cached.cooldownUntil > now) {
      console.log(`⏳ المفتاح ${key.name} في فترة تهدئة مؤقتة (ذاكرة)`);
      return false;
    }

    return true;
  });

  return availableKeys;
}

/**
 * تحديد ما إذا كان يجب تعطيل المفتاح بشكل دائم
 */
function shouldDeactivateKey(status: number, errorText: string): boolean {
  const lower = errorText.toLowerCase();
  
  return (
    lower.includes("invalid_api_key") ||
    lower.includes("api key is invalid") ||
    lower.includes("unauthorized") && lower.includes("invalid") ||
    // إذا كان quota_exceeded وليس detected_unusual_activity
    (status === 401 && lower.includes("quota_exceeded") && !lower.includes("unusual"))
  );
}

/**
 * تحديد ما إذا كان الخطأ يتطلب فترة تهدئة
 */
function requiresCooldown(status: number, errorText: string): { needsCooldown: boolean; minutes: number } {
  const lower = errorText.toLowerCase();
  
  // النشاط غير العادي = فترة تهدئة 10-15 دقيقة
  if (lower.includes("detected_unusual_activity") || lower.includes("unusual activity")) {
    return { needsCooldown: true, minutes: 15 };
  }
  
  // حد المعدل (rate limit) = فترة تهدئة 5 دقائق
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return { needsCooldown: true, minutes: 5 };
  }

  // أخطاء 401 أخرى = فترة تهدئة قصيرة
  if (status === 401 && !shouldDeactivateKey(status, errorText)) {
    return { needsCooldown: true, minutes: 3 };
  }

  return { needsCooldown: false, minutes: 0 };
}

/**
 * تحديد ما إذا كان الخطأ قابل لإعادة المحاولة مع مفتاح آخر
 */
function isRetryableError(status: number, errorText: string): boolean {
  // أخطاء الخادم = مؤقتة
  if (status >= 500) return true;
  
  // حد المعدل = جرب مفتاح آخر
  if (status === 429) return true;
  
  // النشاط غير العادي = جرب مفتاح آخر
  if (errorText.toLowerCase().includes("unusual")) return true;
  
  // 401 غير دائم = جرب مفتاح آخر
  if (status === 401 && !shouldDeactivateKey(status, errorText)) return true;
  
  return false;
}

/**
 * وضع مفتاح في فترة تهدئة
 */
async function setCooldown(keyId: string, keyName: string, minutes: number): Promise<void> {
  const cooldownUntil = new Date(Date.now() + minutes * 60 * 1000);
  
  console.warn(`⏰ وضع المفتاح ${keyName} في فترة تهدئة لمدة ${minutes} دقيقة (حتى ${cooldownUntil.toLocaleString('ar-EG')})`);
  
  // حفظ في قاعدة البيانات
  await supabase
    .from("elevenlabs_keys")
    .update({ 
      cooldown_until: cooldownUntil.toISOString(),
      consecutive_failures: 0 // إعادة تعيين عداد الفشل
    })
    .eq("id", keyId);

  // حفظ في الذاكرة المؤقتة
  keyStatusCache.set(keyId, {
    inCooldown: true,
    cooldownUntil: cooldownUntil,
    consecutiveFailures: 0
  });
}

/**
 * تسجيل نجاح استخدام مفتاح
 */
async function markKeySuccess(keyId: string, keyName: string): Promise<void> {
  console.log(`✅ نجح المفتاح ${keyName}`);
  
  // إزالة فترة التهدئة وإعادة تعيين عداد الفشل
  await supabase
    .from("elevenlabs_keys")
    .update({ 
      cooldown_until: null,
      consecutive_failures: 0
    })
    .eq("id", keyId);

  // تحديث الذاكرة المؤقتة
  keyStatusCache.set(keyId, {
    inCooldown: false,
    cooldownUntil: null,
    consecutiveFailures: 0
  });
}

/**
 * تسجيل فشل مفتاح
 */
async function markKeyFailure(keyId: string, currentFailures: number = 0): Promise<void> {
  const newFailureCount = currentFailures + 1;
  
  await supabase
    .from("elevenlabs_keys")
    .update({ 
      consecutive_failures: newFailureCount
    })
    .eq("id", keyId);

  const cached = keyStatusCache.get(keyId);
  if (cached) {
    cached.consecutiveFailures = newFailureCount;
  }
}

/**
 * الحصول على المفتاح التالي (للاستخدام البسيط)
 */
export async function getNextElevenLabsKey(): Promise<{ key: string; keyId: string } | null> {
  const keys = await getActiveKeys();
  if (keys.length === 0) return null;

  const selectedKey = keys[0];

  // زيادة عداد الاستخدام
  await supabase
    .from("elevenlabs_keys")
    .update({
      usage_count: selectedKey.usage_count + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", selectedKey.id);

  console.log(`🔑 استخدام المفتاح: ${selectedKey.name} (عدد الاستخدامات: ${selectedKey.usage_count + 1})`);

  return {
    key: selectedKey.api_key,
    keyId: selectedKey.id,
  };
}

/**
 * توليد الصوت مع نظام تناوب ذكي بين المفاتيح
 */
export async function generateSpeech(
  text: string,
  voiceId: string = "onwK4e9ZLuTAKqWW03F9" // Daniel - صوت يدعم العربية
): Promise<ArrayBuffer | null> {
  const keys = await getActiveKeys();

  if (keys.length === 0) {
    throw new Error("❌ لا توجد مفاتيح ElevenLabs نشطة أو متاحة. أضف مفتاحاً جديداً أو انتظر انتهاء فترة التهدئة.");
  }

  console.log(`📋 عدد المفاتيح المتاحة: ${keys.length}`);

  const errors: string[] = [];

  // جرب كل المفاتيح المتاحة (واحد تلو الآخر)
  for (let i = 0; i < keys.length; i++) {
    const currentKey = keys[i];
    console.log(`\n🔄 محاولة ${i + 1}/${keys.length} - المفتاح: ${currentKey.name}`);

    try {
      // تحديث وقت آخر استخدام وعداد الاستخدام
      await supabase
        .from("elevenlabs_keys")
        .update({
          usage_count: currentKey.usage_count + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", currentKey.id);

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": currentKey.api_key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.65,
              similarity_boost: 0.82,
              style: 0.40,
              use_speaker_boost: true,
            },
          }),
        }
      );

      // ✅ نجاح!
      if (response.ok) {
        const cType = response.headers.get("content-type") || "";
        
        // التحقق من نوع المحتوى
        if (!cType.includes("audio") && !cType.includes("octet-stream")) {
          const bodyText = await response.text().catch(() => "");
          console.error(`⚠️ استجابة غير صوتية من ${currentKey.name}: ${bodyText.slice(0, 100)}`);
          errors.push(`${currentKey.name}: استجابة غير صوتية`);
          await markKeyFailure(currentKey.id, currentKey.consecutive_failures || 0);
          continue; // جرب المفتاح التالي
        }

        const audioBuffer = await response.arrayBuffer();
        
        // التحقق من حجم الملف
        if (audioBuffer.byteLength < 1000) {
          console.warn(`⚠️ ملف صوتي صغير جداً من ${currentKey.name}: ${audioBuffer.byteLength} بايت`);
          errors.push(`${currentKey.name}: ملف فارغ (${audioBuffer.byteLength}B)`);
          await markKeyFailure(currentKey.id, currentKey.consecutive_failures || 0);
          continue; // جرب المفتاح التالي
        }

        // ✅ نجاح كامل!
        console.log(`✅ نجح ${currentKey.name} - حجم الملف: ${(audioBuffer.byteLength / 1024).toFixed(1)} كيلوبايت`);
        await markKeySuccess(currentKey.id, currentKey.name);
        return audioBuffer;
      }

      // ❌ فشل - معالجة الأخطاء
      const errorText = await response.text();
      console.error(`❌ فشل المفتاح ${currentKey.name}: HTTP ${response.status}`);
      console.error(`📄 نص الخطأ: ${errorText.slice(0, 200)}`);

      // 1️⃣ هل يجب تعطيل المفتاح نهائياً؟
      if (shouldDeactivateKey(response.status, errorText)) {
        console.warn(`🔒 تعطيل المفتاح ${currentKey.name} نهائياً: ${errorText.slice(0, 100)}`);
        await supabase
          .from("elevenlabs_keys")
          .update({ is_active: false })
          .eq("id", currentKey.id);
        
        errors.push(`${currentKey.name}: محظور نهائياً`);
        continue; // جرب المفتاح التالي
      }

      // 2️⃣ هل يحتاج المفتاح فترة تهدئة؟
      const cooldownInfo = requiresCooldown(response.status, errorText);
      if (cooldownInfo.needsCooldown) {
        await setCooldown(currentKey.id, currentKey.name, cooldownInfo.minutes);
        errors.push(`${currentKey.name}: نشاط غير عادي (فترة راحة ${cooldownInfo.minutes} دقائق)`);
        continue; // جرب المفتاح التالي
      }

      // 3️⃣ خطأ قابل لإعادة المحاولة؟
      if (isRetryableError(response.status, errorText)) {
        await markKeyFailure(currentKey.id, currentKey.consecutive_failures || 0);
        errors.push(`${currentKey.name}: خطأ مؤقت (${response.status})`);
        continue; // جرب المفتاح التالي
      }

      // 4️⃣ خطأ غير قابل لإعادة المحاولة (مثل 400 bad request)
      errors.push(`${currentKey.name}: ${response.status} - ${errorText.slice(0, 100)}`);
      
      // إذا كان خطأ في البيانات المرسلة، لا فائدة من تجربة مفاتيح أخرى
      if (response.status === 400) {
        throw new Error(`خطأ في البيانات المرسلة (400): ${errorText.slice(0, 200)}`);
      }

      await markKeyFailure(currentKey.id, currentKey.consecutive_failures || 0);
      
    } catch (err) {
      // إعادة رمي الأخطاء غير القابلة لإعادة المحاولة
      if (err instanceof Error && 
          (err.message.includes("خطأ في البيانات المرسلة") || 
           err.message.startsWith("ElevenLabs API error:"))) {
        throw err;
      }

      // أخطاء الشبكة وغيرها - جرب المفتاح التالي
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`⚠️ خطأ شبكة مع ${currentKey.name}: ${msg}`);
      errors.push(`${currentKey.name}: ${msg}`);
      await markKeyFailure(currentKey.id, currentKey.consecutive_failures || 0);
      continue;
    }
  }

  // 💥 فشلت جميع المفاتيح
  const errorSummary = errors.map((e, i) => `${i + 1}. ${e}`).join("\n");
  throw new Error(
    `❌ فشلت جميع مفاتيح ElevenLabs (${keys.length} محاولات):\n${errorSummary}\n\n💡 نصيحة: انتظر قليلاً ثم حاول مرة أخرى، أو أضف مفاتيح جديدة.`
  );
}

/**
 * تنظيف فترات التهدئة المنتهية (يمكن استدعاؤها بشكل دوري)
 */
export async function cleanupExpiredCooldowns(): Promise<void> {
  const now = new Date().toISOString();
  
  const { data, error } = await supabase
    .from("elevenlabs_keys")
    .update({ cooldown_until: null })
    .lt("cooldown_until", now)
    .select();

  if (error) {
    console.error("خطأ في تنظيف فترات التهدئة:", error);
    return;
  }

  if (data && data.length > 0) {
    console.log(`🧹 تم تنظيف ${data.length} مفتاح من فترات التهدئة المنتهية`);
    
    // تحديث الذاكرة المؤقتة
    data.forEach(key => {
      keyStatusCache.set(key.id, {
        inCooldown: false,
        cooldownUntil: null,
        consecutiveFailures: 0
      });
    });
  }
}

/**
 * الحصول على تقرير حالة جميع المفاتيح
 */
export async function getKeysStatusReport(): Promise<string> {
  const { data: allKeys, error } = await supabase
    .from("elevenlabs_keys")
    .select("*")
    .order("name");

  if (error || !allKeys) {
    return "خطأ في جلب المفاتيح";
  }

  const now = new Date();
  let report = "📊 تقرير حالة مفاتيح ElevenLabs:\n\n";

  allKeys.forEach((key: ElevenLabsKey, index) => {
    const status = key.is_active ? "✅ نشط" : "❌ معطل";
    let cooldownStatus = "";
    
    if (key.cooldown_until) {
      const cooldownDate = new Date(key.cooldown_until);
      if (cooldownDate > now) {
        const minutesLeft = Math.ceil((cooldownDate.getTime() - now.getTime()) / 60000);
        cooldownStatus = ` ⏳ (فترة راحة: ${minutesLeft} دقيقة)`;
      }
    }

    report += `${index + 1}. ${key.name} - ${status}${cooldownStatus}\n`;
    report += `   عدد الاستخدامات: ${key.usage_count}\n`;
    if (key.consecutive_failures && key.consecutive_failures > 0) {
      report += `   فشل متتالي: ${key.consecutive_failures}\n`;
    }
    report += `\n`;
  });

  return report;
}
