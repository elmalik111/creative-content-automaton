const HF_READ_TOKEN = Deno.env.get("HF_READ_TOKEN")!;
const HF_SPACE_URL = Deno.env.get("HF_SPACE_URL") || "https://elmalik-ff.hf.space";

// ===== FREE IMAGE GENERATION ALTERNATIVES =====

/**
 * Hugging Face Free Image Generation Models
 * هذه النماذج مجانية تماماً ولا تحتاج Credits
 */
const FREE_IMAGE_MODELS = {
  // Stable Diffusion 2.1 - سريع ومجاني
  SD_2_1: "stabilityai/stable-diffusion-2-1",
  
  // Stable Diffusion XL - جودة أعلى
  SDXL: "stabilityai/stable-diffusion-xl-base-1.0",
  
  // Playground v2.5 - جودة ممتازة
  PLAYGROUND: "playgroundai/playground-v2.5-1024px-aesthetic",
  
  // Dreamlike Photoreal - واقعي
  DREAMLIKE: "dreamlike-art/dreamlike-photoreal-2.0",
  
  // Realistic Vision - واقعي جداً
  REALISTIC: "SG161222/Realistic_Vision_V5.1_noVAE",
};

// اختر النموذج الافتراضي (يمكن تغييره)
const DEFAULT_FREE_MODEL = FREE_IMAGE_MODELS.PLAYGROUND;

/**
 * Generate image using FREE Hugging Face models
 * بديل مجاني تماماً لـ Flux
 */
