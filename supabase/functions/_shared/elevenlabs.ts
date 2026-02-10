import { supabase } from "./supabase.ts";

interface ElevenLabsKey {
  id: string;
  api_key: string;
  name: string;
  usage_count: number;
  is_active: boolean;
}

// ===== FETCH ACTIVE KEYS =====

async function getActiveKeys(): Promise<ElevenLabsKey[]> {
  const { data: keys, error } = await supabase
    .from("elevenlabs_keys")
    .select("*")
    .eq("is_active", true)
    .order("usage_count", { ascending: true });

  if (error) {
    console.error("[ElevenLabs] خطأ في جلب المفاتيح:", error);
    return [];
  }

  return (keys || []) as ElevenLabsKey[];
}

// ===== KEY DEACTIVATION LOGIC (FIXED!) =====

/**
 * ⚠️ تحديد متى يتم تعطيل المفتاح نهائياً
 * 
 * CRITICAL: "detected_unusual_activity" هو خطأ مؤقت وليس دائم!
 * لا يجب تعطيل المفتاح بسببه.
 */
function shouldDeactivateKey(status: number, errorText: string): boolean {
  const lower = errorText.toLowerCase();
  
  // ===== الأخطاء الدائمة فقط =====
  
  // 1. المفتاح غير صالح بوضوح (invalid API key)
  if (lower.includes("invalid_api_key") || lower.includes("invalid api key")) {
    console.warn("[ElevenLabs] 🔒 مفتاح API غير صالح - تعطيل نهائي");
    return true;
  }
  
  // 2. المفتاح محذوف أو منتهي الصلاحية
  if (lower.includes("api key has been deleted") || lower.includes("expired")) {
    console.warn("[ElevenLabs] 🔒 مفتاح منتهي الصلاحية - تعطيل نهائي");
    return true;
  }
  
  // 3. الحساب محظور بشكل دائم (permanent ban)
  if (lower.includes("account suspended") || lower.includes("permanently banned")) {
    console.warn("[ElevenLabs] 🔒 حساب محظور - تعطيل نهائي");
    return true;
  }
  
  // ===== الأخطاء المؤقتة - لا تعطيل =====
  
  // ⚠️ CRITICAL FIX: "detected_unusual_activity" مؤقت!
  if (lower.includes("detected_unusual_activity")) {
    console.warn("[ElevenLabs] ⚠️ نشاط غير عادي مكتشف - لن يتم التعطيل (خطأ مؤقت)");
    console.warn("[ElevenLabs] 💡 الحل: انتظر 5-10 دقائق ثم حاول مرة أخرى");
    return false; // ✅ لا تعطّل!
  }
  
  // نفاد الحصة - مؤقت (يتجدد شهرياً)
  if (lower.includes("quota") || lower.includes("limit")) {
    console.warn("[ElevenLabs] ⚠️ نفاد الحصة - لن يتم التعطيل (يتجدد شهرياً)");
    return false;
  }
  
  // Rate limiting - مؤقت جداً
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    console.warn("[ElevenLabs] ⚠️ تجاوز حد الطلبات - لن يتم التعطيل (مؤقت)");
    return false;
  }
  
  // Subscription issues - قد تكون مؤقتة
  if (lower.includes("subscription")) {
    console.warn("[ElevenLabs] ⚠️ مشكلة في الاشتراك - لن يتم التعطيل (قد تكون مؤقتة)");
    return false;
  }
  
  // Default: لا تعطّل إلا إذا كنت متأكداً 100%
  console.warn("[ElevenLabs] ⚠️ خطأ غير معروف - لن يتم التعطيل احتياطياً");
  return false;
}

// ===== RETRYABLE ERROR DETECTION =====

function isRetryableError(status: number, errorText: string): boolean {
  const lower = errorText.toLowerCase();
  
  // الأخطاء القابلة لإعادة المحاولة مع مفتاح آخر
  
  // نشاط غير عادي - جرب مفتاح آخر
  if (lower.includes("detected_unusual_activity")) {
    return true;
  }
  
  // 401 - قد يكون المفتاح الحالي به مشكلة مؤقتة
  if (status === 401) {
    return true;
  }
  
  // 429 - Rate limiting
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return true;
  }
  
  // نفاد الحصة
  if (lower.includes("quota") || lower.includes("limit")) {
    return true;
  }
  
  // أخطاء الخادم (5xx)
  if (status >= 500) {
    return true;
  }
  
  // أخطاء الشبكة
  if (lower.includes("network") || lower.includes("connection") || lower.includes("timeout")) {
    return true;
  }
  
  return false;
}

// ===== TEMPORARY COOLDOWN FOR KEYS =====

const keyCooldowns = new Map<string, number>();

