import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.1";
import { supabase, corsHeaders } from "../_shared/supabase.ts";

// ===== AUTH HELPER =====
async function validateAuth(req: Request): Promise<{ valid: boolean; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  
  // Check for service role key (internal calls)
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (authHeader === `Bearer ${serviceRoleKey}`) {
    return { valid: true };
  }
  
  // Check for user JWT
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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== SECURITY: Validate authentication =====
    const auth = await validateAuth(req);
    if (!auth.valid) {
      return new Response(
        JSON.stringify({ error: auth.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract jobId from URL path: /job-status/{jobId}
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const jobId = pathParts[pathParts.length - 1];

    if (!jobId || jobId === "job-status") {
      return new Response(
        JSON.stringify({ error: "Job ID is required in URL path" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch job details
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) {
      throw new Error(`Failed to fetch job: ${jobError.message}`);
    }

    if (!job) {
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch job steps
    const { data: steps, error: stepsError } = await supabase
      .from("job_steps")
      .select("*")
      .eq("job_id", jobId)
      .order("step_order");

    if (stepsError) {
      throw new Error(`Failed to fetch job steps: ${stepsError.message}`);
    }

    // Build logs array from steps with timing info
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

    // Check if job appears stuck (processing for too long without progress)
    let isStuck = false;
    let stuckWarning: string | undefined;
    
    if (job.status === "processing") {
      const processingStep = (steps || []).find((s) => s.status === "processing");
      if (processingStep?.started_at) {
        const processingDuration = Date.now() - new Date(processingStep.started_at).getTime();
        // Warn if processing for more than 3 minutes
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
        // Convenience flags for client
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
