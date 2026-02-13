import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { mergeMediaWithFFmpeg } from "../_shared/huggingface.ts";

interface MergeRequest {
  images?: string[];
  videos?: string[];
  audio: string;
  callback_url?: string;
  // Debug/health check
  test?: boolean;
  health?: boolean;
  // Compatibility aliases (some clients send these)
  imageUrl?: string;
  audioUrl?: string;
  image_url?: string;
  audio_url?: string;
  audio_path?: string;
}

const CANCELLED_BY_USER = "Cancelled by user";

// ===== INPUT VALIDATION (SECURITY) =====

const ALLOWED_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"];
const ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
const ALLOWED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm", ".mkv"];

const MAX_MEDIA_FILES = 50;
const MAX_FILE_SIZE_MB = 200; // 200MB max per file

/**
 * Validates URL format and blocks internal/private IPs (SSRF protection)
 */
function isValidPublicUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    
    // Only allow HTTP/HTTPS protocols
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }
    
    const hostname = url.hostname.toLowerCase();
    
    // Block localhost and loopback
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("127.") ||
      hostname === "::1"
    ) {
      return false;
    }
    
    // Block private IP ranges
    // 10.0.0.0/8
    if (hostname.match(/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
      return false;
    }
    // 172.16.0.0/12
    if (hostname.match(/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/)) {
      return false;
    }
    // 192.168.0.0/16
    if (hostname.match(/^192\.168\.\d{1,3}\.\d{1,3}$/)) {
      return false;
    }
    // 169.254.0.0/16 (link-local / cloud metadata)
    if (hostname.match(/^169\.254\.\d{1,3}\.\d{1,3}$/)) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates media URL has correct extension
 */
function hasValidExtension(url: string, allowedExtensions: string[]): boolean {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const host = urlObj.hostname.toLowerCase();
    if (allowedExtensions.some((ext) => pathname.includes(ext))) return true;
    if (host.includes("supabase.co") && pathname.includes("/storage/")) return true;
    if (host === "image.pollinations.ai") return true;
    if (host.endsWith(".hf.space")) return true;
    const trusted = ["replicate.delivery","replicate.com","fal.media","fal.run","fal.ai","picsum.photos"];
    if (trusted.some((d) => host.includes(d))) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Validates all media URLs in the request
 */
function validateMediaUrls(request: MergeRequest): { valid: boolean; error?: string } {
  // Validate audio URL
  if (!isValidPublicUrl(request.audio)) {
    return { valid: false, error: "Invalid audio URL format or blocked internal address" };
  }
  if (!hasValidExtension(request.audio, ALLOWED_AUDIO_EXTENSIONS)) {
    return { valid: false, error: `Invalid audio format. Allowed: ${ALLOWED_AUDIO_EXTENSIONS.join(", ")}` };
  }

  // Validate images
  for (const imageUrl of request.images || []) {
    if (!isValidPublicUrl(imageUrl)) {
      return { valid: false, error: "Invalid image URL format or blocked internal address" };
    }
    if (!hasValidExtension(imageUrl, ALLOWED_IMAGE_EXTENSIONS)) {
      return { valid: false, error: `Invalid image format. Allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(", ")}` };
    }
  }

  // Validate videos
  for (const videoUrl of request.videos || []) {
    if (!isValidPublicUrl(videoUrl)) {
      return { valid: false, error: "Invalid video URL format or blocked internal address" };
    }
    if (!hasValidExtension(videoUrl, ALLOWED_VIDEO_EXTENSIONS)) {
      return { valid: false, error: `Invalid video format. Allowed: ${ALLOWED_VIDEO_EXTENSIONS.join(", ")}` };
    }
  }

  // Validate media count
  const totalMedia = (request.images?.length || 0) + (request.videos?.length || 0);
  if (totalMedia > MAX_MEDIA_FILES) {
    return { valid: false, error: `Too many media files. Maximum: ${MAX_MEDIA_FILES}` };
  }

  // Validate callback URL if provided
  if (request.callback_url && !isValidPublicUrl(request.callback_url)) {
    return { valid: false, error: "Invalid callback URL format" };
  }

  return { valid: true };
}

// ===== END INPUT VALIDATION =====

async function validateApiKey(apiKey: string): Promise<boolean> {
  if (!apiKey) return false;
  
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, is_active, usage_count")
    .eq("key", apiKey)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return false;

  // Update usage count
  await supabase
    .from("api_keys")
    .update({ 
      usage_count: (data.usage_count || 0) + 1,
      last_used_at: new Date().toISOString()
    })
    .eq("id", data.id);

  return true;
}

async function createJobStep(jobId: string, stepName: string, stepOrder: number) {
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

async function updateJobStep(
  stepId: string,
  status: string,
  opts?: { errorMessage?: string; outputData?: unknown }
) {
  const updates: Record<string, unknown> = { status };
  
  if (status === "processing") {
    updates.started_at = new Date().toISOString();
  } else if (status === "completed" || status === "failed") {
    updates.completed_at = new Date().toISOString();
  }
  
  if (opts?.errorMessage) updates.error_message = opts.errorMessage;
  if (opts?.outputData !== undefined) updates.output_data = opts.outputData;

  await supabase
    .from("job_steps")
    .update(updates)
    .eq("id", stepId);
}

async function isJobCancelled(jobId: string): Promise<boolean> {
  const { data } = await supabase
    .from("jobs")
    .select("status, error_message")
    .eq("id", jobId)
    .maybeSingle();

  if (!data) return false;
  if (data.status !== "failed") return false;
  const msg = (data.error_message || "").toLowerCase();
  return msg.includes("cancel");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check API key for external requests
    const apiKey = req.headers.get("X-API-Key") || req.headers.get("x-api-key");
    const authHeader = req.headers.get("Authorization");
    
    // Allow if has valid Supabase auth OR valid API key
    if (!authHeader && apiKey) {
      const isValid = await validateApiKey(apiKey);
      if (!isValid) {
        return new Response(
          JSON.stringify({ error: "Invalid or inactive API key" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const rawBody: MergeRequest = await req.json().catch(() => ({} as MergeRequest));

    // Health/test mode for UI debuggers (prevents FunctionsHttpError in simple pings)
    if (rawBody?.test || rawBody?.health) {
      return new Response(
        JSON.stringify({
          ok: true,
          message: "merge-media is reachable. Provide imageUrl/audioUrl to start a real merge job.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize body to the canonical shape expected by this API
    const body: MergeRequest = {
      ...rawBody,
      images:
        rawBody.images && rawBody.images.length > 0
          ? rawBody.images
          : rawBody.imageUrl
            ? [rawBody.imageUrl]
            : rawBody.image_url
              ? [rawBody.image_url]
              : undefined,
      audio:
        rawBody.audio || rawBody.audioUrl || rawBody.audio_url || rawBody.audio_path || "",
    };

    // Validate required fields
    if (!body.audio) {
      return new Response(
        JSON.stringify({ error: "Audio URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if ((!body.images || body.images.length === 0) && (!body.videos || body.videos.length === 0)) {
      return new Response(
        JSON.stringify({ error: "At least one image or video is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ===== SECURITY: Validate all URLs before processing =====
    const validation = validateMediaUrls(body);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        type: "merge",
        status: "processing",
        progress: 0,
        callback_url: body.callback_url,
        input_data: {
          images: body.images,
          videos: body.videos,
          audio: body.audio,
        },
      })
      .select()
      .single();

    if (jobError) {
      throw new Error(`Failed to create job: ${jobError.message}`);
    }

    // Create job steps
    const validateStepId = await createJobStep(job.id, "validate_inputs", 1);
    const mergeStepId = await createJobStep(job.id, "merge", 2);
    const finalizeStepId = await createJobStep(job.id, "finalize", 3);

    // Start merge process in background (non-blocking)
    processMediaMerge(job.id, body, { validateStepId, mergeStepId, finalizeStepId }).catch(console.error);

    return new Response(
      JSON.stringify({
        job_id: job.id,
        status: "processing",
        message: "Merge job started",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Error in merge-media:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

const MERGE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

async function processMediaMerge(
  jobId: string, 
  request: MergeRequest,
  steps: { validateStepId?: string; mergeStepId?: string; finalizeStepId?: string }
) {
  const mergeStartTime = Date.now();
  
  try {
    // Step 1: Validate inputs
    if (steps.validateStepId) {
      await updateJobStep(steps.validateStepId, "processing", {
        outputData: {
          images: request.images?.length || 0,
          videos: request.videos?.length || 0,
          hasAudio: !!request.audio,
          stage: "validating_inputs",
        },
      });
    }

    if (await isJobCancelled(jobId)) return;
    
    await supabase
      .from("jobs")
      .update({ progress: 10 })
      .eq("id", jobId);

    if (steps.validateStepId) {
      await updateJobStep(steps.validateStepId, "completed", {
        outputData: {
          images: request.images?.length || 0,
          videos: request.videos?.length || 0,
          hasAudio: !!request.audio,
          stage: "validated",
          validation_time_ms: Date.now() - mergeStartTime,
        },
      });
    }

    // Step 2: Merge media
    if (steps.mergeStepId) {
      await updateJobStep(steps.mergeStepId, "processing", {
        outputData: { 
          provider: "huggingface-space", 
          endpoint: "merge",
          stage: "sending_to_ffmpeg",
        },
      });
    }

    if (await isJobCancelled(jobId)) return;

    await supabase
      .from("jobs")
      .update({ progress: 30 })
      .eq("id", jobId);

    // Timeout controller for merge operation
    const controller = new AbortController();
    let timeoutId: number | undefined;
    let mergeDone = false;
    let timeoutReached = false;

    // Setup 10-minute timeout
    timeoutId = setTimeout(() => {
      if (!mergeDone) {
        timeoutReached = true;
        controller.abort();
      }
    }, MERGE_TIMEOUT_MS);

    // Progress ticker with heartbeat updates
    const ticker = (async () => {
      let p = 30;
      const startTick = Date.now();
      while (!mergeDone && p < 85) {
        await delay(3000);
        if (await isJobCancelled(jobId)) return;
        
        p = Math.min(85, p + 3);
        const elapsed = Date.now() - startTick;
        
        await supabase.from("jobs").update({ progress: p }).eq("id", jobId);
        
        // Heartbeat update to step with elapsed time
        if (steps.mergeStepId) {
          await supabase.from("job_steps").update({
            output_data: {
              provider: "huggingface-space",
              endpoint: "merge",
              stage: "processing_ffmpeg",
              elapsed_seconds: Math.round(elapsed / 1000),
              progress_percent: p,
            },
          }).eq("id", steps.mergeStepId);
        }
      }
    })();

    // Call HuggingFace Space for merge
    let result: { status: string; output_url?: string; error?: string };
    
    try {
      result = await mergeMediaWithFFmpeg({
        images: request.images,
        videos: request.videos,
        audio: request.audio,
        output_format: "mp4",
      });
    } catch (mergeError) {
      if (timeoutReached) {
        throw new Error(`عملية الدمج تجاوزت الحد الزمني (10 دقائق). قد يكون السيرفر مشغولاً أو الملفات كبيرة جداً.`);
      }
      throw mergeError;
    } finally {
      mergeDone = true;
      if (timeoutId) clearTimeout(timeoutId);
    }

    await ticker.catch(() => undefined);

    if (await isJobCancelled(jobId)) return;

    if (timeoutReached) {
      throw new Error(`عملية الدمج تجاوزت الحد الزمني (10 دقائق). قد يكون السيرفر مشغولاً أو الملفات كبيرة جداً.`);
    }

    await supabase
      .from("jobs")
      .update({ progress: 90 })
      .eq("id", jobId);

    if (result.status === "failed") {
      throw new Error(result.error || "Merge failed");
    }

    if (!result.output_url) {
      throw new Error(
        "اكتملت عملية الدمج من مزود الخدمة لكن لم يتم إرجاع رابط إخراج للفيديو (output_url)."
      );
    }

    const providerOutputUrl = result.output_url;
    let finalOutputUrl = providerOutputUrl;

    // Upload final video to our own storage to get a stable URL
    try {
      const videoResponse = await fetch(providerOutputUrl);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download merged video (HTTP ${videoResponse.status})`);
      }
      const videoBuffer = await videoResponse.arrayBuffer();

      const finalVideoName = `${jobId}/merged_video.mp4`;
      const { error: videoUploadError } = await supabase.storage
        .from("media-output")
        .upload(finalVideoName, videoBuffer, {
          contentType: "video/mp4",
          upsert: true,
        });

      if (videoUploadError) {
        throw new Error(`Final video upload failed: ${videoUploadError.message}`);
      }

      const { data: finalVideoUrlData } = supabase.storage
        .from("media-output")
        .getPublicUrl(finalVideoName);

      if (finalVideoUrlData?.publicUrl) {
        finalOutputUrl = finalVideoUrlData.publicUrl;
      }
    } catch (uploadErr) {
      // Fallback: keep provider URL (still better than null)
      console.error("Final video storage upload failed, falling back to provider URL:", uploadErr);
    }

    const mergeDuration = Date.now() - mergeStartTime;

    if (steps.mergeStepId) {
      await updateJobStep(steps.mergeStepId, "completed", {
        outputData: {
          provider: "huggingface-space",
          stage: "merge_complete",
          duration_seconds: Math.round(mergeDuration / 1000),
          provider_output_url: providerOutputUrl,
          output_url: finalOutputUrl,
        },
      });
    }

    if (steps.finalizeStepId) {
      await updateJobStep(steps.finalizeStepId, "processing", {
        outputData: { stage: "finalizing" },
      });
    }

    // Mark as complete
    await supabase
      .from("jobs")
      .update({
        status: "completed",
        progress: 100,
        output_url: finalOutputUrl,
      })
      .eq("id", jobId);

    if (steps.finalizeStepId) {
      await updateJobStep(steps.finalizeStepId, "completed", {
        outputData: { 
          provider_output_url: providerOutputUrl,
          output_url: finalOutputUrl,
          stage: "complete",
          total_duration_seconds: Math.round((Date.now() - mergeStartTime) / 1000),
        },
      });
    }

    // Send callback if provided
    if (request.callback_url) {
      await fetch(request.callback_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          status: "completed",
          output_url: finalOutputUrl,
        }),
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Merge process error:", error);

    const errorOutput = {
      error: error.message,
      stage: "failed",
      elapsed_seconds: Math.round((Date.now() - mergeStartTime) / 1000),
    };

    if (steps.mergeStepId) {
      await updateJobStep(steps.mergeStepId, "failed", { 
        errorMessage: error.message,
        outputData: errorOutput,
      });
    }

    if (steps.finalizeStepId) {
      await updateJobStep(steps.finalizeStepId, "failed", { 
        errorMessage: error.message,
        outputData: errorOutput,
      });
    }
    
    await supabase
      .from("jobs")
      .update({
        status: "failed",
        error_message: error.message,
      })
      .eq("id", jobId);

    // Send failure callback
    if (request.callback_url) {
      await fetch(request.callback_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          status: "failed",
          error: error.message,
        }),
      });
    }
  }
}
