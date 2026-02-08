// _shared/huggingface.ts

const FFMPEG_SPACE_URL = "https://elmalik-ff.hf.space";

interface MergeMediaRequest {
  images?: string[];
  videos?: string[];
  audio: string;
  output_format?: string;
}

interface MergeMediaResponse {
  status: string;
  output_url?: string;
  error?: string;
}

/**
 * دالة للتحقق من حالة السيرفر
 */
async function checkServerHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${FFMPEG_SPACE_URL}/`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(10000), // 10 seconds timeout
    });
    
    return response.ok;
  } catch (error) {
    console.error("Server health check failed:", error);
    return false;
  }
}

/**
 * دالة لدمج الصور/الفيديوهات مع الصوت باستخدام FFmpeg Space
 */
export async function mergeMediaWithFFmpeg(
  request: MergeMediaRequest
): Promise<MergeMediaResponse> {
  try {
    // التحقق من توفر السيرفر أولاً
    console.log("Checking FFmpeg server health...");
    const isHealthy = await checkServerHealth();
    
    if (!isHealthy) {
      throw new Error("سيرفر الدمج (FFmpeg Space) غير متاح حالياً. يرجى المحاولة لاحقاً.");
    }

    console.log("FFmpeg server is healthy, proceeding with merge...");

    // بناء الـ payload
    const payload = {
      images: request.images || [],
      videos: request.videos || [],
      audio: request.audio,
      output_format: request.output_format || "mp4",
    };

    console.log("Sending merge request to FFmpeg Space:", {
      endpoint: `${FFMPEG_SPACE_URL}/merge`,
      imagesCount: payload.images.length,
      videosCount: payload.videos.length,
      hasAudio: !!payload.audio,
    });

    // إرسال الطلب إلى السيرفر
    const response = await fetch(`${FFMPEG_SPACE_URL}/merge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(600000), // 10 minutes timeout for merge operation
    });

    console.log("FFmpeg Space response status:", response.status);

    if (!response.ok) {
      let errorMessage = `FFmpeg Space returned HTTP ${response.status}`;
      
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorData.detail || errorMessage;
      } catch {
        const errorText = await response.text();
        if (errorText) {
          errorMessage = errorText.substring(0, 200); // First 200 chars only
        }
      }

      throw new Error(errorMessage);
    }

    const result = await response.json();

    console.log("FFmpeg Space merge result:", {
      status: result.status,
      hasOutputUrl: !!result.output_url,
      error: result.error,
    });

    // التحقق من النتيجة
    if (result.status === "success" && result.output_url) {
      return {
        status: "success",
        output_url: result.output_url,
      };
    } else if (result.status === "failed" || result.error) {
      return {
        status: "failed",
        error: result.error || "Unknown error from FFmpeg Space",
      };
    } else {
      return {
        status: "failed",
        error: "Invalid response from FFmpeg Space (no output_url)",
      };
    }

  } catch (error) {
    console.error("Error in mergeMediaWithFFmpeg:", error);
    
    if (error instanceof Error) {
      // التحقق من أنواع الأخطاء المختلفة
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        return {
          status: "failed",
          error: "انتهت مهلة الاتصال بسيرفر الدمج. قد يكون السيرفر مشغولاً أو الملفات كبيرة جداً.",
        };
      }
      
      if (error.message.includes("fetch failed") || error.message.includes("network")) {
        return {
          status: "failed",
          error: "فشل الاتصال بسيرفر الدمج. يرجى التحقق من أن السيرفر يعمل.",
        };
      }

      return {
        status: "failed",
        error: error.message,
      };
    }

    return {
      status: "failed",
      error: String(error),
    };
  }
}

/**
 * دالة مساعدة لاختبار الاتصال بالسيرفر
 */
export async function testFFmpegConnection(): Promise<{
  ok: boolean;
  message: string;
  url: string;
}> {
  try {
    const isHealthy = await checkServerHealth();
    
    return {
      ok: isHealthy,
      message: isHealthy 
        ? "الاتصال بسيرفر FFmpeg ناجح" 
        : "فشل الاتصال بسيرفر FFmpeg",
      url: FFMPEG_SPACE_URL,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      url: FFMPEG_SPACE_URL,
    };
  }
}
