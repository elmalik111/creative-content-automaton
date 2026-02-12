const HF_READ_TOKEN = Deno.env.get("HF_READ_TOKEN")!;
const HF_SPACE_URL = Deno.env.get("HF_SPACE_URL") || "https://elmalik-ff.hf.space";

// ===== ENHANCED LOGGING HELPERS =====
function logInfo(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [HF-INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function logError(message: string, error?: any) {
  const timestamp = new Date().toISOString();
  const errorDetails = error instanceof Error 
    ? { message: error.message, stack: error.stack }
    : error;
  console.error(`[${timestamp}] [HF-ERROR] ${message}`, errorDetails || '');
}

function logWarning(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  console.warn(`[${timestamp}] [HF-WARNING] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

// ===== ERROR STRUCTURE =====
interface EnhancedError {
  code: string;
  location: string;
  phase: string;
  message: string;
  details?: any;
  timestamp?: string;
  httpStatus?: number;
  isRetryable?: boolean;
}

function createError(
  code: string,
  location: string,
  phase: string,
  message: string,
  details?: any
): EnhancedError {
  return {
    code,
    location,
    phase,
    message,
    details,
    timestamp: new Date().toISOString()
  };
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

// ===== HEALTH CHECK =====

export interface HealthCheckResult {
  healthy: boolean;
  status?: number;
  error?: EnhancedError | null;
  isSleeping?: boolean;
  responseTime?: number;
  details?: string;
}

export async function isFFmpegSpaceHealthy(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  logInfo(`بدء فحص صحة السيرفر على: ${HF_SPACE_URL}`);
  
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);

    const resp = await fetch(HF_SPACE_URL, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${HF_READ_TOKEN}`,
        "User-Agent": "Supabase-Edge-Function"
      },
      signal: ctrl.signal,
    });
    
    clearTimeout(timer);
    const responseTime = Date.now() - startTime;
    const responseText = await resp.text();

    logInfo(`استجابة الفحص الصحي: HTTP ${resp.status} في ${responseTime}ms`);
    logInfo(`محتوى الاستجابة (أول 200 حرف):`, responseText.slice(0, 200));

    if (isHtmlErrorResponse(responseText)) {
      const isSleeping = isSpaceSleepingError(responseText, resp.status);
      
      const error = createError(
        isSleeping ? 'SPACE_SLEEPING' : 'SPACE_HTML_ERROR',
        'HF-HEALTH',
        'health_check',
        isSleeping 
          ? "السيرفر في وضع السكون ويحتاج إلى الاستيقاظ (قد يستغرق 1-2 دقيقة)"
          : `السيرفر أرجع صفحة خطأ HTML (HTTP ${resp.status})`,
        {
          status: resp.status,
          preview: responseText.slice(0, 200),
          responseTime,
          isSleeping
        }
      );

      logWarning(`السيرفر أرجع صفحة HTML${isSleeping ? ' (قد يكون في وضع السكون)' : ''}`, error.details);

      return {
        healthy: false,
        status: resp.status,
        isSleeping,
        responseTime,
        error,
        details: responseText.slice(0, 300)
      };
    }

    const isHealthy = resp.ok || resp.status === 405 || resp.status === 301 || resp.status === 302;
    
    if (isHealthy) {
      logInfo(`✓ السيرفر يعمل بشكل صحيح`);
      return {
        healthy: true,
        status: resp.status,
        responseTime,
        error: null
      };
    }

    const error = createError(
      'SPACE_UNHEALTHY',
      'HF-HEALTH',
      'health_check',
      `السيرفر أرجع رمز حالة غير متوقع: ${resp.status}`,
      {
        status: resp.status,
        responseTime,
        preview: responseText.slice(0, 300)
      }
    );

    logWarning(`السيرفر غير صحي: HTTP ${resp.status}`);
    return {
      healthy: false,
      status: resp.status,
      responseTime,
      error,
      details: responseText.slice(0, 300)
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes("aborted") || errorMessage.includes("timeout");
    
    const enhancedError = createError(
      isTimeout ? 'HEALTH_CHECK_TIMEOUT' : 'HEALTH_CHECK_NETWORK_ERROR',
      'HF-HEALTH',
      'health_check',
      isTimeout 
        ? "انتهت مهلة الاتصال بالسيرفر (15 ثانية). السيرفر قد يكون بطيئاً أو متوقفاً."
        : `خطأ في الاتصال: ${errorMessage}`,
      {
        responseTime,
        errorMessage,
        isTimeout,
        spaceUrl: HF_SPACE_URL
      }
    );
    
    logError(`فشل الفحص الصحي بعد ${responseTime}ms`, enhancedError);

    return {
      healthy: false,
      responseTime,
      error: enhancedError,
      details: errorMessage
    };
  }
}

