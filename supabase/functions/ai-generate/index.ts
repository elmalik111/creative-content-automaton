import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { generateVoiceoverScript, generateImagePrompts } from "../_shared/gemini.ts";
import { generateSpeech } from "../_shared/elevenlabs.ts";
import { generateImageWithFlux, startMergeWithFFmpeg } from "../_shared/huggingface.ts";
// redeploy trigger
// =================================================================
// الحل الجذري لمشكلة الـ freeze:
// نستخدم EdgeRuntime.waitUntil لإبقاء الـ worker حياً
// بدون هذا، Supabase يُغلق الـ function بعد return Response
// وتموت processAIGeneration في منتصفها
// =================================================================

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

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

async function createJobStep(jobId: string, stepName: string, stepOrder: number): Promise<string | undefined> {
  const { data, error } = await supabase
    .from("job_steps")
    .upsert(
      { job_id: jobId, step_name: stepName, step_order: stepOrder, status: "pending" },
      { onConflict: "job_id,step_name" }
    )
    .select("id")
    .maybeSingle();
  if (error) {
    const { data: ex } = await supabase.from("job_steps").select("id")
      .eq("job_id", jobId).eq("step_name", stepName).maybeSingle();
    return ex?.id;
  }
  return data?.id;
}

async function updateStep(id: string | undefined, status: string, err?: string, out?: Record<string,unknown>) {
  if (!id) return;
  const u: Record<string,unknown> = { status };
  if (status === "processing") u.started_at = new Date().toISOString();
  if (status === "completed" || status === "failed") u.completed_at = new Date().toISOString();
  if (err) u.error_message = err;
  if (out) u.output_data = out;
  await supabase.from("job_steps").update(u).eq("id", id);
}

