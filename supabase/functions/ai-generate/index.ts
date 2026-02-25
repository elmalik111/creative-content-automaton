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

// ====== ENHANCED LOGGING ======
function logWithTimestamp(level: 'INFO' | 'ERROR' | 'WARN', message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const prefix = `[AI-GEN] [${level}] [${timestamp}]`;
  
  if (level === 'ERROR') {
    console.error(prefix, message, data ? JSON.stringify(data, null, 2) : '');
  } else if (level === 'WARN') {
    console.warn(prefix, message, data ? JSON.stringify(data, null, 2) : '');
  } else {
    console.log(prefix, message, data ? JSON.stringify(data, null, 2) : '');
  }
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

// ====== ENHANCED IMAGE GENERATION WITH RETRY ======
async function generateSingleImageWithRetry(
  prompt: string,
  index: number,
  jobId: string,
  maxRetries: number = 3
): Promise<{ buffer: ArrayBuffer; url: string } | null> {
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logWithTimestamp('INFO', `🖼️ صورة ${index + 1}: محاولة ${attempt}/${maxRetries}`);
      
      // Add timeout protection
      const timeoutMs = 60000; // 60 seconds per image
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        const buf = await generateImageWithFlux(prompt);
        clearTimeout(timeoutId);
        
        if (!buf || buf.byteLength < 1000) {
          throw new Error('صورة فارغة أو صغيرة جداً');
        }
        
        const imgFile = `${jobId}/image_${index}.jpg`;
        const { error: imgErr } = await supabase.storage.from("temp-files")
          .upload(imgFile, buf, { contentType: "image/jpeg", upsert: true });
        
        if (imgErr) throw new Error(`فشل رفع الصورة: ${imgErr.message}`);
        
        const { data: imgUrl } = supabase.storage.from("temp-files").getPublicUrl(imgFile);
        
        logWithTimestamp('INFO', `✅ صورة ${index + 1} نجحت في المحاولة ${attempt}`);
        
        return { buffer: buf, url: imgUrl.publicUrl };
        
      } catch (timeoutError) {
        clearTimeout(timeoutId);
        throw timeoutError;
      }
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logWithTimestamp('WARN', `❌ صورة ${index + 1} فشلت في المحاولة ${attempt}/${maxRetries}: ${errorMsg}`);
      
      if (attempt === maxRetries) {
        logWithTimestamp('ERROR', `🚫 صورة ${index + 1} فشلت نهائياً بعد ${maxRetries} محاولات`);
        return null;
      }
      
      // Wait before retry with exponential backoff
      const waitTime = Math.min(5000 * attempt, 15000);
      logWithTimestamp('INFO', `⏳ انتظار ${waitTime}ms قبل إعادة المحاولة...`);
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

    logWithTimestamp('INFO', `▶ بدء المهمة: ${jobId}`);
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
    
    logWithTimestamp('INFO', '✅ تم إنشاء الخطوات');

    const task = processJob(jobId, inputData, steps);

    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      EdgeRuntime.waitUntil(task);
      logWithTimestamp('INFO', '✅ استخدام EdgeRuntime.waitUntil');
    } else {
      await task;
    }

    return new Response(
      JSON.stringify({ status: "processing", job_id: jobId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logWithTimestamp('ERROR', `خطأ: ${msg}`);
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

// ====== MAIN PROCESSING FUNCTION ======
async function processJob(jobId: string, inputData: JobInputData, steps: StepIds) {
  const startTime = Date.now();
  
  try {
    await updateProgress(jobId, 5);

    // ─── السكريبت ──────────────────────────────────────────
    logWithTimestamp('INFO', '📝 بدء توليد السكريبت...');
    await updateStep(steps.scriptStep, "processing");
    
    const script = await generateVoiceoverScript(
      inputData.title, 
      inputData.description, 
      inputData.duration
    );
    
    logWithTimestamp('INFO', `✅ السكريبت جاهز (${script.length} حرف)`);
    await updateStep(steps.scriptStep, "completed", undefined, { script });
    await updateProgress(jobId, 15);

    // ─── الصوت ────────────────────────────────────────────
    logWithTimestamp('INFO', '🎤 بدء توليد الصوت...');
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
    
    logWithTimestamp('INFO', `✅ الصوت جاهز`);
    await updateStep(steps.voiceStep, "completed", undefined, { audio_url: audioUrlData.publicUrl });
    await updateProgress(jobId, 35);

    // ─── الصور مع معالجة محسّنة ────────────────────────
    logWithTimestamp('INFO', '🖼️ بدء توليد الصور...');
    await updateStep(steps.imageStep, "processing");

    const count = Math.max(1, Math.min(inputData.scene_count || 3, 20));
    const prompts = await generateImagePrompts(script, count);
    
    logWithTimestamp('INFO', `✅ تم توليد ${prompts.length} prompts`);

    if (prompts.length === 0) throw new Error("لم يُولَّد أي prompt");

    // ====== OPTIMIZED BATCH PROCESSING ======
    const BATCH_SIZE = 3; // تقليل حجم الدفعة من 10 إلى 3 لتجنب التحميل الزائد
    const imageUrls: string[] = [];
    const failedIndices: number[] = [];

    for (let b = 0; b < prompts.length; b += BATCH_SIZE) {
      const batch = prompts.slice(b, b + BATCH_SIZE);
      const bNum = Math.floor(b / BATCH_SIZE) + 1;
      const tBatches = Math.ceil(prompts.length / BATCH_SIZE);
      
      logWithTimestamp('INFO', `📦 دفعة ${bNum}/${tBatches} (${batch.length} صور)`);

      // Process batch with individual retry logic
      const results = await Promise.allSettled(
        batch.map(async (prompt, j) => {
          const i = b + j;
          const result = await generateSingleImageWithRetry(prompt, i, jobId, 3);
          
          if (result) {
            logWithTimestamp('INFO', `✅ صورة ${i + 1}/${prompts.length} نجحت`);
            return result.url;
          } else {
            logWithTimestamp('ERROR', `❌ صورة ${i + 1}/${prompts.length} فشلت نهائياً`);
            failedIndices.push(i);
            return null;
          }
        })
      );

      // Collect successful results
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          imageUrls.push(result.value);
        }
      }

      // Update progress after each batch
      const prog = 35 + Math.round(((b + batch.length) / prompts.length) * 35);
      await updateProgress(jobId, prog);
      
      logWithTimestamp('INFO', `📊 التقدم: ${imageUrls.length}/${prompts.length} صورة جاهزة`);
    }

    // ====== VALIDATION ======
    const successRate = imageUrls.length / prompts.length;
    logWithTimestamp('INFO', `📊 نتيجة نهائية: ${imageUrls.length}/${prompts.length} صورة (${(successRate * 100).toFixed(1)}%)`);

    // Require at least 50% success
    if (imageUrls.length === 0) {
      throw new Error('فشل توليد جميع الصور');
    }
    
    if (successRate < 0.5) {
      logWithTimestamp('WARN', `⚠️ نسبة نجاح منخفضة: ${(successRate * 100).toFixed(1)}%`);
    }

    if (failedIndices.length > 0) {
      logWithTimestamp('WARN', `⚠️ الصور الفاشلة: ${failedIndices.join(', ')}`);
    }

    // ====== FINALIZE IMAGE STEP ======
    await updateStep(steps.imageStep, "completed", undefined, {
      image_urls: imageUrls,
      total_requested: prompts.length,
      total_succeeded: imageUrls.length,
      total_failed: failedIndices.length,
      failed_indices: failedIndices,
      success_rate: successRate
    });

    // ====== PREPARE FOR MERGE ======
    await updateStep(steps.mergeStep, "pending", undefined, {
      image_urls: imageUrls,
      audio_url: audioUrlData.publicUrl,
      ready_for_merge: true,
      images_count: imageUrls.length
    });

    await updateProgress(jobId, 72);
    
    const duration = Math.round((Date.now() - startTime) / 1000);
    logWithTimestamp('INFO', `✅ اكتمل التوليد في ${duration}s - جاهز للدمج (${imageUrls.length} صور)`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logWithTimestamp('ERROR', `❌ خطأ في المعالجة: ${msg}`);
    
    // Mark all processing steps as failed
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
