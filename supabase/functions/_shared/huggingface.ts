const HF_READ_TOKEN = Deno.env.get("HF_READ_TOKEN")!;
// استخدام السيرفر الصحيح
const HF_SPACE_URL = Deno.env.get("HF_SPACE_URL") || "https://elmalik-ff.hf.space";

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

/**
 * Detects HTML error pages (404, 502, etc.) that are NOT valid JSON responses.
 */
function isHtmlErrorResponse(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return (
    trimmed.startsWith("<!doctype") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<head") ||
    trimmed.includes("cannot get /") ||
    trimmed.includes("page not found") ||
    trimmed.includes("404")
  );
}

/**
 * Quick health check – returns detailed status object.
 */
export async function checkFFmpegSpaceHealth(): Promise<{
  healthy: boolean;
  status: number;
  response?: any;
  error?: string;
  errorType?: 'network' | 'timeout' | 'http' | 'parse' | 'unknown';
}> {
  const endpoints = ['/', '/health'];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`[Health Check] Checking ${HF_SPACE_URL}${endpoint}`);
      
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);

      const resp = await fetch(`${HF_SPACE_URL}${endpoint}`, {
        method: "GET",
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      const text = await resp.text();
      console.log(`[Health Check] Response from ${endpoint}: HTTP ${resp.status}`);
      
      // محاولة parse الاستجابة
      let jsonResponse;
      try {
        jsonResponse = JSON.parse(text);
      } catch {
        jsonResponse = null;
      }

      // إذا كان الرد HTML error page
      if (isHtmlErrorResponse(text)) {
        return {
          healthy: false,
          status: resp.status,
          error: `السيرفر أرجع صفحة HTML خطأ بدلاً من JSON. قد يكون السيرفر معطل أو غير مهيأ بشكل صحيح.`,
          errorType: 'http',
          response: text.slice(0, 200)
        };
      }

      // إذا كان الرد ناجح
      if (resp.ok || resp.status === 405) {
        return {
          healthy: true,
          status: resp.status,
          response: jsonResponse || text
        };
      }

      // ردود HTTP error
      return {
        healthy: false,
        status: resp.status,
        error: `HTTP Error ${resp.status}: ${text.slice(0, 200)}`,
        errorType: 'http',
        response: jsonResponse || text.slice(0, 200)
      };
      
    } catch (error) {
      console.error(`[Health Check] Error checking ${endpoint}:`, error);
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            healthy: false,
            status: 0,
            error: `انتهى وقت الانتظار (15 ثانية). السيرفر لا يستجيب.`,
            errorType: 'timeout'
          };
        }
        
        if (error.message.includes('fetch failed') || error.message.includes('ENOTFOUND')) {
          return {
            healthy: false,
            status: 0,
            error: `لا يمكن الاتصال بالسيرفر. تأكد من أن:
1. السيرفر يعمل على Hugging Face
2. الرابط صحيح: ${HF_SPACE_URL}
3. السيرفر ليس في وضع "Sleeping"

تفاصيل الخطأ: ${error.message}`,
            errorType: 'network'
          };
        }
      }
      
      // استمر للـ endpoint التالي
      continue;
    }
  }
  
  return {
    healthy: false,
    status: 0,
    error: `فشلت جميع محاولات التحقق من السيرفر.`,
    errorType: 'unknown'
  };
}

/**
 * Legacy health check - returns boolean only
 */
export async function isFFmpegSpaceHealthy(): Promise<boolean> {
  const result = await checkFFmpegSpaceHealth();
  return result.healthy;
}

