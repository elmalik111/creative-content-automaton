const HF_READ_TOKEN = Deno.env.get("HF_READ_TOKEN")!;
const HF_SPACE_URL = Deno.env.get("HF_SPACE_URL") || "https://elmalik-ff.hf.space";

// بدائل مجانية لـ Flux في حالة نفاد الرصيد
const FLUX_ALTERNATIVES = [
  {
    name: "FLUX.1-schnell (HF Inference)",
    url: "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
    requiresToken: true,
    free: true // الاستخدام المجاني محدود لكن متاح
  },
  {
    name: "Stable Diffusion XL",
    url: "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
    requiresToken: true,
    free: true
  },
  {
    name: "Stable Diffusion 2.1",
    url: "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-2-1",
    requiresToken: true,
    free: true
  }
];

// ===== LOGGING HELPERS =====
function logInfo(message: string, data?: any) {
  console.log(`[HF-INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function logError(message: string, error?: any) {
  console.error(`[HF-ERROR] ${message}`, error ? (error instanceof Error ? error.message : JSON.stringify(error)) : '');
}

function logWarning(message: string, data?: any) {
  console.warn(`[HF-WARNING] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

// ===== URL HELPERS =====
function normalizeMaybeUrl(raw?: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (!v) return undefined;

  try {
    return new URL(v, HF_SPACE_URL).toString();
  } catch {
    return undefined;
  }
}

function extractJobId(raw: any): string | undefined {
  const v = raw?.job_id ?? raw?.jobId ?? raw?.id;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function extractOutputUrl(raw: any): string | undefined {
  const v =
    raw?.output_url ??
    raw?.outputUrl ??
    raw?.url ??
    raw?.video_url ??
    raw?.videoUrl ??
    raw?.result?.output_url ??
    raw?.result?.outputUrl ??
    raw?.result?.url ??
    raw?.data?.output_url ??
    raw?.data?.outputUrl ??
    raw?.data?.url;

  return normalizeMaybeUrl(v);
}

// ===== ERROR DETECTION =====

/**
 * يكتشف صفحات أخطاء HTML (404, 502, إلخ) التي ليست استجابات JSON صالحة
 */
function isHtmlErrorResponse(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return (
    trimmed.startsWith("<!doctype") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<head") ||
    trimmed.includes("cannot get /") ||
    trimmed.includes("page not found") ||
    trimmed.includes("404") ||
    trimmed.includes("502 bad gateway") ||
    trimmed.includes("503 service unavailable") ||
    trimmed.includes("application error") ||
    trimmed.includes("space is sleeping") ||
    trimmed.includes("starting up")
  );
}

/**
 * يحدد ما إذا كان الخطأ يشير إلى أن السيرفر نائم/يبدأ
 */
function isSpaceSleepingError(text: string, status: number): boolean {
  const lower = text.toLowerCase();
  return (
    status === 502 ||
    status === 503 ||
    lower.includes("space is sleeping") ||
    lower.includes("starting up") ||
    lower.includes("application error") ||
    lower.includes("bad gateway")
  );
}

/**
 * يكتشف أخطاء نفاد الرصيد في Hugging Face
 */
function isCreditDepletedError(text: string, status: number): boolean {
  const lower = text.toLowerCase();
  return (
    status === 402 ||
    lower.includes("credit") && (lower.includes("depleted") || lower.includes("balance")) ||
    lower.includes("quota") && lower.includes("exceeded") ||
    lower.includes("purchase") && lower.includes("credits")
  );
}

// ===== HEALTH CHECK =====

export interface HealthCheckResult {
  healthy: boolean;
  status?: number;
  error?: string;
  isSleeping?: boolean;
  responseTime?: number;
  details?: string;
}

/**
 * فحص صحة محسّن مع تشخيصات مفصلة
 */
export async function isFFmpegSpaceHealthy(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  logInfo(`بدء فحص صحة السيرفر على: ${HF_SPACE_URL}`);
  
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000); // 20 seconds timeout (increased)

    const resp = await fetch(HF_SPACE_URL, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${HF_READ_TOKEN}`,
        "User-Agent": "Supabase-Edge-Function/1.0"
      },
      signal: ctrl.signal,
    });
    
    clearTimeout(timer);
    const responseTime = Date.now() - startTime;
    const responseText = await resp.text();

    logInfo(`استجابة الفحص الصحي: HTTP ${resp.status} في ${responseTime}ms`);
    
    if (responseText.length < 500) {
      logInfo(`محتوى الاستجابة:`, responseText);
    } else {
      logInfo(`محتوى الاستجابة (أول 300 حرف):`, responseText.slice(0, 300));
    }

    // Check if response is HTML error page
    if (isHtmlErrorResponse(responseText)) {
      const isSleeping = isSpaceSleepingError(responseText, resp.status);
      
      logWarning(`السيرفر أرجع صفحة HTML${isSleeping ? ' (قد يكون في وضع السكون)' : ''}`, {
        status: resp.status,
        preview: responseText.slice(0, 200)
      });

      return {
        healthy: false,
        status: resp.status,
        isSleeping,
        responseTime,
        error: isSleeping 
          ? "السيرفر في وضع السكون ويحتاج إلى الاستيقاظ (قد يستغرق 1-2 دقيقة)"
          : `السيرفر أرجع صفحة خطأ HTML (HTTP ${resp.status})`,
        details: responseText.slice(0, 300)
      };
    }

    // Accept various success statuses
    const isHealthy = resp.ok || resp.status === 405 || resp.status === 301 || resp.status === 302;
    
    if (isHealthy) {
      logInfo(`✓ السيرفر يعمل بشكل صحيح`);
      return {
        healthy: true,
        status: resp.status,
        responseTime
      };
    }

    logWarning(`السيرفر غير صحي: HTTP ${resp.status}`);
    return {
      healthy: false,
      status: resp.status,
      responseTime,
      error: `السيرفر أرجع رمز حالة غير متوقع: ${resp.status}`,
      details: responseText.slice(0, 300)
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logError(`فشل الفحص الصحي بعد ${responseTime}ms`, error);

    // Check if timeout
    const isTimeout = errorMessage.includes("aborted") || errorMessage.includes("timeout");
    
    return {
      healthy: false,
      responseTime,
      error: isTimeout 
        ? "انتهت مهلة الاتصال بالسيرفر (20 ثانية). السيرفر قد يكون بطيئاً أو متوقفاً."
        : `خطأ في الاتصال: ${errorMessage}`,
      details: errorMessage
    };
  }
}

// ===== WAKE UP SPACE =====

/**
 * محاولة إيقاظ Hugging Face Space النائم مع محاولات متعددة
 */
async function wakeUpSpace(maxAttempts: number = 3): Promise<boolean> {
  logInfo(`محاولة إيقاظ السيرفر (${maxAttempts} محاولات)...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logInfo(`محاولة إيقاظ ${attempt}/${maxAttempts}...`);
      
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000); // 30 seconds per attempt

      const response = await fetch(HF_SPACE_URL, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${HF_READ_TOKEN}`,
          "User-Agent": "Supabase-Edge-Function/1.0"
        },
        signal: ctrl.signal,
      });
      
      clearTimeout(timer);
      
      logInfo(`استجابة الإيقاظ ${attempt}: HTTP ${response.status}`);
      
      // إذا حصلنا على استجابة (حتى لو خطأ)، فالسيرفر مستيقظ
      if (response.status < 500) {
        logInfo(`✓ السيرفر استيقظ في المحاولة ${attempt}`);
        
        // انتظر قليلاً للتأكد من أن السيرفر جاهز تماماً
        await new Promise(resolve => setTimeout(resolve, 5000));
        return true;
      }
      
      // انتظر قبل المحاولة التالية
      if (attempt < maxAttempts) {
        const waitTime = attempt * 10000; // 10s, 20s, 30s
        logInfo(`انتظار ${waitTime / 1000} ثانية قبل المحاولة التالية...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
    } catch (error) {
      logWarning(`فشلت محاولة الإيقاظ ${attempt}`, error);
      
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }
  
  logWarning(`فشل إيقاظ السيرفر بعد ${maxAttempts} محاولات`);
  return false;
}

// ===== FLUX IMAGE GENERATION (WITH FALLBACKS) =====

/**
 * توليد صورة باستخدام Flux مع بدائل في حالة الفشل
 */
export async function generateImageWithFlux(prompt: string): Promise<ArrayBuffer> {
  logInfo("توليد صورة باستخدام Flux (مع بدائل)", { 
    prompt: prompt.slice(0, 100),
    alternatives: FLUX_ALTERNATIVES.length 
  });
  
  const errors: string[] = [];
  
  // المحاولة 1: Flux Router (الخيار المدفوع)
  try {
    logInfo("محاولة 1: Flux Router (Inference Provider)...");
    
    const response = await fetch(
      "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_READ_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            width: 1280,
            height: 720,
          },
        }),
      }
    );

    if (response.ok) {
      const buffer = await response.arrayBuffer();
      logInfo(`✅ نجح توليد الصورة باستخدام Flux Router (${buffer.byteLength} bytes)`);
      return buffer;
    }

    const errorText = await response.text();
    
    // تحقق من نفاد الرصيد
    if (isCreditDepletedError(errorText, response.status)) {
      logWarning("⚠️ نفاد رصيد Flux Router - التحول إلى البدائل المجانية...");
      errors.push(`Flux Router: نفاد الرصيد (HTTP ${response.status})`);
    } else {
      logError(`فشل Flux Router: HTTP ${response.status}`, errorText);
      errors.push(`Flux Router: ${response.status} - ${errorText.slice(0, 100)}`);
    }
    
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logError("خطأ في Flux Router", msg);
    errors.push(`Flux Router: ${msg}`);
  }
  
  // المحاولة 2-N: البدائل المجانية
  for (const alternative of FLUX_ALTERNATIVES) {
    try {
      logInfo(`محاولة: ${alternative.name}...`);
      
      const response = await fetch(alternative.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_READ_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            width: 1280,
            height: 720,
            num_inference_steps: 20, // أقل للسرعة
          },
        }),
      });

      if (response.ok) {
        const buffer = await response.arrayBuffer();
        logInfo(`✅ نجح توليد الصورة باستخدام ${alternative.name} (${buffer.byteLength} bytes)`);
        return buffer;
      }

      const errorText = await response.text();
      
      // بعض النماذج قد تحتاج وقت تحميل
      if (response.status === 503) {
        logWarning(`${alternative.name} يتم تحميله، انتظار 20 ثانية...`);
        await new Promise(resolve => setTimeout(resolve, 20000));
        
        // محاولة ثانية
        const retryResponse = await fetch(alternative.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${HF_READ_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              width: 1280,
              height: 720,
              num_inference_steps: 20,
            },
          }),
        });
        
        if (retryResponse.ok) {
          const buffer = await retryResponse.arrayBuffer();
          logInfo(`✅ نجح في المحاولة الثانية مع ${alternative.name} (${buffer.byteLength} bytes)`);
          return buffer;
        }
      }
      
      logWarning(`فشل ${alternative.name}: HTTP ${response.status}`, errorText.slice(0, 200));
      errors.push(`${alternative.name}: ${response.status} - ${errorText.slice(0, 100)}`);
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logError(`خطأ في ${alternative.name}`, msg);
      errors.push(`${alternative.name}: ${msg}`);
    }
  }
  
  // جميع الخيارات فشلت
  const errorSummary = `فشل توليد الصورة من جميع المصادر:\n${errors.join('\n')}`;
  logError(errorSummary);
  
  throw new Error(
    `فشل توليد الصورة. تم تجربة ${1 + FLUX_ALTERNATIVES.length} مصدر:\n\n` +
    `${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n\n` +
    `الإجراءات المقترحة:\n` +
    `1. تحقق من رصيد Hugging Face: https://huggingface.co/settings/billing\n` +
    `2. جرب استخدام نموذج مختلف\n` +
    `3. تأكد من صحة HF_READ_TOKEN`
  );
}

