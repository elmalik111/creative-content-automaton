import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { generateVoiceoverScript, generateImagePrompts } from "../_shared/gemini.ts";
import { generateSpeech } from "../_shared/elevenlabs.ts";
import { generateImageWithFlux, startMergeWithFFmpeg } from "../_shared/huggingface.ts";

// =================================================================
// ⚠️  السبب الجذري للـ freeze:
//     processAIGeneration(...).catch(); return Response();
//     → Supabase يُغلق الـ worker بعد return → background task تموت!
//
// الحل: EdgeRuntime.waitUntil() يُبقي الـ worker حياً حتى اكتمال الـ task
// =================================================================

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

interface AIGenerateRequest { job_id: string; }
interface JobInputData {
  title: string;
  description: string;
  voice_type: string;
  scene_count: number;
  duration: number;
}
interface StepIds {
  scriptStep?: string;
  voiceStep?: string;
  imageStep?: string;
  mergeStep?: string;
  publishStep?: string;
}

// =================================================================
// DB HELPERS
// =================================================================
async function createJobStep(
  jobId: string, stepName: string, stepOrder: number
): Promise<string | undefined> {
  // upsert لتجنب duplicate error إذا استُدعيت الـ function مرتين
  const { data, error } = await supabase
    .from("job_steps")
    .upsert(
      { job_id: jobId, step_name: stepName, step_order: stepOrder, status: "pending" },
      { onConflict: "job_id,step_name", ignoreDuplicates: false }
    )
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`[AI-GEN] createJobStep(${stepName}) error:`, error.message);
    // جلب الـ id إذا كان موجوداً
    const { data: existing } = await supabase
      .from("job_steps").select("id")
      .eq("job_id", jobId).eq("step_name", stepName).maybeSingle();
    return existing?.id;
  }
  return data?.id;
}

async function updateJobStep(
  stepId: string | undefined, status: string,
  errorMessage?: string, outputData?: Record<string, unknown>
) {
  if (!stepId) return;
  const updates: Record<string, unknown> = { status };
  if (status === "processing")                         updates.started_at    = new Date().toISOString();
  if (status === "completed" || status === "failed")   updates.completed_at  = new Date().toISOString();
  if (errorMessage)  updates.error_message = errorMessage;
  if (outputData)    updates.output_data   = outputData;
  await supabase.from("job_steps").update(updates).eq("id", stepId);
}

async function updateJobProgress(jobId: string, progress: number, status?: string) {
  const update: Record<string, unknown> = { progress };
  if (status) update.status = status;
  await supabase.from("jobs").update(update).eq("id", jobId);
}

