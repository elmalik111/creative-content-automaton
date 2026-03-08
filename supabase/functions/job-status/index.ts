import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.1";
import { supabase, corsHeaders } from "../_shared/supabase.ts";
import { checkMergeStatus, isFFmpegSpaceHealthy } from "../_shared/huggingface.ts";

const MAX_CONSECUTIVE_FAILURES = 20;

// ===== LOGGING =====
function logInfo(message: string, data?: any) {
  console.log(`[JOB-STATUS] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function logError(message: string, error?: any) {
  console.error(`[JOB-STATUS] ${message}`, error ? (error instanceof Error ? error.message : JSON.stringify(error)) : '');
}

function logWarning(message: string, data?: any) {
  console.warn(`[JOB-STATUS] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

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

    logInfo(`فحص حالة المهمة: ${jobId}`);

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) {
      logError(`فشل جلب المهمة ${jobId}`, jobError);
      throw new Error(`Failed to fetch job: ${jobError.message}`);
    }

    if (!job) {
      logWarning(`المهمة غير موجودة: ${jobId}`);
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

    if (stepsError) {
      logError(`فشل جلب خطوات المهمة ${jobId}`, stepsError);
      throw new Error(`Failed to fetch job steps: ${stepsError.message}`);
    }

    // --- MERGE TICK WITH ENHANCED ERROR HANDLING ---
    const mergeStep = (steps || []).find((s: any) => s.step_name === "merge" && (s.status === "processing" || s.status === "pending"));
    const publishStep = (steps || []).find((s: any) => s.step_name === "publishing");

    const mergeOutput = (mergeStep?.output_data || {}) as any;
    const mergeDiagnostics = (mergeOutput?.diagnostics || {}) as any;
    const providerJobId: string | undefined =
      mergeOutput?.provider_job_id || mergeOutput?.providerJobId || mergeOutput?.job_id || mergeOutput?.jobId;
    const providerStatusEndpoint: string | undefined =
      mergeOutput?.provider_status_endpoint ||
      mergeOutput?.status_url ||
      mergeDiagnostics?.provider_status_endpoint ||
      mergeDiagnostics?.status_url;

    const autoStoppedByWatcher =
      job.status === "failed" &&
      !job.output_url &&
      !!providerJobId &&
      mergeStep?.status === "processing" &&
      typeof job.error_message === "string" &&
      (job.error_message.includes("توقفت المعالجة تلقائياً") ||
        job.error_message.toLowerCase().includes("stopped") ||
        job.error_message.toLowerCase().includes("auto"));

    if (autoStoppedByWatcher) {
      logInfo(`♻️ محاولة استعادة مهمة دمج متوقفة تلقائياً: ${jobId}`);
      await supabase
        .from("jobs")
        .update({
          status: "processing",
          error_message: null,
          progress: Math.max(80, job.progress || 0),
        })
        .eq("id", jobId);

      job.status = "processing";
      job.error_message = null;
      job.progress = Math.max(80, job.progress || 0);
    }

    // إذا merge step جاهز (pending + ready_for_merge) → ابدأ الدمج
    const mergeReady = mergeStep?.status === "pending" && (mergeStep?.output_data as any)?.ready_for_merge;
    if (mergeReady && job.status === "processing") {
      const mergeData = (mergeStep?.output_data || {}) as any;
      logInfo("🔀 بدء الدمج تلقائياً...", { images: mergeData.image_urls?.length, audio: !!mergeData.audio_url });

      const { startMergeWithFFmpeg } = await import("../_shared/huggingface.ts");
      const merge = await startMergeWithFFmpeg({
        images: mergeData.image_urls,
        audio: mergeData.audio_url,
        output_format: "mp4",
      });

      if (merge.status === "failed") {
        await supabase.from("jobs").update({ status: "failed", error_message: merge.error || "فشل الدمج" }).eq("id", jobId);
        return new Response(JSON.stringify({ status: "failed" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (merge.output_url) {
        // اكتمل فوراً
        await supabase.from("job_steps").update({ status: "completed", output_data: { output_url: merge.output_url } }).eq("id", mergeStep!.id);
        await supabase.from("jobs").update({ status: "completed", progress: 100, output_url: merge.output_url }).eq("id", jobId);
        logInfo("✅ اكتمل الدمج فوراً:", merge.output_url);
        return new Response(JSON.stringify({ status: "completed", output_url: merge.output_url }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (merge.job_id) {
        await supabase.from("job_steps").update({
          status: "processing",
          output_data: { ...mergeData, provider_job_id: merge.job_id, ready_for_merge: false },
        }).eq("id", mergeStep!.id);
        await supabase.from("jobs").update({ progress: 78 }).eq("id", jobId);
        logInfo("✅ merge queued:", merge.job_id);
        return new Response(JSON.stringify({ status: "processing", merge_job_id: merge.job_id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if ((job.status === "processing" || autoStoppedByWatcher) && providerJobId && !job.output_url) {
      logInfo(`مراقبة عملية الدمج للمهمة ${jobId} (معرف المزود: ${providerJobId})`);

      // Track consecutive failures
      const currentFailures: number = mergeOutput?.consecutive_failures || 0;

      try {
        const providerStatus = await checkMergeStatus(providerJobId, {
          statusEndpoint: providerStatusEndpoint,
        });
        logInfo(`حالة المزود [${providerJobId}]:`, providerStatus);

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
                  provider_status_endpoint: providerStatusEndpoint,
                  provider_progress: providerStatus.progress,
                  provider_status: providerStatus.status,
                  stage: "processing",
                  consecutive_failures: 0, // Reset on successful check
                  last_check: new Date().toISOString(),
                },
              })
              .eq("id", mergeStep.id);
          }

          logInfo(`✓ تحديث التقدم: ${mapped}%`);
        }

        if (providerStatus.status === "failed") {
          const msg = providerStatus.error || "FFmpeg provider merge failed";
          logError(`فشل الدمج على المزود [${providerJobId}]`, msg);

          if (mergeStep?.id) {
            await supabase
              .from("job_steps")
              .update({ 
                status: "failed", 
                error_message: msg, 
                completed_at: new Date().toISOString(),
                output_data: {
                  ...(mergeOutput || {}),
                  provider_status_endpoint: providerStatusEndpoint,
                  provider_error: msg,
                  failed_at: new Date().toISOString(),
                }
              })
              .eq("id", mergeStep.id);
          }

          await supabase
            .from("jobs")
            .update({ status: "failed", error_message: msg })
            .eq("id", jobId);
        }

        if (providerStatus.status === "completed") {
          logInfo(`✓✓✓ اكتمل الدمج على المزود [${providerJobId}] ✓✓✓`);

          if (!providerStatus.output_url) {
            throw new Error("Merge completed but no output URL returned");
          }

          const providerOutputUrl = providerStatus.output_url;
          logInfo(`تحميل الفيديو من: ${providerOutputUrl}`);

          const videoResp = await fetch(providerOutputUrl);
          if (!videoResp.ok) {
            throw new Error(`Failed to download merged video (HTTP ${videoResp.status})`);
          }
          const videoBuffer = await videoResp.arrayBuffer();
          logInfo(`✓ تم تحميل الفيديو (${videoBuffer.byteLength} bytes)`);

          const finalVideoName = `${jobId}/final_video.mp4`;
          const { error: uploadErr } = await supabase.storage
            .from("media-output")
            .upload(finalVideoName, videoBuffer, {
              contentType: "video/mp4",
              upsert: true,
            });

          if (uploadErr) {
            logError(`فشل رفع الفيديو النهائي`, uploadErr);
            throw new Error(`Final video upload failed: ${uploadErr.message}`);
          }

          const { data: publicUrlData } = supabase.storage
            .from("media-output")
            .getPublicUrl(finalVideoName);

          const finalUrl = publicUrlData.publicUrl;
          logInfo(`✓ الفيديو النهائي متاح على: ${finalUrl}`);

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
                  provider_status_endpoint: providerStatusEndpoint,
                  provider_output_url: providerOutputUrl,
                  output_url: finalUrl,
                  stage: "persisted",
                  consecutive_failures: 0,
                  completed_at: new Date().toISOString(),
                },
              })
              .eq("id", mergeStep.id);
          }

          await supabase
            .from("jobs")
            .update({ 
              status: "completed", 
              progress: 100, 
              output_url: finalUrl, 
              error_message: null 
            })
            .eq("id", jobId);

          // ── النشر التلقائي ──────────────────────────────────
          let publishResults: Record<string, unknown> = {};
          let videoTitle = "فيديو جديد";
          let videoDescription = "";
          let videoHashtags: string[] = [];

          try {
            // جلب السكريبت لتوليد metadata
            const { data: scriptStepData } = await supabase
              .from("job_steps").select("output_data")
              .eq("job_id", jobId).eq("step_name", "script_generation").maybeSingle();
            const script = (scriptStepData?.output_data as any)?.script || "";

            if (script) {
              const { generateVideoMetadata } = await import("../_shared/gemini.ts");
              const meta = await generateVideoMetadata(script);
              videoTitle       = meta.title;
              videoDescription = meta.description + "\n" + meta.hashtags.join(" ");


              logInfo("✅ metadata جاهز:", { title: videoTitle });
            }

            // قراءة platforms من العمود المنفصل أو input_data
            const jobAny = job as any;
            const platforms: string[] =
              (Array.isArray(jobAny.platforms) ? jobAny.platforms : null) ||
              (Array.isArray(jobAny.input_data?.platforms) ? jobAny.input_data.platforms : null) ||
              [];

            if (platforms.length > 0) {
              logInfo(`[PUBLISH] نشر على: ${platforms.join(", ")}`);
              const publishResp = await fetch(
                `${Deno.env.get("SUPABASE_URL")}/functions/v1/publish-video`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  },
                  body: JSON.stringify({
                    job_id: jobId,
                    video_url: finalUrl,
                    duration: (job as any).input_data?.duration || 0,
                    title: videoTitle,
                    description: videoDescription,
                    hashtags: videoHashtags,
                    platforms,
                  }),
                }
              );
              if (publishResp.ok) {
                const pd = await publishResp.json();
                publishResults = pd.results || {};
                logInfo("✅ نتيجة النشر:", publishResults);
              } else {
                logInfo("⚠️ فشل النشر:", await publishResp.text());
              }
            } else {
              logInfo("[PUBLISH] لا توجد منصات — تخطي النشر");
            }
          } catch (pubErr) {
            logInfo("⚠️ خطأ في النشر:", pubErr instanceof Error ? pubErr.message : String(pubErr));
          }

          await supabase
            .from("jobs")
            .update({ 
              status: "completed", 
              progress: 100, 
              output_url: finalUrl, 
              error_message: null 
            })
            .eq("id", jobId);

          if (publishStep?.id && publishStep.status !== "completed") {
            await supabase.from("job_steps").update({
              status: "completed",
              started_at: publishStep.started_at || new Date().toISOString(),
              completed_at: new Date().toISOString(),
              output_data: {
                video_url: finalUrl,
                title: videoTitle,
                description: videoDescription,
                hashtags: videoHashtags,
                publish_results: publishResults,
              },
            }).eq("id", publishStep.id);
          }

          logInfo(`✓✓✓ المهمة ${jobId} اكتملت بنجاح! ✓✓✓`);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logError(`خطأ في مراقبة الدمج [${jobId}]`, e);

        // Increment failure counter
        const newFailures = currentFailures + 1;
        logWarning(`فشل مراقبة الدمج ${newFailures}/${MAX_CONSECUTIVE_FAILURES} للمهمة ${jobId}`, errorMsg);

        // Check if it's a server health issue
        let serverHealthInfo = "";
        try {
          const healthCheck = await isFFmpegSpaceHealthy();
          if (!healthCheck.healthy) {
            serverHealthInfo = `\nحالة السيرفر: ${healthCheck.error || 'غير صحي'}`;
            if (healthCheck.isSleeping) {
              serverHealthInfo += "\n⚠️ السيرفر في وضع السكون - قد يحتاج إلى إعادة تشغيل";
            }
          }
        } catch (healthError) {
          logWarning('فشل فحص صحة السيرفر', healthError);
        }

        if (mergeStep?.id) {
          await supabase
            .from("job_steps")
            .update({
              output_data: {
                ...(mergeOutput || {}),
                consecutive_failures: newFailures,
                last_error: errorMsg,
                last_error_time: new Date().toISOString(),
                server_health_checked: !!serverHealthInfo,
              },
            })
            .eq("id", mergeStep.id);
        }

        // If too many consecutive failures, fail the job with detailed error
        if (newFailures >= MAX_CONSECUTIVE_FAILURES) {
          const failMsg = 
            `سيرفر الدمج لا يستجيب بعد ${MAX_CONSECUTIVE_FAILURES} محاولة فاشلة متتالية.\n` +
            `آخر خطأ: ${errorMsg}${serverHealthInfo}\n` +
            `معرف مهمة المزود: ${providerJobId}\n` +
            `الإجراء المقترح: تحقق من أن السيرفر يعمل على Hugging Face`;

          logError(`تجاوز الحد الأقصى للفشل - إيقاف المهمة ${jobId}`, failMsg);

          if (mergeStep?.id) {
            await supabase
              .from("job_steps")
              .update({
                status: "failed",
                error_message: failMsg,
                completed_at: new Date().toISOString(),
                output_data: {
                  ...(mergeOutput || {}),
                  consecutive_failures: newFailures,
                  max_failures_reached: true,
                  final_error: failMsg,
                },
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

    // Stuck detection with enhanced diagnostics
    let isStuck = false;
    let stuckWarning: string | undefined;
    let stuckDiagnostics: any = undefined;

    if (job.status === "processing") {
      const processingStep = (steps || []).find((s: any) => s.status === "processing");
      if (processingStep?.started_at) {
        const processingDuration = Date.now() - new Date(processingStep.started_at).getTime();
        if (processingDuration > 3 * 60 * 1000) {
          isStuck = true;
          const minutesStuck = Math.floor(processingDuration / 60000);
          
          stuckWarning = `العملية متعطلة منذ ${minutesStuck} دقيقة في خطوة "${processingStep.step_name}"`;
          
          // Get server health for diagnostics
          try {
            const healthCheck = await isFFmpegSpaceHealthy();
            stuckDiagnostics = {
              stuck_duration_minutes: minutesStuck,
              stuck_step: processingStep.step_name,
              server_healthy: healthCheck.healthy,
              server_status: healthCheck.status,
              server_error: healthCheck.error,
              is_sleeping: healthCheck.isSleeping,
              suggestion: healthCheck.isSleeping 
                ? "السيرفر في وضع السكون - قد تحتاج لإعادة تشغيل المهمة"
                : !healthCheck.healthy
                  ? "السيرفر غير متاح - تحقق من حالته على Hugging Face"
                  : "المهمة عالقة رغم أن السيرفر يعمل - قد تحتاج للإلغاء وإعادة المحاولة"
            };
          } catch (healthError) {
            stuckDiagnostics = {
              stuck_duration_minutes: minutesStuck,
              stuck_step: processingStep.step_name,
              health_check_failed: true,
              error: healthError instanceof Error ? healthError.message : String(healthError)
            };
          }

          logWarning(`المهمة ${jobId} عالقة`, stuckDiagnostics);
        }
      }
    }

    const response = {
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
      stuck_diagnostics: stuckDiagnostics,
      is_complete: job.status === "completed",
      is_failed: job.status === "failed",
      can_cancel: job.status === "pending" || job.status === "processing",
    };

    logInfo(`إرجاع حالة المهمة ${jobId}`, {
      status: job.status,
      progress: job.progress,
      hasOutput: !!job.output_url,
      isStuck
    });

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logError("خطأ في job-status", error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString(),
        type: 'internal_error'
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
