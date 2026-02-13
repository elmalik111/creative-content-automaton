import { supabase } from "./supabase.ts";

interface ElevenLabsKey {
  id: string;
  api_key: string;
  name: string;
  usage_count: number;
  is_active: boolean;
  last_used_at?: string;
}

async function getActiveKeys(): Promise<ElevenLabsKey[]> {
  const { data: keys, error } = await supabase
    .from("elevenlabs_keys")
    .select("*")
    .eq("is_active", true)
    .order("usage_count", { ascending: true });
  if (error) { console.error("[ElevenLabs] خطأ في جلب المفاتيح:", error); return []; }
  return (keys || []) as ElevenLabsKey[];
}

// فقط أخطاء مؤكدة وغير قابلة للتعافي = تعطيل نهائي
function shouldDeactivateKey(status: number, errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return (
    lower.includes("invalid_api_key") ||
    lower.includes("api key is invalid") ||
    (status === 401 && lower.includes("quota_exceeded"))
  );
  // لا نُعطّل عند: detected_unusual_activity (مؤقت), 429 (rate limit), 500 (سيرفر)
  // detected_unusual_activity يُرفع عادةً لساعة ثم يُرفع تلقائياً
}

function isRetryableWithOtherKey(status: number): boolean {
  return status === 401 || status === 429 || status >= 500;
}

export async function getNextElevenLabsKey(): Promise<{ key: string; keyId: string } | null> {
  const keys = await getActiveKeys();
  if (keys.length === 0) return null;
  const selectedKey = keys[0];
  await supabase.from("elevenlabs_keys")
    .update({ usage_count: selectedKey.usage_count + 1, last_used_at: new Date().toISOString() })
    .eq("id", selectedKey.id);
  return { key: selectedKey.api_key, keyId: selectedKey.id };
}

export async function generateSpeech(
  text: string,
  voiceId: string = "onwK4e9ZLuTAKqWW03F9"
): Promise<ArrayBuffer | null> {

  const keys = await getActiveKeys();
  if (keys.length === 0) {
    throw new Error("لا توجد مفاتيح ElevenLabs نشطة. أضف مفتاحاً من الإعدادات.");
  }

  const maxTries = Math.min(keys.length, 3);
  const errors: string[] = [];

  for (let i = 0; i < maxTries; i++) {
    const key = keys[i];
    console.log(`[ElevenLabs] محاولة ${i + 1}/${maxTries} - مفتاح: ${key.name}`);

    try {
      // تحديث usage (non-blocking)
      supabase.from("elevenlabs_keys").update({
        usage_count: key.usage_count + 1,
        last_used_at: new Date().toISOString(),
      }).eq("id", key.id).then(() => {});

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": key.api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.65,
              similarity_boost: 0.80,
              style: 0.45,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (response.ok) {
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("audio") && !contentType.includes("octet-stream")) {
          const bodyText = await response.text();
          errors.push(`${key.name}: استجابة غير صوتية (${contentType}): ${bodyText.slice(0, 80)}`);
          continue;
        }
        const audioBuffer = await response.arrayBuffer();
        if (audioBuffer.byteLength < 1000) {
          errors.push(`${key.name}: صوت فارغ (${audioBuffer.byteLength} bytes)`);
          continue;
        }
        console.log(`[ElevenLabs] ✅ نجح مع ${key.name} (${(audioBuffer.byteLength/1024).toFixed(1)}KB)`);
        return audioBuffer;
      }

      const errorText = await response.text().catch(() => "");
      console.error(`[ElevenLabs] ❌ ${key.name}: HTTP ${response.status} - ${errorText.slice(0, 150)}`);

      if (shouldDeactivateKey(response.status, errorText)) {
        console.warn(`[ElevenLabs] 🔒 تعطيل ${key.name} نهائياً`);
        await supabase.from("elevenlabs_keys").update({ is_active: false }).eq("id", key.id);
        errors.push(`${key.name}: مُعطَّل نهائياً (${response.status})`);
        continue;
      }

      if (isRetryableWithOtherKey(response.status)) {
        errors.push(`${key.name}: خطأ مؤقت ${response.status} - سيُجرب مفتاح آخر`);
        continue;
      }

      // 400 = مشكلة في البيانات - لا فائدة من تجربة مفاتيح أخرى
      throw new Error(`[ElevenLabs] خطأ ${response.status}: ${errorText.slice(0, 200)}`);

    } catch (err) {
      if (err instanceof Error && err.message.startsWith("[ElevenLabs] خطأ ")) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${key.name}: ${msg}`);
    }
  }

  throw new Error(`[ElevenLabs] فشل (${maxTries} مفاتيح):\n${errors.join("\n")}`);
}
