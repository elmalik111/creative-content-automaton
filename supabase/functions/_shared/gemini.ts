const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

export async function generateWithGemini(prompt: string): Promise<string> {
  // Try Lovable AI Gateway first (recommended), fallback to direct Gemini API
  if (LOVABLE_API_KEY) {
    return generateWithLovableGateway(prompt);
  } else if (GEMINI_API_KEY) {
    return generateWithDirectGemini(prompt);
  } else {
    throw new Error("No AI API key configured (LOVABLE_API_KEY or GEMINI_API_KEY required)");
  }
}

async function generateWithLovableGateway(prompt: string): Promise<string> {
  console.log("Using Lovable AI Gateway with gemini-3-flash-preview");
  
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Lovable AI Gateway error:", response.status, error);
    throw new Error(`Lovable AI Gateway error: ${error}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function generateWithDirectGemini(prompt: string): Promise<string> {
  console.log("Using direct Gemini API with gemini-2.5-flash");
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Gemini API error:", response.status, error);
    throw new Error(`Gemini API error: ${error}`);
  }

  interface GeminiResponse {
    candidates: Array<{
      content: {
        parts: Array<{
          text: string;
        }>;
      };
    }>;
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
