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
function extractStatusEndpoint(raw: any): string | undefined {
  const v =
    raw?.status_url ??
    raw?.statusUrl ??
    raw?.status_endpoint ??
    raw?.statusEndpoint ??
    raw?.check_url ??
    raw?.checkUrl ??
    raw?.result?.status_url ??
    raw?.result?.statusUrl ??
    raw?.result?.status_endpoint ??
    raw?.result?.statusEndpoint ??
    raw?.data?.status_url ??
    raw?.data?.statusUrl ??
    raw?.data?.status_endpoint ??
    raw?.data?.statusEndpoint;
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
const POLLINATIONS_KEY = Deno.env.get("POLLINATIONS_API_KEY") || "";
// =================================================================
// FALLBACK KEYS — loaded from secure environment secrets
// =================================================================
const POLLINATIONS_FLUX_KEY = Deno.env.get("POLLINATIONS_API_KEY_FLUX") || POLLINATIONS_KEY;
const HF_KEY_PRIMARY   = Deno.env.get("HF_KEY_PRIMARY") || Deno.env.get("HF_READ_TOKEN") || "";
const HF_KEY_SECONDARY = Deno.env.get("HF_KEY_SECONDARY") || "";
async function tryPollinationsModel(
  prompt: string, 
  model: string, 
  timeoutMs: number
): Promise<ArrayBuffer> {
  const seed = Math.floor(Math.random() * 2147483647);
  const encodedPrompt = encodeURIComponent(prompt);
  // استخدام الرابط الجديد لـ Pollinations مع key كـ query parameter
  const url = `https://gen.pollinations.ai/image/${encodedPrompt}?model=${model}&width=1080&height=1920&seed=${seed}&nologo=true${POLLINATIONS_FLUX_KEY ? `&key=${POLLINATIONS_FLUX_KEY}` : ""}`;
  logInfo(`[POLLINATIONS] model=${model} seed=${seed} url=${url.slice(0, 120)}...`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "Accept": "image/jpeg,image/*",
        "User-Agent": "Mozilla/5.0",
      },
    });
    
    clearTimeout(timer);
    if (res.status === 402 || res.status === 429) {
       logWarning(`[POLLINATIONS] API Limit Reached (HTTP ${res.status}) for model ${model}`);
       throw new Error(`${model}: تم الوصول للحد المسموح (HTTP ${res.status})`);
    }
    
    if (res.status === 401 || res.status === 403) throw new Error(`${model}: رفض الوصول`);
    
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
  // 🔴 إذا فشل Pollinations تماماً (مثل خطأ 530 Cloudflare)، نحاول مباشرة مع Hugging Face Inference API
  logWarning(`[FLUX] فشل Pollinations تماماً. جاري محاولة استخدام Hugging Face Inference API كبديل مباشر الطوارئ...`);
  try {
    const fallbackImage = await tryDirectHuggingFaceImage(prompt, 60000);
    return fallbackImage;
  } catch (hfErr) {
    const msg = hfErr instanceof Error ? hfErr.message : String(hfErr);
    errors.push(`Hugging Face Direct API: ${msg}`);
  }
  throw new Error(`فشل توليد الصورة بجميع النماذج والبدائل:\n${errors.join('\n')}`);
}
// =================================================================
// DIRECT HUGGING FACE INFERENCE FALLBACK (حل أخير)
// يُستخدم فقط إذا تعطل Pollinations كلياً (مثل خطأ 530 Cloudflare)
// =================================================================
async function tryHFWithKey(prompt: string, timeoutMs: number, hfKey: string): Promise<ArrayBuffer> {
  const url = "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Authorization": `Bearer ${hfKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: prompt })
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} — ${body.slice(0, 150)}`);
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("image") && !ctype.includes("octet")) {
      throw new Error(`استجابة غير صورة (${ctype})`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 5000) throw new Error(`صورة صغيرة جداً (${buf.byteLength}B)`);
    logInfo(`[HF Direct] ✅ نجاح FLUX الطوارئ: ${(buf.byteLength / 1024).toFixed(1)}KB`);
    return buf;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') throw new Error(`انتهت المهلة (${timeoutMs}ms)`);
    throw err;
  }
}
async function tryDirectHuggingFaceImage(prompt: string, timeoutMs: number): Promise<ArrayBuffer> {
  // نجرب المفتاح الأول أولاً
  try {
    const result = await tryHFWithKey(prompt, timeoutMs, HF_KEY_PRIMARY);
    return result;
  } catch (err1) {
    const msg1 = err1 instanceof Error ? err1.message : String(err1);
    logWarning(`[HF] المفتاح الأول فشل: ${msg1}`);
  }
  // إذا فشل الأول، نجرب المفتاح الثاني
  return await tryHFWithKey(prompt, timeoutMs, HF_KEY_SECONDARY);
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
  // Always use /start-merge for 2+ images (async processing)
  const normalizedImages = Array.isArray(request.images)
    ? [...new Set(request.images.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean))]
    : [];
  const normalizedVideos = Array.isArray(request.videos)
    ? [...new Set(request.videos.map((u) => (typeof u === "string" ? u.trim() : "")).filter(Boolean))]
    : [];

  const imageCount = normalizedImages.length;
  const videoCount = normalizedVideos.length;
  const hasVideos = videoCount > 0;
  const hasMultipleImages = imageCount > 1;
  const endpoint = (hasVideos || hasMultipleImages) ? "/start-merge" : "/merge";
  const mergeUrl = `${HF_SPACE_URL}${endpoint}`;
  logInfo(`استخدام نقطة النهاية: ${mergeUrl}`);

  // Step 3: Prepare payload variants (strict multi-image)
  const basePayload: Record<string, unknown> = {
    output_format: request.output_format || "mp4",
    audio: request.audio,
    audioUrl: request.audio,
    audio_url: request.audio,
    audio_path: request.audio,
    image_count: imageCount,
    scene_count: imageCount,
    require_all_images: hasMultipleImages,
    strict_multi_image: hasMultipleImages,
    expected_image_count: imageCount,
  };

  const payloadVariants: Array<{ name: string; payload: Record<string, unknown> }> = [];

  if (hasMultipleImages) {
    // نجرب صياغات متعددة بدون أي حقول مفردة لتفادي قفل المزود على صورة واحدة
    payloadVariants.push({
      name: "image_urls_only",
      payload: {
        ...basePayload,
        image_urls: normalizedImages,
      },
    });

    payloadVariants.push({
      name: "images_only",
      payload: {
        ...basePayload,
        images: normalizedImages,
      },
    });

    payloadVariants.push({
      name: "imageUrls_only",
      payload: {
        ...basePayload,
        imageUrls: normalizedImages,
      },
    });
  } else {
    const singlePayload: Record<string, unknown> = {
      ...basePayload,
      images: normalizedImages,
      image_urls: normalizedImages,
      imageUrls: normalizedImages,
    };

    if (imageCount === 1) {
      singlePayload.image_url = normalizedImages[0];
      singlePayload.imageUrl = normalizedImages[0];
      singlePayload.primary_image = normalizedImages[0];
    }

    payloadVariants.push({ name: "single_or_video", payload: singlePayload });
  }

  if (hasVideos) {
    for (const variant of payloadVariants) {
      variant.payload.videos = normalizedVideos;
      variant.payload.video_urls = normalizedVideos;
    }
  }

  logInfo("محاولات الإرسال:", {
    endpoint,
    hasImages: imageCount > 0,
    hasVideos,
    hasAudio: !!request.audio,
    imageCount,
    videoCount,
    payloadVariants: payloadVariants.map((v) => v.name),
  });

  // Step 4: Make request with timeout + fallback variant attempts
  let response: Response | undefined;
  let responseText = "";
  let selectedVariant = "";
  const attemptErrors: string[] = [];

  for (const variant of payloadVariants) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 minutes

    try {
      logInfo(`إرسال الدمج عبر variant=${variant.name}`);

      const candidateResponse = await fetch(mergeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${HF_READ_TOKEN}`,
        },
        body: JSON.stringify(variant.payload),
        signal: controller.signal,
      });

      const candidateText = await candidateResponse.text();
      clearTimeout(timeout);

      logInfo(`استجابة variant=${variant.name} HTTP ${candidateResponse.status}`, candidateText.slice(0, 220));

      if (isHtmlErrorResponse(candidateText)) {
        attemptErrors.push(`${variant.name}: HTML error page (HTTP ${candidateResponse.status})`);
        continue;
      }

      if (!candidateResponse.ok) {
        attemptErrors.push(`${variant.name}: HTTP ${candidateResponse.status} - ${candidateText.slice(0, 200)}`);
        continue;
      }

      // فحص مبكر: إذا المزود أبلغ صراحة أنه استلم صورة واحدة فقط، نجرب variant آخر
      if (hasMultipleImages) {
        try {
          const parsed = JSON.parse(candidateText);
          const providerImageCount = Number(
            parsed?.image_count ?? parsed?.images_count ?? parsed?.received_images ?? NaN
          );

          if (Number.isFinite(providerImageCount) && providerImageCount < 2) {
            attemptErrors.push(
              `${variant.name}: provider accepted only ${providerImageCount} image(s) while ${imageCount} requested`
            );
            logWarning("⚠️ المزود لم يقبل تعدد الصور — إعادة الإرسال بصيغة أخرى", {
              variant: variant.name,
              providerImageCount,
              requested: imageCount,
            });
            continue;
          }
        } catch {
          // التحليل النهائي سيتم لاحقاً في الخطوة التالية
        }
      }

      response = candidateResponse;
      responseText = candidateText;
      selectedVariant = variant.name;
      break;

    } catch (fetchError) {
      clearTimeout(timeout);
      const msg = fetchError instanceof Error && fetchError.name === "AbortError"
        ? "انتهت مهلة طلب الدمج (2 دقيقة)"
        : (fetchError instanceof Error ? fetchError.message : String(fetchError));
      attemptErrors.push(`${variant.name}: ${msg}`);
    }
  }

  if (!response) {
    throw new Error(`فشل الاتصال بسيرفر الدمج:\n${attemptErrors.join("\n")}`);
  }

  logInfo("تم اختيار variant نهائي للدمج", { selectedVariant, endpoint });
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
  const providerStatusEndpoint = extractStatusEndpoint(rawResult);

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
      attempts: Math.max(1, attemptErrors.length + 1),
      endpoint,
      payload_variant: selectedVariant,
      requested_image_count: imageCount,
      requested_video_count: videoCount,
      provider_status_endpoint: providerStatusEndpoint,
      provider_reported_image_count:
        rawResult?.image_count ?? rawResult?.images_count ?? rawResult?.received_images ?? undefined,
      prior_attempt_errors: attemptErrors.length ? attemptErrors : undefined,
    },
  };
  const providerImageCount = Number(
    rawResult?.image_count ?? rawResult?.images_count ?? rawResult?.received_images ?? NaN
  );
  if (hasMultipleImages && Number.isFinite(providerImageCount) && providerImageCount < 2) {
    logWarning("⚠️ المزود أبلغ بعدد صور أقل من المتوقع", {
      requested: imageCount,
      providerImageCount,
      rawResult,
    });
  }

  return result;
}
// ===== CHECK STATUS =====
function normalizeProviderStatus(rawStatus: unknown): MergeMediaResponse["status"] {
  const s = String(rawStatus || "").toLowerCase().trim();
  if (!s) return "processing";
  if (["completed", "complete", "done", "success", "succeeded", "finished"].includes(s)) return "completed";
  if (["failed", "error", "cancelled", "canceled", "timeout"].includes(s)) return "failed";
  return "processing";
}

export async function checkMergeStatus(jobId: string): Promise<MergeMediaResponse> {
  logInfo(`فحص حالة المهمة: ${jobId}`);

  const candidates = [
    { method: "GET" as const, url: `${HF_SPACE_URL}/status/${jobId}`, name: "GET /status/:id" },
    { method: "GET" as const, url: `${HF_SPACE_URL}/job-status/${jobId}`, name: "GET /job-status/:id" },
    { method: "GET" as const, url: `${HF_SPACE_URL}/status?jobId=${encodeURIComponent(jobId)}`, name: "GET /status?jobId" },
    { method: "GET" as const, url: `${HF_SPACE_URL}/status?job_id=${encodeURIComponent(jobId)}`, name: "GET /status?job_id" },
    { method: "POST" as const, url: `${HF_SPACE_URL}/status`, body: { jobId }, name: "POST /status {jobId}" },
    { method: "POST" as const, url: `${HF_SPACE_URL}/status`, body: { job_id: jobId }, name: "POST /status {job_id}" },
    { method: "POST" as const, url: `${HF_SPACE_URL}/job-status`, body: { jobId }, name: "POST /job-status {jobId}" },
    { method: "POST" as const, url: `${HF_SPACE_URL}/job-status`, body: { job_id: jobId }, name: "POST /job-status {job_id}" },
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
        errors.push(`${c.name}: HTTP 404`);
        continue;
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

      const outputUrl = extractOutputUrl(raw);
      const status = outputUrl
        ? "completed"
        : normalizeProviderStatus(
            raw?.status ?? raw?.state ?? raw?.job_status ?? raw?.result?.status ?? raw?.data?.status
          );

      const rawProgress = Number(
        raw?.progress ?? raw?.percentage ?? raw?.percent ?? raw?.result?.progress ?? raw?.data?.progress ?? 0
      );
      const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : 0;

      logInfo(`✓ ${c.name} نجح`, { status, progress, hasOutput: !!outputUrl });

      return {
        status,
        progress,
        output_url: outputUrl,
        error: raw?.error || raw?.message,
        job_id: extractJobId(raw) || jobId,
        message: raw?.message,
      };
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      errors.push(`${c.name}: ${errorMsg}`);
    }
  }

  const errorSummary = `تعذّر فحص الحالة للمهمة ${jobId}: ${errors.join(" | ")}`;
  logError(errorSummary);
  throw new Error(errorSummary);
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
