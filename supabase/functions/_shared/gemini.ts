const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GEMINI_API_KEY  = Deno.env.get("GEMINI_API_KEY");

export async function generateWithGemini(prompt: string): Promise<string> {
  if (LOVABLE_API_KEY) return generateWithLovableGateway(prompt);
  if (GEMINI_API_KEY)  return generateWithDirectGemini(prompt);
  throw new Error("No AI API key configured (LOVABLE_API_KEY or GEMINI_API_KEY required)");
}

async function generateWithLovableGateway(prompt: string): Promise<string> {
  console.log("Using Lovable AI Gateway");
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
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
  console.log("Using direct Gemini API");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
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

// ===== HELPERS =====

function parseImagePrompts(text: string, count: number): string[] {
  const prompts: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim().replace(/\*+/g, "");
    if (!t) continue;
    const m = t.match(/^(\d+)[.\)\-:]\s*(.+)/);
    if (m && m[2]) {
      const txt = m[2].trim();
      if (txt.length > 15 && !/[\u0600-\u06FF]/.test(txt)) {
        prompts.push(txt);
      }
    }
  }
  if (prompts.length === 0) {
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.length > 30 && !/[\u0600-\u06FF]/.test(t) && prompts.length < count) {
        prompts.push(t.replace(/^[\d.\-\)\s*:]+/, "").trim());
      }
    }
  }
  return prompts.slice(0, count);
}

// ===== IMAGE PROMPTS =====
export async function generateImagePrompts(
  script: string,
  sceneCount: number
): Promise<string[]> {
  const count = Math.max(1, Math.min(sceneCount || 3, 10));

  // استراتيجية محسّنة: نطلب من Gemini تحليل السكربت وتوليد الـ prompts مباشرة
  const imagePromptRequest = `أنت خبير في تحليل النصوص العربية وتوليد أوصاف بصرية دقيقة بالإنجليزية.

النص العربي التالي هو سكربت صوتي لفيديو قصير:

"""
${script}
"""

مهمتك:
1. اقرأ وافهم النص العربي بعمق
2. حدد الموضوع الرئيسي والعناصر البصرية المهمة
3. أنشئ EXACTLY ${count} وصف صورة (image prompts) بالإنجليزية فقط

⚠️ CRITICAL RULES:
- كل prompt يجب أن يكون مرتبط مباشرة بمحتوى النص العربي
- لا تكتب أوصاف عامة (مثل: طبيعة، سماء، مدينة عشوائية)
- إذا كان النص عن شخصية تاريخية → اكتب عنها وعن عصرها
- إذا كان عن حدث → اكتب عن الحدث ومكانه
- إذا كان عن مكان → اكتب عن المكان وتفاصيله المحددة
- إذا كان عن مفهوم → اكتب تمثيل بصري للمفهوم

FORMAT المطلوب:
اكتب ${count} أسطر فقط، كل سطر:
1. [English image prompt 50-80 words, cinematic, 4K, professional photography]
2. [English image prompt 50-80 words, cinematic, 4K, professional photography]
...

Requirements لكل prompt:
- طول: 50-80 كلمة
- لغة: إنجليزية فقط
- جودة: cinematic 4K, professional photography or digital art
- كل prompt يُظهر زاوية أو مشهد مختلف من نفس الموضوع
- مرتبط بالنص العربي 100%

ابدأ الآن - اكتب الـ ${count} prompts فقط، بدون شرح:`;

  console.log(`[GEMINI] Requesting ${count} prompts directly from Arabic script`);
  
  let result: string;
  try {
    result = await generateWithGemini(imagePromptRequest);
    console.log(`[GEMINI] Raw response (${result.length} chars):`);
    console.log(result.slice(0, 400));
  } catch (e) {
    console.error("[GEMINI] Failed to generate prompts:", e);
    // Fallback strategy
    return generateFallbackPrompts(script, count);
  }

  let prompts = parseImagePrompts(result, count);
  console.log(`[GEMINI] Parsed ${prompts.length}/${count} prompts`);

  // إذا كانت الـ prompts المستخرجة قليلة، نحاول استخراج إضافي
  if (prompts.length < count) {
    console.warn(`[GEMINI] Got only ${prompts.length} prompts, extracting more...`);
    
    // نحاول استخراج أي جملة إنجليزية طويلة
    const lines = result.split("\n");
    for (const line of lines) {
      if (prompts.length >= count) break;
      
      const cleaned = line
        .trim()
        .replace(/^[\d.\-\)\s*:]+/, "") // إزالة الترقيم
        .replace(/\*+/g, "")
        .trim();
      
      // نتحقق: إنجليزية، طويلة، غير موجودة
      if (
        cleaned.length > 40 &&
        !/[\u0600-\u06FF]/.test(cleaned) && // ليست عربية
        !prompts.includes(cleaned)
      ) {
        prompts.push(cleaned);
      }
    }
  }

  // إذا ما زلنا نحتاج المزيد، نستخدم fallback ذكي
  if (prompts.length < count) {
    console.warn(`[GEMINI] Still need more prompts (${prompts.length}/${count}), using smart fallback`);
    const fallbackPrompts = await generateFallbackPrompts(script, count - prompts.length);
    prompts.push(...fallbackPrompts);
  }

  return prompts.slice(0, count);
}

// دالة مساعدة: توليد prompts احتياطية ذكية بناءً على السكربت
async function generateFallbackPrompts(script: string, count: number): Promise<string[]> {
  console.log(`[FALLBACK] Generating ${count} smart fallback prompts`);
  
  // نحاول استخراج كلمات مفتاحية من السكربت العربي
  const keywordPrompt = `اقرأ هذا النص العربي واستخرج 5 كلمات مفتاحية بالإنجليزية تصف الموضوع الرئيسي:

${script.slice(0, 500)}

اكتب 5 كلمات فقط بالإنجليزية، مفصولة بفواصل:`;

  let keywords = "historical scene, ancient civilization, cultural heritage, dramatic moment, significant event";
  
  try {
    const keywordResult = await generateWithGemini(keywordPrompt);
    const extracted = keywordResult
      .split("\n")[0]
      .trim()
      .replace(/[^\w\s,]/g, "");
    
    if (extracted.length > 10 && !/[\u0600-\u06FF]/.test(extracted)) {
      keywords = extracted;
      console.log(`[FALLBACK] Extracted keywords: ${keywords}`);
    }
  } catch (e) {
    console.warn("[FALLBACK] Keyword extraction failed, using defaults");
  }

  const prompts: string[] = [];
  const angles = [
    "dramatic wide establishing shot",
    "intense close-up with shallow depth of field", 
    "cinematic low-angle heroic perspective",
    "overhead aerial view showing scale",
    "medium shot with emotional lighting",
    "dynamic action shot with motion blur",
    "intimate portrait with environmental context"
  ];

  for (let i = 0; i < count; i++) {
    const angle = angles[i % angles.length];
    const prompt = `${keywords}, ${angle}, cinematic lighting, epic atmosphere, highly detailed, 4K ultra HD, professional photography, dramatic composition, rich colors, photorealistic`;
    prompts.push(prompt);
    console.log(`[FALLBACK] Prompt ${i + 1}: ${prompt.slice(0, 70)}...`);
  }

  return prompts;
}
