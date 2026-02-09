import { supabase } from "./supabase.ts";

interface ElevenLabsKey {
  id: string;
  api_key: string;
  name: string;
  usage_count: number;
  is_active: boolean;
}

/**
 * Fetch all active ElevenLabs keys ordered by usage (least used first).
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

  return (keys || []) as ElevenLabsKey[];
}

/**
 * تحديد ما إذا كان الخطأ يستوجب تعطيل المفتاح نهائياً
 * تم تحسين المنطق لتجنب التعطيل الخاطئ
 */
function shouldDeactivateKey(status: number, errorText: string): boolean {
  const lower = errorText.toLowerCase();
  
  // فقط عطّل في حالات محددة جداً:
  // 1. نشاط غير عادي مكتشف صراحة
  if (lower.includes("detected_unusual_activity")) {
    console.warn("[ElevenLabs] 🔒 نشاط غير عادي مكتشف - تعطيل المفتاح");
    return true;
  }
  
  // 2. المفتاح غير صالح بوضوح (ليس خطأ في الرصيد)
  if (lower.includes("invalid_api_key") || lower.includes("invalid api key")) {
    console.warn("[ElevenLabs] 🔒 مفتاح API غير صالح - تعطيل المفتاح");
    return true;
  }
  
  // 3. تم إلغاء الاشتراك أو حظر الحساب
  if (lower.includes("subscription") && lower.includes("cancel")) {
    console.warn("[ElevenLabs] 🔒 الاشتراك ملغى - تعطيل المفتاح");
    return true;
  }
  
  // ⚠️ لا تعطّل في حالة نفاد الحصة - قد تكون مؤقتة
  if (lower.includes("quota") || lower.includes("limit")) {
    console.warn("[ElevenLabs] ⚠️ تحذير: نفاد الحصة - لن يتم التعطيل (قد تكون حصة شهرية)");
    return false;
  }
  
  return false;
}

/**
 * تحديد ما إذا كان الخطأ يمكن المحاولة مرة أخرى مع مفتاح آخر
 */
function isRetryableError(status: number, errorText: string): boolean {
  const lower = errorText.toLowerCase();
  
  // أخطاء الحصة/الحد - حاول مع مفتاح آخر
  if (lower.includes("quota") || lower.includes("limit") || lower.includes("rate")) {
    return true;
  }
  
  // 401 - قد يكون خطأ مؤقت أو مفتاح غير صالح
  if (status === 401) {
    return true;
  }
  
  // 429 - تجاوز الحد - حاول مع مفتاح آخر
  if (status === 429) {
    return true;
  }
  
  // أخطاء الخادم - مؤقتة
  if (status >= 500) {
    return true;
  }
  
  // خطأ في الشبكة أو الاتصال
  if (lower.includes("network") || lower.includes("connection") || lower.includes("timeout")) {
    return true;
  }
  
  return false;
}

/**
 * تسجيل معلومات استخدام المفتاح في قاعدة البيانات
 */
