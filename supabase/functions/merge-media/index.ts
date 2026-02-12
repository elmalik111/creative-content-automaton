import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";

interface MergeRequest {
  images?: string[];
  videos?: string[];
  audio: string;
  // Compatibility aliases
  imageUrl?: string;
  audioUrl?: string;
  image_url?: string;
  audio_url?: string;
}

// ===== VALIDATION =====
function isValidPublicUrl(url: string) {
  try { return new URL(url).protocol.startsWith("http"); } catch { return false; }
}

// ===== MAIN HANDLER =====
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const rawBody: MergeRequest = await req.json().catch(() => ({}));
    
    // Normalize inputs
    const images = rawBody.images?.length ? rawBody.images : 
                   rawBody.imageUrl ? [rawBody.imageUrl] : 
                   rawBody.image_url ? [rawBody.image_url] : [];
    const audio = rawBody.audio || rawBody.audioUrl || rawBody.audio_url || "";

    if (!audio || !images.length) {
      return new Response(JSON.stringify({ error: "Missing audio or images" }), { status: 400, headers: corsHeaders });
    }

    if (!isValidPublicUrl(audio) || !isValidPublicUrl(images[0])) {
      return new Response(JSON.stringify({ error: "Invalid URLs provided" }), { status: 400, headers: corsHeaders });
    }

    // 1. إنشاء المهمة في قاعدة البيانات فقط (بدون اتصال خارجي)
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        type: "merge",
        status: "pending_start", // حالة جديدة: بانتظار البدء
        progress: 0,
        input_data: { images, audio },
      })
      .select()
      .single();

    if (jobError) throw jobError;

    // 2. إنشاء الخطوات
    await supabase.from("job_steps").insert([
      { job_id: job.id, step_name: "validate_inputs", step_order: 1, status: "completed" },
      { job_id: job.id, step_name: "media_merge", step_order: 2, status: "pending" }, // pending هنا
      { job_id: job.id, step_name: "publishing", step_order: 3, status: "pending" }
    ]);

    // 3. الرد فوراً (فائق السرعة)
    return new Response(
      JSON.stringify({
        job_id: job.id,
        status: "pending",
        message: "Job registered. Initialization will start via status polling."
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
