import { supabase } from "./supabase.ts";

interface ElevenLabsKey {
  id: string;
  api_key: string;
  name: string;
  usage_count: number;
  is_active: boolean;
  cooldown_until: string | null;
  consecutive_failures: number | null;
}

// =================================================================
// COOLDOWN MAP — in-memory (مؤقت داخل نفس instance)
// =================================================================
const cooldownMap = new Map<string, number>(); // keyId -> unix ms

function isRuntimeCooldownActive(keyId: string): boolean {
  const until = cooldownMap.get(keyId);
  if (!until) return false;
  if (Date.now() >= until) {
    cooldownMap.delete(keyId);
    return false;
  }
  return true;
}

function setRuntimeCooldown(keyId: string, minutes: number, name: string) {
  cooldownMap.set(keyId, Date.now() + minutes * 60_000);
  console.log(`[ElevenLabs] ⏳ runtime cooldown ${minutes}د للمفتاح "${name}"`);
}

function runtimeCooldownMinutesLeft(keyId: string): number {
  const until = cooldownMap.get(keyId) ?? 0;
  return Math.ceil(Math.max(0, until - Date.now()) / 60_000);
}

function dbCooldownMinutesLeft(cooldownUntil: string | null): number {
  if (!cooldownUntil) return 0;
  const until = new Date(cooldownUntil).getTime();
  if (Number.isNaN(until)) return 0;
  return Math.ceil(Math.max(0, until - Date.now()) / 60_000);
}

function isDbCooldownActive(cooldownUntil: string | null): boolean {
  if (!cooldownUntil) return false;
  const until = new Date(cooldownUntil).getTime();
  if (Number.isNaN(until)) return false;
  return until > Date.now();
}

function getCooldownUntilIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function cleanupExpiredCooldowns(): Promise<void> {
  try {
    await supabase.rpc("cleanup_expired_cooldowns");
  } catch (err) {
    console.warn("[ElevenLabs] cleanup_expired_cooldowns failed:", err);
  }
}

// =================================================================
// FETCH ACTIVE KEYS — الأقل استخداماً أولاً + احترام cooldown_until
// =================================================================
async function getActiveKeys(): Promise<ElevenLabsKey[]> {
  await cleanupExpiredCooldowns();

  const { data, error } = await supabase
    .from("elevenlabs_keys")
    .select("id, api_key, name, usage_count, is_active, cooldown_until, consecutive_failures")
    .eq("is_active", true)
    .order("usage_count", { ascending: true });

  if (error) {
    console.error("[ElevenLabs] DB error:", error);
    return [];
  }

  return (data || []) as ElevenLabsKey[];
}

async function markKeySuccess(key: ElevenLabsKey): Promise<void> {
  await supabase
    .from("elevenlabs_keys")
    .update({
      usage_count: (key.usage_count || 0) + 1,
      last_used_at: new Date().toISOString(),
      last_validation_at: new Date().toISOString(),
      cooldown_until: null,
      consecutive_failures: 0,
    })
    .eq("id", key.id);
}

async function markKeyCooldown(
  key: ElevenLabsKey,
  minutes: number,
  reason: string,
): Promise<void> {
  setRuntimeCooldown(key.id, minutes, key.name);

  await supabase
    .from("elevenlabs_keys")
    .update({
      cooldown_until: getCooldownUntilIso(minutes),
      last_validation_at: new Date().toISOString(),
      consecutive_failures: (key.consecutive_failures || 0) + 1,
      deactivation_reason: reason.slice(0, 200),
    })
    .eq("id", key.id);
}

async function markKeyDeactivated(key: ElevenLabsKey, reason: string): Promise<void> {
  await supabase
    .from("elevenlabs_keys")
    .update({
      is_active: false,
      deactivated_at: new Date().toISOString(),
      deactivation_reason: reason.slice(0, 200),
      last_validation_at: new Date().toISOString(),
      consecutive_failures: (key.consecutive_failures || 0) + 1,
    })
    .eq("id", key.id);
}

// =================================================================
// ERROR CLASSIFIER
// =================================================================
type Action = "success" | "cooldown" | "skip" | "deactivate" | "fatal";