export async function generateImageFree(
  prompt: string,
  model: string = DEFAULT_FREE_MODEL
): Promise<ArrayBuffer> {
  
  console.log(`[FREE-IMAGE] توليد صورة باستخدام: ${model}`);
  console.log(`[FREE-IMAGE] Prompt: ${prompt.slice(0, 100)}`);
  
  // إضافة كلمات تحسينية للـ prompt
  const enhancedPrompt = `${prompt}, high quality, detailed, professional`;
  
  try {
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HF_READ_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: enhancedPrompt,
          parameters: {
            width: 1280,
            height: 720,
            num_inference_steps: 30,  // جودة جيدة
            guidance_scale: 7.5,        // توازن بين الإبداع والدقة
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      
      // التحقق من نوع الخطأ
      if (response.status === 402) {
        throw new Error(
          `نفد رصيد Hugging Face Credits.\n` +
          `الحل: استخدم generateImageFree() بدلاً من generateImageWithFlux()\n` +
          `أو: اشترك في Hugging Face PRO`
        );
      }
      
      // إذا كان النموذج يحتاج وقت للتحميل (503)
      if (response.status === 503) {
        console.warn(`[FREE-IMAGE] النموذج يحتاج وقت للتحميل، إعادة المحاولة...`);
        
        // انتظر 10 ثوانٍ ثم حاول مرة أخرى
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        const retryResponse = await fetch(
          `https://api-inference.huggingface.co/models/${model}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${HF_READ_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              inputs: enhancedPrompt,
              parameters: {
                width: 1280,
                height: 720,
                num_inference_steps: 30,
                guidance_scale: 7.5,
              },
            }),
          }
        );
        
        if (!retryResponse.ok) {
          throw new Error(`فشل بعد إعادة المحاولة: ${await retryResponse.text()}`);
        }
        
        const buffer = await retryResponse.arrayBuffer();
        console.log(`[FREE-IMAGE] ✓ تم توليد الصورة بنجاح (${buffer.byteLength} bytes)`);
        return buffer;
      }
      
      throw new Error(`خطأ في توليد الصورة (${response.status}): ${errorText}`);
    }

    const buffer = await response.arrayBuffer();
    console.log(`[FREE-IMAGE] ✓ تم توليد الصورة بنجاح (${buffer.byteLength} bytes)`);
    return buffer;
    
  } catch (error) {
    console.error(`[FREE-IMAGE] فشل توليد الصورة:`, error);
    throw error;
  }
}

/**
 * OLD Flux function - يتطلب Credits مدفوعة
 * استخدم generateImageFree() بدلاً منه
 */
export async function generateImageWithFlux(prompt: string): Promise<ArrayBuffer> {
  console.log("[FLUX] ⚠️ تحذير: Flux يتطلب Credits مدفوعة");
  console.log("[FLUX] ⚠️ استخدم generateImageFree() للحصول على بديل مجاني");
  
  try {
    const response = await fetch(
      "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
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
      
      // إذا كانت المشكلة في الـ Credits
      if (response.status === 402 || error.includes("Credit balance")) {
        console.error("[FLUX] ❌ نفد رصيد Credits");
        console.log("[FLUX] 💡 جارٍ التحويل التلقائي للبديل المجاني...");
        
        // التحويل التلقائي للبديل المجاني
        return await generateImageFree(prompt);
      }
      
      throw new Error(`Flux API error (${response.status}): ${error}`);
    }

    const buffer = await response.arrayBuffer();
    console.log(`[FLUX] ✓ تم توليد الصورة (${buffer.byteLength} bytes)`);
    return buffer;
    
  } catch (error) {
    console.error("[FLUX] خطأ، محاولة البديل المجاني...");
    // Fallback إلى البديل المجاني
    return await generateImageFree(prompt);
  }
}

/**
 * Generate image with multiple fallback options
 * يجرب نماذج متعددة حتى ينجح
 */
export async function generateImageWithFallback(
  prompt: string,
  preferredModel?: string
): Promise<ArrayBuffer> {
  
  const modelsToTry = [
    preferredModel || DEFAULT_FREE_MODEL,
    FREE_IMAGE_MODELS.PLAYGROUND,
    FREE_IMAGE_MODELS.SD_2_1,
    FREE_IMAGE_MODELS.SDXL,
    FREE_IMAGE_MODELS.REALISTIC,
  ].filter((model, index, self) => self.indexOf(model) === index); // إزالة التكرار
  
  console.log(`[IMAGE-GEN] محاولة توليد صورة مع ${modelsToTry.length} نماذج احتياطية`);
  
  const errors: string[] = [];
  
  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    
    try {
      console.log(`[IMAGE-GEN] محاولة ${i + 1}/${modelsToTry.length}: ${model}`);
      const result = await generateImageFree(prompt, model);
      console.log(`[IMAGE-GEN] ✓✓✓ نجح مع النموذج: ${model} ✓✓✓`);
      return result;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[IMAGE-GEN] فشل ${model}: ${errorMsg}`);
      errors.push(`${model}: ${errorMsg}`);
      
      // إذا كان هذا ليس آخر نموذج، انتظر قليلاً قبل المحاولة التالية
      if (i < modelsToTry.length - 1) {
        console.log(`[IMAGE-GEN] انتظار 3 ثوانٍ قبل المحاولة التالية...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }
  
  // فشلت جميع المحاولات
  throw new Error(
    `فشل توليد الصورة مع جميع النماذج:\n${errors.join('\n')}`
  );
}

// ===== التصدير السابق للتوافق =====
// يمكنك الاحتفاظ بهذا للتوافق مع الكود القديم
export { generateImageWithFlux };

// ===== باقي الكود (merge functions, etc.) =====
// ... (باقي الكود الموجود في huggingface.ts)

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
  
  console.log(`[HEALTH] فحص صحة السيرفر: ${HF_SPACE_URL}`);
  
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

    if (isHtmlErrorResponse(responseText)) {
      const isSleeping = isSpaceSleepingError(responseText, resp.status);
      
      return {
        healthy: false,
        status: resp.status,
        isSleeping,
        responseTime,
        error: isSleeping 
          ? "السيرفر في وضع السكون"
          : `السيرفر أرجع صفحة HTML (HTTP ${resp.status})`,
        details: responseText.slice(0, 300)
      };
    }

    const isHealthy = resp.ok || resp.status === 405 || resp.status === 301 || resp.status === 302;
    
    if (isHealthy) {
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
      error: `رمز حالة غير متوقع: ${resp.status}`,
      details: responseText.slice(0, 300)
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return {
      healthy: false,
      responseTime,
      error: errorMessage.includes("aborted") 
        ? "انتهت مهلة الاتصال"
        : `خطأ في الاتصال: ${errorMessage}`,
      details: errorMessage
    };
  }
}

async function wakeUpSpace(): Promise<void> {
  console.log("[WAKE] محاولة إيقاظ السيرفر...");
  
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
    
    console.log("[WAKE] انتظار 10 ثوانٍ لبدء التشغيل...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
  } catch (error) {
    console.warn("[WAKE] قد يستغرق الإيقاظ وقتاً", error);
  }
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
  diagnostics?: {
    healthCheck?: HealthCheckResult;
    spaceWokenUp?: boolean;
    attempts?: number;
  };
}

export async function startMergeWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  const imageUrl = request.images?.[0] || request.videos?.[0];
  const audioUrl = request.audio;

  if (!imageUrl || !audioUrl) {
    throw new Error("Missing imageUrl or audioUrl");
  }

  const healthCheck = await isFFmpegSpaceHealthy();
  
  let spaceWokenUp = false;
  
  if (!healthCheck.healthy) {
    if (healthCheck.isSleeping) {
      await wakeUpSpace();
      spaceWokenUp = true;
      
      const recheckHealth = await isFFmpegSpaceHealthy();
      if (!recheckHealth.healthy) {
        throw new Error(
          `فشل إيقاظ السيرفر. ${recheckHealth.error || 'السيرفر لا يزال غير متاح.'}`
        );
      }
    } else {
      throw new Error(
        `سيرفر الدمج غير متاح.\n` +
        `الخطأ: ${healthCheck.error || 'خطأ غير معروف'}`
      );
    }
  }

  const payload = {
    imageUrl,
    audioUrl,
    images: request.images,
    videos: request.videos,
    audio: request.audio,
    output_format: request.output_format || "mp4",
  };

  const mergeUrl = `${HF_SPACE_URL}/merge`;

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
    throw new Error(`فشل الاتصال بسيرفر الدمج: ${errorMsg}`);
  }

  const responseText = await response.text();

  if (isHtmlErrorResponse(responseText)) {
    throw new Error(
      `خطأ في السيرفر (HTTP ${response.status}): السيرفر أرجع صفحة HTML`
    );
  }

  if (!response.ok) {
    throw new Error(`FFmpeg Space error: ${responseText}`);
  }

  let rawResult: any;
  try {
    rawResult = JSON.parse(responseText);
  } catch {
    throw new Error(`استجابة غير صالحة من السيرفر`);
  }

  return {
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

  if (!jobId) {
    return result;
  }

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
          error: `سيرفر الدمج لا يستجيب بعد ${consecutiveFailures} محاولة`,
        };
      }
    }
  }

  if (attempts >= maxAttempts && result.status === "processing") {
    return {
      status: "failed",
      progress: result.progress,
      error: `تجاوزت عملية الدمج الحد الزمني`,
    };
  }

  return result;
}

export async function checkMergeStatus(jobId: string): Promise<MergeMediaResponse> {
  const candidates = [
    { method: "GET" as const, url: `${HF_SPACE_URL}/status/${jobId}` },
    { method: "GET" as const, url: `${HF_SPACE_URL}/merge/status/${jobId}` },
    { method: "POST" as const, url: `${HF_SPACE_URL}/status`, body: { jobId } },
  ];

  let lastErr: string | undefined;

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
        lastErr = `HTML error from ${c.url}`;
        continue;
      }

      if (!resp.ok) {
        lastErr = `HTTP ${resp.status} from ${c.url}`;
        continue;
      }

      let raw: any;
      try {
        raw = JSON.parse(text);
      } catch {
        lastErr = `Invalid JSON from ${c.url}`;
        continue;
      }

      return {
        status: raw.status || "processing",
        progress: raw.progress ?? 0,
        output_url: extractOutputUrl(raw),
        error: raw.error,
        job_id: extractJobId(raw) || jobId,
        message: raw.message,
      };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }

  throw new Error(lastErr || "Status check failed");
}
