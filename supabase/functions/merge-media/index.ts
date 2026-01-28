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

async function processMediaMerge(
  jobId: string, 
  request: MergeRequest,
  steps: { validateStepId?: string; mergeStepId?: string; finalizeStepId?: string }
) {
  try {
    // Step 1: Validate inputs
    if (steps.validateStepId) {
      await updateJobStep(steps.validateStepId, "processing", {
        outputData: {
          images: request.images?.length || 0,
          videos: request.videos?.length || 0,
          hasAudio: !!request.audio,
        },
      });
    }

    if (await isJobCancelled(jobId)) return;
    
    await supabase
      .from("jobs")
      .update({ progress: 10 })
      .eq("id", jobId);

    if (steps.validateStepId) {
      await updateJobStep(steps.validateStepId, "completed");
    }

    // Step 2: Merge media
    if (steps.mergeStepId) {
      await updateJobStep(steps.mergeStepId, "processing", {
        outputData: { provider: "huggingface-space", endpoint: "merge" },
      });
    }

    if (await isJobCancelled(jobId)) return;

    await supabase
      .from("jobs")
      .update({ progress: 30 })
      .eq("id", jobId);

    // While waiting for the external merge, keep progress moving a bit (and allow cancellation)
    let mergeDone = false;
    const ticker = (async () => {
      let p = 30;
      while (!mergeDone && p < 70) {
        await delay(3500);
        if (await isJobCancelled(jobId)) return;
        p += 5;
        await supabase.from("jobs").update({ progress: p }).eq("id", jobId);
      }
    })();

    // Call HuggingFace Space for merge
    const result = await mergeMediaWithFFmpeg({
      images: request.images,
      videos: request.videos,
      audio: request.audio,
      output_format: "mp4",
    });

    mergeDone = true;
    await ticker.catch(() => undefined);

    if (await isJobCancelled(jobId)) return;

    await supabase
      .from("jobs")
      .update({ progress: 80 })
      .eq("id", jobId);

    if (result.status === "failed") {
      throw new Error(result.error || "Merge failed");
    }

    if (steps.mergeStepId) {
      await updateJobStep(steps.mergeStepId, "completed");
    }

    if (steps.finalizeStepId) {
      await updateJobStep(steps.finalizeStepId, "processing");
    }

    // Mark as complete
    await supabase
      .from("jobs")
      .update({
        status: "completed",
        progress: 100,
        output_url: result.output_url,
      })
      .eq("id", jobId);

    if (steps.finalizeStepId) {
      await updateJobStep(steps.finalizeStepId, "completed", {
        outputData: { output_url: result.output_url },
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
          output_url: result.output_url,
        }),
      });
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Merge process error:", error);

    if (steps.mergeStepId) {
      await updateJobStep(steps.mergeStepId, "failed", { errorMessage: error.message });
    }

    if (steps.finalizeStepId) {
      await updateJobStep(steps.finalizeStepId, "failed", { errorMessage: error.message });
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
