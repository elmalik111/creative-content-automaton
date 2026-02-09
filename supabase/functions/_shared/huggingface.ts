const HF_READ_TOKEN = Deno.env.get("HF_READ_TOKEN")!;
const HF_SPACE_URL = Deno.env.get("HF_SPACE_URL") || "https://elmalik-ff.hf.space";

// ===== APIs مجانية محدّثة وموثوقة =====
const FREE_IMAGE_GENERATORS = [
  {
    name: "Pollinations AI v2",
    type: "pollinations-v2",
    url: "https://pollinations.ai/p/",
    requiresToken: false,
    free: true,
    description: "النسخة المحدثة من Pollinations"
  },
  {
    name: "Prodia (Free Stable Diffusion)",
    type: "prodia",
    url: "https://api.prodia.com/v1/sd/generate",
    requiresToken: false,
    free: true,
    description: "Stable Diffusion مجاني"
  },
  {
    name: "Hugging Face Inference API (Free tier)",
    type: "hf-inference",
    url: "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
    requiresToken: false,
    free: true,
    description: "SDXL مجاني بدون token"
  },
  {
    name: "ImgGen AI",
    type: "imggen",
    url: "https://api.imggen.ai/generate",
    requiresToken: false,
    free: true,
    description: "خدمة مجانية جديدة"
  },
  {
    name: "DeepAI",
    type: "deepai",
    url: "https://api.deepai.org/api/text2img",
    requiresToken: false,
    free: true,
    description: "DeepAI مجاني"
  }
];

// ===== LOGGING =====
function logInfo(message: string, data?: any) {
  console.log(`[IMG-INFO] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function logError(message: string, error?: any) {
  console.error(`[IMG-ERROR] ${message}`, error ? (error instanceof Error ? error.message : JSON.stringify(error)) : '');
}

// ===== GENERATORS =====

/**
 * Pollinations v2 - أكثر استقراراً
 */
async function generateWithPollinationsV2(prompt: string): Promise<ArrayBuffer> {
  logInfo("محاولة: Pollinations v2");
  
  const encodedPrompt = encodeURIComponent(prompt);
  const imageUrl = `https://pollinations.ai/p/${encodedPrompt}?width=1280&height=720&nologo=true&model=flux`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 ثانية
  
  try {
    const response = await fetch(imageUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const buffer = await response.arrayBuffer();
    logInfo(`✅ نجح Pollinations v2 (${buffer.byteLength} bytes)`);
    return buffer;
    
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Prodia - Stable Diffusion مجاني
 */
async function generateWithProdia(prompt: string): Promise<ArrayBuffer> {
  logInfo("محاولة: Prodia");
  
  try {
    // طلب التوليد
    const generateResponse = await fetch("https://api.prodia.com/v1/sd/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt,
        model: "sdv1_4.ckpt",
        steps: 25,
        cfg_scale: 7,
        width: 1024,
        height: 576,
      }),
    });
    
    if (!generateResponse.ok) {
      throw new Error(`HTTP ${generateResponse.status}`);
    }
    
    const jobData = await generateResponse.json();
    const jobId = jobData.job;
    
    if (!jobId) {
      throw new Error("لم يتم الحصول على job ID");
    }
    
    logInfo(`Job ID: ${jobId} - انتظار...`);
    
    // انتظار اكتمال التوليد
    let attempts = 0;
    while (attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const statusResponse = await fetch(`https://api.prodia.com/v1/job/${jobId}`);
      const statusData = await statusResponse.json();
      
      if (statusData.status === "succeeded") {
        const imageUrl = statusData.imageUrl;
        const imageResponse = await fetch(imageUrl);
        const buffer = await imageResponse.arrayBuffer();
        
        logInfo(`✅ نجح Prodia (${buffer.byteLength} bytes)`);
        return buffer;
      }
      
      if (statusData.status === "failed") {
        throw new Error("فشل التوليد");
      }
      
      attempts++;
    }
    
    throw new Error("انتهت المهلة");
    
  } catch (error) {
    throw error;
  }
}

/**
 * HF Inference API - بدون token
 */
async function generateWithHFInference(prompt: string): Promise<ArrayBuffer> {
  logInfo("محاولة: HF Inference (SDXL)");
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  
  try {
    const response = await fetch(
      "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          options: { wait_for_model: true }
        }),
        signal: controller.signal,
      }
    );
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 100)}`);
    }
    
    const buffer = await response.arrayBuffer();
    logInfo(`✅ نجح HF Inference (${buffer.byteLength} bytes)`);
    return buffer;
    
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * DeepAI - مجاني
 */
async function generateWithDeepAI(prompt: string): Promise<ArrayBuffer> {
  logInfo("محاولة: DeepAI");
  
  const formData = new FormData();
  formData.append("text", prompt);
  
  try {
    const response = await fetch("https://api.deepai.org/api/text2img", {
      method: "POST",
      headers: {
        "api-key": "quickstart-QUdJIGlzIGNvbWluZy4uLi4K", // مفتاح عام للتجربة
      },
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    const imageUrl = result.output_url;
    
    if (!imageUrl) {
      throw new Error("لا يوجد رابط للصورة");
    }
    
    const imageResponse = await fetch(imageUrl);
    const buffer = await imageResponse.arrayBuffer();
    
    logInfo(`✅ نجح DeepAI (${buffer.byteLength} bytes)`);
    return buffer;
    
  } catch (error) {
    throw error;
  }
}

/**
 * الدالة الرئيسية - تجرب جميع المصادر
 */
export async function generateImageBuffer(prompt: string): Promise<ArrayBuffer> {
  const errors: string[] = [];
  
  // 1. جرب Pollinations v2
  try {
    return await generateWithPollinationsV2(prompt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`Pollinations v2: ${msg}`);
    logError("فشل Pollinations v2", msg);
  }
  
  // 2. جرب Prodia
  try {
    return await generateWithProdia(prompt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`Prodia: ${msg}`);
    logError("فشل Prodia", msg);
  }
  
  // 3. جرب HF Inference
  try {
    return await generateWithHFInference(prompt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`HF Inference: ${msg}`);
    logError("فشل HF Inference", msg);
  }
  
  // 4. جرب DeepAI
  try {
    return await generateWithDeepAI(prompt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`DeepAI: ${msg}`);
    logError("فشل DeepAI", msg);
  }
  
  // جميع المصادر فشلت
  throw new Error(
    `❌ فشل توليد الصورة من جميع المصادر المجانية.\n\n` +
    `الأخطاء:\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n\n` +
    `💡 الحلول:\n` +
    `1. تحقق من الإنترنت\n` +
    `2. جرب نص أقصر (20-50 كلمة)\n` +
    `3. انتظر دقيقة ثم أعد المحاولة\n` +
    `4. استخدم VPN إذا كانت الخدمات محظورة في منطقتك\n` +
    `5. احصل على API key مدفوع: https://replicate.com أو https://huggingface.co/pricing`
  );
}