export async function generateImageWithFlux(prompt: string): Promise<ArrayBuffer> {
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Flux API error: ${error}`);
  }

  return response.arrayBuffer();
}

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
  debug?: any;
}

/**
 * Starts a merge job on the FFmpeg Space and returns the *initial* response (no polling).
 * Includes a detailed health check to fail fast if the server is down.
 */
export async function startMergeWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  const imageUrl = request.images?.[0] || request.videos?.[0];
  const audioUrl = request.audio;

  if (!imageUrl || !audioUrl) {
    throw new Error("Missing imageUrl or audioUrl");
  }

  // Health check – fail fast instead of hanging
  console.log("[startMergeWithFFmpeg] Performing health check before merge...");
  const healthCheck = await checkFFmpegSpaceHealth();
  
  if (!healthCheck.healthy) {
    console.error("[startMergeWithFFmpeg] Health check failed:", healthCheck);
    
    let errorMessage = "سيرفر الدمج (FFmpeg Space) غير متاح حالياً.";
    
    if (healthCheck.errorType === 'network') {
      errorMessage = `❌ مشكلة في الاتصال بالسيرفر:\n${healthCheck.error}\n\n💡 الحلول المقترحة:\n1. تأكد من أن السيرفر يعمل على Hugging Face\n2. قم بإعادة تشغيل السيرفر من لوحة تحكم Hugging Face\n3. تحقق من أن الرابط صحيح: ${HF_SPACE_URL}`;
    } else if (healthCheck.errorType === 'timeout') {
      errorMessage = `⏱️ انتهى وقت الانتظار. السيرفر بطيء أو غير مستجيب.\n\n💡 جرب:\n1. الانتظار دقيقة ثم المحاولة مرة أخرى\n2. إعادة تشغيل السيرفر`;
    } else if (healthCheck.errorType === 'http') {
      errorMessage = `🚫 السيرفر أرجع خطأ HTTP ${healthCheck.status}.\n\n💡 قد يكون:\n- السيرفر في وضع "Sleeping" على Hugging Face\n- هناك خطأ في إعدادات السيرفر\n- السيرفر يحتاج لإعادة تشغيل`;
    }
    
    throw new Error(errorMessage);
  }

  console.log("[startMergeWithFFmpeg] Health check passed, sending merge request...");

  const payload = {
    imageUrl,
    audioUrl,
    images: request.images,
    videos: request.videos,
    audio: request.audio,
    output_format: request.output_format || "mp4",
  };

  const targetUrl = `${HF_SPACE_URL}/merge`;
  console.log("[startMergeWithFFmpeg] Target URL:", targetUrl);
  console.log("[startMergeWithFFmpeg] Payload:", JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_READ_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log("[startMergeWithFFmpeg] Raw response:", responseText.slice(0, 500));

    // Detect HTML error pages
    if (isHtmlErrorResponse(responseText)) {
      throw new Error(`🚫 السيرفر أرجع صفحة خطأ HTML (HTTP ${response.status}).\n\n💡 هذا يعني:\n- السيرفر قد يكون في وضع "Sleeping"\n- أو هناك خطأ في إعدادات السيرفر\n- جرب زيارة ${HF_SPACE_URL} مباشرة للتحقق`);
    }

    if (!response.ok) {
      throw new Error(`❌ خطأ من FFmpeg Space (HTTP ${response.status}):\n${responseText.slice(0, 300)}`);
    }

    let rawResult: any;
    try {
      rawResult = JSON.parse(responseText);
    } catch {
      throw new Error(`❌ الاستجابة ليست JSON صالح:\n${responseText.slice(0, 200)}`);
    }

    console.log("[startMergeWithFFmpeg] Parsed response:", JSON.stringify(rawResult, null, 2));

    return {
      status: rawResult.status || "processing",
      progress: rawResult.progress ?? 0,
      output_url: extractOutputUrl(rawResult),
      error: rawResult.error,
      job_id: extractJobId(rawResult),
      message: rawResult.message,
      debug: { rawResponse: rawResult }
    };
    
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('❌')) {
      throw error; // Re-throw our formatted errors
    }
    
    console.error("[startMergeWithFFmpeg] Fetch error:", error);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`⏱️ انتهى وقت الانتظار أثناء إرسال طلب الدمج.\n\n💡 السيرفر قد يكون مشغولاً أو بطيئاً.`);
      }
      
      throw new Error(`❌ فشل الاتصال بالسيرفر:\n${error.message}\n\n💡 تأكد من:\n1. أن السيرفر يعمل: ${HF_SPACE_URL}\n2. أن الرمز (Token) صحيح\n3. أن السيرفر ليس في وضع Sleeping`);
    }
    
    throw error;
  }
}

export async function mergeMediaWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  const imageUrl = request.images?.[0] || request.videos?.[0];
  const audioUrl = request.audio;

  if (!imageUrl || !audioUrl) {
    throw new Error("Missing imageUrl or audioUrl");
  }

  const payload = {
    imageUrl,
    audioUrl,
    images: request.images,
    videos: request.videos,
    audio: request.audio,
    output_format: request.output_format || "mp4",
  };

  console.log("[mergeMediaWithFFmpeg] Sending to FFmpeg Space:", JSON.stringify(payload, null, 2));
  console.log("[mergeMediaWithFFmpeg] Target URL:", `${HF_SPACE_URL}/merge`);

  try {
    const response = await fetch(`${HF_SPACE_URL}/merge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_READ_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    console.log("[mergeMediaWithFFmpeg] Raw response:", responseText.slice(0, 500));

    if (isHtmlErrorResponse(responseText)) {
      throw new Error(`🚫 السيرفر أرجع صفحة خطأ HTML (HTTP ${response.status}).\n\n💡 هذا يعني أن السيرفر قد يكون معطلاً أو في وضع Sleeping.`);
    }

    if (!response.ok) {
      throw new Error(`❌ خطأ من FFmpeg Space (HTTP ${response.status}):\n${responseText.slice(0, 300)}`);
    }

    let rawResult: any;
    try {
      rawResult = JSON.parse(responseText);
    } catch {
      throw new Error(`❌ الاستجابة ليست JSON صالح:\n${responseText.slice(0, 200)}`);
    }

    console.log("[mergeMediaWithFFmpeg] Parsed response:", JSON.stringify(rawResult, null, 2));

    const result: MergeMediaResponse = {
      status: rawResult.status || "processing",
      progress: rawResult.progress ?? 0,
      output_url: extractOutputUrl(rawResult),
      error: rawResult.error,
      job_id: extractJobId(rawResult),
      message: rawResult.message,
    };

    if (result.job_id && result.status === "processing") {
      console.log(`[mergeMediaWithFFmpeg] Job started with ID: ${result.job_id}, polling for completion...`);
      return await pollForMergeCompletion(result);
    }

    if (result.status === "completed" || result.status === "failed") {
      return result;
    }

    if (result.status === "processing") {
      console.log("[mergeMediaWithFFmpeg] Merge started without job_id, polling for completion...");
      return await pollForMergeCompletion(result);
    }

    return result;
    
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('🚫') || error.message.startsWith('❌'))) {
      throw error;
    }
    
    console.error("[mergeMediaWithFFmpeg] Error:", error);
    
    if (error instanceof Error) {
      throw new Error(`❌ فشل في mergeMediaWithFFmpeg:\n${error.message}`);
    }
    
    throw error;
  }
}

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
    console.log("[pollForMergeCompletion] No job_id available for polling");
    return result;
  }

  console.log(`[pollForMergeCompletion] Starting polling for job ${jobId}`);

  while (result.status === "processing" && attempts < maxAttempts) {
    attempts++;
    console.log(`[pollForMergeCompletion] Polling attempt ${attempts}/${maxAttempts} for job ${jobId}`);

    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const status = await checkMergeStatus(jobId);
      consecutiveFailures = 0;

      result = {
        ...result,
        status: status.status || result.status,
        progress: status.progress ?? result.progress,
        output_url: status.output_url || result.output_url,
        error: status.error || result.error,
      };

      if (result.output_url && result.output_url.startsWith("http")) {
        result.status = "completed";
        console.log(`[pollForMergeCompletion] Merge completed! Output URL: ${result.output_url}`);
      }
    } catch (pollError) {
      consecutiveFailures++;
      console.error(`[pollForMergeCompletion] Poll attempt ${attempts} failed (consecutive: ${consecutiveFailures}):`, pollError);

      if (consecutiveFailures >= 10) {
        return {
          status: "failed",
          progress: result.progress,
          error: `❌ سيرفر الدمج لا يستجيب بعد 10 محاولات متتالية فاشلة.\n\n💡 جرب:\n1. إعادة تشغيل السيرفر\n2. الانتظار قليلاً ثم المحاولة مرة أخرى`,
        };
      }
    }
  }

  if (attempts >= maxAttempts && result.status === "processing") {
    return {
      status: "failed",
      progress: result.progress,
      error: `⏱️ انتهى وقت انتظار عملية الدمج (${maxAttempts * pollInterval / 1000} ثانية).\n\n💡 قد يكون السيرفر مشغولاً أو الملفات كبيرة جداً.`,
    };
  }

  return result;
}

