const HF_READ_TOKEN = Deno.env.get("HF_READ_TOKEN")!;
// Use ff.hf.space as the primary merge endpoint
const HF_SPACE_URL = Deno.env.get("HF_SPACE_URL") || "https://ff.hf.space";

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

  const result: MergeMediaResponse = await response.json();
  
  // If the merge is still processing, poll for completion
  if (result.status === "processing" && result.output_url) {
    // If we have a job ID or output URL, poll for completion
    return await pollForMergeCompletion(result);
  }
  
  // If immediately completed or failed
  if (result.status === "completed" || result.status === "failed") {
    return result;
  }

  // For async jobs, poll using the job URL or output_url
  console.log("Merge started, polling for completion...");
  return await pollForMergeCompletion(result);
}

async function pollForMergeCompletion(
  initialResult: MergeMediaResponse,
  maxAttempts = 60, // 5 minutes max (5 seconds * 60)
  pollInterval = 5000
): Promise<MergeMediaResponse> {
  let attempts = 0;
  let result = initialResult;
  
  // If we have a job_id field, use it for polling
  const jobId = (result as unknown as { job_id?: string }).job_id;
  
  while (result.status === "processing" && attempts < maxAttempts) {
    attempts++;
    console.log(`Polling merge status... attempt ${attempts}/${maxAttempts}`);
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    
    try {
      // If we have a job_id, use status endpoint
      if (jobId) {
        const statusResponse = await fetch(`${HF_SPACE_URL}/status/${jobId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${HF_READ_TOKEN}`,
          },
        });
        
        if (statusResponse.ok) {
          result = await statusResponse.json();
        }
      } else if (result.output_url) {
        // Try to check if the output URL is accessible
        const checkResponse = await fetch(result.output_url, { method: "HEAD" });
        if (checkResponse.ok) {
          result = {
            ...result,
            status: "completed",
          };
        }
      } else {
        // No way to poll, assume completed if we got a response
        console.log("No job_id or output_url for polling, returning initial result");
        break;
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
  const response = await fetch(`${HF_SPACE_URL}/status/${jobId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${HF_READ_TOKEN}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Status check error: ${error}`);
  }

  return response.json();
}
