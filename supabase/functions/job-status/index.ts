import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.1";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { checkMergeStatus, isFFmpegSpaceHealthy } from "../_shared/huggingface.ts";

// إعدادات المراقبة
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_JOB_AGE_MS = 30 * 60 * 1000; // 30 دقيقة كحد أقصى

// ===== LOGGING =====
function logInfo(message: string, data?: any) {
  console.log(`[JOB-STATUS] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function logError(message: string, error?: any) {
  console.error(`[JOB-STATUS] ${message}`, error ? (error instanceof Error ? error.message : JSON.stringify(error)) : '');
}

// ===== AUTH =====
async function validateAuth(req: Request) {
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (authHeader === `Bearer ${serviceRoleKey}`) return { valid: true };
  if (!authHeader?.startsWith("Bearer ")) return { valid: false, error: "Auth header required" };
  
  const token = authHeader.replace("Bearer ", "");
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data?.user) return { valid: false, error: "Invalid token" };
  return { valid: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await validateAuth(req);
    if (!auth.valid) {
      return new Response(JSON.stringify({ error: auth.error }), { status: 401, headers: corsHeaders });
    }

    // استخراج Job ID
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    let jobId = pathParts[pathParts.length - 1] === "job-status" ? null : pathParts[pathParts.length - 1];
    if (!jobId) jobId = url.searchParams.get("job_id");

    if (!jobId) {
      return new Response(JSON.stringify({ error: "job_id required" }), { status: 400, headers: corsHeaders });
    }

    // جلب بيانات المهمة
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), { status: 404, headers: corsHeaders });
    }

    // جلب الخطوات
    let { data: steps } = await supabase
      .from("job_steps")
      .select("*")
      .eq("job_id", jobId)
      .order("step_order");

    // تحديد الخطوة الحالية للمعالجة
    const mergeStep = steps?.find((s: any) => s.step_name === "media_merge" || s.step_name === "merge");
    
    // === المنطق الأساسي للتحديث (POLLING LOGIC) ===
    
    // إذا كانت المهمة قيد المعالجة ولدينا معرف مهمة خارجي (Provider Job ID)
    if (job.status === "processing" && mergeStep && mergeStep.status === "processing") {
      const outputData = mergeStep.output_data || {};
      const providerJobId = outputData.provider_job_id || outputData.job_id;

      if (providerJobId) {
        logInfo(`Polling external provider for job ${providerJobId}`);
        
        try {
          // 1. فحص الحالة من السيرفر الخارجي
          const providerStatus = await checkMergeStatus(providerJobId);
          logInfo(`Provider response: ${providerStatus.status}`, providerStatus);

          // 2. تحديث الحالة بناءً على الرد
          if (providerStatus.status === "processing") {
            // تحديث التقدم فقط
            const newProgress = Math.min(90, 10 + Math.round((providerStatus.progress || 0) * 0.8));
            
            await supabase.from("jobs").update({ progress: newProgress }).eq("id", jobId);
            await supabase.from("job_steps").update({
              output_data: {
                ...outputData,
                provider_status: "processing",
                provider_progress: providerStatus.progress,
                last_check: new Date().toISOString()
              }
            }).eq("id", mergeStep.id);
          }
          else if (providerStatus.status === "completed" && providerStatus.output_url) {
            // اكتملت المهمة! تحميل الفيديو وحفظه
            logInfo(`Job completed! Downloading from ${providerStatus.output_url}`);
            
            const videoResp = await fetch(providerStatus.output_url);
            if (videoResp.ok) {
              const videoBuffer = await videoResp.arrayBuffer();
              const fileName = `${jobId}/final.mp4`;
              
              await supabase.storage
                .from("media-output")
                .upload(fileName, videoBuffer, { contentType: "video/mp4", upsert: true });
                
              const { data: publicUrl } = supabase.storage
                .from("media-output")
                .getPublicUrl(fileName);
                
              // تحديث كل شيء للإكمال
              await supabase.from("job_steps").update({
                status: "completed",
                completed_at: new Date().toISOString(),
                output_data: { ...outputData, output_url: publicUrl.publicUrl }
              }).eq("id", mergeStep.id);
              
              // تحديث الخطوة الأخيرة (Publishing)
              const publishStep = steps?.find((s: any) => s.step_name === "publishing");
              if (publishStep) {
                await supabase.from("job_steps").update({
                  status: "completed",
                  completed_at: new Date().toISOString(),
                  output_data: { video_url: publicUrl.publicUrl }
                }).eq("id", publishStep.id);
              }

              await supabase.from("jobs").update({
                status: "completed",
                progress: 100,
                output_url: publicUrl.publicUrl
              }).eq("id", jobId);
              
              // تحديث الكائن المحلي للرد السريع
              job.status = "completed";
              job.output_url = publicUrl.publicUrl;
              job.progress = 100;
            }
          }
          else if (providerStatus.status === "failed") {
            // فشلت المهمة
            throw new Error(providerStatus.error || "External job failed");
          }
          
        } catch (err) {
          // التعامل مع أخطاء Polling
          const errorMsg = err instanceof Error ? err.message : String(err);
          const failures = (outputData.consecutive_failures || 0) + 1;
          
          logError(`Polling failed (${failures}/${MAX_CONSECUTIVE_FAILURES})`, errorMsg);
          
          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            // فشل نهائي
            await supabase.from("jobs").update({ 
              status: "failed", 
              error_message: `Lost connection to render server: ${errorMsg}` 
            }).eq("id", jobId);
            
            await supabase.from("job_steps").update({
              status: "failed",
              error_message: errorMsg
            }).eq("id", mergeStep.id);
          } else {
            // تسجيل الفشل المؤقت
            await supabase.from("job_steps").update({
              output_data: { ...outputData, consecutive_failures: failures, last_error: errorMsg }
            }).eq("id", mergeStep.id);
          }
        }
      }
    }
    
    // إعادة جلب الخطوات المحدثة
    const { data: updatedSteps } = await supabase
      .from("job_steps")
      .select("*")
      .eq("job_id", jobId)
      .order("step_order");

    // بناء الرد النهائي
    const logs = (updatedSteps || []).map((step: any) => ({
      step: step.step_name,
      status: step.status,
      message: step.status === 'completed' ? `✅ ${step.step_name} completed` : 
               step.status === 'processing' ? `🔄 Processing ${step.step_name}...` : 
               step.status === 'failed' ? `❌ Failed: ${step.error_message}` : `⏳ ${step.step_name} pending`,
      created_at: step.created_at
    }));

    return new Response(
      JSON.stringify({
        job_id: job.id,
        status: job.status,
        progress: job.progress,
        output_url: job.output_url,
        logs: logs,
        is_complete: job.status === "completed"
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
