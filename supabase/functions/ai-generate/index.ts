import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { generateVoiceoverScript, generateImagePrompts } from "../_shared/gemini.ts";
import { generateSpeech } from "../_shared/elevenlabs.ts";
import { generateImageWithFlux, startMergeWithFFmpeg } from "../_shared/huggingface.ts";

interface AIGenerateRequest {
  job_id: string;
}

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
  const { data } = await supabase
    .from("job_steps")
    .insert({
      job_id: jobId,
      step_name: stepName,
      step_order: stepOrder,
      status: "pending"
    })
    .select()
    .single();
  return data?.id;
}

async function updateJobStep(stepId: string | undefined, status: string, errorMessage?: string, outputData?: Record<string, unknown>) {
  if (!stepId) return;
  
  const updates: Record<string, unknown> = { status };
  
  if (status === "processing") {
    updates.started_at = new Date().toISOString();
  } else if (status === "completed" || status === "failed") {
    updates.completed_at = new Date().toISOString();
  }
  
  if (errorMessage) {
    updates.error_message = errorMessage;
  }

  if (outputData) {
    updates.output_data = outputData;
  }

  await supabase
    .from("job_steps")
    .update(updates)
    .eq("id", stepId);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id }: AIGenerateRequest = await req.json();

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", job_id)
      .single();

    if (jobError || !job) {
      throw new Error("Job not found");
    }

    const inputData = job.input_data as JobInputData;

    // Create job steps
    const steps: StepIds = {
      scriptStep:  await createJobStep(job_id, "script_generation", 1),
      voiceStep:   await createJobStep(job_id, "voice_generation",  2),
      imageStep:   await createJobStep(job_id, "image_generation",  3),
      mergeStep:   await createJobStep(job_id, "merge",             4), // "merge" متوافق مع job-status.ts
      publishStep: await createJobStep(job_id, "publishing",        5),
    };

    // Start processing in background (non-blocking)
    processAIGeneration(job_id, inputData, job.source_url, steps).catch(console.error);

    return new Response(
      JSON.stringify({ status: "processing", job_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("AI Generate error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function processAIGeneration(
  jobId: string,
  inputData: JobInputData,
  sourceUrl: string | null,
  steps: StepIds
) {
  try {
    // Update status to processing
    await updateJobProgress(jobId, 5, "processing");

    // Step 1: Generate voiceover script with Gemini
    await updateJobStep(steps.scriptStep, "processing");
    console.log("Generating voiceover script...");
    const script = await generateVoiceoverScript(
      inputData.title,
      inputData.description,
      inputData.duration
    );
    await updateJobStep(steps.scriptStep, "completed", undefined, { script });
    await updateJobProgress(jobId, 15);

    // Step 2: Generate audio with ElevenLabs
    await updateJobStep(steps.voiceStep, "processing");
    console.log("Generating audio...");
    const voiceId = inputData.voice_type === "female_arabic" 
      ? "EXAVITQu4vr4xnSDxMaL"  // Sarah
      : "onwK4e9ZLuTAKqWW03F9"; // Daniel

    const audioBuffer = await generateSpeech(script, voiceId);
    if (!audioBuffer) {
      throw new Error("Failed to generate audio");
    }

    // Upload audio to storage
    const audioFileName = `${jobId}/audio.mp3`;
    const { error: audioUploadError } = await supabase.storage
      .from("temp-files")
      .upload(audioFileName, audioBuffer, {
        contentType: "audio/mpeg",
      });

    if (audioUploadError) {
      throw new Error(`Audio upload failed: ${audioUploadError.message}`);
    }

    const { data: audioUrlData } = supabase.storage
      .from("temp-files")
      .getPublicUrl(audioFileName);

    await updateJobStep(steps.voiceStep, "completed", undefined, { audio_url: audioUrlData.publicUrl });
    await updateJobProgress(jobId, 35);

    // Step 3: توليد الصور
    await updateJobStep(steps.imageStep, "processing");
    const sceneCount = Math.max(1, Math.min(inputData.scene_count || 3, 10));
    console.log(`[IMAGES] طلب ${sceneCount} صورة...`);

    // توليد الـ prompts (gemini.ts يضمن sceneCount prompts بالإنجليزية)
    const imagePrompts = await generateImagePrompts(script, sceneCount);
    await updateJobProgress(jobId, 42);

    const imageUrls: string[] = [];
    const progressPerImage = 28 / sceneCount;

    for (let i = 0; i < sceneCount; i++) {
      const prompt = imagePrompts[i];
      console.log(`[IMAGE ${i + 1}/${sceneCount}] prompt: "${prompt.slice(0, 80)}"`);

      try {
        const imageBuffer = await generateImageWithFlux(prompt);

        const imageFileName = `${jobId}/image_${i}.png`;
        const { error: imageUploadError } = await supabase.storage
          .from("temp-files")
          .upload(imageFileName, imageBuffer, { contentType: "image/png" });

        if (imageUploadError) {
          console.error(`[IMAGE ${i + 1}] upload فشل:`, imageUploadError.message);
          continue;
        }

        const { data: imageUrlData } = supabase.storage
          .from("temp-files").getPublicUrl(imageFileName);

        imageUrls.push(imageUrlData.publicUrl);
        console.log(`[IMAGE ${i + 1}/${sceneCount}] ✅ ${imageUrlData.publicUrl.slice(-40)}`);
      } catch (imgErr) {
        console.error(`[IMAGE ${i + 1}/${sceneCount}] ❌ فشل:`, imgErr);
        // نكمل بالصور الناجحة
      }

      await updateJobProgress(jobId, 42 + (i + 1) * progressPerImage);
    }

    if (imageUrls.length === 0) {
      throw new Error(`فشل توليد جميع الصور (${sceneCount} مطلوبة)`);
    }
    console.log(`✅ ${imageUrls.length}/${sceneCount} صورة بنجاح`);

    await updateJobStep(steps.imageStep, "completed", undefined, {
      image_urls: imageUrls,
      requested: sceneCount,
      generated: imageUrls.length,
    });
    await updateJobProgress(jobId, 72);

    // Step 4: Merge images with audio
    await updateJobStep(steps.mergeStep, "processing");
    console.log("Merging media...");
    // IMPORTANT: do NOT long-poll inside ai-generate. Just start the provider job and
    // let the UI polling (job-status) advance it.
    const mergeStart = await startMergeWithFFmpeg({
      images: imageUrls,
      audio: audioUrlData.publicUrl,
      output_format: "mp4",
    });

    console.log("Merge start:", JSON.stringify(mergeStart));

    if (mergeStart.status === "failed") {
      throw new Error(mergeStart.error || "Video merge failed");
    }

    // If provider returned an immediate output URL, we can complete quickly.
    if (mergeStart.output_url) {
      await updateJobStep(steps.mergeStep, "completed", undefined, { output_url: mergeStart.output_url });
      await updateJobProgress(jobId, 90);
      // Publishing stays in the existing pipeline, but immediate outputs are rare.
      // For now: mark job completed with the provider URL.
      await supabase
        .from("jobs")
        .update({
          status: "completed",
          progress: 100,
          output_url: mergeStart.output_url,
        })
        .eq("id", jobId);
      return;
    }

    if (!mergeStart.job_id) {
      throw new Error("FFmpeg merge started but no provider job id returned");
    }

    await updateJobStep(steps.mergeStep, "processing", undefined, {
      provider: "ffmpeg-space",
      provider_job_id: mergeStart.job_id,
      job_id: mergeStart.job_id,
      step_name: "merge",
      stage: "queued",
      images_count: imageUrls.length,
    });

    // Keep job in processing; the frontend polling will call job-status which will
    // check the provider status and finalize upload/output_url.
    await updateJobProgress(jobId, 78);
    return;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("AI Generation error:", error);
    
    // Mark failed step
    for (const stepId of Object.values(steps)) {
      if (stepId) {
        const { data } = await supabase
          .from("job_steps")
          .select("status")
          .eq("id", stepId)
          .single();
        
        if (data?.status === "processing") {
          await updateJobStep(stepId, "failed", error.message);
        }
      }
    }
    
    await supabase
      .from("jobs")
      .update({
        status: "failed",
        error_message: error.message,
      })
      .eq("id", jobId);

    // Notify Telegram of failure
    if (sourceUrl?.startsWith("telegram:")) {
      const chatId = parseInt(sourceUrl.replace("telegram:", ""));
      await sendTelegramFailureNotification(chatId, jobId, error.message);
    }
  }
}

async function autoPublishToConnectedPlatforms(
  jobId: string,
  videoUrl: string,
  title: string,
  description: string
): Promise<Record<string, { success: boolean; url?: string; error?: string }>> {
  const results: Record<string, { success: boolean; url?: string; error?: string }> = {};

  // Get all active OAuth tokens
  const { data: tokens } = await supabase
    .from("oauth_tokens")
    .select("platform")
    .eq("is_active", true);

  if (!tokens || tokens.length === 0) {
    console.log("No connected platforms for auto-publish");
    return results;
  }

  const connectedPlatforms = tokens.map(t => t.platform as "youtube" | "instagram" | "facebook");
  
  console.log("Auto-publishing to:", connectedPlatforms);

  // Call publish-video function
  try {
    const response = await fetch(
      `https://cidxcujlfkrzvvmljxqs.supabase.co/functions/v1/publish-video`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          job_id: jobId,
          video_url: videoUrl,
          title,
          description,
          platforms: connectedPlatforms,
        }),
      }
    );

    const data = await response.json();
    
    if (data.results) {
      Object.assign(results, data.results);
    }
  } catch (err) {
    console.error("Auto-publish error:", err);
  }

  return results;
}

