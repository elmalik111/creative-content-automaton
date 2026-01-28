import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
