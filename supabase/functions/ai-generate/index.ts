import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { generateVoiceoverScript, generateImagePrompts } from "../_shared/gemini.ts";
import { generateSpeech } from "../_shared/elevenlabs.ts";
import { generateImageWithFlux } from "../_shared/huggingface.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

interface JobInputData {
  title: string;
  description: string;
  voice_type: string;
  scene_count: number;  // أي رقم من 3 إلى 20
  duration: number;
}
interface StepIds {
  scriptStep?: string;
  voiceStep?: string;
  imageStep?: string;
  mergeStep?: string;
  publishStep?: string;
}

async function createJobStep(jobId: string, stepName: string, stepOrder: number): Promise<string | undefined> {
  const { data, error } = await supabase.from("job_steps")
    .upsert(
      { job_id: jobId, step_name: stepName, step_order: stepOrder, status: "pending" },
      { onConflict: "job_id,step_name" }
    ).select("id").maybeSingle();
  if (error) {
    const { data: ex } = await supabase.from("job_steps").select("id")
      .eq("job_id", jobId).eq("step_name", stepName).maybeSingle();
    return ex?.id;
  }
  return data?.id;
}

async function updateStep(id: string | undefined, status: string, err?: string, out?: Record<string, unknown>) {
  if (!id) return;
  const u: Record<string, unknown> = { status };
  if (status === "processing") u.started_at = new Date().toISOString();
  if (status === "completed" || status === "failed") u.completed_at = new Date().toISOString();
  if (err) u.error_message = err;
  if (out) u.output_data = out;
  await supabase.from("job_steps").update(u).eq("id", id);
}

async function updateProgress(jobId: string, progress: number, status?: string) {
  const u: Record<string, unknown> = { progress };
  if (status) u.status = status;
  await supabase.from("jobs").update(u).eq("id", jobId);
}

