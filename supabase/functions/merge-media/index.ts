import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { startMergeWithFFmpeg } from "../_shared/huggingface.ts"; // نستخدم start فقط وليس merge الكاملة

interface MergeRequest {
  images?: string[];
  videos?: string[];
  audio: string;
  callback_url?: string;
  test?: boolean;
  health?: boolean;
  imageUrl?: string;
  audioUrl?: string;
  image_url?: string;
  audio_url?: string;
  audio_path?: string;
}

// ===== INPUT VALIDATION =====
const ALLOWED_AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"];
const ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
const ALLOWED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".webm", ".mkv"];
const MAX_MEDIA_FILES = 50;

function isValidPublicUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168.")) return false;
    return true;
  } catch {
    return false;
  }
}

function hasValidExtension(url: string, allowedExtensions: string[]): boolean {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    const host = urlObj.hostname.toLowerCase();
    if (allowedExtensions.some((ext) => pathname.includes(ext))) return true;
    if (host.includes("supabase.co") && pathname.includes("/storage/")) return true;
    if (host.endsWith(".hf.space")) return true;
    const trusted = ["replicate.delivery", "pollinations.ai", "fal.media"];
    if (trusted.some((d) => host.includes(d))) return true;
    return false;
  } catch {
    return false;
  }
}

function validateMediaUrls(request: MergeRequest): { valid: boolean; error?: string } {
  if (!isValidPublicUrl(request.audio)) return { valid: false, error: "Invalid audio URL" };
  if (!hasValidExtension(request.audio, ALLOWED_AUDIO_EXTENSIONS)) return { valid: false, error: "Invalid audio format" };
  
  for (const imageUrl of request.images || []) {
    if (!isValidPublicUrl(imageUrl)) return { valid: false, error: "Invalid image URL" };
    if (!hasValidExtension(imageUrl, ALLOWED_IMAGE_EXTENSIONS)) return { valid: false, error: "Invalid image format" };
  }
  return { valid: true };
}

// ===== JOB HELPERS =====
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

async function updateJobStep(stepId: string, status: string, data?: any) {
  const update: any = { status };
  if (status === 'processing') update.started_at = new Date().toISOString();
  if (status === 'completed') update.completed_at = new Date().toISOString();
  if (data) update.output_data = data;
  
  await supabase.from("job_steps").update(update).eq("id", stepId);
}

// ===== MAIN HANDLER =====
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Parse & Validate
    const rawBody: MergeRequest = await req.json().catch(() => ({} as MergeRequest));
    
    // Health check
    if (rawBody?.test || rawBody?.health) {
      return new Response(JSON.stringify({ ok: true, message: "Marge is ready" }), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // Normalize inputs
    const body: MergeRequest = {
      ...rawBody,
      images: rawBody.images?.length ? rawBody.images : 
              rawBody.imageUrl ? [rawBody.imageUrl] : 
              rawBody.image_url ? [rawBody.image_url] : undefined,
      audio: rawBody.audio || rawBody.audioUrl || rawBody.audio_url || "",
    };

    if (!body.audio || (!body.images?.length && !body.videos?.length)) {
      return new Response(JSON.stringify({ error: "Missing audio or images" }), { 
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const validation = validateMediaUrls(body);
    if (!validation.valid) {
      return new Response(JSON.stringify({ error: validation.error }), { 
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    // 2. Create Job in DB
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        type: "merge",
        status: "processing", // نبدأ مباشرة بـ processing
        progress: 5,
        input_data: { images: body.images, audio: body.audio },
      })
      .select()
      .single();

    if (jobError) throw new Error(`DB Error: ${jobError.message}`);

    // 3. Create Steps (يتم إنشاؤها فوراً لتظهر في الواجهة)
    const validateStepId = await createJobStep(job.id, "validate_inputs", 1);
    const mergeStepId = await createJobStep(job.id, "media_merge", 2); // لاحظ الاسم المتطابق مع job-status
    const publishStepId = await createJobStep(job.id, "publishing", 3);

    // 4. Mark validation as complete immediately
    if (validateStepId) {
      await updateJobStep(validateStepId, "completed", { 
        valid: true, 
        files_count: (body.images?.length || 0) + 1 
      });
    }

    // 5. Start Merge on Hugging Face (Async Start)
    // هنا التغيير الجذري: لا ننتظر النتيجة النهائية، فقط نرسل الأمر للسيرفر
    if (mergeStepId) {
      await updateJobStep(mergeStepId, "processing", { stage: "initiating_request" });
    }

    console.log(`[Marge] Starting HF job for ${job.id}...`);
    
    // استدعاء دالة البدء فقط (بدون polling)
    const hfResult = await startMergeWithFFmpeg({
      images: body.images,
      videos: body.videos,
      audio: body.audio,
      output_format: "mp4"
    });

    if (hfResult.status === "failed") {
      throw new Error(hfResult.error || "Failed to start job on HF Server");
    }

    // 6. Save Provider Job ID to DB
    // هذا هو الرابط الذي سيستخدمه job-status للمتابعة لاحقاً
    if (mergeStepId) {
      await updateJobStep(mergeStepId, "processing", {
        provider: "ffmpeg-space",
        provider_job_id: hfResult.job_id, // حفظ معرف المهمة الخارجي
        stage: "processing_on_server",
        started_at: new Date().toISOString()
      });
    }

    await supabase.from("jobs").update({ progress: 10 }).eq("id", job.id);

    // 7. Return Success Immediately
    // نرجع للمستخدم فوراً، بينما السيرفر الخارجي يعمل، و job-status سيتابع التحديث
    return new Response(
      JSON.stringify({
        job_id: job.id,
        status: "processing",
        message: "Merge job started successfully. Progress will be updated via status polling.",
        provider_job_id: hfResult.job_id
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Marge Error:", error);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
