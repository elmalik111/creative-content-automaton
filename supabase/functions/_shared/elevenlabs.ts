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
 * Reactivate a specific key (useful if it was deactivated by mistake)
 */
export async function reactivateKey(keyId: string): Promise<void> {
  const { error } = await supabase
    .from("elevenlabs_keys")
    .update({ is_active: true })
    .eq("id", keyId);

  if (error) {
    console.error("Error reactivating key:", error);
    throw error;
  }
  
  console.log(`✅ Key ${keyId} has been reactivated`);
}

/**
 * Reactivate all deactivated keys (use with caution!)
 */
export async function reactivateAllKeys(): Promise<void> {
  const { error } = await supabase
    .from("elevenlabs_keys")
    .update({ is_active: true })
    .eq("is_active", false);

  if (error) {
    console.error("Error reactivating keys:", error);
    throw error;
  }
  
  console.log(`✅ All keys have been reactivated`);
}

/**
 * Determine whether an error should permanently deactivate the key.
 */
function shouldDeactivateKey(status: number, errorText: string): boolean {
  const lower = errorText.toLowerCase();
  
  // Only deactivate on VERY specific permanent errors
  const isPermanentError = (
    // Invalid API key - must have explicit "invalid" message
    (status === 401 && (
      lower.includes("invalid_api_key") ||
      lower.includes("invalid api key") ||
      lower.includes("api key is invalid") ||
      (lower.includes("unauthorized") && lower.includes("invalid"))
    )) ||
    // Account suspended or unusual activity
    lower.includes("detected_unusual_activity") ||
    lower.includes("account suspended") ||
    lower.includes("account has been suspended")
  );
  
  // Log deactivation decision for debugging
  if (isPermanentError) {
    console.warn(`[shouldDeactivateKey] 🔒 سيتم تعطيل المفتاح - Status: ${status}, Error: ${errorText.slice(0, 200)}`);
  } else {
    console.log(`[shouldDeactivateKey] ✓ لن يتم تعطيل المفتاح - Status: ${status}`);
  }
  
  return isPermanentError;
}

/**
 * Determine whether the error is retryable with a different key.
 */
function isRetryableError(status: number, errorText: string): boolean {
  const lower = errorText.toLowerCase();
  
  // Rate limiting - definitely retry with next key
  if (status === 429) return true;
  
  // Quota exceeded - try next key (DON'T deactivate permanently!)
  if (lower.includes("quota_exceeded") || 
      lower.includes("quota exceeded") ||
      lower.includes("insufficient quota") ||
      lower.includes("character limit")) return true;
  
  // Server errors - transient issues
  if (status >= 500) return true;
  
  // 401 errors that DON'T explicitly say "invalid" - could be temporary
  if (status === 401 && !lower.includes("invalid")) return true;
  
  return false;
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

  console.log(`Using ElevenLabs key: ${selectedKey.name} (usage: ${selectedKey.usage_count + 1})`);

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
    console.log(`[ElevenLabs] محاولة ${i + 1}/${maxRetries} - مفتاح: ${currentKey.name}`);

    try {
      // Increment usage
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
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.5,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (response.ok) {
        const audioBuffer = await response.arrayBuffer();
        console.log(`[ElevenLabs] ✅ نجح مع مفتاح ${currentKey.name}, حجم: ${audioBuffer.byteLength}`);
        return audioBuffer;
      }

      // Handle error
      const errorText = await response.text();
      console.error(`[ElevenLabs] ❌ مفتاح ${currentKey.name} فشل: HTTP ${response.status} - ${errorText}`);

      // Should we permanently deactivate this key?
      if (shouldDeactivateKey(response.status, errorText)) {
        console.warn(`[ElevenLabs] 🔒 تعطيل المفتاح ${currentKey.name} نهائياً: ${errorText.slice(0, 100)}`);
        await supabase
          .from("elevenlabs_keys")
          .update({ is_active: false })
          .eq("id", currentKey.id);
        errors.push(`${currentKey.name}: محظور نهائياً`);
        continue; // Try next key
      }

      // Retryable error? Try next key without deactivating
      if (isRetryableError(response.status, errorText)) {
        errors.push(`${currentKey.name}: خطأ مؤقت (${response.status})`);
        continue; // Try next key
      }

      // Non-retryable, non-permanent error (e.g. 400 bad request)
      errors.push(`${currentKey.name}: ${response.status} - ${errorText.slice(0, 100)}`);
      throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("ElevenLabs API error:")) {
        throw err; // Re-throw non-retryable errors
      }
      // Network errors etc. – try next key
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ElevenLabs] ⚠️ خطأ شبكة مع ${currentKey.name}: ${msg}`);
      errors.push(`${currentKey.name}: ${msg}`);
      continue;
    }
  }

  // All keys exhausted
  throw new Error(
    `فشلت جميع مفاتيح ElevenLabs (${maxRetries} محاولات):\n${errors.join("\n")}`
  );
}
