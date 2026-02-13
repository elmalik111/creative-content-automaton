const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

export async function generateWithGemini(prompt: string): Promise<string> {
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
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${error}`);
  }

  interface GeminiResponse {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  }

  const data: GeminiResponse = await response.json();
  return data.candidates[0]?.content?.parts[0]?.text || "";
}

// ===== VOICEOVER SCRIPT =====
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

// ===== IMAGE PROMPTS =====
// يُنشئ عدد من الـ prompts بالإنجليزية مناسبة لتوليد الصور
export async function generateImagePrompts(
  script: string,
  sceneCount: number
): Promise<string[]> {

  // تأكد أن sceneCount معقول
  const count = Math.max(1, Math.min(sceneCount || 3, 10));

  const prompt = `You are a professional visual content creator specializing in AI image generation.

Task: Create EXACTLY ${count} image generation prompts in ENGLISH ONLY based on this Arabic voiceover script.

Arabic Script:
"""
${script}
"""

STRICT RULES:
1. Write EXACTLY ${count} prompts - no more, no less
2. ALL prompts must be in ENGLISH ONLY - absolutely no Arabic
3. Each prompt must be on its own line, starting with a number and period: "1. ", "2. ", etc.
4. Each prompt must be detailed and cinematic (50-100 words)
5. Style: professional photography, 4K quality, cinematic lighting
6. DO NOT include any introduction, explanation, or conclusion - ONLY the numbered prompts

OUTPUT FORMAT (follow exactly):
1. [detailed English image prompt here]
2. [detailed English image prompt here]
${count > 2 ? Array.from({length: count - 2}, (_, i) => `${i + 3}. [detailed English image prompt here]`).join('\n') : ''}

BEGIN PROMPTS:`;

  const result = await generateWithGemini(prompt);
  console.log(`[GEMINI] Raw image prompts response (${count} requested):`, result.slice(0, 300));

  const prompts = parseImagePrompts(result, count);
  console.log(`[GEMINI] Parsed ${prompts.length}/${count} prompts`);

  // إذا لم يُرجع العدد الكافي، أضف prompts بديلة
  if (prompts.length < count) {
    console.warn(`[GEMINI] Only got ${prompts.length} prompts, filling remaining with fallbacks`);
    const fallbackBase = buildFallbackPrompt(script);
    while (prompts.length < count) {
      prompts.push(`${fallbackBase}, scene ${prompts.length + 1} of ${count}, cinematic shot, 4K`);
    }
  }

  return prompts;
}

// ===== HELPER: Parse prompts من الـ Gemini response =====
function parseImagePrompts(text: string, expectedCount: number): string[] {
  const prompts: string[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // أشكال مختلفة: "1. ", "1) ", "1 - ", "**1.**", "- 1."
    const match = trimmed.match(/^(?:\*{0,2})(\d+)[.\)\-]\s*(?:\*{0,2})\s*(.+)/);
    if (match && match[2]) {
      const promptText = match[2]
        .replace(/\*+/g, '') // إزالة markdown bold
        .trim();

      // تحقق أن الـ prompt ليس قصيراً جداً وليس عربياً
      if (promptText.length > 10 && !/[\u0600-\u06FF]/.test(promptText)) {
        prompts.push(promptText);
      }
    }
  }

  // إذا لم ينجح النمط الأول، جرب استخراج أي سطر طويل بالإنجليزية
  if (prompts.length === 0) {
    console.warn("[GEMINI] Standard parsing failed, trying fallback extraction");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 30 && !/[\u0600-\u06FF]/.test(trimmed) && prompts.length < expectedCount) {
        prompts.push(trimmed.replace(/^[\d.\-\)\s*]+/, '').trim());
      }
    }
  }

  return prompts.slice(0, expectedCount);
}

// ===== HELPER: Fallback prompt من الـ script =====
function buildFallbackPrompt(script: string): string {
  // استخرج كلمات مفتاحية من النص العربي وحولها لوصف إنجليزي عام
  const hasNature = /طبيع|بحر|جبل|غاب|نهر|سماء/i.test(script);
  const hasPeople = /إنسان|شخص|ناس|أطفال|عائل/i.test(script);
  const hasBusiness = /عمل|تجار|شرك|اقتصاد|مال/i.test(script);
  const hasTech = /تقني|ذكاء|رقم|تكنولوج|ابتكار/i.test(script);

  if (hasTech) return "Futuristic technology concept, digital innovation, glowing screens, modern workspace, professional photography, 4K";
  if (hasBusiness) return "Professional business environment, modern office, team collaboration, success concept, cinematic lighting, 4K";
  if (hasNature) return "Beautiful natural landscape, golden hour lighting, stunning scenery, professional nature photography, 4K";
  if (hasPeople) return "Group of diverse people, warm atmosphere, genuine emotions, documentary style photography, 4K";
  return "Cinematic establishing shot, dramatic lighting, high production value, professional photography, 4K ultra HD";
}
