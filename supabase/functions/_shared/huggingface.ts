const HF_READ_TOKEN = Deno.env.get("HF_READ_TOKEN")!;
// Use ff.hf.space as the primary merge endpoint
const HF_SPACE_URL = Deno.env.get("HF_SPACE_URL") || "https://ff.hf.space";

function normalizeMaybeUrl(raw?: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  if (!v) return undefined;

  // Some providers return relative paths like "/file=...".
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

export async function generateImageWithFlux(prompt: string): Promise<ArrayBuffer> {
  // Using the Hugging Face Router API with FLUX.1-schnell (updated endpoint)
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
 * This is critical for serverless reliability: long polling should not happen inside a
 * single edge-function invocation.
 */
export async function startMergeWithFFmpeg(
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

  const response = await fetch(`${HF_SPACE_URL}/merge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_READ_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`FFmpeg Space error: ${error}`);
  }

  const rawResult = await response.json();
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
  // Transform to the format expected by the FFmpeg Space (imageUrl and audioUrl)
  const imageUrl = request.images?.[0] || request.videos?.[0];
  const audioUrl = request.audio;
  
  if (!imageUrl || !audioUrl) {
    throw new Error("Missing imageUrl or audioUrl");
  }

  // Send in the format the server expects
  const payload = {
    imageUrl,
    audioUrl,
    images: request.images,
    videos: request.videos,
    audio: request.audio,
    output_format: request.output_format || "mp4",
  };

  console.log("Sending to FFmpeg Space:", JSON.stringify(payload));

  const response = await fetch(`${HF_SPACE_URL}/merge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_READ_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`FFmpeg Space error: ${error}`);
  }

  const rawResult = await response.json();
  
  console.log("FFmpeg Space initial response:", JSON.stringify(rawResult));
  
  // Normalize the response - FFmpeg Space returns jobId (camelCase)
  const result: MergeMediaResponse = {
    status: rawResult.status || "processing",
    progress: rawResult.progress ?? 0,
    output_url: extractOutputUrl(rawResult),
    error: rawResult.error,
    job_id: extractJobId(rawResult), // Support both naming conventions
    message: rawResult.message,
  };
  
  // If the merge returns a job_id, we need to poll for completion
  if (result.job_id && result.status === "processing") {
    console.log(`Merge job started with ID: ${result.job_id}, polling for completion...`);
    return await pollForMergeCompletion(result);
  }
  
  // If immediately completed or failed
  if (result.status === "completed" || result.status === "failed") {
    return result;
  }

  // For async jobs without job_id, try to poll using output_url
  if (result.status === "processing") {
    console.log("Merge started without job_id, polling for completion...");
    return await pollForMergeCompletion(result);
  }
  
  return result;
}

async function pollForMergeCompletion(
  initialResult: MergeMediaResponse,
  maxAttempts = 60, // 5 minutes max (5 seconds * 60)
  pollInterval = 5000
): Promise<MergeMediaResponse> {
  let attempts = 0;
  let result = initialResult;
  
  // Get the job_id from the initial result
  const jobId = result.job_id;
  
  if (!jobId) {
    console.log("No job_id available for polling");
    return result;
  }
  
  while (result.status === "processing" && attempts < maxAttempts) {
    attempts++;
    console.log(`Polling merge status for job ${jobId}... attempt ${attempts}/${maxAttempts}`);
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    
    try {
      const status = await checkMergeStatus(jobId);

      result = {
        ...result,
        status: status.status || result.status,
        progress: status.progress ?? result.progress,
        output_url: status.output_url || result.output_url,
        error: status.error || result.error,
      };

      // If we got an output_url, consider it completed.
      if (result.output_url && result.output_url.startsWith("http")) {
        result.status = "completed";
        console.log(`Merge completed with output URL: ${result.output_url}`);
      }
    } catch (pollError) {
      console.error(`Poll attempt ${attempts} failed:`, pollError);
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

export async function checkMergeStatus(jobId: string): Promise<MergeMediaResponse> {
  const candidates: Array<
    | { method: "GET"; url: string }
    | { method: "POST"; url: string; body?: Record<string, unknown> }
  > = [
    { method: "GET", url: `${HF_SPACE_URL}/status/${jobId}` },
    { method: "GET", url: `${HF_SPACE_URL}/merge/status/${jobId}` },
    { method: "GET", url: `${HF_SPACE_URL}/merge/status?jobId=${encodeURIComponent(jobId)}` },
    { method: "GET", url: `${HF_SPACE_URL}/status?jobId=${encodeURIComponent(jobId)}` },
    { method: "POST", url: `${HF_SPACE_URL}/status`, body: { jobId } },
    { method: "POST", url: `${HF_SPACE_URL}/merge/status`, body: { jobId } },
    { method: "POST", url: `${HF_SPACE_URL}/status/${jobId}` },
    { method: "POST", url: `${HF_SPACE_URL}/merge/status/${jobId}` },
  ];

  let lastErr: string | undefined;

  for (const c of candidates) {
    try {
      const resp = await fetch(c.url, {
        method: c.method,
        headers: {
          Authorization: `Bearer ${HF_READ_TOKEN}`,
          ...(c.method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        body: c.method === "POST" ? JSON.stringify(c.body ?? {}) : undefined,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        lastErr = `HTTP ${resp.status} from ${c.method} ${c.url}: ${text}`;
        continue;
      }

      const raw = await resp.json();
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