function classifyError(status: number, body: string): Action {
  const b = body.toLowerCase();

  // مفتاح منتهي/غير صالح نهائياً
  if (b.includes("invalid_api_key") || b.includes("api key is invalid")) return "deactivate";

  // حصة منتهية
  if (b.includes("quota_exceeded")) return "deactivate";

  // نشاط غير عادي أو ضغط طلبات
  if (b.includes("unusual_activity") || b.includes("detected_unusual")) return "cooldown";
  if (status === 429) return "cooldown";

  // نص/مدخلات غير صالحة
  if (status === 400) return "fatal";

  // 401/403/5xx: جرب مفتاح آخر
  return "skip";
}

// =================================================================
// RANDOM DELAY — تقليل احتمال الحظر
// =================================================================
function randomDelay(): Promise<void> {
  const ms = 1000 + Math.random() * 2000; // 1-3s
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =================================================================
// HF TTS FALLBACK (حل نهائي عند حظر ElevenLabs)
// =================================================================
const HF_TTS_MODELS = [
  "facebook/mms-tts-ara",
  "suno/bark-small",
];

function getHfTokens(): string[] {
  const tokens = [
    Deno.env.get("HF_KEY_PRIMARY") || "",
    Deno.env.get("HF_KEY_SECONDARY") || "",
    Deno.env.get("HF_READ_TOKEN") || "",
  ].filter((t) => !!t.trim());

  return [...new Set(tokens)];
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function requestHfTts(model: string, token: string, text: string): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(
      `https://router.huggingface.co/hf-inference/models/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "audio/mpeg,audio/wav,audio/*,*/*",
        },
        body: JSON.stringify({ inputs: text }),
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`HF ${model} HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();

    if (contentType.includes("audio") || contentType.includes("octet")) {
      const audio = await response.arrayBuffer();
      if (audio.byteLength < 1000) {
        throw new Error(`HF ${model}: audio too small (${audio.byteLength}B)`);
      }
      return audio;
    }

    // بعض النماذج قد تعيد JSON فيه base64
    const raw = await response.text();
    try {
      const parsed = JSON.parse(raw);
      const b64 = parsed?.audio || parsed?.audio_base64 || parsed?.data?.audio;
      if (typeof b64 === "string" && b64.length > 100) {
        const audio = base64ToArrayBuffer(b64);
        if (audio.byteLength < 1000) {
          throw new Error(`HF ${model}: base64 audio too small (${audio.byteLength}B)`);
        }
        return audio;
      }
      throw new Error(`HF ${model}: non-audio response`);
    } catch {
      throw new Error(`HF ${model}: unexpected response (${raw.slice(0, 180)})`);
    }
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`HF ${model}: timeout`);
    }
    throw err;
  }
}

async function generateSpeechWithHfFallback(text: string): Promise<ArrayBuffer | null> {
  const tokens = getHfTokens();
  if (tokens.length === 0) {
    console.warn("[ElevenLabs] لا يوجد HF token متاح لـ fallback");
    return null;
  }

  const sanitizedText = text.slice(0, 1200).trim();
  const errors: string[] = [];

  for (const token of tokens) {
    for (const model of HF_TTS_MODELS) {
      try {
        console.log(`[HF-TTS] محاولة fallback بالموديل: ${model}`);
        const audio = await requestHfTts(model, token, sanitizedText);
        console.log(`[HF-TTS] ✅ نجاح fallback (${(audio.byteLength / 1024).toFixed(1)}KB)`);
        return audio;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        console.warn(`[HF-TTS] فشل ${model}: ${msg}`);
      }
    }
  }

  throw new Error(`HF fallback failed:\n${errors.join("\n")}`);
}