async function logKeyUsage(keyId: string, success: boolean, errorMessage?: string) {
  try {
    await supabase.from("elevenlabs_key_logs").insert({
      key_id: keyId,
      success: success,
      error_message: errorMessage,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[ElevenLabs] فشل تسجيل استخدام المفتاح:", error);
  }
}

export async function getNextElevenLabsKey(): Promise<{ key: string; keyId: string } | null> {
  const keys = await getActiveKeys();
  if (keys.length === 0) return null;

  const selectedKey = keys[0];

  // Increment usage count
  await supabase
    .from("elevenlabs_keys")
    .update({
      usage_count: selectedKey.usage_count + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", selectedKey.id);

  console.log(`[ElevenLabs] 🔑 استخدام المفتاح: ${selectedKey.name} (مرات الاستخدام: ${selectedKey.usage_count + 1})`);

  return {
    key: selectedKey.api_key,
    keyId: selectedKey.id,
  };
}

export async function generateSpeech(
  text: string,
  voiceId: string = "onwK4e9ZLuTAKqWW03F9" // Daniel - Arabic-friendly voice
): Promise<ArrayBuffer | null> {
  const keys = await getActiveKeys();

  if (keys.length === 0) {
    throw new Error("لا توجد مفاتيح ElevenLabs نشطة. أضف مفتاحاً جديداً من الإعدادات.");
  }

  const maxRetries = Math.min(keys.length, 3);
  const errors: string[] = [];

  for (let i = 0; i < maxRetries; i++) {
    const currentKey = keys[i];
    console.log(`[ElevenLabs] 🔄 محاولة ${i + 1}/${maxRetries} - مفتاح: ${currentKey.name}`);

    try {
      // Increment usage BEFORE making the request
      await supabase
        .from("elevenlabs_keys")
        .update({
          usage_count: currentKey.usage_count + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", currentKey.id);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

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
        
        // تسجيل النجاح
        await logKeyUsage(currentKey.id, true);
        
        return audioBuffer;
      }

      // Handle error response
      const errorText = await response.text();
      console.error(`[ElevenLabs] ❌ مفتاح ${currentKey.name} فشل: HTTP ${response.status}`);
      console.error(`[ElevenLabs] رسالة الخطأ: ${errorText.substring(0, 200)}`);

      // تسجيل الفشل
      await logKeyUsage(currentKey.id, false, `HTTP ${response.status}: ${errorText.substring(0, 100)}`);

      // Should we permanently deactivate this key?
      if (shouldDeactivateKey(response.status, errorText)) {
        console.warn(`[ElevenLabs] 🔒 تعطيل المفتاح ${currentKey.name} نهائياً`);
        console.warn(`[ElevenLabs] السبب: ${errorText.slice(0, 200)}`);
        
        await supabase
          .from("elevenlabs_keys")
          .update({ 
            is_active: false,
            deactivated_at: new Date().toISOString(),
            deactivation_reason: errorText.slice(0, 500)
          })
          .eq("id", currentKey.id);
          
        errors.push(`${currentKey.name}: محظور نهائياً (${errorText.slice(0, 50)})`);
        continue; // Try next key
      }

      // Retryable error? Try next key without deactivating
      if (isRetryableError(response.status, errorText)) {
        console.warn(`[ElevenLabs] ⚠️ خطأ قابل لإعادة المحاولة مع ${currentKey.name}`);
        errors.push(`${currentKey.name}: خطأ مؤقت (${response.status})`);
        continue; // Try next key
      }

      // Non-retryable, non-permanent error (e.g. 400 bad request)
      console.error(`[ElevenLabs] ⛔ خطأ غير قابل لإعادة المحاولة: ${response.status}`);
      errors.push(`${currentKey.name}: ${response.status} - ${errorText.slice(0, 100)}`);
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
      
    } catch (err) {
      // إذا كان خطأ من النوع ElevenLabs API error، أعد رميه
      if (err instanceof Error && err.message.startsWith("ElevenLabs API error:")) {
        throw err;
      }
      
      // Network errors, timeout, etc. – try next key
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ElevenLabs] ⚠️ خطأ شبكة مع ${currentKey.name}: ${msg}`);
      
      // تسجيل خطأ الشبكة
      await logKeyUsage(currentKey.id, false, `Network error: ${msg.substring(0, 100)}`);
      
      errors.push(`${currentKey.name}: ${msg.substring(0, 100)}`);
      
      // إذا كان timeout، أعط وقتاً إضافياً قبل المحاولة التالية
      if (msg.includes("abort") || msg.includes("timeout")) {
        console.warn(`[ElevenLabs] ⏱️ انتهت المهلة - انتظار 2 ثانية قبل المحاولة التالية`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      continue;
    }
  }

  // All keys exhausted
  const errorSummary = `فشلت جميع مفاتيح ElevenLabs (${maxRetries} محاولات):\n${errors.join("\n")}`;
  console.error(`[ElevenLabs] ❌❌❌ ${errorSummary}`);
  
  throw new Error(errorSummary);
}

/**
 * وظيفة جديدة: التحقق من صحة المفتاح بدون استهلاك الحصة
 */
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

/**
 * وظيفة جديدة: إعادة تفعيل المفاتيح المعطلة خطأً
 */
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
