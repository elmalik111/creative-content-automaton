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

    const body = await req.json().catch(() => ({}));
    const jobId = body.jobId || body.job_id;

    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "jobId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch current job status
    const { data: job, error: fetchError } = await supabase
      .from("jobs")
      .select("id, status")
      .eq("id", jobId)
      .maybeSingle();

    if (fetchError) {
      throw new Error(`Failed to fetch job: ${fetchError.message}`);
    }

    if (!job) {
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if job can be cancelled
    if (job.status === "completed") {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Cannot cancel a completed job",
          job_id: jobId,
          status: job.status
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (job.status === "failed") {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Job has already failed",
          job_id: jobId,
          status: job.status
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date().toISOString();
    const cancelMessage = "Cancelled by user";

    // Update job status to failed with cancel message
    const { error: jobUpdateError } = await supabase
      .from("jobs")
      .update({
        status: "failed",
        error_message: cancelMessage,
        updated_at: now,
      })
      .eq("id", jobId);

    if (jobUpdateError) {
      throw new Error(`Failed to update job: ${jobUpdateError.message}`);
    }

    // Update all pending/processing steps to failed
    const { error: stepsUpdateError } = await supabase
      .from("job_steps")
      .update({
        status: "failed",
        error_message: cancelMessage,
        completed_at: now,
      })
      .eq("job_id", jobId)
      .in("status", ["pending", "processing"]);

    if (stepsUpdateError) {
      console.error("Failed to update job steps:", stepsUpdateError);
      // Don't throw - job was already cancelled
    }

    console.log(`Job ${jobId} cancelled by user`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Job cancelled successfully",
        job_id: jobId,
        cancelled_at: now,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Error in cancel-job:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