// ===== MERGE INTERFACES =====

export interface MergeMediaRequest {
  images?: string[];
  videos?: string[];
  audio: string;
  output_format?: string;
}

export interface MergeMediaResponse {
  status: "processing" | "completed" | "failed";
  progress: number;
  output_url?: string;
  error?: string;
  job_id?: string;
  message?: string;
  diagnostics?: any;
}

// ===== START MERGE WITH ENHANCED ERROR HANDLING =====

export async function startMergeWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  
  logInfo("=== بدء عملية الدمج ===", {
    hasImages: !!(request.images && request.images.length > 0),
    hasVideos: !!(request.videos && request.videos.length > 0),
    hasAudio: !!request.audio,
    imageCount: request.images?.length || 0,
    videoCount: request.videos?.length || 0
  });

  // Step 1: Health check with auto-wake
  logInfo("الخطوة 1: فحص صحة السيرفر...");
  
  let healthCheck = await isFFmpegSpaceHealthy();
  let spaceWokenUp = false;
  
  if (!healthCheck.healthy && healthCheck.isSleeping) {
    logInfo("السيرفر نائم - محاولة الإيقاظ...");
    spaceWokenUp = await wakeUpSpace(3);
    
    if (spaceWokenUp) {
      logInfo("✓ تم إيقاظ السيرفر بنجاح، إعادة فحص الصحة...");
      healthCheck = await isFFmpegSpaceHealthy();
    }
  }
  
  if (!healthCheck.healthy) {
    logError("السيرفر غير صحي", healthCheck);
    
    return {
      status: "failed",
      progress: 0,
      error: `سيرفر الدمج غير متاح:\n${healthCheck.error}\n\nالتفاصيل: ${healthCheck.details || 'لا توجد'}`,
      diagnostics: { healthCheck, spaceWokenUp }
    };
  }
  
  logInfo("✓ السيرفر صحي وجاهز");

  // Step 2: Prepare merge request
  const mergeUrl = `${HF_SPACE_URL}/merge`;
  
  logInfo("الخطوة 2: إرسال طلب الدمج...", { url: mergeUrl });
  
  const mergePayload = {
    images: request.images,
    videos: request.videos,
    audio: request.audio,
    output_format: request.output_format || "mp4",
  };
  
  logInfo("بيانات الطلب:", mergePayload);

  // Step 3: Send merge request with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds timeout
  
  let response: Response;
  
  try {
    response = await fetch(mergeUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_READ_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "Supabase-Edge-Function/1.0"
      },
      body: JSON.stringify(mergePayload),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
  } catch (fetchError) {
    clearTimeout(timeoutId);
    
    const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    logError("فشل الاتصال بسيرفر الدمج", errorMsg);
    
    return {
      status: "failed",
      progress: 0,
      error: `فشل الاتصال بسيرفر الدمج:\n${errorMsg}\n\nتحقق من:\n1. الاتصال بالإنترنت\n2. أن السيرفر يعمل على Hugging Face`,
      diagnostics: {
        healthCheck,
        spaceWokenUp,
        fetchError: errorMsg
      }
    };
  }

  // Step 4: Read response
  const responseText = await response.text();
  
  logInfo(`استجابة السيرفر: HTTP ${response.status}`, {
    contentLength: responseText.length,
    preview: responseText.slice(0, 300)
  });

  // Check for HTML error pages
  if (isHtmlErrorResponse(responseText)) {
    const isSleeping = isSpaceSleepingError(responseText, response.status);
    
    logError(`السيرفر أرجع صفحة HTML بدلاً من JSON${isSleeping ? ' (قد يكون نائماً)' : ''}`, {
      status: response.status,
      preview: responseText.slice(0, 200)
    });

    return {
      status: "failed",
      progress: 0,
      error: 
        `خطأ في السيرفر (HTTP ${response.status}):\n` +
        `السيرفر أرجع صفحة HTML بدلاً من استجابة JSON صحيحة.\n` +
        `${isSleeping ? 'السيرفر قد يكون في وضع السكون. حاول مرة أخرى بعد دقيقة.\n' : ''}` +
        `المعاينة: ${responseText.slice(0, 200)}\n` +
        `الرابط: ${mergeUrl}`,
      diagnostics: {
        healthCheck,
        spaceWokenUp,
        htmlError: true,
        isSleeping
      }
    };
  }

  if (!response.ok) {
    logError(`فشل طلب الدمج: HTTP ${response.status}`, responseText);
    
    return {
      status: "failed",
      progress: 0,
      error:
        `فشل سيرفر الدمج (HTTP ${response.status}):\n` +
        `${responseText.slice(0, 500)}\n` +
        `الرابط: ${mergeUrl}`,
      diagnostics: {
        healthCheck,
        spaceWokenUp,
        httpError: true,
        statusCode: response.status
      }
    };
  }

  // Step 5: Parse JSON response
  let rawResult: any;
  try {
    rawResult = JSON.parse(responseText);
  } catch (parseError) {
    logError("فشل تحليل استجابة JSON", { 
      responseText: responseText.slice(0, 200), 
      error: parseError 
    });
    
    return {
      status: "failed",
      progress: 0,
      error:
        `استجابة غير صالحة من السيرفر:\n` +
        `لم يتم إرجاع JSON صحيح.\n` +
        `المحتوى: ${responseText.slice(0, 200)}`,
      diagnostics: {
        healthCheck,
        spaceWokenUp,
        parseError: true
      }
    };
  }

  logInfo("✓ تم استلام استجابة صالحة", rawResult);

  const result: MergeMediaResponse = {
    status: rawResult.status || "processing",
    progress: rawResult.progress ?? 0,
    output_url: extractOutputUrl(rawResult),
    error: rawResult.error,
    job_id: extractJobId(rawResult),
    message: rawResult.message,
    diagnostics: {
      healthCheck,
      spaceWokenUp,
      attempts: 1
    }
  };

  return result;
}

