import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { generateVoiceoverScript, generateImagePrompts } from "../_shared/gemini.ts";
import { generateSpeech } from "../_shared/elevenlabs.ts";
import { generateImageWithFlux } from "../_shared/huggingface.ts";
import { startMergeWithFFmpeg } from "../_shared/huggingface.ts";
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
// ====== LOGGING ======
function log(level: 'INFO' | 'ERROR' | 'WARN', msg: string, data?: any) {
  const ts = new Date().toISOString();
  const prefix = `[AI-GEN] [${level}] [${ts}]`;
  if (level === 'ERROR') console.error(prefix, msg, data || '');
  else if (level === 'WARN') console.warn(prefix, msg, data || '');
  else console.log(prefix, msg, data || '');
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
// ====== IMAGE GENERATION WITH RETRY ======
async function generateSingleImageWithRetry(
  prompt: string,
  index: number,
  jobId: string,
  maxRetries: number = 3
): Promise<{ buffer: ArrayBuffer; url: string } | null> {
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log('INFO', `🖼️ صورة ${index + 1}: محاولة ${attempt}/${maxRetries}`);
      
      // generateImageWithFlux handles its own internal timeout per model
      const buf = await generateImageWithFlux(prompt);
      
      if (!buf || buf.byteLength < 1000) {
        throw new Error('صورة فارغة أو صغيرة جداً');
      }
      
      const imgFile = `${jobId}/image_${index}.jpg`;
      const { error: imgErr } = await supabase.storage.from("temp-files")
        .upload(imgFile, buf, { contentType: "image/jpeg", upsert: true });
      
      if (imgErr) throw new Error(`رفع فشل: ${imgErr.message}`);
      
      const { data: imgUrl } = supabase.storage.from("temp-files").getPublicUrl(imgFile);
      log('INFO', `✅ صورة ${index + 1} نجحت (${(buf.byteLength / 1024).toFixed(1)}KB)`);
      
      return { buffer: buf, url: imgUrl.publicUrl };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('WARN', `❌ صورة ${index + 1} فشلت في ${attempt}/${maxRetries}: ${errorMsg}`);
      
      if (attempt === maxRetries) {
        log('ERROR', `🚫 صورة ${index + 1} فشلت نهائياً`);
        return null;
      }
      
      const waitTime = Math.min(5000 * attempt, 15000);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  return null;
}
// ====== MAIN HANDLER ======
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let jobId = "";
  try {
    const body = await req.json();
    jobId = body.job_id;
    if (!jobId) throw new Error("job_id مطلوب");
    log('INFO', `▶ بدء المهمة: ${jobId}`);
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
    
    log('INFO', '✅ خطوات جاهزة');
    const task = processJob(jobId, inputData, steps);
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(task);
      log('INFO', '✅ استخدام EdgeRuntime.waitUntil');
    } else {
      await task;
    }
    return new Response(
      JSON.stringify({ status: "processing", job_id: jobId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('ERROR', `خطأ: ${msg}`);
    if (jobId) {
      await supabase.from("jobs")
        .update({ status: "failed", error_message: msg })
        .eq("id", jobId)
        .catch(() => {});
    }
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
// ====== MAIN PROCESSING ======
async function processJob(jobId: string, inputData: JobInputData, steps: StepIds) {
  const startTime = Date.now();
  
  try {
    await updateProgress(jobId, 5);
    // ─── SCRIPT ──────────────────────────────────────────
    log('INFO', '📝 توليد السكريبت...');
    await updateStep(steps.scriptStep, "processing");
    
    const script = await generateVoiceoverScript(
      inputData.title, 
      inputData.description, 
      inputData.duration
    );
    
    log('INFO', `✅ السكريبت (${script.length} حرف)`);
    await updateStep(steps.scriptStep, "completed", undefined, { script });
    await updateProgress(jobId, 15);
    // ─── VOICE ───────────────────────────────────────────
    log('INFO', '🎤 توليد الصوت...');
    await updateStep(steps.voiceStep, "processing");
    
    const voiceId = inputData.voice_type === "female_arabic" 
      ? "EXAVITQu4vr4xnSDxMaL" 
      : "onwK4e9ZLuTAKqWW03F9";
    
    const audioBuffer = await generateSpeech(script, voiceId);
    if (!audioBuffer) throw new Error("فشل توليد الصوت");
    const audioFile = `${jobId}/audio.mp3`;
    const { error: audioErr } = await supabase.storage.from("temp-files")
      .upload(audioFile, audioBuffer, { contentType: "audio/mpeg", upsert: true });
    
    if (audioErr) throw new Error(`فشل رفع الصوت: ${audioErr.message}`);
    const { data: audioUrlData } = supabase.storage.from("temp-files").getPublicUrl(audioFile);
    
    log('INFO', `✅ الصوت جاهز`);
    await updateStep(steps.voiceStep, "completed", undefined, { audio_url: audioUrlData.publicUrl });
    await updateProgress(jobId, 35);
    // ─── IMAGES ──────────────────────────────────────────
    log('INFO', '🖼️ توليد الصور...');
    await updateStep(steps.imageStep, "processing");
    const count = Math.max(1, Math.min(inputData.scene_count || 3, 20));
    const prompts = await generateImagePrompts(script, count);
    
    log('INFO', `✅ ${prompts.length} prompts جاهزة`);
    if (prompts.length === 0) throw new Error("لم يُولَّد أي prompt");
    const BATCH_SIZE = 2; // reduced to avoid Pollinations rate limiting
    const imageUrls: string[] = [];
    const failedIndices: number[] = [];

    for (let b = 0; b < prompts.length; b += BATCH_SIZE) {
      const batch = prompts.slice(b, b + BATCH_SIZE);
      const bNum = Math.floor(b / BATCH_SIZE) + 1;
      const tBatches = Math.ceil(prompts.length / BATCH_SIZE);

      log('INFO', `📦 دفعة ${bNum}/${tBatches} (${batch.length} صور)`);

      // Generate images sequentially within batch to avoid rate limiting
      for (let j = 0; j < batch.length; j++) {
        const i = b + j;

        // Add delay between requests to avoid rate limiting (except first)
        if (i > 0) {
          const delay = 3000 + Math.random() * 2000; // 3-5 seconds
          log('INFO', `⏳ انتظار ${(delay/1000).toFixed(1)}s قبل الصورة ${i + 1}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const result = await generateSingleImageWithRetry(batch[j], i, jobId, 3);

        if (result) {
          imageUrls.push(result.url);
          log('INFO', `✅ صورة ${i + 1}/${prompts.length}`);
        } else {
          failedIndices.push(i);
          log('ERROR', `❌ صورة ${i + 1}/${prompts.length} فشلت`);
        }
      }

      const prog = 35 + Math.round(((b + batch.length) / prompts.length) * 30);
      await updateProgress(jobId, prog);
      log('INFO', `📊 ${imageUrls.length}/${prompts.length} صورة`);
    }

    const minRequiredImages = prompts.length > 1 ? 2 : 1;

    // Recovery pass: try failed prompts again before accepting a single-image video
    if (imageUrls.length < minRequiredImages && failedIndices.length > 0) {
      log('WARN', `♻️ محاولة إنقاذ الصور الفاشلة: ${failedIndices.length} صور`);

      const retryTargets = [...failedIndices];
      failedIndices.length = 0;

      for (const idx of retryTargets) {
        if (imageUrls.length >= minRequiredImages) break;

        const retryDelay = 5000 + Math.random() * 3000; // 5-8 seconds
        log('INFO', `⏳ إعادة محاولة الصورة ${idx + 1} بعد ${(retryDelay / 1000).toFixed(1)}s`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));

        const recovered = await generateSingleImageWithRetry(prompts[idx], idx, jobId, 2);
        if (recovered) {
          imageUrls.push(recovered.url);
          log('INFO', `✅ تم إنقاذ الصورة ${idx + 1}`);
        } else {
          failedIndices.push(idx);
        }
      }
    }

    const successRate = imageUrls.length / prompts.length;
    log('INFO', `📊 نتيجة: ${imageUrls.length}/${prompts.length} (${(successRate * 100).toFixed(1)}%)`);

    if (imageUrls.length < minRequiredImages) {
      throw new Error(`تم توليد ${imageUrls.length} صورة فقط من أصل ${prompts.length}. لن نكمل الدمج لتجنّب فيديو بصورة واحدة.`);
    }

    if (successRate < 0.5) log('WARN', `⚠️ نسبة نجاح منخفضة`);
    if (failedIndices.length > 0) log('WARN', `⚠️ فشل: ${failedIndices.join(', ')}`);

    await updateStep(steps.imageStep, "completed", undefined, {
      image_urls: imageUrls,
      total_requested: prompts.length,
      total_succeeded: imageUrls.length,
      min_required_images: minRequiredImages,
      failed_indices: failedIndices,
      success_rate: successRate
    });
    await updateProgress(jobId, 70);
    // ─── MERGE (START IMMEDIATELY!) ─────────────────────
    log('INFO', '🔀 بدء الدمج مباشرة...');
    await updateStep(steps.mergeStep, "processing");
    await updateProgress(jobId, 75);
    try {
      const mergeResult = await startMergeWithFFmpeg({
        images: imageUrls,
        audio: audioUrlData.publicUrl,
        output_format: "mp4",
      });
      log('INFO', `🔀 نتيجة الدمج: ${mergeResult.status}`, {
        has_output: !!mergeResult.output_url,
        has_job_id: !!mergeResult.job_id
      });
      // اكتمل فوراً
      if (mergeResult.output_url) {
        await updateStep(steps.mergeStep, "completed", undefined, { 
          output_url: mergeResult.output_url 
        });
        await updateProgress(jobId, 100, "completed");
        await supabase.from("jobs").update({ 
          output_url: mergeResult.output_url 
        }).eq("id", jobId);
        
        const duration = Math.round((Date.now() - startTime) / 1000);
        log('INFO', `✅ اكتمل كل شيء في ${duration}s`);
        
      } 
      // السيرفر يعالج - job-status سيتابع
      else if (mergeResult.job_id) {
        const mergeDiagnostics = (mergeResult.diagnostics ?? {}) as Record<string, unknown>;
        const providerReportedImageCount = Number(mergeDiagnostics.provider_reported_image_count ?? NaN);

        await updateStep(steps.mergeStep, "processing", undefined, {
          provider_job_id: mergeResult.job_id,
          provider: "ffmpeg-space",
          started_at: new Date().toISOString(),
          requested_image_count: imageUrls.length,
          provider_reported_image_count: Number.isFinite(providerReportedImageCount)
            ? providerReportedImageCount
            : undefined,
          payload_variant:
            typeof mergeDiagnostics.payload_variant === "string"
              ? mergeDiagnostics.payload_variant
              : undefined,
          provider_status_endpoint:
            typeof mergeDiagnostics.provider_status_endpoint === "string"
              ? mergeDiagnostics.provider_status_endpoint
              : undefined,
          image_urls: imageUrls,
          audio_url: audioUrlData.publicUrl,
          diagnostics: mergeDiagnostics,
        });
        await updateProgress(jobId, 80);
        log('INFO', `✅ الدمج قيد المعالجة: ${mergeResult.job_id}`);
      }
      // خطأ
      else if (mergeResult.status === "failed") {
        throw new Error(mergeResult.error || "فشل الدمج");
      }
    } catch (mergeError) {
      const mergeMsg = mergeError instanceof Error ? mergeError.message : String(mergeError);
      log('ERROR', `❌ فشل الدمج: ${mergeMsg}`);
      
      await updateStep(steps.mergeStep, "failed", mergeMsg);
      await updateProgress(jobId, 75); // نرجع للخلف قليلاً
      
      throw new Error(`فشل الدمج: ${mergeMsg}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('ERROR', `❌ خطأ: ${msg}`);
    
    for (const id of Object.values(steps)) {
      if (!id) continue;
      const { data } = await supabase.from("job_steps").select("status").eq("id", id).maybeSingle();
      if (data?.status === "processing") {
        await updateStep(id, "failed", msg);
      }
    }
    
    await supabase.from("jobs").update({ 
      status: "failed", 
      error_message: msg 
    }).eq("id", jobId);
  }
}
