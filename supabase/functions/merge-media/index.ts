import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { mergeMediaWithFFmpeg } from "../_shared/huggingface.ts";

interface MergeRequest {
  images?: string[];
  videos?: string[];
  audio: string;
  callback_url?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: MergeRequest = await req.json();

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

    // Start merge process in background (non-blocking)
    processMediaMerge(job.id, body).catch(console.error);

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

async function processMediaMerge(jobId: string, request: MergeRequest) {
  try {
    // Update progress
    await supabase
      .from("jobs")
      .update({ progress: 10 })
      .eq("id", jobId);

    // Call HuggingFace Space for merge
    const result = await mergeMediaWithFFmpeg({
      images: request.images,
      videos: request.videos,
      audio: request.audio,
      output_format: "mp4",
    });

    // Update progress
    await supabase
      .from("jobs")
      .update({ progress: 50 })
      .eq("id", jobId);

    if (result.status === "failed") {
      throw new Error(result.error || "Merge failed");
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