/**
 * Check the status of a merge job. Tries multiple endpoints.
 * Detects HTML error pages and counts them as failures.
 */
export async function checkMergeStatus(jobId: string): Promise<MergeMediaResponse> {
  const candidates = [
    { method: "GET" as const, url: `${HF_SPACE_URL}/status/${jobId}` },
    { method: "GET" as const, url: `${HF_SPACE_URL}/merge/status/${jobId}` },
    { method: "POST" as const, url: `${HF_SPACE_URL}/status`, body: { jobId } },
    { method: "GET" as const, url: `${HF_SPACE_URL}/job-status/${jobId}` },
  ];

  let lastErr: string | undefined;
  let allErrors: string[] = [];

  for (const c of candidates) {
    try {
      console.log(`[checkMergeStatus] Trying ${c.method} ${c.url}`);
      
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

      // Detect HTML error pages
      if (isHtmlErrorResponse(text)) {
        const err = `HTML error page from ${c.method} ${c.url}`;
        console.log(`[checkMergeStatus] ${err}`);
        allErrors.push(err);
        lastErr = err;
        continue;
      }

      if (!resp.ok) {
        const err = `HTTP ${resp.status} from ${c.method} ${c.url}: ${text.slice(0, 200)}`;
        console.log(`[checkMergeStatus] ${err}`);
        allErrors.push(err);
        lastErr = err;
        continue;
      }

      let raw: any;
      try {
        raw = JSON.parse(text);
      } catch {
        const err = `Invalid JSON from ${c.method} ${c.url}: ${text.slice(0, 100)}`;
        console.log(`[checkMergeStatus] ${err}`);
        allErrors.push(err);
        lastErr = err;
        continue;
      }

      console.log(`[checkMergeStatus] Success with ${c.method} ${c.url}:`, JSON.stringify(raw, null, 2));

      return {
        status: raw.status || "processing",
        progress: raw.progress ?? 0,
        output_url: extractOutputUrl(raw),
        error: raw.error,
        job_id: extractJobId(raw) || jobId,
        message: raw.message,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.log(`[checkMergeStatus] Error from ${c.method} ${c.url}: ${errMsg}`);
      allErrors.push(`${c.method} ${c.url}: ${errMsg}`);
      lastErr = errMsg;
    }
  }

  console.error(`[checkMergeStatus] All candidates failed. Errors:\n${allErrors.join('\n')}`);
  throw new Error(`❌ فشل التحقق من حالة المهمة.\n\nالمحاولات الفاشلة:\n${allErrors.map(e => `• ${e}`).join('\n')}`);
}
