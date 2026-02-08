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
    console.log(`Checking FFmpeg Space health at: ${HF_SPACE_URL}`);
    
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000); // زيادة وقت الانتظار إلى 10 ثوانٍ

    const resp = await fetch(HF_SPACE_URL, {
      method: "GET", // تغيير من HEAD إلى GET لأن بعض السيرفرات لا تدعم HEAD
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    console.log(`Health check response: ${resp.status}`);
    
    // قبول أي استجابة ليست 404 أو 502 أو 503
    return resp.ok || resp.status === 405 || resp.status === 301 || resp.status === 302;
  } catch (error) {
    console.error("Health check failed:", error);
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
  console.log("Performing health check before merge...");
  const healthy = await isFFmpegSpaceHealthy();
  if (!healthy) {
    console.error(`FFmpeg Space (${HF_SPACE_URL}) appears to be down`);
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

  console.log("Sending to FFmpeg Space:", JSON.stringify(payload));
  console.log("Target URL:", `${HF_SPACE_URL}/merge`);

  const response = await fetch(`${HF_SPACE_URL}/merge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_READ_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  console.log("FFmpeg Space raw response:", responseText.slice(0, 500));

  // Detect HTML error pages
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

  return {
    status: rawResult.status || "processing",
    progress: rawResult.progress ?? 0,
    output_url: extractOutputUrl(rawResult),
    error: rawResult.error,
    job_id: extractJobId(rawResult),
    message: rawResult.message,
  };
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

  console.log("Sending to FFmpeg Space:", JSON.stringify(payload));
  console.log("Target URL:", `${HF_SPACE_URL}/merge`);

  const response = await fetch(`${HF_SPACE_URL}/merge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_READ_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  console.log("FFmpeg Space raw response:", responseText.slice(0, 500));

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
