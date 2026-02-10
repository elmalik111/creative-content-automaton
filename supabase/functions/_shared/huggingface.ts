const HF_READ_TOKEN = Deno.env.get("HF_READ_TOKEN")!;
const HF_SPACE_URL = Deno.env.get("HF_SPACE_URL") || "https://elmalik-ff.hf.space";

// ===== بدائل مجانية 100% محدثة ومختبرة =====
const FREE_IMAGE_APIS = [
  {
    name: "Replicate (Free tier)",
    type: "replicate",
    enabled: true,
    description: "موثوق وسريع - FLUX.1-schnell"
  },
  {
    name: "Pollinations AI",
    type: "pollinations",
    enabled: true,
    description: "مجاني تماماً بدون حدود"
  },
  {
    name: "Prodia AI",
    type: "prodia",
    enabled: true,
    description: "Stable Diffusion XL - مجاني"
  },
  {
    name: "Together AI (Free)",
    type: "together",
    enabled: false, // يحتاج API key مجاني
    description: "FLUX مجاني مع API key"
  }
];

// ===== LOGGING =====
function logInfo(message: string, data?: any) {
  console.log(`[IMG-GEN] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

function logError(message: string, error?: any) {
  console.error(`[IMG-ERROR] ${message}`, error ? (error instanceof Error ? error.message : JSON.stringify(error)) : '');
}

function logWarning(message: string, data?: any) {
  console.warn(`[IMG-WARN] ${message}`, data ? JSON.stringify(data, null, 2) : '');
}

// ===== HELPERS =====
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
    trimmed.includes("404") ||
    trimmed.includes("502 bad gateway") ||
    trimmed.includes("503 service unavailable")
  );
}

function isSpaceSleepingError(text: string, status: number): boolean {
  const lower = text.toLowerCase();
  return (
    status === 502 ||
    status === 503 ||
    lower.includes("space is sleeping") ||
    lower.includes("starting up") ||
    lower.includes("bad gateway")
  );
}

// ===== IMAGE GENERATION - METHOD 1: Pollinations (محسّن) =====

async function generateWithPollinations(prompt: string, retries = 3): Promise<ArrayBuffer> {
  logInfo("📌 محاولة Pollinations AI...");
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const encodedPrompt = encodeURIComponent(prompt);
      
      // استخدام seed عشوائي لتجنب الـ cache
      const seed = Math.floor(Math.random() * 1000000);
      
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}` +
        `?width=1280&height=720&seed=${seed}&nologo=true&enhance=true`;
      
      logInfo(`محاولة ${attempt}/${retries}:`, imageUrl.substring(0, 100));
      
      // زيادة Timeout إلى 2 دقيقة
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      
      const response = await fetch(imageUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; ImageGenerator/1.0)"
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const buffer = await response.arrayBuffer();
      
      // التحقق من الحجم
      if (buffer.byteLength < 5000) {
        throw new Error(`الصورة صغيرة جداً: ${buffer.byteLength} bytes`);
      }
      
      logInfo(`✅ نجح Pollinations (${buffer.byteLength} bytes)`);
      return buffer;
      
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logWarning(`محاولة ${attempt} فشلت: ${msg}`);
      
      if (attempt < retries) {
        const waitTime = attempt * 3000; // 3s, 6s, 9s
        logInfo(`انتظار ${waitTime/1000}s قبل إعادة المحاولة...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw new Error(msg);
      }
    }
  }
  
  throw new Error("فشلت جميع المحاولات");
}

// ===== IMAGE GENERATION - METHOD 2: Prodia AI =====

async function generateWithProdia(prompt: string): Promise<ArrayBuffer> {
  logInfo("📌 محاولة Prodia AI...");
  
  try {
    // Prodia لديه API بسيط ومجاني
    const response = await fetch("https://api.prodia.com/v1/sd/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt,
        model: "sdxl",
        negative_prompt: "ugly, blurry, low quality",
        steps: 20,
        cfg_scale: 7,
        seed: -1,
        sampler: "DPM++ 2M Karras",
        aspect_ratio: "16:9"
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    logInfo("Prodia response:", result);
    
    // الحصول على job ID
    const jobId = result.job;
    
    if (!jobId) {
      throw new Error("لم يتم إرجاع job ID");
    }
    
    // الانتظار حتى يكتمل التوليد
    let imageUrl = null;
    const maxAttempts = 30; // 30 * 2s = 60s max
    
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const statusResponse = await fetch(`https://api.prodia.com/v1/job/${jobId}`);
      const statusData = await statusResponse.json();
      
      logInfo(`حالة Prodia: ${statusData.status}`);
      
      if (statusData.status === "succeeded") {
        imageUrl = statusData.imageUrl;
        break;
      } else if (statusData.status === "failed") {
        throw new Error("فشل التوليد في Prodia");
      }
    }
    
    if (!imageUrl) {
      throw new Error("انتهت المهلة في Prodia");
    }
    
    // تحميل الصورة
    const imageResponse = await fetch(imageUrl);
    const buffer = await imageResponse.arrayBuffer();
    
    logInfo(`✅ نجح Prodia (${buffer.byteLength} bytes)`);
    return buffer;
    
  } catch (error) {
    logError("فشل Prodia", error);
    throw error;
  }
}

// ===== IMAGE GENERATION - METHOD 3: استخدام Gradio بشكل صحيح =====

async function generateWithGradio(prompt: string): Promise<ArrayBuffer> {
  logInfo("📌 محاولة Gradio Spaces...");
  
  // قائمة بـ Spaces العاملة
  const workingSpaces = [
    "https://black-forest-labs-flux-1-schnell.hf.space",
    "https://stabilityai-stable-diffusion-xl.hf.space",
  ];
  
  for (const spaceUrl of workingSpaces) {
    try {
      logInfo(`جرب Space: ${spaceUrl}`);
      
      // الخطوة 1: استدعاء predict
      const predictResponse = await fetch(`${spaceUrl}/call/infer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: [prompt]
        })
      });
      
      if (!predictResponse.ok) {
        throw new Error(`Predict failed: ${predictResponse.status}`);
      }
      
      const predictData = await predictResponse.json();
      const eventId = predictData.event_id;
      
      if (!eventId) {
        throw new Error("لم يتم إرجاع event_id");
      }
      
      logInfo(`Event ID: ${eventId}`);
      
      // الخطوة 2: الانتظار للنتيجة
      const resultResponse = await fetch(`${spaceUrl}/call/infer/${eventId}`);
      
      if (!resultResponse.ok) {
        throw new Error(`Result failed: ${resultResponse.status}`);
      }
      
      // قراءة stream
      const reader = resultResponse.body?.getReader();
      if (!reader) throw new Error("No reader");
      
      let imageData = null;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = new TextDecoder().decode(value);
        const lines = text.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data[0]?.url) {
                imageData = data[0];
                break;
              }
            } catch (e) {
              // تجاهل أخطاء parsing
            }
          }
        }
        
        if (imageData) break;
      }
      
      if (!imageData?.url) {
        throw new Error("لم يتم إرجاع رابط الصورة");
      }
      
      // تحميل الصورة
      const fullUrl = imageData.url.startsWith('http') 
        ? imageData.url 
        : `${spaceUrl}/file=${imageData.url}`;
      
      const imageResponse = await fetch(fullUrl);
      const buffer = await imageResponse.arrayBuffer();
      
      logInfo(`✅ نجح Gradio (${buffer.byteLength} bytes)`);
      return buffer;
      
    } catch (error) {
      logWarning(`فشل ${spaceUrl}:`, error);
      continue;
    }
  }
  
  throw new Error("فشلت جميع Gradio Spaces");
}

// ===== IMAGE GENERATION - METHOD 4: استخدام API عام آخر =====

async function generateWithFalAI(prompt: string): Promise<ArrayBuffer> {
  logInfo("📌 محاولة Fal.ai...");
  
  try {
    // Fal.ai لديه tier مجاني
    const response = await fetch("https://fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt,
        image_size: "landscape_16_9",
        num_inference_steps: 4,
        num_images: 1
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    
    if (!result.images || !result.images[0]?.url) {
      throw new Error("لم يتم إرجاع صورة");
    }
    
    // تحميل الصورة
    const imageResponse = await fetch(result.images[0].url);
    const buffer = await imageResponse.arrayBuffer();
    
    logInfo(`✅ نجح Fal.ai (${buffer.byteLength} bytes)`);
    return buffer;
    
  } catch (error) {
    logError("فشل Fal.ai", error);
    throw error;
  }
}

// ===== الدالة الرئيسية مع جميع البدائل =====

export async function generateImageWithFlux(prompt: string): Promise<ArrayBuffer> {
  logInfo("🎨 بدء توليد الصورة", { prompt: prompt.slice(0, 100) });
  
  const errors: string[] = [];
  
  // الأولوية 1: Pollinations (الأسرع والأكثر موثوقية)
  try {
    logInfo("🥇 الأولوية 1: Pollinations AI (محسّن)");
    return await generateWithPollinations(prompt, 3);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logWarning("فشل Pollinations:", msg);
    errors.push(`Pollinations: ${msg}`);
  }
  
  // الأولوية 2: Prodia
  try {
    logInfo("🥈 الأولوية 2: Prodia AI");
    return await generateWithProdia(prompt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logWarning("فشل Prodia:", msg);
    errors.push(`Prodia: ${msg}`);
  }
  
  // الأولوية 3: Fal.ai
  try {
    logInfo("🥉 الأولوية 3: Fal.ai");
    return await generateWithFalAI(prompt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logWarning("فشل Fal.ai:", msg);
    errors.push(`Fal.ai: ${msg}`);
  }
  
  // الأولوية 4: Gradio Spaces
  try {
    logInfo("4️⃣ الأولوية 4: Gradio Spaces");
    return await generateWithGradio(prompt);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logWarning("فشل Gradio:", msg);
    errors.push(`Gradio: ${msg}`);
  }
  
  // فشلت جميع الطرق
  const errorSummary = errors.join('\n');
  logError("❌ فشلت جميع الطرق", errorSummary);
  
  throw new Error(
    `فشل توليد الصورة من جميع المصادر (${errors.length} محاولات).\n\n` +
    `الأخطاء:\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n\n` +
    `💡 الحلول:\n` +
    `1. تأكد من اتصالك بالإنترنت\n` +
    `2. جرب نص أبسط وأقصر (بالإنجليزية)\n` +
    `3. انتظر دقيقة وحاول مرة أخرى\n` +
    `4. تحقق من الـ Logs أعلاه للتفاصيل`
  );
}

// ===== HEALTH CHECK للسيرفر =====

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
  logInfo(`فحص صحة سيرفر الدمج: ${HF_SPACE_URL}`);
  
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
        error: isSleeping ? "السيرفر نائم" : `خطأ HTML`,
        details: responseText.slice(0, 300)
      };
    }

    const isHealthy = resp.ok || resp.status === 405 || resp.status === 301;
    
    if (isHealthy) {
      logInfo(`✓ السيرفر صحي`);
      return { healthy: true, status: resp.status, responseTime };
    }

    return {
      healthy: false,
      status: resp.status,
      responseTime,
      error: `HTTP ${resp.status}`,
      details: responseText.slice(0, 300)
    };

  } catch (error) {
    return {
      healthy: false,
      responseTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function wakeUpSpace(maxAttempts: number = 3): Promise<boolean> {
  logInfo(`إيقاظ السيرفر (${maxAttempts} محاولات)...`);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);

      const response = await fetch(HF_SPACE_URL, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${HF_READ_TOKEN}`,
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
        await new Promise(resolve => setTimeout(resolve, attempt * 10000));
      }
      
    } catch (error) {
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }
  
  return false;
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

export async function startMergeWithFFmpeg(request: MergeMediaRequest): Promise<MergeMediaResponse> {
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
      error: `سيرفر الدمج غير متاح: ${healthCheck.error}`,
      diagnostics: { healthCheck }
    };
  }

  const mergeUrl = `${HF_SPACE_URL}/merge`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  
  try {
    const response = await fetch(mergeUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_READ_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        images: request.images,
        videos: request.videos,
        audio: request.audio,
        output_format: request.output_format || "mp4",
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const responseText = await response.text();

    if (!response.ok) {
      return {
        status: "failed",
        progress: 0,
        error: `فشل الدمج (HTTP ${response.status}): ${responseText.slice(0, 500)}`
      };
    }

    const rawResult = JSON.parse(responseText);
    return {
      status: rawResult.status || "processing",
      progress: rawResult.progress ?? 0,
      output_url: extractOutputUrl(rawResult),
      error: rawResult.error,
      job_id: extractJobId(rawResult),
      message: rawResult.message,
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    return {
      status: "failed",
      progress: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function mergeMediaWithFFmpeg(request: MergeMediaRequest): Promise<MergeMediaResponse> {
  const initialResult = await startMergeWithFFmpeg(request);
  
  if (initialResult.status !== "processing" || !initialResult.job_id) {
    return initialResult;
  }

  return await pollForMergeCompletion(initialResult);
}

async function pollForMergeCompletion(
  initialResult: MergeMediaResponse,
  maxAttempts = 60,
  pollInterval = 5000
): Promise<MergeMediaResponse> {
  let attempts = 0;
  let result = initialResult;
  const jobId = result.job_id!;

  while (result.status === "processing" && attempts < maxAttempts) {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const status = await checkMergeStatus(jobId);
      result = { ...result, ...status };

      if (result.output_url?.startsWith("http")) {
        result.status = "completed";
      }
    } catch (error) {
      // تجاهل أخطاء المراقبة المؤقتة
    }
  }

  return result;
}

export async function checkMergeStatus(jobId: string): Promise<MergeMediaResponse> {
  const url = `${HF_SPACE_URL}/status/${jobId}`;
  
  const response = await fetch(url, {
    headers: { "Authorization": `Bearer ${HF_READ_TOKEN}` }
  });
  
  const text = await response.text();
  const raw = JSON.parse(text);
  
  return {
    status: raw.status || "processing",
    progress: raw.progress ?? 0,
    output_url: extractOutputUrl(raw),
    error: raw.error,
    job_id: jobId,
  };
}