async function updateProgress(jobId: string, progress: number, status?: string) {
  const u: Record<string,unknown> = { progress };
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

    console.log(`[AI-GEN] ▶ بدء معالجة المهمة: ${jobId}`);

    // تحديث فوري إلى processing
    await supabase.from("jobs").update({ status: "processing", progress: 1 }).eq("id", jobId);

    // جلب المهمة
    const { data: job, error: jobErr } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    if (jobErr || !job) throw new Error(`المهمة غير موجودة: ${jobId}`);

    const inputData = job.input_data as JobInputData;

    // إنشاء الخطوات
    const steps: StepIds = {
      scriptStep:  await createJobStep(jobId, "script_generation", 1),
      voiceStep:   await createJobStep(jobId, "voice_generation",  2),
      imageStep:   await createJobStep(jobId, "image_generation",  3),
      mergeStep:   await createJobStep(jobId, "merge",             4),
      publishStep: await createJobStep(jobId, "publishing",        5),
    };
    console.log(`[AI-GEN] ✅ steps created`);

    // تشغيل المعالجة
    const task = processJob(jobId, inputData, job.source_url, steps);

    // الحل الجذري: EdgeRuntime.waitUntil يُبقي الـ worker حياً
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(task);
    } else {
      // إذا EdgeRuntime غير متاح، ننتظر الـ task قبل الـ return
      // هذا يمنع Supabase من قتل الـ worker
      await task;
    }

    return new Response(
      JSON.stringify({ status: "processing", job_id: jobId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AI-GEN] ❌ خطأ: ${msg}`);
    if (jobId) {
      await supabase.from("jobs").update({ status: "failed", error_message: msg }).eq("id", jobId).catch(() => {});
    }
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// =================================================================
async function processJob(jobId: string, inputData: JobInputData, sourceUrl: string|null, steps: StepIds) {
  try {
    await updateProgress(jobId, 5, "processing");

    // ─── السكريبت ─────────────────────────────────────────────────
    await updateStep(steps.scriptStep, "processing");
    const script = await generateVoiceoverScript(inputData.title, inputData.description, inputData.duration);
    console.log(`[AI-GEN] ✅ script: ${script.slice(0,80)}`);
    await updateStep(steps.scriptStep, "completed", undefined, { script });
    await updateProgress(jobId, 15);

    // ─── الصوت ────────────────────────────────────────────────────
    await updateStep(steps.voiceStep, "processing");
    const voiceId = inputData.voice_type === "female_arabic" ? "EXAVITQu4vr4xnSDxMaL" : "onwK4e9ZLuTAKqWW03F9";
    const audioBuffer = await generateSpeech(script, voiceId);
    if (!audioBuffer) throw new Error("فشل توليد الصوت");

    const audioFile = `${jobId}/audio.mp3`;
    const { error: audioErr } = await supabase.storage.from("temp-files")
      .upload(audioFile, audioBuffer, { contentType: "audio/mpeg", upsert: true });
    if (audioErr) throw new Error(`فشل رفع الصوت: ${audioErr.message}`);

    const { data: audioUrl } = supabase.storage.from("temp-files").getPublicUrl(audioFile);
    console.log(`[AI-GEN] ✅ audio: ${audioUrl.publicUrl}`);
    await updateStep(steps.voiceStep, "completed", undefined, { audio_url: audioUrl.publicUrl });
    await updateProgress(jobId, 35);

    // ─── الصور ────────────────────────────────────────────────────
    await updateStep(steps.imageStep, "processing");
    const count = Math.max(1, Math.min(inputData.scene_count || 3, 10));
    const prompts = await generateImagePrompts(script, count);
    console.log(`[AI-GEN] ✅ prompts (${prompts.length}): ${prompts.map((p,i)=>`[${i+1}]${p.slice(0,60)}`).join(' | ')}`);

    if (prompts.length === 0) throw new Error("لم يُولَّد أي prompt للصور");

    await updateProgress(jobId, 40);
    const imageUrls: string[] = [];

    for (let i = 0; i < prompts.length; i++) {
      console.log(`[AI-GEN] 🖼 صورة ${i+1}/${prompts.length}: ${prompts[i].slice(0,80)}`);
      try {
        const buf = await generateImageWithFlux(prompts[i]);
        const imgFile = `${jobId}/image_${i}.jpg`;
        const { error: imgErr } = await supabase.storage.from("temp-files")
          .upload(imgFile, buf, { contentType: "image/jpeg", upsert: true });
        if (imgErr) { console.error(`[AI-GEN] ❌ رفع صورة ${i+1}: ${imgErr.message}`); continue; }
        const { data: imgUrl } = supabase.storage.from("temp-files").getPublicUrl(imgFile);
        imageUrls.push(imgUrl.publicUrl);
        console.log(`[AI-GEN] ✅ صورة ${i+1}: ${imgUrl.publicUrl}`);
      } catch (e) {
        console.error(`[AI-GEN] ❌ صورة ${i+1}: ${e instanceof Error ? e.message : e}`);
      }
      await updateProgress(jobId, 40 + (i+1) * (30 / count));
    }

    if (imageUrls.length === 0) throw new Error("فشل توليد جميع الصور");
    await updateStep(steps.imageStep, "completed", undefined, { image_urls: imageUrls });
    await updateProgress(jobId, 75);

    // ─── الدمج ────────────────────────────────────────────────────
    await updateStep(steps.mergeStep, "processing");
    const merge = await startMergeWithFFmpeg({ images: imageUrls, audio: audioUrl.publicUrl, output_format: "mp4" });
    console.log(`[AI-GEN] merge: ${JSON.stringify(merge)}`);

    if (merge.status === "failed") throw new Error(merge.error || "فشل الدمج");

    if (merge.output_url) {
      await updateStep(steps.mergeStep, "completed", undefined, { output_url: merge.output_url });
      await updateStep(steps.publishStep, "completed", undefined, { video_url: merge.output_url });
      await supabase.from("jobs").update({ status: "completed", progress: 100, output_url: merge.output_url }).eq("id", jobId);
      console.log(`[AI-GEN] ✅ اكتمل: ${merge.output_url}`);
      return;
    }

    if (!merge.job_id) throw new Error("لم يُرجع merge job_id");
    await updateStep(steps.mergeStep, "processing", undefined, { provider: "ffmpeg-space", provider_job_id: merge.job_id, stage: "queued" });
    await updateProgress(jobId, 78);
    console.log(`[AI-GEN] ✅ merge queued: ${merge.job_id}`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AI-GEN] ❌ processJob error: ${msg}`);
    for (const id of Object.values(steps)) {
      if (!id) continue;
      const { data } = await supabase.from("job_steps").select("status").eq("id", id).maybeSingle();
      if (data?.status === "processing") await updateStep(id, "failed", msg);
    }
    await supabase.from("jobs").update({ status: "failed", error_message: msg }).eq("id", jobId);
  }
}