// ===== WAKE UP SPACE =====

async function wakeUpSpace(): Promise<void> {
  logInfo("محاولة إيقاظ السيرفر...");
  
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);

    await fetch(HF_SPACE_URL, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${HF_READ_TOKEN}`,
      },
      signal: ctrl.signal,
    });
    
    clearTimeout(timer);
    
    logInfo("انتظار 10 ثوانٍ لبدء تشغيل السيرفر...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
  } catch (error) {
    logWarning("قد يستغرق إيقاظ السيرفر بعض الوقت", error);
  }
}

// ===== IMAGE GENERATION - Pollinations AI =====

async function tryPollinations(prompt: string, ms: number): Promise<ArrayBuffer> {
  const seed = Date.now() + Math.floor(Math.random() * 99999);
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?seed=${seed}&width=1280&height=720&nologo=true`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "image/*",
      },
    });
    clearTimeout(t);
    
    if (!res.ok) {
      throw createError(
        'IMAGE_GEN_HTTP_ERROR',
        'POLLINATIONS',
        'image_generation',
        `HTTP ${res.status} من pollinations.ai`,
        { status: res.status, url }
      );
    }
    
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 4000) {
      throw createError(
        'IMAGE_GEN_TOO_SMALL',
        'POLLINATIONS',
        'image_generation',
        `الصورة صغيرة جداً: ${buf.byteLength}B`,
        { size: buf.byteLength, url }
      );
    }
    
    return buf;
  } catch (e) {
    clearTimeout(t);
    
    if (e.code) throw e; // Already an EnhancedError
    
    const m = e instanceof Error ? e.message : String(e);
    throw createError(
      m.includes("abort") ? 'IMAGE_GEN_TIMEOUT' : 'IMAGE_GEN_ERROR',
      'POLLINATIONS',
      'image_generation',
      m.includes("abort") ? `انتهت المهلة (${ms/1000}s)` : m,
      { timeout: ms, error: m }
    );
  }
}

export async function generateImageWithFlux(prompt: string): Promise<ArrayBuffer> {
  logInfo("[IMAGE-GEN] بدء توليد الصورة (Pollinations AI)", { prompt: prompt.slice(0, 80) });
  const timeouts = [25000, 35000, 50000, 70000, 90000];
  const errors: EnhancedError[] = [];
  
  for (let i = 0; i < timeouts.length; i++) {
    logInfo(`[IMAGE-GEN] محاولة ${i + 1}/${timeouts.length} (${timeouts[i]/1000}s)`);
    try {
      const buf = await tryPollinations(prompt, timeouts[i]);
      logInfo(`[IMAGE-GEN] ✅ نجح (${(buf.byteLength/1024).toFixed(1)}KB)`);
      return buf;
    } catch (e: any) {
      logError(`[IMAGE-GEN] فشلت محاولة ${i + 1}`, e);
      errors.push(e.code ? e : createError(
        'IMAGE_GEN_ATTEMPT_FAILED',
        'POLLINATIONS',
        'image_generation',
        e.message || String(e),
        { attempt: i + 1, timeout: timeouts[i] }
      ));
    }
  }
  
  throw createError(
    'IMAGE_GEN_ALL_FAILED',
    'POLLINATIONS',
    'image_generation',
    `فشل توليد الصورة بعد ${timeouts.length} محاولات`,
    {
      prompt: prompt.slice(0, 100),
      attempts: timeouts.length,
      errors: errors.map(e => ({ code: e.code, message: e.message }))
    }
  );
}

