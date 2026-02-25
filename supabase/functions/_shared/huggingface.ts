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
function isHtmlErrorResponse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  const lower = trimmed.toLowerCase();
  return (
    lower.startsWith("<!doctype") || lower.startsWith("<html") || lower.startsWith("<head") ||
    lower.includes("cannot get /") || lower.includes("page not found") ||
    lower.includes("502 bad gateway") || lower.includes("503 service unavailable") ||
    lower.includes("application error") || lower.includes("space is sleeping") ||
    lower.includes("starting up")
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
  error?: string;
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
    if (isHtmlErrorResponse(responseText)) {
      const isSleeping = isSpaceSleepingError(responseText, resp.status);
      
      return {
        healthy: false,
        status: resp.status,
        isSleeping,
        responseTime,
        error: isSleeping 
          ? "السيرفر في وضع السكون ويحتاج إلى الاستيقاظ"
          : `السيرفر أرجع صفحة خطأ HTML (HTTP ${resp.status})`,
        details: responseText.slice(0, 300)
      };
    }
    const isHealthy = resp.ok || resp.status === 405 || resp.status === 301 || resp.status === 302;
    
    if (isHealthy) {
      logInfo(`✓ السيرفر يعمل بشكل صحيح`);
      return { healthy: true, status: resp.status, responseTime };
    }
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
    const isTimeout = errorMessage.includes("aborted") || errorMessage.includes("timeout");
    
    return {
      healthy: false,
      responseTime,
      error: isTimeout 
        ? "انتهت مهلة الاتصال بالسيرفر (15 ثانية)"
        : `خطأ في الاتصال: ${errorMessage}`,
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
      headers: { "Authorization": `Bearer ${HF_READ_TOKEN}` },
      signal: ctrl.signal,
    });
    
    clearTimeout(timer);
    
    logInfo("انتظار 10 ثوانٍ لبدء تشغيل السيرفر...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
  } catch (error) {
    logWarning("قد يستغرق إيقاظ السيرفر بعض الوقت", error);
  }
}
// ===== IMAGE GENERATION WITH ENHANCED ERROR HANDLING =====
const POLLINATIONS_KEY = Deno.env.get("POLLINATIONS_API_KEY") || "sk_E7DZagW8HKHCBUrMJjXm8bAhI2O1Pye9";
async function tryPollinationsModel(
  prompt: string, 
  model: string, 
  timeoutMs: number
): Promise<ArrayBuffer> {
  const seed = Math.floor(Math.random() * 2147483647);
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://gen.pollinations.ai/image/${encodedPrompt}?model=${model}&width=1080&height=1920&seed=${seed}&safe=false&nologo=true`;
  logInfo(`[POLLINATIONS] model=${model} seed=${seed}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "Authorization": `Bearer ${POLLINATIONS_KEY}`,
        "Accept": "image/jpeg,image/*",
        "User-Agent": "Mozilla/5.0",
      },
    });
    
    clearTimeout(timer);
    if (res.status === 401) throw new Error(`${model}: مفتاح API غير صالح`);
    if (res.status === 402) throw new Error(`${model}: رصيد غير كافٍ`);
    if (res.status === 403) throw new Error(`${model}: رفض الوصول`);
    
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${model}: HTTP ${res.status} — ${body.slice(0, 100)}`);
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("image") && !ctype.includes("octet")) {
      const body = await res.text().catch(() => "");
      throw new Error(`${model}: استجابة غير صورة (${ctype})`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 5000) {
      throw new Error(`${model}: صورة صغيرة جداً (${buf.byteLength}B)`);
    }
    logInfo(`[POLLINATIONS] ✅ ${model}: ${(buf.byteLength / 1024).toFixed(1)}KB`);
    return buf;
    
  } catch (err) {
    clearTimeout(timer);
    
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${model}: انتهت المهلة (${timeoutMs}ms)`);
    }
    throw err;
  }
}
export async function generateImageWithFlux(prompt: string): Promise<ArrayBuffer> {
  logInfo(`[FLUX] توليد صورة...`);
  
  // Try multiple models with different timeouts
  const models = [
    { name: "flux",         timeout: 60000 },  // 60s primary
    { name: "flux-realism", timeout: 60000 },  // 60s fallback
  ];
  const errors: string[] = [];
  for (const { name, timeout } of models) {
    try {
      const result = await tryPollinationsModel(prompt, name, timeout);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      logWarning(`فشل ${name}:`, msg);
    }
  }
  throw new Error(`فشل توليد الصورة بجميع النماذج:\n${errors.join('\n')}`);
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
  progress?: number;
  output_url?: string;
  error?: string;
  job_id?: string;
  message?: string;
  diagnostics?: any;
}
// ===== START MERGE =====
export async function startMergeWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  
  logInfo("بدء طلب الدمج...");
  // Step 1: Health check
  const healthCheck = await isFFmpegSpaceHealthy();
  logInfo("نتيجة الفحص الصحي:", healthCheck);
  let spaceWokenUp = false;
  if (!healthCheck.healthy) {
    if (healthCheck.isSleeping) {
      logInfo("السيرفر في وضع السكون، محاولة إيقاظه...");
      await wakeUpSpace();
      spaceWokenUp = true;
      
      const recheckHealth = await isFFmpegSpaceHealthy();
      if (!recheckHealth.healthy) {
        throw new Error(
          `السيرفر لا يستجيب بعد محاولة الإيقاظ.\n` +
          `الحالة: ${recheckHealth.error || 'غير معروف'}\n` +
          `قد يحتاج السيرفر لبضع دقائق للبدء.`
        );
      }
    } else {
      throw new Error(
        `سيرفر الدمج غير متاح.\n` +
        `الحالة: ${healthCheck.error || 'غير معروف'}\n` +
        `يُرجى التحقق من Hugging Face Space.`
      );
    }
  }
  // Step 2: Determine endpoint
  const hasVideos = request.videos && request.videos.length > 0;
  const endpoint = hasVideos ? "/start-merge" : "/merge";
  const mergeUrl = `${HF_SPACE_URL}${endpoint}`;
  logInfo(`استخدام نقطة النهاية: ${mergeUrl}`);
  // Step 3: Prepare payload with proper structure
  const payload: any = {
    audio: request.audio,
    output_format: request.output_format || "mp4"
  };
  if (hasVideos) {
    payload.videos = request.videos;
    if (request.images && request.images.length > 0) {
      payload.images = request.images;
    }
  } else {
    // For /merge endpoint, use either imageUrl (single) or images (array)
    if (request.images && request.images.length > 0) {
      if (request.images.length === 1) {
        payload.imageUrl = request.images[0];
      } else {
        payload.images = request.images;
      }
    }
  }
  logInfo("البيانات المرسلة:", {
    endpoint,
    hasImages: !!request.images?.length,
    hasVideos: !!request.videos?.length,
    hasAudio: !!request.audio,
    imageCount: request.images?.length || 0,
    videoCount: request.videos?.length || 0
  });
  // Step 4: Make request with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // 2 minutes
  let response: Response;
  let responseText: string;
  
  try {
    response = await fetch(mergeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${HF_READ_TOKEN}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    responseText = await response.text();
    
    logInfo(`استجابة HTTP ${response.status}`, responseText.slice(0, 200));
    
  } catch (fetchError) {
    clearTimeout(timeout);
    
    if (fetchError instanceof Error && fetchError.name === 'AbortError') {
      throw new Error('انتهت مهلة طلب الدمج (2 دقيقة)');
    }
    
    throw new Error(
      `فشل الاتصال بسيرفر الدمج:\n${fetchError instanceof Error ? fetchError.message : String(fetchError)}`
    );
  }
  // Step 5: Handle HTML error pages
  if (isHtmlErrorResponse(responseText)) {
    logError("السيرفر أرجع صفحة HTML بدلاً من JSON", responseText.slice(0, 300));
    throw new Error(
      `السيرفر أرجع صفحة خطأ HTML (HTTP ${response.status}).\n` +
      `قد يكون السيرفر في وضع السكون أو غير متاح.`
    );
  }
  if (!response.ok) {
    logError(`فشل طلب الدمج: HTTP ${response.status}`, responseText);
    throw new Error(
      `فشل سيرفر الدمج (HTTP ${response.status}):\n${responseText.slice(0, 500)}`
    );
  }
  // Step 6: Parse JSON response
  let rawResult: any;
  try {
    rawResult = JSON.parse(responseText);
  } catch (parseError) {
    logError("فشل تحليل استجابة JSON", { responseText: responseText.slice(0, 200), error: parseError });
    throw new Error(
      `استجابة غير صالحة من السيرفر - لم يتم إرجاع JSON صحيح.\n` +
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
    diagnostics: { healthCheck, spaceWokenUp, attempts: 1 }
  };
  return result;
}
// ===== CHECK STATUS =====
export async function checkMergeStatus(jobId: string): Promise<MergeMediaResponse> {
  logInfo(`فحص حالة المهمة: ${jobId}`);
  const candidates = [
    { method: "GET" as const, url: `${HF_SPACE_URL}/status/${jobId}`, name: "GET /status/:id" },
    { method: "GET" as const, url: `${HF_SPACE_URL}/job-status/${jobId}`, name: "GET /job-status/:id" },
    { method: "POST" as const, url: `${HF_SPACE_URL}/status`, body: { jobId }, name: "POST /status" },
  ];
  const errors: string[] = [];
  for (const c of candidates) {
    try {
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
      if (isHtmlErrorResponse(text)) {
        errors.push(`${c.name}: HTML error page (HTTP ${resp.status})`);
        continue;
      }
      if (resp.status === 404) {
        return { 
          status: "failed" as const, 
          progress: 0, 
          job_id: jobId,
          error: "المهمة غير موجودة (قد يكون السيرفر أُعيد تشغيله)"
        };
      }
      
      if (!resp.ok) {
        errors.push(`${c.name}: HTTP ${resp.status} - ${text.slice(0, 100)}`);
        continue;
      }
      let raw: any;
      try {
        raw = JSON.parse(text);
      } catch {
        errors.push(`${c.name}: Invalid JSON`);
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
      
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      errors.push(`${c.name}: ${errorMsg}`);
    }
  }
  const errorSummary = `فشل فحص حالة المهمة ${jobId}:\n${errors.join('\n')}`;
  logError(errorSummary);
  
  return { 
    status: "failed" as const, 
    progress: 0, 
    job_id: jobId,
    error: `تعذّر فحص الحالة: ${errors.join(" | ")}`
  };
}
// ===== MERGE WITH POLLING =====
export async function mergeMediaWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  
  logInfo("=== بدء عملية الدمج مع المراقبة ===");
  
  const initialResult = await startMergeWithFFmpeg(request);
  
  if (initialResult.status === "completed" || initialResult.status === "failed") {
    logInfo(`العملية انتهت فوراً بحالة: ${initialResult.status}`);
    return initialResult;
  }
  if (initialResult.job_id && initialResult.status === "processing") {
    logInfo(`بدأت المهمة بمعرف: ${initialResult.job_id}، بدء المراقبة...`);
    return await pollForMergeCompletion(initialResult);
  }
  return initialResult;
}
// ===== POLLING WITH BACKOFF =====
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
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    try {
      const status = await checkMergeStatus(jobId);
      consecutiveFailures = 0;
      logInfo(`حالة ${jobId}: ${status.status} (${status.progress}%)`);
      result = {
        ...result,
        status: status.status || result.status,
        progress: status.progress ?? result.progress,
        output_url: status.output_url || result.output_url,
        error: status.error || result.error,
      };
      if (result.output_url && result.output_url.startsWith("http")) {
        result.status = "completed";
        logInfo(`✓ اكتملت المهمة! ${result.output_url}`);
        break;
      }
      
    } catch (pollError) {
      consecutiveFailures++;
      const errorMsg = pollError instanceof Error ? pollError.message : String(pollError);
      logError(`فشلت محاولة ${attempts} (متتالية: ${consecutiveFailures}/10)`, errorMsg);
      if (consecutiveFailures >= 10) {
        logError("10 محاولات متتالية فاشلة");
        return {
          status: "failed",
          progress: result.progress,
          error: `السيرفر لا يستجيب بعد ${consecutiveFailures} محاولة.\nآخر خطأ: ${errorMsg}`,
          diagnostics: {
            attempts: consecutiveFailures,
            healthCheck: await isFFmpegSpaceHealthy()
          }
        };
      }
    }
  }
  if (attempts >= maxAttempts && result.status === "processing") {
    logWarning(`انتهت مهلة المراقبة بعد ${attempts} محاولة`);
    return {
      status: "failed",
      progress: result.progress,
      error: `تجاوزت العملية الحد الزمني (${Math.round(maxAttempts * pollInterval / 1000)}s)`,
      diagnostics: {
        attempts,
        healthCheck: await isFFmpegSpaceHealthy()
      }
    };
  }
  return result;
}