// =================================================================
// SERVE HANDLER
// =================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let jobId = "";
  try {
    const body: AIGenerateRequest = await req.json();
    jobId = body.job_id;

    if (!jobId) throw new Error("job_id مطلوب");

    // ── 1. تحديث status فوراً (في الـ serve handler، قبل أي شيء) ──
    await supabase.from("jobs")
      .update({ status: "processing", progress: 1 })
      .eq("id", jobId);
    console.log(`[AI-GEN] ✅ job ${jobId} → processing`);

    // ── 2. جلب تفاصيل المهمة ──────────────────────────────────────
    const { data: job, error: jobError } = await supabase
      .from("jobs").select("*").eq("id", jobId).single();
    if (jobError || !job) throw new Error(`Job not found: ${jobId}`);

    const inputData = job.input_data as JobInputData;

    // ── 3. إنشاء خطوات المهمة ────────────────────────────────────
    const steps: StepIds = {
      scriptStep:  await createJobStep(jobId, "script_generation", 1),
      voiceStep:   await createJobStep(jobId, "voice_generation",  2),
      imageStep:   await createJobStep(jobId, "image_generation",  3),
      mergeStep:   await createJobStep(jobId, "merge",             4),
      publishStep: await createJobStep(jobId, "publishing",        5),
    };
    console.log(`[AI-GEN] ✅ steps: ${JSON.stringify(steps)}`);

    // ── 4. تشغيل المعالجة مع waitUntil ───────────────────────────
    const task = processAIGeneration(jobId, inputData, job.source_url, steps);

    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // ✅ Supabase Deno Edge: يُبقي الـ worker حياً حتى اكتمال المعالجة
      EdgeRuntime.waitUntil(task);
      console.log("[AI-GEN] ✅ استخدام EdgeRuntime.waitUntil");
    } else {
      // Fallback: نتابع بدون ضمان (قد يُقتل قبل الاكتمال)
      task.catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[AI-GEN] ❌ task crash:", msg);
        supabase.from("jobs")
          .update({ status: "failed", error_message: msg })
          .eq("id", jobId).then(() => {});
      });
    }

    return new Response(
      JSON.stringify({ status: "processing", job_id: jobId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[AI-GEN] ❌ serve error:", error.message);

    if (jobId) {
      await supabase.from("jobs")
        .update({ status: "failed", error_message: error.message })
        .eq("id", jobId);
    }

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// =================================================================
// MAIN PROCESSING
// =================================================================
async function processAIGeneration(
  jobId: string,
  inputData: JobInputData,
  sourceUrl: string | null,
  steps: StepIds
) {
  try {
    await updateJobProgress(jobId, 5, "processing");
    console.log("[AI-GEN] === بدء المعالجة ===");

    // ── خطوة 1: السكريبت ─────────────────────────────────────────
    await updateJobStep(steps.scriptStep, "processing");
    console.log("[AI-GEN] 📝 توليد السكريبت...");
    const script = await generateVoiceoverScript(
      inputData.title, inputData.description, inputData.duration
    );
    console.log(`[AI-GEN] ✅ السكريبت (${script.length} حرف): ${script.slice(0, 100)}`);
    await updateJobStep(steps.scriptStep, "completed", undefined, { script });
    await updateJobProgress(jobId, 15);

    // ── خطوة 2: الصوت ───────────────────────────────────────────
    await updateJobStep(steps.voiceStep, "processing");
    console.log("[AI-GEN] 🎙️ توليد الصوت...");
    const voiceId = inputData.voice_type === "female_arabic"
      ? "EXAVITQu4vr4xnSDxMaL"   // Sarah
      : "onwK4e9ZLuTAKqWW03F9";  // Daniel

    const audioBuffer = await generateSpeech(script, voiceId);
    if (!audioBuffer) throw new Error("فشل توليد الصوت");

    const audioFileName = `${jobId}/audio.mp3`;
    const { error: audioUploadErr } = await supabase.storage
      .from("temp-files")
      .upload(audioFileName, audioBuffer, { contentType: "audio/mpeg", upsert: true });
    if (audioUploadErr) throw new Error(`فشل رفع الصوت: ${audioUploadErr.message}`);

    const { data: audioUrlData } = supabase.storage.from("temp-files").getPublicUrl(audioFileName);
    console.log(`[AI-GEN] ✅ الصوت: ${audioUrlData.publicUrl}`);
    await updateJobStep(steps.voiceStep, "completed", undefined, { audio_url: audioUrlData.publicUrl });
    await updateJobProgress(jobId, 35);

    // ── خطوة 3: الصور ───────────────────────────────────────────
    await updateJobStep(steps.imageStep, "processing");
    const sceneCount = Math.max(1, Math.min(inputData.scene_count || 3, 10));
    console.log(`[AI-GEN] 🖼️ طلب ${sceneCount} صور...`);

    const imagePrompts = await generateImagePrompts(script, sceneCount);
    console.log(`[AI-GEN] ✅ prompts (${imagePrompts.length}/${sceneCount}):`);
    imagePrompts.forEach((p, i) => console.log(`  [${i+1}] ${p}`));

    if (imagePrompts.length === 0) {
      throw new Error(`generateImagePrompts أرجع 0 prompts! sceneCount=${sceneCount}`);
    }

    await updateJobProgress(jobId, 40);
    const imageUrls: string[] = [];
    const progressPerImage = 30 / sceneCount;

    for (let i = 0; i < imagePrompts.length; i++) {
      const prompt = imagePrompts[i];
      console.log(`[AI-GEN] 🖼️ توليد صورة ${i+1}/${imagePrompts.length}`);
      console.log(`[AI-GEN]   prompt: ${prompt}`);

      let imageBuffer: ArrayBuffer;
      try {
        imageBuffer = await generateImageWithFlux(prompt);
      } catch (imgErr) {
        const msg = imgErr instanceof Error ? imgErr.message : String(imgErr);
        console.error(`[AI-GEN] ❌ فشل الصورة ${i+1}: ${msg}`);
        continue;
      }

      const imageFileName = `${jobId}/image_${i}.jpg`;
      const { error: imgUploadErr } = await supabase.storage
        .from("temp-files")
        .upload(imageFileName, imageBuffer, { contentType: "image/jpeg", upsert: true });

      if (imgUploadErr) {
        console.error(`[AI-GEN] ❌ فشل رفع الصورة ${i+1}:`, imgUploadErr.message);
        continue;
      }

      const { data: imgUrlData } = supabase.storage.from("temp-files").getPublicUrl(imageFileName);
      console.log(`[AI-GEN] ✅ صورة ${i+1}: ${imgUrlData.publicUrl}`);
      imageUrls.push(imgUrlData.publicUrl);
      await updateJobProgress(jobId, 40 + (i + 1) * progressPerImage);
    }

    if (imageUrls.length === 0) throw new Error("فشل توليد جميع الصور");

    await updateJobStep(steps.imageStep, "completed", undefined, { image_urls: imageUrls });
    await updateJobProgress(jobId, 75);

    // ── خطوة 4: الدمج ───────────────────────────────────────────
    await updateJobStep(steps.mergeStep, "processing");
    console.log("[AI-GEN] 🎬 بدء دمج الوسائط...");

    const mergeStart = await startMergeWithFFmpeg({
      images: imageUrls,
      audio: audioUrlData.publicUrl,
      output_format: "mp4",
    });
    console.log("[AI-GEN] merge start:", JSON.stringify(mergeStart));

    if (mergeStart.status === "failed") throw new Error(mergeStart.error || "فشل دمج الوسائط");

    if (mergeStart.output_url) {
      await updateJobStep(steps.mergeStep, "completed", undefined, { output_url: mergeStart.output_url });
      await updateJobStep(steps.publishStep, "completed", undefined, { video_url: mergeStart.output_url });
      await supabase.from("jobs")
        .update({ status: "completed", progress: 100, output_url: mergeStart.output_url })
        .eq("id", jobId);
      console.log(`[AI-GEN] ✅ اكتمل! ${mergeStart.output_url}`);
      return;
    }

    if (!mergeStart.job_id) throw new Error("لم يُرجع merge job_id");

    await updateJobStep(steps.mergeStep, "processing", undefined, {
      provider: "ffmpeg-space",
      provider_job_id: mergeStart.job_id,
      stage: "queued",
    });
    await updateJobProgress(jobId, 78);
    console.log(`[AI-GEN] ✅ merge queued: ${mergeStart.job_id}`);

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[AI-GEN] ❌ processAIGeneration error:", error.message);

    // تحديث أي step في processing إلى failed
    for (const stepId of Object.values(steps)) {
      if (!stepId) continue;
      const { data } = await supabase.from("job_steps")
        .select("status").eq("id", stepId).maybeSingle();
      if (data?.status === "processing") {
        await updateJobStep(stepId, "failed", error.message);
      }
    }

    await supabase.from("jobs")
      .update({ status: "failed", error_message: error.message })
      .eq("id", jobId);

    // إشعار Telegram
    if (sourceUrl?.startsWith("telegram:")) {
      const chatId = parseInt(sourceUrl.replace("telegram:", ""));
      await sendTelegramFailureNotification(chatId, jobId, error.message).catch(() => {});
    }
  }
}

// =================================================================
// TELEGRAM
// =================================================================
async function sendTelegramFailureNotification(chatId: number, jobId: string, error: string) {
  const { data: tokenSetting } = await supabase
    .from("settings").select("value").eq("key", "telegram_token").maybeSingle();
  if (!tokenSetting?.value) return;

  await fetch(`https://api.telegram.org/bot${tokenSetting.value}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `❌ فشل في إنشاء الفيديو\n\n🔴 رقم المهمة: ${jobId.slice(0, 8)}\n⚠️ الخطأ: ${error}\n\nحاول مرة أخرى.`,
      parse_mode: "HTML",
    }),
  });
}