// ===== TYPES =====

export interface MergeMediaRequest {
  images?: string[];
  videos?: string[];
  audio: string;
  output_format?: string;
}

export interface MergeMediaResponse {
  status: string;
  progress?: number;
  output_url?: string;
  error?: string | EnhancedError;
  job_id?: string;
  message?: string;
  diagnostics?: any;
}

// ===== START MERGE =====

export async function startMergeWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  
  logInfo("=== بدء طلب الدمج ===", {
    hasImages: !!request.images?.length,
    hasVideos: !!request.videos?.length,
    hasAudio: !!request.audio
  });

  // Step 1: Health check
  logInfo("خطوة 1: فحص صحة السيرفر...");
  const healthCheck = await isFFmpegSpaceHealthy();
  let spaceWokenUp = false;

  if (!healthCheck.healthy) {
    logWarning("السيرفر غير صحي", healthCheck);
    
    if (healthCheck.isSleeping) {
      logInfo("محاولة إيقاظ السيرفر...");
      await wakeUpSpace();
      spaceWokenUp = true;
      
      const recheck = await isFFmpegSpaceHealthy();
      if (!recheck.healthy) {
        throw createError(
          'SPACE_WAKE_FAILED',
          'HF-MERGE',
          'health_check',
          "فشل إيقاظ السيرفر. قد يحتاج إلى مزيد من الوقت للبدء.",
          {
            initialHealth: healthCheck,
            recheckHealth: recheck,
            spaceUrl: HF_SPACE_URL
          }
        );
      }
    } else {
      throw createError(
        'SPACE_UNHEALTHY',
        'HF-MERGE',
        'health_check',
        healthCheck.error?.message || "السيرفر غير متاح حالياً",
        {
          healthCheck,
          spaceUrl: HF_SPACE_URL
        }
      );
    }
  }

  logInfo("✓ السيرفر صحي وجاهز");

  // Step 2: Build request body
  const mergeBody = {
    imageUrl: request.images?.[0],
    images: request.images,
    videos: request.videos,
    audioUrl: request.audio,
    audio: request.audio,
    output_format: request.output_format || "mp4",
  };

  logInfo("خطوة 2: إعداد طلب الدمج", mergeBody);

  // Step 3: Determine merge endpoint
  const mergeUrl = `${HF_SPACE_URL}/merge`;
  logInfo(`خطوة 3: إرسال الطلب إلى ${mergeUrl}`);

  // Step 4: Send merge request
  let response: Response;
  let responseText: string;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 seconds

    response = await fetch(mergeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${HF_READ_TOKEN}`,
      },
      body: JSON.stringify(mergeBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    responseText = await response.text();
    
    logInfo(`خطوة 4: استجابة من السيرفر - HTTP ${response.status}`, {
      status: response.status,
      contentLength: responseText.length,
      preview: responseText.slice(0, 200)
    });
    
  } catch (fetchError: any) {
    const isTimeout = fetchError.name === 'AbortError';
    
    throw createError(
      isTimeout ? 'MERGE_REQUEST_TIMEOUT' : 'MERGE_REQUEST_FAILED',
      'HF-MERGE',
      'merge_request',
      isTimeout 
        ? "انتهت مهلة طلب الدمج (30 ثانية)"
        : `فشل إرسال طلب الدمج: ${fetchError.message}`,
      {
        mergeUrl,
        error: fetchError.message,
        isTimeout,
        requestBody: mergeBody
      }
    );
  }

  // Check for HTML error response
  if (isHtmlErrorResponse(responseText)) {
    const isSleeping = isSpaceSleepingError(responseText, response.status);
    
    throw createError(
      isSleeping ? 'SPACE_SLEEPING_DURING_MERGE' : 'MERGE_HTML_ERROR',
      'HF-MERGE',
      'merge_response',
      isSleeping
        ? 'السيرفر دخل في وضع السكون أثناء المعالجة. حاول مرة أخرى بعد دقيقة.'
        : `السيرفر أرجع صفحة خطأ HTML بدلاً من JSON`,
      {
        status: response.status,
        preview: responseText.slice(0, 200),
        mergeUrl,
        isSleeping
      }
    );
  }

  if (!response.ok) {
    throw createError(
      'MERGE_HTTP_ERROR',
      'HF-MERGE',
      'merge_response',
      `فشل سيرفر الدمج (HTTP ${response.status})`,
      {
        status: response.status,
        statusText: response.statusText,
        response: responseText.slice(0, 500),
        mergeUrl
      }
    );
  }

  // Step 5: Parse JSON response
  let rawResult: any;
  try {
    rawResult = JSON.parse(responseText);
  } catch (parseError) {
    throw createError(
      'MERGE_INVALID_JSON',
      'HF-MERGE',
      'response_parsing',
      'استجابة غير صالحة من السيرفر: لم يتم إرجاع JSON صحيح',
      {
        responsePreview: responseText.slice(0, 200),
        parseError: parseError instanceof Error ? parseError.message : String(parseError)
      }
    );
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
      attempts: 1,
      timestamp: new Date().toISOString()
    }
  };

  return result;
}

// ===== MERGE WITH POLLING =====

export async function mergeMediaWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  
  logInfo("=== بدء عملية الدمج مع المراقبة ===");
  
  let initialResult: MergeMediaResponse;
  
  try {
    initialResult = await startMergeWithFFmpeg(request);
  } catch (error: any) {
    // Return enhanced error
    return {
      status: 'failed',
      error: error.code ? error : createError(
        'MERGE_START_FAILED',
        'HF-MERGE',
        'merge_start',
        error.message || String(error),
        { originalError: error }
      ),
      progress: 0
    };
  }
  
  if (initialResult.status === "completed" || initialResult.status === "failed") {
    logInfo(`العملية انتهت فوراً بحالة: ${initialResult.status}`);
    return initialResult;
  }

  if (initialResult.job_id && initialResult.status === "processing") {
    logInfo(`بدأت المهمة بمعرف: ${initialResult.job_id}، بدء المراقبة...`);
    return await pollForMergeCompletion(initialResult);
  }

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
      consecutiveFailures = 0;

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

      if (result.output_url && result.output_url.startsWith("http")) {
        result.status = "completed";
        logInfo(`✓ اكتملت المهمة بنجاح! رابط الإخراج: ${result.output_url}`);
      }
    } catch (pollError: any) {
      consecutiveFailures++;
      const errorMsg = pollError instanceof Error ? pollError.message : String(pollError);
      logError(`فشلت محاولة المراقبة ${attempts} (متتالية: ${consecutiveFailures}/10)`, pollError);

      if (consecutiveFailures >= 10) {
        const healthCheck = await isFFmpegSpaceHealthy();
        
        return {
          status: "failed",
          progress: result.progress,
          error: createError(
            'POLLING_MAX_FAILURES',
            'HF-POLLING',
            'status_polling',
            `سيرفر الدمج لا يستجيب بعد ${consecutiveFailures} محاولة متتالية فاشلة`,
            {
              consecutiveFailures,
              jobId,
              lastError: errorMsg,
              healthCheck,
              suggestion: 'تحقق من أن السيرفر يعمل على Hugging Face'
            }
          ),
          diagnostics: {
            attempts: consecutiveFailures,
            healthCheck
          }
        };
      }
    }
  }

  if (attempts >= maxAttempts && result.status === "processing") {
    const healthCheck = await isFFmpegSpaceHealthy();
    
    return {
      status: "failed",
      progress: result.progress,
      error: createError(
        'POLLING_TIMEOUT',
        'HF-POLLING',
        'status_polling',
        `تجاوزت عملية الدمج الحد الزمني (${Math.round(maxAttempts * pollInterval / 1000)} ثانية)`,
        {
          attempts,
          maxAttempts,
          pollInterval,
          jobId,
          healthCheck,
          message: 'المهمة لا تزال قيد المعالجة ولكن تم تجاوز الوقت المسموح'
        }
      ),
      diagnostics: {
        attempts,
        healthCheck
      }
    };
  }

  return result;
}

// ===== CHECK STATUS =====

export async function checkMergeStatus(jobId: string): Promise<MergeMediaResponse> {
  logInfo(`فحص حالة المهمة: ${jobId}`);

  const candidates = [
    { method: "GET" as const, url: `${HF_SPACE_URL}/status/${jobId}`, name: "GET /status/:id" },
    { method: "GET" as const, url: `${HF_SPACE_URL}/merge/status/${jobId}`, name: "GET /merge/status/:id" },
    { method: "POST" as const, url: `${HF_SPACE_URL}/status`, body: { jobId }, name: "POST /status" },
  ];

  const errors: EnhancedError[] = [];

  for (const c of candidates) {
    try {
      logInfo(`محاولة ${c.name}...`);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);

      const resp = await fetch(c.url, {
        method: c.method,
        headers: {
          Authorization: `Bearer ${HF_READ_TOKEN}`,
          ...(c.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: c.method === "POST" ? JSON.stringify(c.body ?? {}) : undefined,
        signal: ctrl.signal,
      });

      clearTimeout(timer);

      const text = await resp.text();
      logInfo(`${c.name} استجابة: HTTP ${resp.status}`, text.slice(0, 200));

      if (isHtmlErrorResponse(text)) {
        errors.push(createError(
          'STATUS_HTML_RESPONSE',
          'HF-STATUS',
          'status_check',
          `${c.name}: HTML error page (HTTP ${resp.status})`,
          {
            method: c.name,
            status: resp.status,
            preview: text.slice(0, 100)
          }
        ));
        continue;
      }

      if (!resp.ok) {
        errors.push(createError(
          'STATUS_HTTP_ERROR',
          'HF-STATUS',
          'status_check',
          `${c.name}: HTTP ${resp.status}`,
          {
            method: c.name,
            status: resp.status,
            response: text.slice(0, 200)
          }
        ));
        continue;
      }

      let raw: any;
      try {
        raw = JSON.parse(text);
      } catch {
        errors.push(createError(
          'STATUS_INVALID_JSON',
          'HF-STATUS',
          'status_check',
          `${c.name}: Invalid JSON`,
          {
            method: c.name,
            response: text.slice(0, 100)
          }
        ));
        continue;
      }

      logInfo(`✓ ${c.name} نجح`, raw);
      return {
        status: raw.status || "processing",
        progress: raw.progress ?? 0,
        output_url: extractOutputUrl(raw),
        error: raw.error,
        job_id: extractJobId(raw) || jobId,
        message: raw.message,
      };
    } catch (e: any) {
      const isTimeout = e.name === 'AbortError';
      errors.push(createError(
        isTimeout ? 'STATUS_CHECK_TIMEOUT' : 'STATUS_CHECK_ERROR',
        'HF-STATUS',
        'status_check',
        `${c.name}: ${isTimeout ? 'Timeout' : e.message}`,
        {
          method: c.name,
          error: e.message,
          isTimeout
        }
      ));
    }
  }

  throw createError(
    'STATUS_ALL_ENDPOINTS_FAILED',
    'HF-STATUS',
    'status_check',
    `فشل فحص حالة المهمة ${jobId}. جُربت جميع نقاط النهاية`,
    {
      jobId,
      errors: errors.map(e => ({ code: e.code, message: e.message, location: e.location })),
      suggestion: 'تحقق من أن السيرفر يعمل بشكل صحيح على Hugging Face'
    }
  );
}
