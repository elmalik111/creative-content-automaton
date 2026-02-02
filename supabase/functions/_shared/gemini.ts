const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
  }>;
}

export async function generateWithGemini(prompt: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${error}`);
  }

  const data: GeminiResponse = await response.json();
  return data.candidates[0]?.content?.parts[0]?.text || "";
}

export async function generateVoiceoverScript(
  title: string,
  description: string,
  duration: number
): Promise<string> {
  const prompt = `أنت كاتب محتوى محترف. اكتب نص تعليق صوتي بالعربية لفيديو قصير.

العنوان: ${title}
الوصف: ${description}
المدة المطلوبة: حوالي ${duration} ثانية

التعليمات:
- اكتب نصًا جذابًا ومؤثرًا
- استخدم لغة بسيطة وواضحة
- اجعل النص مناسبًا للتلاوة بصوت عالٍ
- لا تضف أي تعليقات أو شروحات، فقط النص المطلوب

النص:`;

  return generateWithGemini(prompt);
}

export async function generateImagePrompts(
  script: string,
  sceneCount: number
): Promise<string[]> {
  const prompt = `You are a visual content creator. Based on the following Arabic voiceover script, create ${sceneCount} detailed image prompts in English for AI image generation.

Script:
${script}

Instructions:
- Create exactly ${sceneCount} image prompts
- Each prompt should be detailed and descriptive
- Use professional photography/cinematic style
- Make prompts suitable for Flux image generation
- Output ONLY the prompts, one per line, numbered 1-${sceneCount}

Prompts:`;

  const result = await generateWithGemini(prompt);
  
  // Parse the numbered prompts
  const lines = result.split("\n").filter(line => line.trim());
  const prompts: string[] = [];
  
  for (const line of lines) {
    const match = line.match(/^\d+[\.\)]\s*(.+)/);
    if (match) {
      prompts.push(match[1].trim());
    }
  }
  
  return prompts.slice(0, sceneCount);
}
