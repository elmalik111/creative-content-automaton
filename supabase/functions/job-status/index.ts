import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.1";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { checkMergeStatus } from "../_shared/huggingface.ts";

const MAX_CONSECUTIVE_FAILURES = 20;

// ===== AUTH HELPER =====
async function validateAuth(req: Request): Promise<{ valid: boolean; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (authHeader === `Bearer ${serviceRoleKey}`) {
    return { valid: true };
  }
  
  if (!authHeader?.startsWith("Bearer ")) {
    return { valid: false, error: "Authorization header required" };
  }
  
  const token = authHeader.replace("Bearer ", "");
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data?.user) {
    return { valid: false, error: "Invalid or expired token" };
  }
  
  return { valid: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await validateAuth(req);
    if (!auth.valid) {
      return new Response(
        JSON.stringify({ error: auth.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const maybeFromPath = pathParts[pathParts.length - 1];

    let jobId: string | null = null;

    if (maybeFromPath && maybeFromPath !== "job-status") {
      jobId = maybeFromPath;
    } else {
      const fromQuery = url.searchParams.get("job_id") || url.searchParams.get("jobId");
      if (fromQuery) jobId = fromQuery;
      else {
        const body = await req.json().catch(() => ({} as any));
        jobId = body?.job_id || body?.jobId || null;
      }
    }

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "job_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) throw new Error(`Failed to fetch job: ${jobError.message}`);

    if (!job) {
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let { data: steps, error: stepsError } = await supabase
      .from("job_steps")
      .select("*")
      .eq("job_id", jobId)
      .order("step_order");

    if (stepsError) throw new Error(`Failed to fetch job steps: ${stepsError.message}`);

    // --- MERGE TICK ---
    const mergeStep = (steps || []).find((s: any) => s.step_name === "media_merge" && s.status === "processing");
    const publishStep = (steps || []).find((s: any) => s.step_name === "publishing");

    const mergeOutput = (mergeStep?.output_data || {}) as any;
    const providerJobId: string | undefined =
      mergeOutput?.provider_job_id || mergeOutput?.providerJobId || mergeOutput?.job_id || mergeOutput?.jobId;

    if (job.status === "processing" && providerJobId && !job.output_url) {
      // Track consecutive failures
      const currentFailures: number = mergeOutput?.consecutive_failures || 0;

      try {
        const providerStatus = await checkMergeStatus(providerJobId);

        // Success – reset failure counter
        if (providerStatus.status === "processing") {
          const mapped = Math.min(
            89,
            Math.max(
              job.progress || 75,
              75 + Math.round(((providerStatus.progress ?? 0) / 100) * 14)
            )
          );

          await supabase.from("jobs").update({ progress: mapped }).eq("id", jobId);

          if (mergeStep?.id) {
            await supabase
              .from("job_steps")
              .update({
                output_data: {
                  ...(mergeOutput || {}),
                  provider: "ffmpeg-space",
                  provider_job_id: providerJobId,
                  provider_progress: providerStatus.progress,
                  provider_status: providerStatus.status,
                  stage: "processing",
                  consecutive_failures: 0, // Reset on successful check
                },
              })
              .eq("id", mergeStep.id);
          }
        }

        if (providerStatus.status === "failed") {
          const msg = providerStatus.error || "FFmpeg provider merge failed";
          if (mergeStep?.id) {
            await supabase
              .from("job_steps")
              .update({ status: "failed", error_message: msg, completed_at: new Date().toISOString() })
              .eq("id", mergeStep.id);
          }

          await supabase
            .from("jobs")
            .update({ status: "failed", error_message: msg })
            .eq("id", jobId);
        }

        if (providerStatus.status === "completed") {
          if (!providerStatus.output_url) {
            throw new Error("Merge completed but no output URL returned");
          }

          const providerOutputUrl = providerStatus.output_url;
          const videoResp = await fetch(providerOutputUrl);
          if (!videoResp.ok) {
            throw new Error(`Failed to download merged video (HTTP ${videoResp.status})`);
          }
          const videoBuffer = await videoResp.arrayBuffer();

          const finalVideoName = `${jobId}/final_video.mp4`;
          const { error: uploadErr } = await supabase.storage
            .from("media-output")
            .upload(finalVideoName, videoBuffer, {
              contentType: "video/mp4",
              upsert: true,
            });

          if (uploadErr) throw new Error(`Final video upload failed: ${uploadErr.message}`);

          const { data: publicUrlData } = supabase.storage
            .from("media-output")
            .getPublicUrl(finalVideoName);

          const finalUrl = publicUrlData.publicUrl;

          if (mergeStep?.id) {
            await supabase
              .from("job_steps")
              .update({
                status: "completed",
                completed_at: new Date().toISOString(),
                output_data: {
                  ...(mergeOutput || {}),
                  provider: "ffmpeg-space",
                  provider_job_id: providerJobId,
                  provider_output_url: providerOutputUrl,
                  output_url: finalUrl,
                  stage: "persisted",
                  consecutive_failures: 0,
                },
              })
              .eq("id", mergeStep.id);
          }

          await supabase
            .from("jobs")
            .update({ status: "completed", progress: 100, output_url: finalUrl, error_message: null })
            .eq("id", jobId);

          if (publishStep?.id && publishStep.status !== "completed") {
            await supabase
              .from("job_steps")
              .update({
                status: "completed",
                started_at: publishStep.started_at || new Date().toISOString(),
                completed_at: new Date().toISOString(),
                output_data: { video_url: finalUrl, publish_results: {} },
              })
              .eq("id", publishStep.id);
          }
        }
      } catch (e) {
        console.error("Merge tick error:", e);

        // Increment failure counter
        const newFailures = currentFailures + 1;
        console.warn(`Merge tick failure ${newFailures}/${MAX_CONSECUTIVE_FAILURES} for job ${jobId}`);

        if (mergeStep?.id) {
          await supabase
            .from("job_steps")
            .update({
              output_data: {
                ...(mergeOutput || {}),
                consecutive_failures: newFailures,
                last_error: e instanceof Error ? e.message : String(e),
              },
            })
            .eq("id", mergeStep.id);
        }

        // If too many consecutive failures, fail the job
        if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
          const failMsg = `سيرفر الدمج لا يستجيب بعد ${MAX_CONSECUTIVE_FAILURES} محاولة فاشلة متتالية`;

          if (mergeStep?.id) {
            await supabase
              .from("job_steps")
              .update({
                status: "failed",
                error_message: failMsg,
                completed_at: new Date().toISOString(),
              })
              .eq("id", mergeStep.id);
          }

          await supabase
            .from("jobs")
            .update({ status: "failed", error_message: failMsg })
            .eq("id", jobId);
        }
      }

      // Refresh after tick
      const refreshedJob = await supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
      if (refreshedJob.data) {
        Object.assign(job, {
          status: refreshedJob.data.status,
          progress: refreshedJob.data.progress,
          output_url: refreshedJob.data.output_url,
          error_message: refreshedJob.data.error_message,
          updated_at: refreshedJob.data.updated_at,
        });
      }

      const refreshedSteps = await supabase
        .from("job_steps")
        .select("*")
        .eq("job_id", jobId)
        .order("step_order");
      if (refreshedSteps.data) steps = refreshedSteps.data;
    }

    // Build logs
    const logs: Array<{
      step: string;
      status: string;
      message: string;
      duration_ms?: number;
      started_at?: string;
      completed_at?: string;
      output_data?: unknown;
      error?: string;
    }> = [];

    for (const step of steps || []) {
      let duration_ms: number | undefined;
      if (step.started_at && step.completed_at) {
        duration_ms = new Date(step.completed_at).getTime() - new Date(step.started_at).getTime();
      }

      let message = "";
      switch (step.status) {
        case "pending":
          message = `⏳ ${step.step_name} في انتظار البدء`;
          break;
        case "processing":
          message = `🔄 ${step.step_name} جارٍ التنفيذ...`;
          break;
        case "completed":
          message = `✅ ${step.step_name} اكتمل${duration_ms ? ` (${(duration_ms / 1000).toFixed(1)}s)` : ""}`;
          break;
        case "failed":
          message = `❌ ${step.step_name} فشل: ${step.error_message || "خطأ غير معروف"}`;
          break;
        default:
          message = step.step_name;
      }

      logs.push({
        step: step.step_name,
        status: step.status,
        message,
        duration_ms,
        started_at: step.started_at,
        completed_at: step.completed_at,
        output_data: step.output_data,
        error: step.error_message || undefined,
      });
    }

    // Stuck detection
    let isStuck = false;
    let stuckWarning: string | undefined;

    if (job.status === "processing") {
      const processingStep = (steps || []).find((s: any) => s.status === "processing");
      if (processingStep?.started_at) {
        const processingDuration = Date.now() - new Date(processingStep.started_at).getTime();
        if (processingDuration > 3 * 60 * 1000) {
          isStuck = true;
          stuckWarning = `العملية متعطلة منذ ${Math.floor(processingDuration / 60000)} دقيقة في خطوة "${processingStep.step_name}"`;
        }
      }
    }

    return new Response(
      JSON.stringify({
        job_id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        output_url: job.output_url,
        error_message: job.error_message,
        created_at: job.created_at,
        updated_at: job.updated_at,
        logs,
        is_stuck: isStuck,
        stuck_warning: stuckWarning,
        is_complete: job.status === "completed",
        is_failed: job.status === "failed",
        can_cancel: job.status === "pending" || job.status === "processing",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Error in job-status:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
