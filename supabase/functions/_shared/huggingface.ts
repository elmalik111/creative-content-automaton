const HF_READ_TOKEN = Deno.env.get("HF_READ_TOKEN")!;
const HF_SPACE_URL = Deno.env.get("HF_SPACE_URL") || "https://elmalik-ff.hf.space";

// ===== بدائل مجانية 100% لتوليد الصور =====
const FREE_IMAGE_GENERATORS = [
  {
    name: "Pollinations AI (Free, No Auth)",
    type: "pollinations",
    url: "https://image.pollinations.ai/prompt/",
    requiresToken: false,
    free: true,
    description: "خدمة مجانية بالكامل بدون حاجة لـ API key"
  },
  {
    name: "Hugging Face Space (FLUX Direct)",
    type: "hf-space-direct",
    url: "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
    spaceUrl: "https://black-forest-labs-flux-1-schnell.hf.space/api/predict",
    requiresToken: false,
    free: true,
    description: "استدعاء مباشر لـ Space"
  },
  {
    name: "Segmind (Free tier)",
    type: "segmind",
    url: "https://api.segmind.com/v1/sd1.5-txt2img",
    requiresToken: false, // يمكن استخدامه بدون token لعدد محدود
    free: true,
    description: "Stable Diffusion 1.5"
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

function isCreditDepletedError(text: string, status: number): boolean {
  const lower = text.toLowerCase();
  return (
    status === 402 ||
    status === 410 ||
    lower.includes("credit") && (lower.includes("depleted") || lower.includes("balance")) ||
    lower.includes("quota") && lower.includes("exceeded") ||
    lower.includes("no longer supported") ||
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

export async function isFFmpegSpaceHealthy(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  logInfo(`بدء فحص صحة السيرفر على: ${HF_SPACE_URL}`);
  
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

    logInfo(`استجابة الفحص الصحي: HTTP ${resp.status} في ${responseTime}ms`);

    if (isHtmlErrorResponse(responseText)) {
      const isSleeping = isSpaceSleepingError(responseText, resp.status);
      
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

    const isHealthy = resp.ok || resp.status === 405 || resp.status === 301 || resp.status === 302;
    
    if (isHealthy) {
      logInfo(`✓ السيرفر يعمل بشكل صحيح`);
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
      error: `السيرفر أرجع رمز حالة غير متوقع: ${resp.status}`,
      details: responseText.slice(0, 300)
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      healthy: false,
      responseTime,
      error: errorMessage.includes("aborted") 
        ? "انتهت مهلة الاتصال بالسيرفر (20 ثانية)"
        : `خطأ في الاتصال: ${errorMessage}`,
      details: errorMessage
    };
  }
}

// ===== WAKE UP SPACE =====

async function wakeUpSpace(maxAttempts: number = 3): Promise<boolean> {
  logInfo(`محاولة إيقاظ السيرفر (${maxAttempts} محاولات)...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logInfo(`محاولة إيقاظ ${attempt}/${maxAttempts}...`);
      
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
      
      logInfo(`استجابة الإيقاظ ${attempt}: HTTP ${response.status}`);
      
      if (response.status < 500) {
        logInfo(`✓ السيرفر استيقظ في المحاولة ${attempt}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return true;
      }
      
      if (attempt < maxAttempts) {
        const waitTime = attempt * 10000;
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
  
  return false;
}

// ===== IMAGE GENERATION WITH FREE ALTERNATIVES =====

/**
 * توليد صورة باستخدام Pollinations AI (مجاني 100%)
 */
async function generateWithPollinations(prompt: string): Promise<ArrayBuffer> {
  logInfo("محاولة التوليد عبر Pollinations AI...");
  
  // Pollinations يقبل النص في URL مباشرة
  const encodedPrompt = encodeURIComponent(prompt);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&nologo=true&enhance=true`;
  
  logInfo("URL الصورة:", imageUrl);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds
  
  try {
    const response = await fetch(imageUrl, {
      method: "GET",
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const buffer = await response.arrayBuffer();
    
    if (buffer.byteLength < 1000) {
      throw new Error("الصورة المولدة صغيرة جداً");
    }
    
    logInfo(`✅ نجح التوليد عبر Pollinations (${buffer.byteLength} bytes)`);
    return buffer;
    
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * توليد صورة عبر Hugging Face Space مباشرة (Gradio API)
 */
async function generateWithHFSpaceDirect(prompt: string): Promise<ArrayBuffer> {
  logInfo("محاولة التوليد عبر HF Space API...");
  
  // استدعاء Gradio API مباشرة
  const spaceUrl = "https://black-forest-labs-flux-1-schnell.hf.space";
  
  try {
    // الخطوة 1: إرسال الطلب
    const response = await fetch(`${spaceUrl}/api/predict`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: [
          prompt,  // النص
          0,       // seed (0 = random)
          true,    // randomize_seed
          1280,    // width
          720,     // height
          4,       // num_inference_steps (سريع)
        ]
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    logInfo("استجابة Space:", result);
    
    // الخطوة 2: الحصول على رابط الصورة
    let imageUrl = null;
    
    if (result.data && result.data[0]) {
      // قد يكون الرد مباشرة رابط أو object
      if (typeof result.data[0] === 'string') {
        imageUrl = result.data[0];
      } else if (result.data[0].url) {
        imageUrl = result.data[0].url;
      } else if (result.data[0].path) {
        imageUrl = `${spaceUrl}/file=${result.data[0].path}`;
      }
    }
    
    if (!imageUrl) {
      throw new Error("لم يتم إرجاع رابط الصورة من Space");
    }
    
    logInfo("رابط الصورة:", imageUrl);
    
    // الخطوة 3: تحميل الصورة
    const imageResponse = await fetch(imageUrl);
    
    if (!imageResponse.ok) {
      throw new Error(`فشل تحميل الصورة: HTTP ${imageResponse.status}`);
    }
    
    const buffer = await imageResponse.arrayBuffer();
    logInfo(`✅ نجح التوليد عبر HF Space (${buffer.byteLength} bytes)`);
    
    return buffer;
    
  } catch (error) {
    logError("فشل التوليد عبر HF Space", error);
    throw error;
  }
}

/**
 * توليد صورة عبر API محلي (إذا كان متوفراً)
 */
async function generateWithLocalAPI(prompt: string): Promise<ArrayBuffer> {
  logInfo("محاولة التوليد عبر API محلي...");
  
  // إذا كان لديك Space خاص بك على Hugging Face
  const localSpaceUrl = Deno.env.get("CUSTOM_IMAGE_SPACE_URL");
  
  if (!localSpaceUrl) {
    throw new Error("لا يوجد Custom Space URL");
  }
  
  const response = await fetch(`${localSpaceUrl}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: prompt,
      width: 1280,
      height: 720,
    })
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const buffer = await response.arrayBuffer();
  logInfo(`✅ نجح التوليد عبر API المحلي (${buffer.byteLength} bytes)`);
  
  return buffer;
}

/**
 * الدالة الرئيسية لتوليد الصور مع بدائل مجانية
 */
export async function generateImageWithFlux(prompt: string): Promise<ArrayBuffer> {
  logInfo("🎨 بدء توليد الصورة مع البدائل المجانية", { 
    prompt: prompt.slice(0, 100)
  });
  
  const errors: string[] = [];
  
  // الأولوية 1: Pollinations AI (مجاني 100% بدون API key)
  try {
    logInfo("📌 الأولوية 1: Pollinations AI");
    return await generateWithPollinations(prompt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logWarning("فشل Pollinations AI", msg);
    errors.push(`Pollinations AI: ${msg}`);
  }
  
  // الأولوية 2: Hugging Face Space مباشرة
  try {
    logInfo("📌 الأولوية 2: Hugging Face Space Direct API");
    return await generateWithHFSpaceDirect(prompt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logWarning("فشل HF Space Direct", msg);
    errors.push(`HF Space Direct: ${msg}`);
  }
  
  // الأولوية 3: Custom Space (إن وجد)
  try {
    logInfo("📌 الأولوية 3: Custom Image Generation Space");
    return await generateWithLocalAPI(prompt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logWarning("فشل Custom API", msg);
    errors.push(`Custom API: ${msg}`);
  }
  
  // الأولوية 4: محاولة Router (إذا كان هناك رصيد)
  if (HF_READ_TOKEN) {
    try {
      logInfo("📌 الأولوية 4: Hugging Face Router (يتطلب رصيد)");
      
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
        logInfo(`✅ نجح عبر Router (${buffer.byteLength} bytes)`);
        return buffer;
      }
      
      const errorText = await response.text();
      errors.push(`HF Router: HTTP ${response.status} - ${errorText.slice(0, 100)}`);
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`HF Router: ${msg}`);
    }
  }
  
  // جميع الخيارات فشلت
  const errorSummary = errors.join('\n');
  logError("❌ فشل توليد الصورة من جميع المصادر", errorSummary);
  
  throw new Error(
    `فشل توليد الصورة من جميع المصادر المجانية.\n\n` +
    `الأخطاء:\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n\n` +
    `💡 الحلول المقترحة:\n` +
    `1. تحقق من اتصالك بالإنترنت\n` +
    `2. جرب مرة أخرى بعد دقيقة (قد تكون الخدمات مشغولة)\n` +
    `3. استخدم نص أقصر وأبسط للصورة\n` +
    `4. احصل على رصيد في Hugging Face: https://huggingface.co/pricing\n` +
    `5. أنشئ Space خاص بك للتوليد`
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

// ===== START MERGE =====

export async function startMergeWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  
  logInfo("=== بدء عملية الدمج ===", {
    hasImages: !!(request.images && request.images.length > 0),
    hasVideos: !!(request.videos && request.videos.length > 0),
    hasAudio: !!request.audio,
  });

  let healthCheck = await isFFmpegSpaceHealthy();
  let spaceWokenUp = false;
  
  if (!healthCheck.healthy && healthCheck.isSleeping) {
    logInfo("السيرفر نائم - محاولة الإيقاظ...");
    spaceWokenUp = await wakeUpSpace(3);
    
    if (spaceWokenUp) {
      healthCheck = await isFFmpegSpaceHealthy();
    }
  }
  
  if (!healthCheck.healthy) {
    return {
      status: "failed",
      progress: 0,
      error: `سيرفر الدمج غير متاح:\n${healthCheck.error}`,
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
      error: `فشل الاتصال بسيرفر الدمج:\n${errorMsg}`,
      diagnostics: { healthCheck, spaceWokenUp, fetchError: errorMsg }
    };
  }

  const responseText = await response.text();

  if (isHtmlErrorResponse(responseText)) {
    return {
      status: "failed",
      progress: 0,
      error: `السيرفر أرجع صفحة HTML بدلاً من JSON`,
      diagnostics: { healthCheck, spaceWokenUp, htmlError: true }
    };
  }

  if (!response.ok) {
    return {
      status: "failed",
      progress: 0,
      error: `فشل سيرفر الدمج (HTTP ${response.status}):\n${responseText.slice(0, 500)}`,
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
      error: `استجابة غير صالحة من السيرفر`,
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
          error: `سيرفر الدمج لا يستجيب`,
          diagnostics: { attempts: consecutiveFailures }
        };
      }
    }
  }

  if (attempts >= maxAttempts && result.status === "processing") {
    return {
      status: "failed",
      progress: result.progress,
      error: `تجاوزت عملية الدمج الحد الزمني`,
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

  throw new Error(`فشل فحص حالة المهمة ${jobId}`);
}