// =================================================================
// GENERATE SPEECH — ElevenLabs أولاً ثم HF fallback
// =================================================================
export async function generateSpeech(
  text: string,
  voiceId: string = "cgSgspJ2msm6clMCkdW9",
): Promise<ArrayBuffer | null> {
  const allKeys = await getActiveKeys();

  if (allKeys.length === 0) {
    const fallback = await generateSpeechWithHfFallback(text);
    if (fallback) return fallback;
    throw new Error("لا توجد مفاتيح ElevenLabs نشطة ولا يوجد مزود بديل متاح.");
  }

  const ready = allKeys.filter((k) => !isRuntimeCooldownActive(k.id) && !isDbCooldownActive(k.cooldown_until));
  const onHold = allKeys.filter((k) => !ready.some((r) => r.id === k.id));

  console.log(`[ElevenLabs] ${allKeys.length} مفتاح — ${ready.length} جاهز، ${onHold.length} في راحة مؤقتة`);

  const errors: string[] = [];

  for (const key of ready) {
    console.log(`[ElevenLabs] جارٍ التجربة — مفتاح: "${key.name}"`);
    await randomDelay();

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": key.api_key,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true,
            },
          }),
        },
      );

      if (res.ok) {
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("audio") && !contentType.includes("octet")) {
          const txt = await res.text().catch(() => "");
          errors.push(`${key.name}: استجابة غير صوتية — ${txt.slice(0, 80)}`);
          continue;
        }

        const buffer = await res.arrayBuffer();
        if (buffer.byteLength < 1000) {
          errors.push(`${key.name}: صوت فارغ (${buffer.byteLength}B)`);
          continue;
        }

        await markKeySuccess(key);
        cooldownMap.delete(key.id);
        console.log(`[ElevenLabs] ✅ "${key.name}" — ${(buffer.byteLength / 1024).toFixed(1)}KB`);
        return buffer;
      }

      const errBody = await res.text().catch(() => "");
      const action = classifyError(res.status, errBody);
      console.error(`[ElevenLabs] ❌ "${key.name}" HTTP ${res.status} action=${action} | ${errBody.slice(0, 120)}`);

      if (action === "deactivate") {
        await markKeyDeactivated(key, errBody);
        errors.push(`${key.name}: مُعطَّل نهائياً (مفتاح غير صالح/حصة منتهية)`);
      } else if (action === "cooldown") {
        const lower = errBody.toLowerCase();
        const unusual = lower.includes("unusual_activity") || lower.includes("detected_unusual");
        const cooldownMins = unusual ? 30 : 2;
        await markKeyCooldown(key, cooldownMins, errBody);
        errors.push(`${key.name}: ${unusual ? "نشاط غير عادي" : "ضغط طلبات"} — راحة ${cooldownMins} دقيقة`);
      } else if (action === "fatal") {
        throw new Error(`[ElevenLabs] خطأ بيانات (400): ${errBody.slice(0, 200)}`);
      } else {
        await supabase
          .from("elevenlabs_keys")
          .update({
            last_validation_at: new Date().toISOString(),
            consecutive_failures: (key.consecutive_failures || 0) + 1,
          })
          .eq("id", key.id);

        errors.push(`${key.name}: خطأ ${res.status} — جارٍ التجربة مع المفتاح التالي`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("[ElevenLabs] خطأ")) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${key.name}: ${msg}`);
    }
  }

  // إذا كل مفاتيح ElevenLabs فشلت أو كانت في cooldown → fallback تلقائي
  try {
    console.warn("[ElevenLabs] محاولة fallback إلى HF-TTS...");
    const fallbackAudio = await generateSpeechWithHfFallback(text);
    if (fallbackAudio) return fallbackAudio;
  } catch (fallbackErr) {
    const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    errors.push(`HF fallback: ${fallbackMsg}`);
  }

  const holdInfo = onHold.length > 0
    ? `\n(${onHold.length} مفاتيح في راحة مؤقتة، أقربها خلال ${Math.min(...onHold.map((k) => {
      const runtimeMins = isRuntimeCooldownActive(k.id) ? runtimeCooldownMinutesLeft(k.id) : 0;
      const dbMins = dbCooldownMinutesLeft(k.cooldown_until);
      const mins = [runtimeMins, dbMins].filter((n) => n > 0);
      return mins.length ? Math.min(...mins) : 0;
    }))} دقيقة)`
    : "";

  throw new Error(`فشلت جميع محاولات توليد الصوت:\n${errors.join("\n")}${holdInfo}`);
}

// =================================================================
// getNextElevenLabsKey — للاستخدام الخارجي
// =================================================================
export async function getNextElevenLabsKey(): Promise<{ key: string; keyId: string } | null> {
  const keys = await getActiveKeys();
  const key = keys.find((k) => !isRuntimeCooldownActive(k.id) && !isDbCooldownActive(k.cooldown_until));
  if (!key) return null;

  await supabase
    .from("elevenlabs_keys")
    .update({
      usage_count: (key.usage_count || 0) + 1,
      last_used_at: new Date().toISOString(),
      last_validation_at: new Date().toISOString(),
    })
    .eq("id", key.id);

  return { key: key.api_key, keyId: key.id };
}
