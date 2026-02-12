const HF_READ_TOKEN = Deno.env.get("HF_READ_TOKEN")!;
const HF_SPACE_URL = Deno.env.get("HF_SPACE_URL") || "https://elmalik-ff.hf.space";

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
 * Detects HTML error pages (404, 502, etc.) that are NOT valid JSON responses.
 */
function isHtmlErrorResponse(text: string): boolean {
  const trimmed = text.trim();
  // JSON صحيح (يبدأ بـ { أو [) ليس HTML أبداً - يحل false positive
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("<!doctype") ||
    lower.startsWith("<html")     ||
    lower.startsWith("<head")     ||
    lower.includes("cannot get /")            ||
    lower.includes("page not found")          ||
    lower.includes("502 bad gateway")         ||
    lower.includes("503 service unavailable") ||
    lower.includes("application error")       ||
    lower.includes("space is sleeping")       ||
    lower.includes("starting up")
    // "404" حُذف - يظهر داخل JSON صحيح كـ "HTTP 404"
  );
}

/**
 * Determines if error indicates space is sleeping/starting
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
 * Enhanced health check with detailed diagnostics
 */
export async function isFFmpegSpaceHealthy(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  logInfo(`بدء فحص صحة السيرفر على: ${HF_SPACE_URL}`);
  
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000); // 15 seconds timeout

    const resp = await fetch(HF_SPACE_URL, {
      method: "GET", // Use GET instead of HEAD for better compatibility
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
        ? "انتهت مهلة الاتصال بالسيرفر (15 ثانية). السيرفر قد يكون بطيئاً أو متوقفاً."
        : `خطأ في الاتصال: ${errorMessage}`,
      details: errorMessage
    };
  }
}

// ===== WAKE UP SPACE =====

/**
 * Attempts to wake up a sleeping Hugging Face Space
 */