// ===== بقية الكود الأصلي (Merge, Health Check, etc.) =====

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
  
  logInfo(`فحص السيرفر: ${HF_SPACE_URL}`);
  
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);

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

    if (isHtmlErrorResponse(responseText)) {
      const isSleeping = isSpaceSleepingError(responseText, resp.status);
      
      return {
        healthy: false,
        status: resp.status,
        isSleeping,
        responseTime,
        error: isSleeping 
          ? "السيرفر في وضع السكون"
          : `السيرفر أرجع HTML (HTTP ${resp.status})`,
        details: responseText.slice(0, 300)
      };
    }

    const isHealthy = resp.ok || resp.status === 405 || resp.status === 301 || resp.status === 302;
    
    if (isHealthy) {
      logInfo(`✓ السيرفر يعمل`);
      return {
        healthy: true,
        status: resp.status,
        responseTime
      };
    }

    return {
      healthy: false,
      status: resp.status,
      responseTime,
      error: `HTTP ${resp.status}`,
      details: responseText.slice(0, 300)
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      healthy: false,
      responseTime,
      error: errorMessage.includes("aborted") 
        ? "انتهت المهلة (20 ثانية)"
        : `خطأ: ${errorMessage}`,
      details: errorMessage
    };
  }
}

async function wakeUpSpace(maxAttempts: number = 3): Promise<boolean> {
  logInfo(`إيقاظ السيرفر...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);

      const response = await fetch(HF_SPACE_URL, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${HF_READ_TOKEN}`,
          "User-Agent": "Supabase-Edge-Function/1.0"
        },
        signal: ctrl.signal,
      });
      
      clearTimeout(timer);
      
      if (response.status < 500) {
        logInfo(`✓ استيقظ في المحاولة ${attempt}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return true;
      }
      
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
      
    } catch (error) {
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }
  
  return false;
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
  diagnostics?: any;
}

export async function startMergeWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  
  logInfo("=== بدء الدمج ===");

  let healthCheck = await isFFmpegSpaceHealthy();
  let spaceWokenUp = false;
  
  if (!healthCheck.healthy && healthCheck.isSleeping) {
    spaceWokenUp = await wakeUpSpace(3);
    
    if (spaceWokenUp) {
      healthCheck = await isFFmpegSpaceHealthy();
    }
  }
  
  if (!healthCheck.healthy) {
    return {
      status: "failed",
      progress: 0,
      error: `السيرفر غير متاح:\n${healthCheck.error}`,
      diagnostics: { healthCheck, spaceWokenUp }
    };
  }

  const mergeUrl = `${HF_SPACE_URL}/merge`;
  const mergePayload = {
    images: request.images,
    videos: request.videos,
    audio: request.audio,
    output_format: request.output_format || "mp4",
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  
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
    
    return {
      status: "failed",
      progress: 0,
      error: `فشل الاتصال:\n${errorMsg}`,
      diagnostics: { healthCheck, spaceWokenUp, fetchError: errorMsg }
    };
  }

  const responseText = await response.text();

  if (isHtmlErrorResponse(responseText)) {
    return {
      status: "failed",
      progress: 0,
      error: `السيرفر أرجع HTML بدلاً من JSON`,
      diagnostics: { healthCheck, spaceWokenUp, htmlError: true }
    };
  }

  if (!response.ok) {
    return {
      status: "failed",
      progress: 0,
      error: `HTTP ${response.status}:\n${responseText.slice(0, 500)}`,
      diagnostics: { healthCheck, spaceWokenUp, httpError: true }
    };
  }

  let rawResult: any;
  try {
    rawResult = JSON.parse(responseText);
  } catch (parseError) {
    return {
      status: "failed",
      progress: 0,
      error: `استجابة غير صالحة`,
      diagnostics: { healthCheck, spaceWokenUp, parseError: true }
    };
  }

  return {
    status: rawResult.status || "processing",
    progress: rawResult.progress ?? 0,
    output_url: extractOutputUrl(rawResult),
    error: rawResult.error,
    job_id: extractJobId(rawResult),
    message: rawResult.message,
    diagnostics: { healthCheck, spaceWokenUp, attempts: 1 }
  };
}

export async function mergeMediaWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  
  const initialResult = await startMergeWithFFmpeg(request);
  
  if (initialResult.status === "completed" || initialResult.status === "failed") {
    return initialResult;
  }

  if (initialResult.job_id && initialResult.status === "processing") {
    return await pollForMergeCompletion(initialResult);
  }

  return initialResult;
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
  if (!jobId) return result;

  while (result.status === "processing" && attempts < maxAttempts) {
    attempts++;
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
      }
    } catch (pollError) {
      consecutiveFailures++;
      if (consecutiveFailures >= 10) {
        return {
          status: "failed",
          progress: result.progress,
          error: `السيرفر لا يستجيب`,
          diagnostics: { attempts: consecutiveFailures }
        };
      }
    }
  }

  if (attempts >= maxAttempts && result.status === "processing") {
    return {
      status: "failed",
      progress: result.progress,
      error: `تجاوز الحد الزمني`,
      diagnostics: { attempts }
    };
  }

  return result;
}

export async function checkMergeStatus(jobId: string): Promise<MergeMediaResponse> {
  const candidates = [
    { method: "GET" as const, url: `${HF_SPACE_URL}/status/${jobId}`, name: "GET /status/:id" },
    { method: "GET" as const, url: `${HF_SPACE_URL}/merge/status/${jobId}`, name: "GET /merge/status/:id" },
    { method: "POST" as const, url: `${HF_SPACE_URL}/status`, body: { jobId }, name: "POST /status" },
  ];

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

      if (isHtmlErrorResponse(text) || !resp.ok) continue;

      const raw = JSON.parse(text);
      return {
        status: raw.status || "processing",
        progress: raw.progress ?? 0,
        output_url: extractOutputUrl(raw),
        error: raw.error,
        job_id: extractJobId(raw) || jobId,
        message: raw.message,
      };
    } catch (e) {
      continue;
    }
  }

  throw new Error(`فشل فحص المهمة ${jobId}`);
}