async function updateJobProgress(jobId: string, progress: number, status?: string) {
  const update: Record<string, unknown> = { progress };
  if (status) update.status = status;

  await supabase
    .from("jobs")
    .update(update)
    .eq("id", jobId);
}

async function sendTelegramNotification(
  chatId: number, 
  jobId: string, 
  videoUrl: string,
  publishResults: Record<string, { success: boolean; url?: string; error?: string }>
) {
  const { data: tokenSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "telegram_token")
    .maybeSingle();

  if (!tokenSetting?.value) return;

  // Build publish status message
  let publishStatus = "";
  const platforms = Object.keys(publishResults);
  
  if (platforms.length > 0) {
    publishStatus = "\n\n📢 النشر:\n";
    for (const platform of platforms) {
      const result = publishResults[platform];
      if (result.success) {
        publishStatus += `✅ ${platform}: ${result.url || "تم النشر"}\n`;
      } else {
        publishStatus += `❌ ${platform}: ${result.error || "فشل"}\n`;
      }
    }
  }

  await fetch(`https://api.telegram.org/bot${tokenSetting.value}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `✅ تم الانتهاء من فيديوك!

🎬 رقم المهمة: ${jobId.slice(0, 8)}
🔗 رابط الفيديو: ${videoUrl}${publishStatus}`,
      parse_mode: "HTML",
    }),
  });
}

async function sendTelegramFailureNotification(chatId: number, jobId: string, error: string) {
  const { data: tokenSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "telegram_token")
    .maybeSingle();

  if (!tokenSetting?.value) return;

  await fetch(`https://api.telegram.org/bot${tokenSetting.value}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `❌ فشل في إنشاء الفيديو

🔴 رقم المهمة: ${jobId.slice(0, 8)}
⚠️ الخطأ: ${error}

حاول مرة أخرى لاحقاً.`,
      parse_mode: "HTML",
    }),
  });
}