async function wakeUpSpace(): Promise<void> {
  logInfo("محاولة إيقاظ السيرفر...");
  
  try {
    // Make a simple request to wake it up
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000); // 30 seconds for wake up

    await fetch(HF_SPACE_URL, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${HF_READ_TOKEN}`,
      },
      signal: ctrl.signal,
    });
    
    clearTimeout(timer);
    
    // Wait a bit for the space to fully start
    logInfo("انتظار 10 ثوانٍ لبدء تشغيل السيرفر...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
  } catch (error) {
    logWarning("قد يستغرق إيقاظ السيرفر بعض الوقت", error);
  }
}

// ===== IMAGE GENERATION - Pollinations AI (مجاني) =====

async function tryPollinations(prompt: string, ms: number): Promise<ArrayBuffer> {
  const seed = Date.now() + Math.floor(Math.random() * 99999);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=1280&height=720&nologo=true`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Accept": "image/*" },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`[IMAGE-GEN] HTTP ${res.status} من pollinations.ai`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 4000) throw new Error(`[IMAGE-GEN] صورة صغيرة: ${buf.byteLength}B`);
    return buf;
  } catch (e) {
    clearTimeout(t);
    const m = e instanceof Error ? e.message : String(e);
    throw new Error(m.includes("abort") ? `[IMAGE-GEN] انتهت المهلة (${ms/1000}s)` : m);
  }
}

export async function generateImageWithFlux(prompt: string): Promise<ArrayBuffer> {
  logInfo("[IMAGE-GEN] توليد الصورة (Pollinations AI)", { prompt: prompt.slice(0, 80) });
  const timeouts = [25000, 35000, 50000, 70000, 90000];
  const errors: string[] = [];
  for (let i = 0; i < timeouts.length; i++) {
    try {
      const buf = await tryPollinations(prompt, timeouts[i]);
      logInfo(`[IMAGE-GEN] ✅ نجح (${(buf.byteLength/1024).toFixed(1)}KB)`);
      return buf;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      errors.push(m);
      if (i < timeouts.length - 1) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error("[IMAGE-GEN] فشل بعد 5 محاولات: " + errors.join(" | "));
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
  diagnostics?: {
    healthCheck?: HealthCheckResult;
    spaceWokenUp?: boolean;
    attempts?: number;
  };
}

// ===== START MERGE =====

/**
 * Starts a merge job on the FFmpeg Space with enhanced error handling and diagnostics.
 */
export async function startMergeWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  const imageUrl = request.images?.[0] || request.videos?.[0];
  const audioUrl = request.audio;

  if (!imageUrl || !audioUrl) {
    throw new Error("Missing imageUrl or audioUrl");
  }

  logInfo("بدء عملية دمج الوسائط", { imageUrl: imageUrl.slice(0, 50), audioUrl: audioUrl.slice(0, 50) });

  // Step 1: Health check with detailed diagnostics
  logInfo("الخطوة 1: فحص صحة السيرفر...");
  const healthCheck = await isFFmpegSpaceHealthy();
  
  let spaceWokenUp = false;
  
  if (!healthCheck.healthy) {
    logWarning("السيرفر غير صحي", healthCheck);
    
    // If space is sleeping, try to wake it up
    if (healthCheck.isSleeping) {
      logInfo("السيرفر في وضع السكون، محاولة الإيقاظ...");
      await wakeUpSpace();
      spaceWokenUp = true;
      
      // Check health again after wake up
      const recheckHealth = await isFFmpegSpaceHealthy();
      if (!recheckHealth.healthy) {
        throw new Error(
          `فشل إيقاظ السيرفر. ${recheckHealth.error || 'السيرفر لا يزال غير متاح.'}\n` +
          `التفاصيل: ${recheckHealth.details || 'لا توجد تفاصيل إضافية'}`
        );
      }
      logInfo("✓ تم إيقاظ السيرفر بنجاح");
    } else {
      // Space is not healthy and not sleeping - hard failure
      throw new Error(
        `سيرفر الدمج (FFmpeg Space) غير متاح.\n` +
        `الخطأ: ${healthCheck.error || 'خطأ غير معروف'}\n` +
        `رمز الحالة: ${healthCheck.status || 'غير متوفر'}\n` +
        `التفاصيل: ${healthCheck.details || 'لا توجد تفاصيل'}\n` +
        `رابط السيرفر: ${HF_SPACE_URL}\n` +
        `الإجراء المقترح: تحقق من أن السيرفر يعمل على Hugging Face`
      );
    }
  }

  logInfo("✓ السيرفر صحي ومتاح");

  // Step 2: Prepare payload
  const payload = {
    imageUrl,
    audioUrl,
    images: request.images,
    videos: request.videos,
    audio: request.audio,
    output_format: request.output_format || "mp4",
  };

  logInfo("الخطوة 2: إرسال طلب الدمج", payload);

  // Step 3: Send merge request
  const mergeUrl = `${HF_SPACE_URL}/merge`;
  logInfo(`إرسال الطلب إلى: ${mergeUrl}`);

  let response: Response;
  try {
    response = await fetch(mergeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_READ_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (fetchError) {
    const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    logError("فشل إرسال طلب الدمج", fetchError);
    throw new Error(
      `فشل الاتصال بسيرفر الدمج:\n` +
      `الخطأ: ${errorMsg}\n` +
      `الرابط: ${mergeUrl}\n` +
      `تأكد من أن السيرفر يعمل وأن الشبكة متصلة`
    );
  }

  const responseText = await response.text();
  logInfo(`استجابة السيرفر: HTTP ${response.status}`, responseText.slice(0, 300));

  // Step 4: Validate response
  if (isHtmlErrorResponse(responseText)) {
    const isSleeping = isSpaceSleepingError(responseText, response.status);
    
    logError(`السيرفر أرجع صفحة HTML بدلاً من JSON${isSleeping ? ' (قد يكون نائماً)' : ''}`, {
      status: response.status,
      preview: responseText.slice(0, 200)
    });

    throw new Error(
      `خطأ في السيرفر (HTTP ${response.status}):\n` +
      `السيرفر أرجع صفحة HTML بدلاً من استجابة JSON صحيحة.\n` +
      `${isSleeping ? 'السيرفر قد يكون في وضع السكون. حاول مرة أخرى بعد دقيقة.\n' : ''}` +
      `المعاينة: ${responseText.slice(0, 200)}\n` +
      `الرابط: ${mergeUrl}`
    );
  }

  if (!response.ok) {
    logError(`فشل طلب الدمج: HTTP ${response.status}`, responseText);
    throw new Error(
      `فشل سيرفر الدمج (HTTP ${response.status}):\n` +
      `${responseText.slice(0, 500)}\n` +
      `الرابط: ${mergeUrl}`
    );
  }

  // Step 5: Parse JSON response
  let rawResult: any;
  try {
    rawResult = JSON.parse(responseText);
  } catch (parseError) {
    logError("فشل تحليل استجابة JSON", { responseText: responseText.slice(0, 200), error: parseError });
    throw new Error(
      `استجابة غير صالحة من السيرفر:\n` +
      `لم يتم إرجاع JSON صحيح.\n` +
      `المحتوى: ${responseText.slice(0, 200)}`
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
 * Check the status of a merge job with enhanced error handling.
 */
export async function checkMergeStatus(jobId: string): Promise<MergeMediaResponse> {
  logInfo(`فحص حالة المهمة: ${jobId}`);

  const candidates = [
    { method: "GET" as const, url: `${HF_SPACE_URL}/status/${jobId}`, name: "GET /status/:id" },
    { method: "GET" as const, url: `${HF_SPACE_URL}/merge/status/${jobId}`, name: "GET /merge/status/:id" },
    { method: "POST" as const, url: `${HF_SPACE_URL}/status`, body: { jobId }, name: "POST /status" },
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
          ...(c.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: c.method === "POST" ? JSON.stringify(c.body ?? {}) : undefined,
        signal: ctrl.signal,
      });

      clearTimeout(timer);

      const text = await resp.text();
      logInfo(`${c.name} استجابة: HTTP ${resp.status}`, text.slice(0, 200));

      // Detect HTML error pages
      if (isHtmlErrorResponse(text)) {
        const error = `${c.name}: HTML error page (HTTP ${resp.status}): ${text.slice(0, 100)}`;
        logWarning(error);
        errors.push(error);
        continue;
      }

      if (resp.status === 404) {
        logWarning(`[HF-STATUS] 404 - المهمة ${jobId} غير موجودة في HF Space`);
        return { status: "failed" as const, progress: 0, job_id: jobId,
          error: "[HF-STATUS→404] المهمة غير موجودة (أُعيد تشغيل HF Space). أنشئ مهمة جديدة." };
      }
      if (!resp.ok) {
        const error = `[HF-STATUS] ${c.name}: HTTP ${resp.status} - ${text.slice(0, 150)}`;
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
  
  const summary = errors.join(" | ");
  logError(`[HF-STATUS] تعذّر checkMergeStatus: ${summary}`);
  return { status: "failed" as const, progress: 0, job_id: jobId,
    error: `[HF-STATUS] تعذّر فحص الحالة: ${summary}` };
}
