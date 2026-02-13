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

// ===== HELPER: Parse prompts من الـ response =====
function parseImagePrompts(text: string, count: number): string[] {
  const prompts: string[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim().replace(/\*+/g, "");
    if (!trimmed) continue;
    // أشكال: "1. ", "1) ", "1 - ", "**1.**"
    const match = trimmed.match(/^(\d+)[.\)\-]\s*(.+)/);
    if (match && match[2]) {
      const txt = match[2].trim();
      // رفض أي نص عربي
      if (txt.length > 10 && !/[\u0600-\u06FF]/.test(txt)) {
        prompts.push(txt);
      }
    }
  }

  // إذا فشل الـ parsing، استخرج أي سطر إنجليزي طويل
  if (prompts.length === 0) {
    console.warn("[GEMINI] parsing فشل - استخراج بديل");
    for (const line of lines) {
      const t = line.trim();
      if (t.length > 30 && !/[\u0600-\u06FF]/.test(t) && prompts.length < count) {
        prompts.push(t.replace(/^[\d.\-\)\s*]+/, "").trim());
      }
    }
  }
  return prompts.slice(0, count);
}

// ===== HELPER: Fallback prompt إذا نقصت الـ prompts =====
function buildFallbackPrompt(script: string, index: number, total: number): string {
  const hasNature = /طبيع|بحر|جبل|غاب|نهر|سماء/.test(script);
  const hasBusiness = /عمل|تجار|شرك|اقتصاد|مال/.test(script);
  const hasTech = /تقني|ذكاء|رقم|تكنولوج|ابتكار/.test(script);
  const hasPeople = /إنسان|شخص|ناس|أطفال|عائل/.test(script);
  let base = "Cinematic establishing shot, dramatic lighting, professional photography, 4K";
  if (hasTech) base = "Futuristic technology, digital innovation, glowing screens, modern workspace, 4K";
  else if (hasBusiness) base = "Professional business environment, modern office, success concept, 4K";
  else if (hasNature) base = "Beautiful natural landscape, golden hour, stunning scenery, 4K";
  else if (hasPeople) base = "Group of diverse people, warm atmosphere, genuine emotions, 4K";
  return `${base}, scene ${index + 1} of ${total}`;
}

export async function generateImagePrompts(
  script: string,
  sceneCount: number
): Promise<string[]> {
  const count = Math.max(1, Math.min(sceneCount || 3, 10));

  const prompt = `You are a professional visual content creator for AI image generation.

TASK: Create EXACTLY ${count} image prompts in ENGLISH ONLY.

The prompts are for a video with this Arabic voiceover:
"""
${script}
"""

STRICT OUTPUT RULES:
- EXACTLY ${count} prompts, numbered 1 to ${count}
- ENGLISH ONLY - zero Arabic words allowed
- Each prompt: 40-80 words, cinematic and detailed
- Style: professional photography, 4K, cinematic lighting
- Describe visual scenes that match the audio content
- NO introduction, NO explanation, ONLY the numbered prompts

OUTPUT (follow this format exactly):
1. [English prompt for scene 1]
2. [English prompt for scene 2]${count > 2 ? "
" + Array.from({length: count - 2}, (_, i) => `${i + 3}. [English prompt for scene ${i + 3}]`).join("
") : ""}`;

  console.log(`[GEMINI] طلب ${count} image prompts...`);
  const result = await generateWithGemini(prompt);
  console.log(`[GEMINI] استجابة (${result.length} chars): ${result.slice(0, 200)}`);

  let prompts = parseImagePrompts(result, count);
  console.log(`[GEMINI] تم استخراج ${prompts.length}/${count} prompts`);

  // ملء الناقص بـ fallback
  while (prompts.length < count) {
    const fb = buildFallbackPrompt(script, prompts.length, count);
    console.warn(`[GEMINI] fallback للـ prompt ${prompts.length + 1}: ${fb.slice(0, 60)}`);
    prompts.push(fb);
  }

  return prompts;
}