// =================================================================
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let jobId = "";
  try {
    const body = await req.json();
    jobId = body.job_id;
    if (!jobId) throw new Error("job_id مطلوب");

    console.log(`[AI-GEN] ▶ بدء: ${jobId}`);
    await supabase.from("jobs").update({ status: "processing", progress: 1 }).eq("id", jobId);

    const { data: job, error: jobErr } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    if (jobErr || !job) throw new Error(`المهمة غير موجودة: ${jobId}`);

    const inputData = job.input_data as JobInputData;

    const steps: StepIds = {
      scriptStep:  await createJobStep(jobId, "script_generation", 1),
      voiceStep:   await createJobStep(jobId, "voice_generation",  2),
      imageStep:   await createJobStep(jobId, "image_generation",  3),
      mergeStep:   await createJobStep(jobId, "merge",             4),
      publishStep: await createJobStep(jobId, "publishing",        5),
    };
    console.log(`[AI-GEN] ✅ steps created`);

    const task = processJob(jobId, inputData, steps);

    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(task);
      console.log(`[AI-GEN] ✅ استخدام EdgeRuntime.waitUntil`);
    } else {
      await task;
    }

    return new Response(
      JSON.stringify({ status: "processing", job_id: jobId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AI-GEN] ❌ ${msg}`);
    if (jobId) await supabase.from("jobs").update({ status: "failed", error_message: msg }).eq("id", jobId).catch(() => {});
    return new Response(JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// =================================================================
// ai-generate مسؤولة فقط عن: script + voice + images
// job-status مسؤولة عن: merge + publish
// هذا يحل مشكلة timeout مهما كان عدد الصور
// =================================================================
async function processJob(jobId: string, inputData: JobInputData, steps: StepIds) {
  try {
    await updateProgress(jobId, 5);

    // ─── السكريبت ──────────────────────────────────────────
    await updateStep(steps.scriptStep, "processing");
    const script = await generateVoiceoverScript(inputData.title, inputData.description, inputData.duration);
    console.log(`[AI-GEN] ✅ script (${script.length} حرف)`);
    await updateStep(steps.scriptStep, "completed", undefined, { script });
    await updateProgress(jobId, 15);

    // ─── الصوت ────────────────────────────────────────────
    await updateStep(steps.voiceStep, "processing");
    const voiceId = inputData.voice_type === "female_arabic" ? "EXAVITQu4vr4xnSDxMaL" : "onwK4e9ZLuTAKqWW03F9";
    const audioBuffer = await generateSpeech(script, voiceId);
    if (!audioBuffer) throw new Error("فشل توليد الصوت");

    const audioFile = `${jobId}/audio.mp3`;
    const { error: audioErr } = await supabase.storage.from("temp-files")
      .upload(audioFile, audioBuffer, { contentType: "audio/mpeg", upsert: true });
    if (audioErr) throw new Error(`فشل رفع الصوت: ${audioErr.message}`);

    const { data: audioUrlData } = supabase.storage.from("temp-files").getPublicUrl(audioFile);
    console.log(`[AI-GEN] ✅ audio`);
    await updateStep(steps.voiceStep, "completed", undefined, { audio_url: audioUrlData.publicUrl });
    await updateProgress(jobId, 35);

    // ─── الصور (parallel batches) ────────────────────────
    await updateStep(steps.imageStep, "processing");

    const count = Math.max(1, Math.min(inputData.scene_count || 3, 20));
    const prompts = await generateImagePrompts(script, count);
    console.log(`[AI-GEN] ✅ ${prompts.length} prompts`);

    if (prompts.length === 0) throw new Error("لم يُولَّد أي prompt");

    // batch size = 5 صور في وقت واحد
    // مهما كان العدد (3 أو 10 أو 20):
    // - 3  صور → batch واحد  ~30s
    // - 10 صور → batch واحد  ~45s
    // - 20 صور → 2 batches   ~90s
    const BATCH_SIZE = 10;
    const imageUrls: string[] = [];

    for (let b = 0; b < prompts.length; b += BATCH_SIZE) {
      const batch = prompts.slice(b, b + BATCH_SIZE);
      const bNum = Math.floor(b / BATCH_SIZE) + 1;
      const tBatches = Math.ceil(prompts.length / BATCH_SIZE);
      console.log(`[AI-GEN] 📦 batch ${bNum}/${tBatches} (${batch.length} صور بالتوازي)`);

      const results = await Promise.all(
        batch.map(async (prompt, j) => {
          const i = b + j;
          try {
            const buf = await generateImageWithFlux(prompt);
            const imgFile = `${jobId}/image_${i}.jpg`;
            const { error: imgErr } = await supabase.storage.from("temp-files")
              .upload(imgFile, buf, { contentType: "image/jpeg", upsert: true });
            if (imgErr) { console.error(`[AI-GEN] ❌ صورة ${i+1}: ${imgErr.message}`); return null; }
            const { data: imgUrl } = supabase.storage.from("temp-files").getPublicUrl(imgFile);
            console.log(`[AI-GEN] ✅ صورة ${i+1}/${prompts.length}`);
            return imgUrl.publicUrl;
          } catch (e) {
            console.error(`[AI-GEN] ❌ صورة ${i+1}: ${e instanceof Error ? e.message : e}`);
            return null;
          }
        })
      );

      imageUrls.push(...results.filter((u): u is string => u !== null));
      const prog = 35 + Math.round((imageUrls.length / prompts.length) * 35);
      await updateProgress(jobId, prog);
    }

    if (imageUrls.length === 0) throw new Error("فشل توليد جميع الصور");
    console.log(`[AI-GEN] ✅ ${imageUrls.length}/${prompts.length} صورة جاهزة`);

    // حفظ الصور + الصوت في merge step بحالة "pending"
    // job-status سيلتقطها ويبدأ الـ merge تلقائياً
    await updateStep(steps.imageStep, "completed", undefined, { image_urls: imageUrls });
    await updateStep(steps.mergeStep, "pending", undefined, {
      image_urls: imageUrls,
      audio_url: audioUrlData.publicUrl,
      ready_for_merge: true,
    });
    await updateProgress(jobId, 72);
    console.log(`[AI-GEN] ✅ جاهز للـ merge — job-status سيكمل`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AI-GEN] ❌ ${msg}`);
    for (const id of Object.values(steps)) {
      if (!id) continue;
      const { data } = await supabase.from("job_steps").select("status").eq("id", id).maybeSingle();
      if (data?.status === "processing") await updateStep(id, "failed", msg);
    }
    await supabase.from("jobs").update({ status: "failed", error_message: msg }).eq("id", jobId);
  }
}
