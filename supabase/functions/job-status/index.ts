import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { startMergeWithFFmpeg, checkMergeStatus } from "../_shared/huggingface.ts";

// إعدادات
const MAX_CONSECUTIVE_FAILURES = 5;

// ===== LOGGING =====
function logInfo(msg: string, data?: any) { console.log(`[STATUS] ${msg}`, data || ''); }
function logError(msg: string, err?: any) { console.error(`[STATUS-ERR] ${msg}`, err || ''); }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // 1. استخراج معرف المهمة
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/");
    let jobId = pathParts[pathParts.length - 1] === "job-status" ? null : pathParts[pathParts.length - 1];
    if (!jobId) jobId = url.searchParams.get("job_id");

    if (!jobId) return new Response(JSON.stringify({ error: "Missing job_id" }), { status: 400, headers: corsHeaders });

    // 2. جلب بيانات المهمة
    const { data: job, error } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    if (error || !job) return new Response(JSON.stringify({ error: "Job not found" }), { status: 404, headers: corsHeaders });

    // 3. جلب الخطوات
    const { data: steps } = await supabase.from("job_steps").select("*").eq("job_id", jobId).order("step_order");
    const mergeStep = steps?.find((s: any) => s.step_name === "media_merge");

    // ===== المنطق الذكي (LAZY START LOGIC) =====
    
    // الحالة أ: المهمة مسجلة لكن لم تبدأ على السيرفر الخارجي بعد
    if (job.status === "pending_start" || (mergeStep && mergeStep.status === "pending")) {
      logInfo(`Job ${jobId} needs starting. Attempting to start on HF...`);
      
      try {
        // تحديث الحالة ليعرف المستخدم أننا نحاول
        await supabase.from("jobs").update({ status: "processing", progress: 5 }).eq("id", jobId);
        await supabase.from("job_steps").update({ status: "processing", output_data: { stage: "starting_server" } }).eq("id", mergeStep.id);

        // محاولة البدء (قد تستغرق بضع ثوانٍ)
        const result = await startMergeWithFFmpeg({
          images: job.input_data.images,
          audio: job.input_data.audio,
          output_format: "mp4"
        });

        // حفظ معرف المهمة الخارجي
        await supabase.from("job_steps").update({
          output_data: { 
            provider_job_id: result.job_id, 
            provider: "ffmpeg-space",
            stage: "processing" 
          }
        }).eq("id", mergeStep.id);

        logInfo(`Job started successfully on HF: ${result.job_id}`);

      } catch (startError: any) {
        logError("Failed to start job on HF", startError);
        // لا نفشل المهمة فوراً، ربما تنجح في المحاولة التالية (Polling التالي)
        // لكن نعيد رسالة خطأ للمستخدم ليعرف السبب
        return new Response(JSON.stringify({
          job_id: jobId,
          status: "processing",
          progress: 5,
          is_stuck: true,
          stuck_warning: "Waiting for server to wake up...",
          logs: [{ step: "Initialization", status: "failed", message: `Retrying connection: ${startError.message}` }]
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // الحالة ب: المهمة بدأت ولدينا Provider ID -> نتابع الحالة (Normal Polling)
    else if (job.status === "processing" && mergeStep?.output_data?.provider_job_id) {
      const providerId = mergeStep.output_data.provider_job_id;
      const failures = mergeStep.output_data.consecutive_failures || 0;

      try {
        const status = await checkMergeStatus(providerId);
        
        if (status.status === "completed" && status.output_url) {
          // النجاح! تحميل وحفظ
          logInfo("Job completed on provider. Downloading...");
          const fileReq = await fetch(status.output_url);
          const buf = await fileReq.arrayBuffer();
          const path = `${jobId}/final.mp4`;
          
          await supabase.storage.from("media-output").upload(path, buf, { contentType: "video/mp4", upsert: true });
          const { data: pub } = supabase.storage.from("media-output").getPublicUrl(path);

          await supabase.from("jobs").update({ status: "completed", progress: 100, output_url: pub.publicUrl }).eq("id", jobId);
          await supabase.from("job_steps").update({ status: "completed", output_data: { output_url: pub.publicUrl } }).eq("id", mergeStep.id);
          
          // تحديث خطوة النشر أيضاً
          const pubStep = steps?.find((s: any) => s.step_name === "publishing");
          if (pubStep) await supabase.from("job_steps").update({ status: "completed" }).eq("id", pubStep.id);
        } else if (status.status === "processing") {
          // تحديث التقدم
          const prog = 10 + Math.round((status.progress || 0) * 0.8);
          await supabase.from("jobs").update({ progress: prog }).eq("id", jobId);
          // تصفير عداد الفشل عند النجاح
          if (failures > 0) {
             await supabase.from("job_steps").update({ output_data: { ...mergeStep.output_data, consecutive_failures: 0 } }).eq("id", mergeStep.id);
          }
        } else if (status.status === "failed") {
          throw new Error(status.error || "Provider reported failure");
        }

      } catch (pollErr: any) {
        logError("Polling error", pollErr);
        const newFailures = failures + 1;
        
        if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
          await supabase.from("jobs").update({ status: "failed", error_message: pollErr.message }).eq("id", jobId);
          await supabase.from("job_steps").update({ status: "failed", error_message: pollErr.message }).eq("id", mergeStep.id);
        } else {
          await supabase.from("job_steps").update({ 
            output_data: { ...mergeStep.output_data, consecutive_failures: newFailures, last_error: pollErr.message } 
          }).eq("id", mergeStep.id);
        }
      }
    }

    // بناء الرد النهائي
    // نعيد جلب البيانات المحدثة
    const { data: finalJob } = await supabase.from("jobs").select("*").eq("id", jobId).single();
    const { data: finalSteps } = await supabase.from("job_steps").select("*").eq("job_id", jobId).order("step_order");

    const logs = (finalSteps || []).map((s: any) => ({
      step: s.step_name,
      status: s.status,
      message: s.status === 'completed' ? `✅ ${s.step_name} Done` : 
               s.status === 'failed' ? `❌ ${s.error_message || 'Failed'}` : 
               s.output_data?.stage === 'starting_server' ? '⏳ Waking up server...' :
               `🔄 ${s.status}...`
    }));

    return new Response(JSON.stringify({
      job_id: finalJob.id,
      status: finalJob.status,
      progress: finalJob.progress,
      output_url: finalJob.output_url,
      logs,
      is_complete: finalJob.status === "completed"
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});