// ===== MERGE WITH POLLING =====

export async function mergeMediaWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  
  logInfo("=== بدء عملية الدمج مع المراقبة ===");
  
  // Start the merge job
  const initialResult = await startMergeWithFFmpeg(request);
  
  // If already completed or failed, return immediately
  if (initialResult.status === "completed" || initialResult.status === "failed") {
    logInfo(`العملية انتهت فوراً بحالة: ${initialResult.status}`);
    return initialResult;
  }

  // If we have a job_id, poll for completion
  if (initialResult.job_id && initialResult.status === "processing") {
    logInfo(`بدأت المهمة بمعرف: ${initialResult.job_id}، بدء المراقبة...`);
    return await pollForMergeCompletion(initialResult);
  }

  // If processing but no job_id, try polling anyway
  if (initialResult.status === "processing") {
    logInfo("المهمة قيد المعالجة بدون معرف، محاولة المراقبة...");
    return await pollForMergeCompletion(initialResult);
  }

  return initialResult;
}

// ===== POLLING =====

async function pollForMergeCompletion(
  initialResult: MergeMediaResponse,
  maxAttempts = 60,
  pollInterval = 5000
): Promise<MergeMediaResponse> {
  let attempts = 0;
  let consecutiveFailures = 0;
  let result = initialResult;

  const jobId = result.job_id;

  if (!jobId) {
    logWarning("لا يوجد معرف مهمة للمراقبة");
    return result;
  }

  logInfo(`بدء مراقبة المهمة ${jobId} (الحد الأقصى: ${maxAttempts} محاولة)`);

  while (result.status === "processing" && attempts < maxAttempts) {
    attempts++;
    logInfo(`محاولة المراقبة ${attempts}/${maxAttempts}...`);

    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const status = await checkMergeStatus(jobId);
      consecutiveFailures = 0; // Reset on success

      logInfo(`حالة المهمة ${jobId}: ${status.status} (${status.progress}%)`, {
        hasOutputUrl: !!status.output_url
      });

      result = {
        ...result,
        status: status.status || result.status,
        progress: status.progress ?? result.progress,
        output_url: status.output_url || result.output_url,
        error: status.error || result.error,
      };

      // Check if completed
      if (result.output_url && result.output_url.startsWith("http")) {
        result.status = "completed";
        logInfo(`✓ اكتملت المهمة بنجاح! رابط الإخراج: ${result.output_url}`);
      }
    } catch (pollError) {
      consecutiveFailures++;
      const errorMsg = pollError instanceof Error ? pollError.message : String(pollError);
      logError(`فشلت محاولة المراقبة ${attempts} (متتالية: ${consecutiveFailures}/10)`, errorMsg);

      // If 10 consecutive failures, assume server is down
      if (consecutiveFailures >= 10) {
        logError("فشلت 10 محاولات متتالية - السيرفر على الأرجح متوقف");
        return {
          status: "failed",
          progress: result.progress,
          error: `سيرفر الدمج لا يستجيب بعد ${consecutiveFailures} محاولة متتالية فاشلة.\n` +
                 `آخر خطأ: ${errorMsg}\n` +
                 `الإجراء المقترح: تحقق من أن السيرفر يعمل على Hugging Face`,
          diagnostics: {
            attempts: consecutiveFailures,
            healthCheck: await isFFmpegSpaceHealthy()
          }
        };
      }
    }
  }

  // Timeout check
  if (attempts >= maxAttempts && result.status === "processing") {
    logWarning(`انتهت مهلة المراقبة بعد ${attempts} محاولة`);
    return {
      status: "failed",
      progress: result.progress,
      error: `تجاوزت عملية الدمج الحد الزمني (${Math.round(maxAttempts * pollInterval / 1000)} ثانية).\n` +
             `المهمة لا تزال قيد المعالجة ولكن تم تجاوز الوقت المسموح.\n` +
             `معرف المهمة: ${jobId}`,
      diagnostics: {
        attempts,
        healthCheck: await isFFmpegSpaceHealthy()
      }
    };
  }

  return result;
}

