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

  return response.json();
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