/**
 * وضع المفتاح في "فترة راحة" مؤقتة بدلاً من التعطيل
 */
function setKeyCooldown(keyId: string, minutes: number = 10) {
  const cooldownUntil = Date.now() + (minutes * 60 * 1000);
  keyCooldowns.set(keyId, cooldownUntil);
  console.log(`[ElevenLabs] 🕐 المفتاح ${keyId} في فترة راحة لمدة ${minutes} دقيقة`);
}

/**
 * التحقق إذا كان المفتاح في فترة راحة
 */
function isInCooldown(keyId: string): boolean {
  const cooldownUntil = keyCooldowns.get(keyId);
  if (!cooldownUntil) return false;
  
  if (Date.now() < cooldownUntil) {
    const remainingMinutes = Math.ceil((cooldownUntil - Date.now()) / 60000);
    console.log(`[ElevenLabs] ⏳ المفتاح في فترة راحة (${remainingMinutes} دقيقة متبقية)`);
    return true;
  }
  
  // انتهت فترة الراحة
  keyCooldowns.delete(keyId);
  return false;
}

// ===== KEY USAGE LOGGING =====

async function logKeyUsage(keyId: string, success: boolean, errorMessage?: string) {
  try {
    await supabase.from("elevenlabs_key_logs").insert({
      key_id: keyId,
      success: success,
      error_message: errorMessage,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // تجاهل أخطاء التسجيل
  }
}

// ===== MAIN FUNCTION =====

export async function getNextElevenLabsKey(): Promise<{ key: string; keyId: string } | null> {
  const keys = await getActiveKeys();
  if (keys.length === 0) return null;

  // ابحث عن أول مفتاح ليس في cooldown
  for (const key of keys) {
    if (!isInCooldown(key.id)) {
      await supabase
        .from("elevenlabs_keys")
        .update({
          usage_count: key.usage_count + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", key.id);

      console.log(`[ElevenLabs] 🔑 استخدام المفتاح: ${key.name} (استخدام: ${key.usage_count + 1})`);

      return {
        key: key.api_key,
        keyId: key.id,
      };
    }
  }
  
  // جميع المفاتيح في cooldown
  console.warn("[ElevenLabs] ⚠️ جميع المفاتيح في فترة راحة");
  return null;
}

// ===== GENERATE SPEECH =====

export async function generateSpeech(
  text: string,
  voiceId: string = "onwK4e9ZLuTAKqWW03F9"
): Promise<ArrayBuffer | null> {
  const keys = await getActiveKeys();

  if (keys.length === 0) {
    throw new Error("لا توجد مفاتيح ElevenLabs نشطة. أضف مفتاحاً جديداً من الإعدادات.");
  }

  const maxRetries = Math.min(keys.length, 5); // زيادة المحاولات
  const errors: string[] = [];

  for (let i = 0; i < maxRetries; i++) {
    const currentKey = keys[i];
    
    // تخطي المفاتيح في cooldown
    if (isInCooldown(currentKey.id)) {
      console.log(`[ElevenLabs] ⏭️ تخطي المفتاح ${currentKey.name} (في فترة راحة)`);
      continue;
    }
    
    console.log(`[ElevenLabs] 🔄 محاولة ${i + 1}/${maxRetries} - مفتاح: ${currentKey.name}`);

    try {
      // Update usage
      await supabase
        .from("elevenlabs_keys")
        .update({
          usage_count: currentKey.usage_count + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", currentKey.id);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 seconds

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
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.5,
              use_speaker_boost: true,
            },
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        console.log(`[ElevenLabs] ✅ نجح مع مفتاح ${currentKey.name}, حجم: ${audioBuffer.byteLength} bytes`);
        
        await logKeyUsage(currentKey.id, true);
        
        return audioBuffer;
      }

      // Handle error
      const errorText = await response.text();
      console.error(`[ElevenLabs] ❌ مفتاح ${currentKey.name} فشل: HTTP ${response.status}`);
      console.error(`[ElevenLabs] التفاصيل: ${errorText.substring(0, 300)}`);

      await logKeyUsage(currentKey.id, false, `HTTP ${response.status}: ${errorText.substring(0, 100)}`);

      // Check if we should permanently deactivate
      if (shouldDeactivateKey(response.status, errorText)) {
        console.warn(`[ElevenLabs] 🔒 تعطيل المفتاح ${currentKey.name} نهائياً`);
        
        await supabase
          .from("elevenlabs_keys")
          .update({ 
            is_active: false,
            deactivated_at: new Date().toISOString(),
            deactivation_reason: errorText.slice(0, 500)
          })
          .eq("id", currentKey.id);
          
        errors.push(`${currentKey.name}: محظور نهائياً (${errorText.slice(0, 50)})`);
        continue;
      }

      // Check if retryable - if yes, try next key
      if (isRetryableError(response.status, errorText)) {
        console.warn(`[ElevenLabs] ⚠️ خطأ قابل لإعادة المحاولة`);
        
        // إذا كان "unusual activity"، ضع المفتاح في cooldown
        if (errorText.toLowerCase().includes("detected_unusual_activity")) {
          console.warn(`[ElevenLabs] 🕐 وضع المفتاح ${currentKey.name} في فترة راحة 10 دقائق`);
          setKeyCooldown(currentKey.id, 10);
          errors.push(`${currentKey.name}: نشاط غير عادي (فترة راحة 10 دقائق)`);
        } else {
          errors.push(`${currentKey.name}: خطأ مؤقت (${response.status})`);
        }
        
        continue; // Try next key
      }

      // Non-retryable error (e.g., 400 bad request)
      errors.push(`${currentKey.name}: ${response.status} - ${errorText.slice(0, 100)}`);
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
      
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("ElevenLabs API error:")) {
        throw err;
      }
      
      // Network/timeout errors
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ElevenLabs] ⚠️ خطأ شبكة مع ${currentKey.name}: ${msg}`);
      
      await logKeyUsage(currentKey.id, false, `Network: ${msg.substring(0, 100)}`);
      
      errors.push(`${currentKey.name}: ${msg.substring(0, 100)}`);
      
      if (msg.includes("abort") || msg.includes("timeout")) {
        console.warn(`[ElevenLabs] ⏱️ انتهت المهلة - انتظار 2 ثانية`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      continue;
    }
  }

  // All keys exhausted
  const errorSummary = `فشلت جميع مفاتيح ElevenLabs (${maxRetries} محاولات):\n${errors.join("\n")}`;
  console.error(`[ElevenLabs] ❌❌❌ ${errorSummary}`);
  
  // إضافة رسالة مساعدة
  console.error("\n💡 الحلول المقترحة:");
  console.error("  1. انتظر 10-15 دقيقة ثم حاول مرة أخرى");
  console.error("  2. تحقق من لوحة ElevenLabs: https://elevenlabs.io/app/speech-synthesis");
  console.error("  3. قد تحتاج إلى التحقق من حسابك في ElevenLabs");
  console.error("  4. أضف مفاتيح إضافية لتوزيع الحمل\n");
  
  throw new Error(errorSummary);
}

// ===== VALIDATION =====

export async function validateElevenLabsKey(apiKey: string): Promise<{
  valid: boolean;
  characterCount?: number;
  characterLimit?: number;
  error?: string;
}> {
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/user", {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        valid: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const userData = await response.json();
    
    return {
      valid: true,
      characterCount: userData.subscription?.character_count || 0,
      characterLimit: userData.subscription?.character_limit || 0,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ===== REACTIVATE KEYS =====

export async function reactivateDeactivatedKeys(): Promise<number> {
  try {
    const { data: deactivatedKeys, error } = await supabase
      .from("elevenlabs_keys")
      .select("*")
      .eq("is_active", false);

    if (error || !deactivatedKeys || deactivatedKeys.length === 0) {
      return 0;
    }

    let reactivatedCount = 0;

    for (const key of deactivatedKeys) {
      console.log(`[ElevenLabs] 🔍 فحص المفتاح المعطل: ${key.name}`);
      
      const validation = await validateElevenLabsKey(key.api_key);
      
      if (validation.valid) {
        console.log(`[ElevenLabs] ✅ المفتاح ${key.name} صالح - إعادة التفعيل`);
        console.log(`[ElevenLabs] الحصة: ${validation.characterCount}/${validation.characterLimit}`);
        
        await supabase
          .from("elevenlabs_keys")
          .update({
            is_active: true,
            reactivated_at: new Date().toISOString(),
          })
          .eq("id", key.id);
          
        reactivatedCount++;
      } else {
        console.log(`[ElevenLabs] ❌ المفتاح ${key.name} لا يزال غير صالح: ${validation.error}`);
      }
    }

    return reactivatedCount;
  } catch (error) {
    console.error("[ElevenLabs] خطأ في إعادة تفعيل المفاتيح:", error);
    return 0;
  }
}

// ===== CLEAR COOLDOWNS (UTILITY) =====

/**
 * مسح جميع فترات الراحة (للصيانة)
 */
export function clearAllCooldowns(): void {
  keyCooldowns.clear();
  console.log("[ElevenLabs] 🔄 تم مسح جميع فترات الراحة");
}

/**
 * الحصول على حالة فترات الراحة
 */
export function getCooldownStatus(): Map<string, number> {
  return new Map(keyCooldowns);
}