// ===== CHECK STATUS =====

/**
 * فحص حالة مهمة الدمج مع معالجة محسّنة للأخطاء
 */
export async function checkMergeStatus(jobId: string): Promise<MergeMediaResponse> {
  logInfo(`فحص حالة المهمة: ${jobId}`);

  const candidates = [
    { method: "GET" as const, url: `${HF_SPACE_URL}/status/${jobId}`, name: "GET /status/:id" },
    { method: "GET" as const, url: `${HF_SPACE_URL}/merge/status/${jobId}`, name: "GET /merge/status/:id" },
    { method: "POST" as const, url: `${HF_SPACE_URL}/status`, body: { jobId }, name: "POST /status" },
    { method: "GET" as const, url: `${HF_SPACE_URL}/job-status/${jobId}`, name: "GET /job-status/:id" },
  ];

  const errors: string[] = [];

  for (const c of candidates) {
    try {
      logInfo(`محاولة ${c.name}...`);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000); // 15 second timeout

      const resp = await fetch(c.url, {
        method: c.method,
        headers: {
          Authorization: `Bearer ${HF_READ_TOKEN}`,
          "User-Agent": "Supabase-Edge-Function/1.0",
          ...(c.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: c.method === "POST" ? JSON.stringify(c.body ?? {}) : undefined,
        signal: ctrl.signal,
      });

      clearTimeout(timer);

      const text = await resp.text();
      
      if (text.length < 300) {
        logInfo(`${c.name} استجابة: HTTP ${resp.status}`, text);
      } else {
        logInfo(`${c.name} استجابة: HTTP ${resp.status}`, text.slice(0, 200));
      }

      // Detect HTML error pages
      if (isHtmlErrorResponse(text)) {
        const error = `${c.name}: HTML error page (HTTP ${resp.status}): ${text.slice(0, 100)}`;
        logWarning(error);
        errors.push(error);
        continue;
      }

      if (!resp.ok) {
        const error = `${c.name}: HTTP ${resp.status} - ${text.slice(0, 200)}`;
        logWarning(error);
        errors.push(error);
        continue;
      }

      // Parse JSON
      let raw: any;
      try {
        raw = JSON.parse(text);
      } catch {
        const error = `${c.name}: Invalid JSON - ${text.slice(0, 100)}`;
        logWarning(error);
        errors.push(error);
        continue;
      }

      // Success!
      logInfo(`✓ ${c.name} نجح`, raw);
      return {
        status: raw.status || "processing",
        progress: raw.progress ?? 0,
        output_url: extractOutputUrl(raw),
        error: raw.error,
        job_id: extractJobId(raw) || jobId,
        message: raw.message,
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      const error = `${c.name}: ${errorMsg}`;
      logError(error);
      errors.push(error);
    }
  }

  // All candidates failed
  const errorSummary = `فشل فحص حالة المهمة ${jobId}. جُربت جميع نقاط النهاية:\n${errors.join('\n')}`;
  logError(errorSummary);
  
  throw new Error(
    `لم نتمكن من فحص حالة المهمة:\n` +
    `معرف المهمة: ${jobId}\n` +
    `الأخطاء:\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}\n` +
    `تحقق من أن السيرفر يعمل بشكل صحيح على Hugging Face`
  );
}
