import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.1";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { startMergeWithFFmpeg } from "../_shared/huggingface.ts";

async function validateAuth(req: Request): Promise<{ valid: boolean; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (authHeader === `Bearer ${serviceRoleKey}`) return { valid: true };
  if (!authHeader?.startsWith("Bearer ")) return { valid: false, error: "Authorization header required" };

  const token = authHeader.replace("Bearer ", "");
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data?.user) return { valid: false, error: "Invalid or expired token" };
  return { valid: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await validateAuth(req);
    if (!auth.valid) {
      return new Response(JSON.stringify({ error: auth.error }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const jobId = body.job_id || body.jobId;
    if (!jobId) {
      return new Response(JSON.stringify({ error: "job_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[RETRY-MERGE] بدء إعادة الدمج للمهمة: ${jobId}`);

    // Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch steps
    const { data: steps } = await supabase
      .from("job_steps")
      .select("*")
      .eq("job_id", jobId)
      .order("step_order");

    const mergeStep = (steps || []).find(
      (s: any) => s.step_name === "merge" || s.step_name === "media_merge"
    );
    const imageStep = (steps || []).find((s: any) => s.step_name === "image_generation");
    const voiceStep = (steps || []).find((s: any) => s.step_name === "voice_generation");

    // Get image URLs from image step or merge step output
    const mergeOutput = (mergeStep?.output_data || {}) as Record<string, any>;
    const imageOutput = (imageStep?.output_data || {}) as Record<string, any>;
    const voiceOutput = (voiceStep?.output_data || {}) as Record<string, any>;

    const imageUrls: string[] =
      mergeOutput.image_urls ||
      imageOutput.image_urls ||
      (job.input_data as any)?.images ||
      [];

    const audioUrl: string =
      mergeOutput.audio_url ||
      voiceOutput.audio_url ||
      (job.input_data as any)?.audio ||
      "";

    if (!imageUrls.length || !audioUrl) {
      return new Response(
        JSON.stringify({
          error: "لا توجد صور أو صوت متاح لإعادة الدمج",
          details: { imageCount: imageUrls.length, hasAudio: !!audioUrl },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[RETRY-MERGE] إعادة الدمج بـ ${imageUrls.length} صورة`);

    // Reset merge step
    if (mergeStep?.id) {
      await supabase.from("job_steps").update({
        status: "processing",
        error_message: null,
        completed_at: null,
        started_at: new Date().toISOString(),
        output_data: {
          image_urls: imageUrls,
          audio_url: audioUrl,
          retry: true,
          retry_at: new Date().toISOString(),
        },
      }).eq("id", mergeStep.id);
    }

    // Reset publishing step if exists
    const publishStep = (steps || []).find((s: any) => s.step_name === "publishing");
    if (publishStep?.id) {
      await supabase.from("job_steps").update({
        status: "pending",
        error_message: null,
        completed_at: null,
        started_at: null,
        output_data: null,
      }).eq("id", publishStep.id);
    }

    // Reset job status
    await supabase.from("jobs").update({
      status: "processing",
      progress: 75,
      error_message: null,
      output_url: null,
    }).eq("id", jobId);

    // Start merge
    const mergeResult = await startMergeWithFFmpeg({
      images: imageUrls,
      audio: audioUrl,
      output_format: "mp4",
    });

    console.log(`[RETRY-MERGE] نتيجة الدمج:`, JSON.stringify({
      status: mergeResult.status,
      has_output: !!mergeResult.output_url,
      has_job_id: !!mergeResult.job_id,
    }));

    if (mergeResult.output_url) {
      // Completed immediately
      if (mergeStep?.id) {
        await supabase.from("job_steps").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          output_data: { output_url: mergeResult.output_url },
        }).eq("id", mergeStep.id);
      }
      await supabase.from("jobs").update({
        status: "completed",
        progress: 100,
        output_url: mergeResult.output_url,
      }).eq("id", jobId);

      return new Response(
        JSON.stringify({ success: true, status: "completed", output_url: mergeResult.output_url }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (mergeResult.job_id) {
      const diagnostics = (mergeResult.diagnostics ?? {}) as Record<string, unknown>;
      if (mergeStep?.id) {
        await supabase.from("job_steps").update({
          output_data: {
            image_urls: imageUrls,
            audio_url: audioUrl,
            provider_job_id: mergeResult.job_id,
            provider: "ffmpeg-space",
            retry: true,
            retry_at: new Date().toISOString(),
            started_at: new Date().toISOString(),
            requested_image_count: imageUrls.length,
            payload_variant: diagnostics.payload_variant,
            provider_status_endpoint: diagnostics.provider_status_endpoint,
            diagnostics,
          },
        }).eq("id", mergeStep.id);
      }
      await supabase.from("jobs").update({ progress: 80 }).eq("id", jobId);

      return new Response(
        JSON.stringify({ success: true, status: "processing", merge_job_id: mergeResult.job_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (mergeResult.status === "failed") {
      const errMsg = mergeResult.error || "فشل إعادة الدمج";
      if (mergeStep?.id) {
        await supabase.from("job_steps").update({
          status: "failed",
          error_message: errMsg,
          completed_at: new Date().toISOString(),
        }).eq("id", mergeStep.id);
      }
      await supabase.from("jobs").update({
        status: "failed",
        error_message: errMsg,
      }).eq("id", jobId);

      return new Response(
        JSON.stringify({ success: false, error: errMsg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, status: "processing" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[RETRY-MERGE] خطأ:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
