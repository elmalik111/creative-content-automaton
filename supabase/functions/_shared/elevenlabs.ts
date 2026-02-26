import { supabase } from "./supabase.ts";
interface ElevenLabsKey {
  id: string;
  api_key: string;
  name: string;
  usage_count: number;
  is_active: boolean;
}
// =================================================================
// COOLDOWN MAP — in-memory
// unusual_activity = مؤقت (10-120 دقيقة) لا يُعطّل المفتاح نهائياً
// =================================================================
const cooldownMap = new Map<string, number>(); // keyId → timestamp انتهاء الراحة
function isInCooldown(keyId: string): boolean {
  const until = cooldownMap.get(keyId);
  if (!until) return false;
  if (Date.now() >= until) { cooldownMap.delete(keyId); return false; }
  return true;
}
function setCooldown(keyId: string, minutes: number, name: string) {
  cooldownMap.set(keyId, Date.now() + minutes * 3_000);
  console.log(`[ElevenLabs] ⏳ cooldown ${minutes}د للمفتاح "${name}"`);
}
function cooldownMinutesLeft(keyId: string): number {
  const until = cooldownMap.get(keyId) ?? 0;
  return Math.ceil(Math.max(0, until - Date.now()) / 3_000);
}
// =================================================================
// FETCH ACTIVE KEYS — الأقل استخداماً أولاً
// =================================================================
async function getActiveKeys(): Promise<ElevenLabsKey[]> {
  const { data, error } = await supabase
    .from("elevenlabs_keys")
    .select("*")
    .eq("is_active", true)
    .order("usage_count", { ascending: true });
  if (error) { console.error("[ElevenLabs] DB error:", error); return []; }
  return (data || []) as ElevenLabsKey[];
}
// =================================================================
// ERROR CLASSIFIER
// =================================================================
type Action = "success" | "cooldown" | "skip" | "deactivate" | "fatal";
function classifyError(status: number, body: string): Action {
  const b = body.toLowerCase();
  // مفتاح منتهي نهائياً
  if (b.includes("invalid_api_key") || b.includes("api key is invalid")) return "deactivate";
  // حصة شهرية انتهت
  if (b.includes("quota_exceeded"))  return "deactivate";
  // نشاط غير عادي — مؤقت، راحة فقط
  if (b.includes("unusual_activity") || b.includes("detected_unusual")) return "cooldown";
  // rate limit
  if (status === 429) return "cooldown";
  // خطأ في البيانات (النص طويل جداً مثلاً) — لا فائدة من مفاتيح أخرى
  if (status === 400) return "fatal";
  // 401 أو 5xx — جرّب مفتاحاً آخر
  return "skip";
}
// =================================================================
// GENERATE SPEECH
// =================================================================
export async function generateSpeech(
  text: string,
  voiceId: string = "cgSgspJ2msm6clMCkdW9"
): Promise<ArrayBuffer | null> {
  const allKeys = await getActiveKeys();
  if (allKeys.length === 0)
    throw new Error("لا توجد مفاتيح ElevenLabs. أضف مفتاحاً من الإعدادات.");
  // فصل المتاح عن المحجوب مؤقتاً
  const ready    = allKeys.filter(k => !isInCooldown(k.id));
  const onHold   = allKeys.filter(k =>  isInCooldown(k.id));
  console.log(`[ElevenLabs] ${allKeys.length} مفتاح — ${ready.length} جاهز، ${onHold.length} في راحة مؤقتة`);
  if (ready.length === 0) {
    const mins = Math.min(...onHold.map(k => cooldownMinutesLeft(k.id)));
    throw new Error(
      `جميع المفاتيح في فترة راحة مؤقتة.\n` +
      `⏳ أقرب مفتاح جاهز خلال ${mins} دقيقة تقريباً.\n` +
      `(السبب الشائع: ElevenLabs يكتشف نشاطاً غير عادي ويفرض راحة تلقائية مؤقتة)`
    );
  }
  const errors: string[] = [];
  for (const key of ready) {
    console.log(`[ElevenLabs] جارٍ التجربة — مفتاح: "${key.name}"`);
    // تسجيل الاستخدام (non-blocking)
    supabase.from("elevenlabs_keys")
      .update({ usage_count: key.usage_count + 1, last_used_at: new Date().toISOString() })
      .eq("id", key.id).then(() => {});
    try {
      const res = await fetch(
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
              stability: 0.75,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true,
            },
          }),
        }
      );
      // ✅ ناجح
      if (res.ok) {
        const ctype = res.headers.get("content-type") ?? "";
        if (!ctype.includes("audio") && !ctype.includes("octet")) {
          const txt = await res.text().catch(() => "");
          errors.push(`${key.name}: استجابة غير صوتية — ${txt.slice(0, 80)}`);
          continue;
        }
        const buf = await res.arrayBuffer();
        if (buf.byteLength < 1000) {
          errors.push(`${key.name}: صوت فارغ (${buf.byteLength}B)`);
          continue;
        }
        console.log(`[ElevenLabs] ✅ "${key.name}" — ${(buf.byteLength/1024).toFixed(1)}KB`);
        return buf;
      }
      // ❌ خطأ من API
      const errBody = await res.text().catch(() => "");
      const action  = classifyError(res.status, errBody);
      console.error(`[ElevenLabs] ❌ "${key.name}" HTTP ${res.status} action=${action} | ${errBody.slice(0,100)}`);
      if (action === "deactivate") {
        await supabase.from("elevenlabs_keys").update({ is_active: false }).eq("id", key.id);
        errors.push(`${key.name}: مُعطَّل نهائياً (مفتاح منتهٍ أو حصة شهرية)`);
      } else if (action === "cooldown") {
        if (errBody.includes("unusual_activity") || errBody.includes("detected_unusual")) {
          errors.push(`${key.name}: نشاط غير عادي (ElevenLabs يحظر السيرفرات السحابية للحسابات المجانية. جرب الترقية لـ Starter)`);
        } else {
          setCooldown(key.id, 1, key.name); // قللنا المدة إلى دقيقة واحدة بدلاً من 10 دقائق
          errors.push(`${key.name}: ضغط طلبات — راحة 1 دقيقة`);
        }
      } else if (action === "fatal") {
        throw new Error(`[ElevenLabs] خطأ في البيانات (400): ${errBody.slice(0, 200)}`);
      } else {
        errors.push(`${key.name}: خطأ ${res.status} — جارٍ التجربة مع المفتاح التالي`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("[ElevenLabs] خطأ")) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${key.name}: ${msg}`);
    }
  }
  // كل المفاتيح الجاهزة فشلت، الانتقال للبديل المجاني (Edge TTS / Azure)
  console.log(`[ElevenLabs] فشلت جميع المفاتيح. جاري استخدام البديل المجاني (Microsoft Edge TTS)...`);
  try {
    const fallbackAudio = await generateEdgeTTS(text, voiceId);
    if (fallbackAudio) return fallbackAudio;
  } catch (fallbackErr) {
    console.error(`[Edge TTS Fallback] خطأ: ${fallbackErr}`);
  }
  const holdInfo = onHold.length > 0
    ? `\n(${onHold.length} مفاتيح في راحة مؤقتة، أقربها خلال ${Math.min(...onHold.map(k => cooldownMinutesLeft(k.id)))} دقيقة)`
    : "";
  throw new Error(
    `فشلت جميع مفاتيح ElevenLabs وفشل البديل المجاني:\n` +
    errors.join("\n") + holdInfo
  );
}
// =================================================================
// MICROSOFT EDGE TTS FALLBACK (Free Azure Neural Voices)
// =================================================================
async function generateEdgeTTS(text: string, originalVoiceId: string): Promise<ArrayBuffer | null> {
  // تحديد الصوت بناءً على معرف ElevenLabs التقريبي (ذكر أو أنثى)
  // EXAVITQu4vr4xnSDxMaL (أنثى) -> سلمى المصرية
  // onwK4e9ZLuTAKqWW03F9 (ذكر) -> حامد السعودي
  const voice = originalVoiceId === "EXAVITQu4vr4xnSDxMaL" ? "ar-EG-SalmaNeural" : "ar-SA-HamedNeural";
  
  console.log(`[Edge TTS] طلب صوت: ${voice}...`);
  
  // استخدام خدمة TTS مفتوحة توفر أصوات ميكروسوفت/أزور مجاناً
  // ملاحظة: هذه الخدمة قد تستغرق بضع ثوانٍ للرد
  const res = await fetch("https://api.tts.quest/v3/voiceover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text,
      voice: voice,
      format: "mp3",
    })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }
  const data = await res.json();
  if (!data.success || !data.data || !data.data.download_url) {
    throw new Error("لم يتم إرجاع رابط تحميل من الخدمة.");
  }
  // انتظر قليلاً حتى يتم إنشاء الملف (الخدمة تعطيه رابطاً قد لا يكون جاهزاً في نفس المللي ثانية)
  await new Promise(r => setTimeout(r, 2000));
  
  // تحميل الملف الصوتي من الرابط المُرجع
  const audioRes = await fetch(data.data.download_url);
  if (!audioRes.ok) throw new Error(`فشل تحميل الصوت من ${data.data.download_url}`);
  
  const buf = await audioRes.arrayBuffer();
  console.log(`[Edge TTS] ✅ ناجح — ${(buf.byteLength/1024).toFixed(1)}KB`);
  return buf;
}
// =================================================================
// getNextElevenLabsKey — للاستخدام الخارجي
// =================================================================
export async function getNextElevenLabsKey(): Promise<{ key: string; keyId: string } | null> {
  const keys = await getActiveKeys();
  const key  = keys.find(k => !isInCooldown(k.id));
  if (!key) return null;
  await supabase.from("elevenlabs_keys")
    .update({ usage_count: key.usage_count + 1, last_used_at: new Date().toISOString() })
    .eq("id", key.id);
  return { key: key.api_key, keyId: key.id };
}
