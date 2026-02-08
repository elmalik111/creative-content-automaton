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
 * Quick health check – returns true if the FFmpeg Space is reachable.
 */
export async function isFFmpegSpaceHealthy(): Promise<boolean> {
  try {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔍 فحص صحة السيرفر");
    console.log(`📍 URL: ${HF_SPACE_URL}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      console.log("⏱️ انتهى وقت الانتظار (10 ثوانٍ)");
      ctrl.abort();
    }, 10000);

    const startTime = Date.now();
    const resp = await fetch(HF_SPACE_URL, {
      method: "GET",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    
    const duration = Date.now() - startTime;

    console.log(`✅ استجابة السيرفر:`);
    console.log(`   - Status Code: ${resp.status}`);
    console.log(`   - Status Text: ${resp.statusText}`);
    console.log(`   - وقت الاستجابة: ${duration}ms`);
    console.log(`   - Headers:`, Object.fromEntries(resp.headers.entries()));
    
    // محاولة قراءة الـ body
    const bodyText = await resp.text();
    console.log(`   - Response Body (first 200 chars): ${bodyText.slice(0, 200)}`);
    
    const isHealthy = resp.ok || resp.status === 405 || resp.status === 301 || resp.status === 302;
    
    if (isHealthy) {
      console.log("✅ السيرفر يعمل بشكل صحيح");
    } else {
      console.log(`❌ السيرفر يرجع خطأ: ${resp.status}`);
    }
    
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    
    return isHealthy;
  } catch (error) {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("❌ فشل فحص صحة السيرفر");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error("تفاصيل الخطأ:", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined,
    });
    
    if (error instanceof Error && error.name === "AbortError") {
      console.log("⏱️ السبب: انتهى وقت الانتظار - السيرفر بطيء جداً أو لا يستجيب");
    } else if (error instanceof TypeError) {
      console.log("🌐 السبب: خطأ في الاتصال بالشبكة - تحقق من:");
      console.log("   1. اتصال الإنترنت");
      console.log("   2. صحة الـ URL");
      console.log("   3. السيرفر قد يكون متوقف");
    }
    
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    return false;
  }
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
}

/**
 * Starts a merge job on the FFmpeg Space and returns the *initial* response (no polling).
 * Includes a health check to fail fast if the server is down.
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
  console.log("\n🔍 بدء فحص صحة السيرفر قبل عملية الدمج...\n");
  const healthy = await isFFmpegSpaceHealthy();
  
  if (!healthy) {
    const errorMsg = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ سيرفر الدمج غير متاح
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

السيرفر المستهدف: ${HF_SPACE_URL}

الأسباب المحتملة:
1. السيرفر متوقف أو في وضع Sleep على Hugging Face
2. مشكلة في الاتصال بالإنترنت
3. الـ URL خاطئ
4. السيرفر يحتاج وقت للاستيقاظ (cold start)

الحلول المقترحة:
1. افتح الرابط في المتصفح: ${HF_SPACE_URL}
2. انتظر دقيقة حتى يستيقظ السيرفر
3. تأكد من أن Space مفعّل على Hugging Face
4. جرب مرة أخرى بعد قليل

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    console.error(errorMsg);
    throw new Error("سيرفر الدمج (FFmpeg Space) غير متاح حالياً. يرجى المحاولة لاحقاً.");
  }

  const payload = {
    imageUrl,
    audioUrl,
    images: request.images,
    videos: request.videos,
    audio: request.audio,
    output_format: request.output_format || "mp4",
  };

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📤 إرسال طلب الدمج");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Target URL:", `${HF_SPACE_URL}/merge`);
  console.log("Payload:", JSON.stringify(payload, null, 2));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

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
    
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📥 استجابة السيرفر");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Status:", response.status, response.statusText);
    console.log("Headers:", Object.fromEntries(response.headers.entries()));
    console.log("Body (first 500 chars):", responseText.slice(0, 500));
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Detect HTML error pages
    if (isHtmlErrorResponse(responseText)) {
      const errorMsg = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ السيرفر أرجع صفحة HTML بدلاً من JSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status Code: ${response.status}
Response: ${responseText.slice(0, 300)}

السبب المحتمل:
- المسار /merge غير موجود على السيرفر
- السيرفر لم يتم إعداده بشكل صحيح
- الـ endpoint المطلوب غير متوفر

الحل المقترح:
- تحقق من كود السيرفر في server.js
- تأكد من أن المسار /merge موجود
- راجع logs السيرفر على Hugging Face

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      console.error(errorMsg);
      throw new Error(`سيرفر الدمج أرجع صفحة خطأ (HTTP ${response.status}). السيرفر قد يكون معطل.`);
    }

    if (!response.ok) {
      const errorMsg = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ خطأ من السيرفر
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: ${response.status} ${response.statusText}
Response: ${responseText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      console.error(errorMsg);
      throw new Error(`FFmpeg Space error (${response.status}): ${responseText}`);
    }

    let rawResult: any;
    try {
      rawResult = JSON.parse(responseText);
    } catch (parseError) {
      const errorMsg = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ استجابة غير صالحة من السيرفر
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

السيرفر أرجع نص ليس بصيغة JSON:
${responseText.slice(0, 300)}

Parse Error: ${parseError instanceof Error ? parseError.message : String(parseError)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      console.error(errorMsg);
      throw new Error(`FFmpeg Space returned invalid JSON: ${responseText.slice(0, 200)}`);
    }

    console.log("✅ تم تحليل استجابة السيرفر بنجاح:", JSON.stringify(rawResult, null, 2));

    return {
      status: rawResult.status || "processing",
      progress: rawResult.progress ?? 0,
      output_url: extractOutputUrl(rawResult),
      error: rawResult.error,
      job_id: extractJobId(rawResult),
      message: rawResult.message,
    };
  } catch (fetchError) {
    const errorMsg = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ فشل الاتصال بالسيرفر
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Error Type: ${fetchError instanceof Error ? fetchError.name : "Unknown"}
Error Message: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}

Target URL: ${HF_SPACE_URL}/merge

الأسباب المحتملة:
1. مشكلة في الشبكة
2. السيرفر متوقف
3. CORS issue
4. Timeout

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    console.error(errorMsg);
    throw fetchError;
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

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📤 إرسال طلب الدمج (مع Polling)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Target URL:", `${HF_SPACE_URL}/merge`);
  console.log("Payload:", JSON.stringify(payload, null, 2));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const response = await fetch(`${HF_SPACE_URL}/merge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_READ_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📥 استجابة السيرفر");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Status:", response.status, response.statusText);
  console.log("Body (first 500 chars):", responseText.slice(0, 500));
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (isHtmlErrorResponse(responseText)) {
    throw new Error(`سيرفر الدمج أرجع صفحة خطأ (HTTP ${response.status}). السيرفر قد يكون معطل.`);
  }

  if (!response.ok) {
    throw new Error(`FFmpeg Space error: ${responseText}`);
  }

  let rawResult: any;
  try {
    rawResult = JSON.parse(responseText);
  } catch {
    throw new Error(`FFmpeg Space returned invalid JSON: ${responseText.slice(0, 200)}`);
  }

  console.log("FFmpeg Space initial response:", JSON.stringify(rawResult));

  const result: MergeMediaResponse = {
    status: rawResult.status || "processing",
    progress: rawResult.progress ?? 0,
    output_url: extractOutputUrl(rawResult),
    error: rawResult.error,
    job_id: extractJobId(rawResult),
    message: rawResult.message,
  };

  if (result.job_id && result.status === "processing") {
    console.log(`Merge job started with ID: ${result.job_id}, polling for completion...`);
    return await pollForMergeCompletion(result);
  }

  if (result.status === "completed" || result.status === "failed") {
    return result;
  }

  if (result.status === "processing") {
    console.log("Merge started without job_id, polling for completion...");
    return await pollForMergeCompletion(result);
  }

  return result;
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
    console.log("No job_id available for polling");
    return result;
  }

  while (result.status === "processing" && attempts < maxAttempts) {
    attempts++;
    console.log(`Polling merge status for job ${jobId}... attempt ${attempts}/${maxAttempts}`);

    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    try {
      const status = await checkMergeStatus(jobId);
      consecutiveFailures = 0; // Reset on success

      result = {
        ...result,
        status: status.status || result.status,
        progress: status.progress ?? result.progress,
        output_url: status.output_url || result.output_url,
        error: status.error || result.error,
      };

      if (result.output_url && result.output_url.startsWith("http")) {
        result.status = "completed";
        console.log(`Merge completed with output URL: ${result.output_url}`);
      }
    } catch (pollError) {
      consecutiveFailures++;
      console.error(`Poll attempt ${attempts} failed (consecutive: ${consecutiveFailures}):`, pollError);

      // If 10 consecutive failures, the server is likely down
      if (consecutiveFailures >= 10) {
        return {
          status: "failed",
          progress: result.progress,
          error: "سيرفر الدمج لا يستجيب بعد 10 محاولات متتالية فاشلة",
        };
      }
    }
  }

  if (attempts >= maxAttempts && result.status === "processing") {
    return {
      status: "failed",
      progress: result.progress,
      error: "Merge timeout: Operation took too long",
    };
  }

  return result;
}

/**
 * Check the status of a merge job. Tries only the most reliable endpoints.
 * Detects HTML error pages and counts them as failures.
 */
export async function checkMergeStatus(jobId: string): Promise<MergeMediaResponse> {
  const candidates = [
    { method: "GET" as const, url: `${HF_SPACE_URL}/job-status/${jobId}` },
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

      // Detect HTML error pages
      if (isHtmlErrorResponse(text)) {
        lastErr = `HTML error page from ${c.method} ${c.url}: ${text.slice(0, 100)}`;
        continue;
      }

      if (!resp.ok) {
        lastErr = `HTTP ${resp.status} from ${c.method} ${c.url}: ${text.slice(0, 200)}`;
        continue;
      }

      let raw: any;
      try {
        raw = JSON.parse(text);
      } catch {
        lastErr = `Invalid JSON from ${c.method} ${c.url}: ${text.slice(0, 100)}`;
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

  throw new Error(lastErr || "Status check error: all candidates failed");
}
