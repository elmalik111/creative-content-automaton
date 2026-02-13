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
 * Determine whether an error should permanently deactivate the key.
 */
function shouldDeactivateKey(status: number, errorText: string): boolean {
  const lower = errorText.toLowerCase();
  // detected_unusual_activity = مؤقت لا يُعطّل المفتاح
  return (
    lower.includes("invalid_api_key") ||
    lower.includes("api key is invalid") ||
    (status === 401 && lower.includes("quota_exceeded"))
  );
}

/**
 * Determine whether the error is retryable with a different key.
 */
function isRetryableError(status: number, errorText: string): boolean {
  // 401 without permanent block = try another key
  if (status === 401) return true;
  // Server errors = transient
  if (status >= 500) return true;
  // Rate limiting
  if (status === 429) return true;
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
              stability: 0.65,
              similarity_boost: 0.82,
              style: 0.40,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (response.ok) {
        const cType = response.headers.get("content-type") || "";
        if (!cType.includes("audio") && !cType.includes("octet-stream")) {
          const bodyText = await response.text().catch(() => "");
          console.error(`[ElevenLabs] ❌ غير صوتي من ${currentKey.name}: ${bodyText.slice(0,100)}`);
          errors.push(`${currentKey.name}: غير صوتي`);
          continue;
        }
        const audioBuffer = await response.arrayBuffer();
        if (audioBuffer.byteLength < 1000) {
          errors.push(`${currentKey.name}: فارغ (${audioBuffer.byteLength}B)`);
          continue;
        }
        console.log(`[ElevenLabs] ✅ ${currentKey.name} (${(audioBuffer.byteLength/1024).toFixed(1)}KB)`);
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
