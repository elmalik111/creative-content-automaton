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

// ===== IMAGE PROMPTS - IMPROVED VERSION =====
export async function generateImagePrompts(
  script: string,
  sceneCount: number
): Promise<string[]> {
  const count = Math.max(1, Math.min(sceneCount || 3, 10));

  console.log(`[GEMINI] 🎯 Generating ${count} image prompts from Arabic script (${script.length} chars)`);

  // 🔧 FIXED: طلب واحد مباشر بدلاً من خطوتين منفصلتين
  const imagePromptRequest = `أنت خبير في تحليل النصوص العربية وتوليد أوصاف الصور بالإنجليزية.

اقرأ النص العربي التالي بعناية:

"""
${script}
"""

مهمتك: إنشاء EXACTLY ${count} وصف صورة (image prompt) بالإنجليزية فقط.

⚠️ قواعد صارمة:
1. كل وصف يجب أن يكون مرتبط 100% بمحتوى النص العربي
2. إذا النص عن "كرة القدم" → اكتب عن football/soccer (ليس مجرد "sports")
3. إذا النص عن "حتشبسوت" → اكتب عن Queen Hatshepsut (ليس مجرد "ancient queen")
4. إذا النص عن "الفضاء" → اكتب عن space/planets (ليس مجرد "sky")
5. لا تكتب أوصاف عامة مثل: nature, sky, city, landscape
6. كل وصف يجب أن يذكر الموضوع الرئيسي بالاسم

متطلبات كل وصف:
- الطول: 50-80 كلمة
- اللغة: إنجليزية فقط (NO ARABIC)
- الجودة: cinematic 4K, professional photography or digital art
- كل وصف يُظهر زاوية أو مشهد مختلف من نفس الموضوع

التنسيق المطلوب:
اكتب ${count} أسطر فقط، كل سطر بهذا الشكل:
1. [وصف الصورة بالإنجليزية 50-80 كلمة]
2. [وصف الصورة بالإنجليزية 50-80 كلمة]
...

ابدأ الآن - اكتب فقط الأوصاف المرقمة، بدون أي شرح أو مقدمة:`;

  let result: string;
  try {
    result = await generateWithGemini(imagePromptRequest);
    console.log(`[GEMINI] 📥 Raw response (${result.length} chars)`);
    console.log(`[GEMINI] Preview: ${result.slice(0, 200)}...`);
  } catch (e) {
    console.error("[GEMINI] ❌ Failed to generate prompts:", e);
    // Fallback إلى استخراج كلمات مفتاحية
    return await generateFallbackPromptsFromScript(script, count);
  }

  // 🔧 FIXED: استخراج محسّن يدعم أشكال متعددة
  let prompts = extractImagePrompts(result, count);
  console.log(`[GEMINI] ✅ Extracted ${prompts.length}/${count} prompts`);

  // إذا لم نحصل على العدد الكافي، نحاول استخراج إضافي
  if (prompts.length < count) {
    console.warn(`[GEMINI] ⚠️ Only got ${prompts.length} prompts, need ${count}`);
    
    // محاولة استخراج أي جملة إنجليزية طويلة
    const lines = result.split("\n");
    for (const line of lines) {
      if (prompts.length >= count) break;
      
      const cleaned = line
        .trim()
        .replace(/^[\d.\-\)\s*:]+/, "")
        .replace(/\*+/g, "")
        .trim();
      
      // تحقق: إنجليزية، طويلة، غير مكررة
      if (
        cleaned.length > 40 &&
        !/[\u0600-\u06FF]/.test(cleaned) &&
        !prompts.includes(cleaned)
      ) {
        prompts.push(cleaned);
        console.log(`[GEMINI] + Added extra prompt: ${cleaned.slice(0, 60)}...`);
      }
    }
  }

  // إذا ما زلنا نحتاج المزيد، استخدم fallback ذكي
  if (prompts.length < count) {
    console.warn(`[GEMINI] ⚠️ Still need ${count - prompts.length} more prompts, using smart fallback`);
    const fallbackPrompts = await generateFallbackPromptsFromScript(script, count - prompts.length);
    prompts.push(...fallbackPrompts);
  }

  // التأكد من عدم وجود نص عربي في النتيجة النهائية
  prompts = prompts.map((prompt, idx) => {
    if (/[\u0600-\u06FF]/.test(prompt)) {
      console.warn(`[GEMINI] ⚠️ Prompt ${idx + 1} contains Arabic, using fallback`);
      return `cinematic scene related to the topic, professional photography, 4K ultra HD, dramatic lighting, highly detailed`;
    }
    return prompt;
  });

  console.log(`[GEMINI] 🎉 Final result: ${prompts.length} prompts ready`);
  return prompts.slice(0, count);
}

// 🔧 IMPROVED: دالة استخراج محسّنة
function extractImagePrompts(text: string, count: number): string[] {
  const prompts: string[] = [];
  
  // محاولة 1: استخراج من نص مرقم (1. 2. 3.)
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim().replace(/\*+/g, "");
    if (!trimmed) continue;
    
    // أشكال الترقيم المختلفة: "1." "1)" "1-" "1:"
    const match = trimmed.match(/^(\d+)[.\)\-:]\s*(.+)/);
    if (match && match[2]) {
      const promptText = match[2].trim();
      // تحقق: إنجليزية، طويلة بما يكفي
      if (promptText.length > 15 && !/[\u0600-\u06FF]/.test(promptText)) {
        prompts.push(promptText);
        console.log(`[EXTRACT] Found prompt ${match[1]}: ${promptText.slice(0, 60)}...`);
      }
    }
  }
  
  // محاولة 2: إذا لم نجد أي شيء، ابحث عن جمل طويلة
  if (prompts.length === 0) {
    console.warn("[EXTRACT] No numbered prompts found, trying to extract long sentences");
    for (const line of lines) {
      const trimmed = line.trim().replace(/^[\d.\-\)\s*:]+/, "").trim();
      if (trimmed.length > 30 && !/[\u0600-\u06FF]/.test(trimmed) && prompts.length < count) {
        prompts.push(trimmed);
        console.log(`[EXTRACT] Found sentence: ${trimmed.slice(0, 60)}...`);
      }
    }
  }
  
  return prompts.slice(0, count);
}

// 🔧 NEW: fallback ذكي يستخرج كلمات مفتاحية من النص
async function generateFallbackPromptsFromScript(
  script: string,
  count: number
): Promise<string[]> {
  console.log(`[FALLBACK] 🔄 Generating ${count} smart fallback prompts`);
  
  // محاولة استخراج كلمات مفتاحية من النص العربي
  const keywordPrompt = `اقرأ هذا النص العربي واستخرج الموضوع الرئيسي والكلمات المفتاحية بالإنجليزية:

${script.slice(0, 800)}

اكتب سطر واحد فقط بهذا الشكل:
TOPIC: [الموضوع بالإنجليزية], KEYWORDS: [5 كلمات مفتاحية بالإنجليزية مفصولة بفواصل]

مثال:
TOPIC: football history, KEYWORDS: soccer ball, stadium, players, world cup, championship`;

  let topic = "the subject";
  let keywords = "cinematic scene, professional photography, detailed composition, dramatic atmosphere, 4K quality";
  
  try {
    const keywordResult = await generateWithGemini(keywordPrompt);
    console.log(`[FALLBACK] Keyword extraction result: ${keywordResult.slice(0, 150)}`);
    
    const topicMatch = keywordResult.match(/TOPIC:\s*([^,\n]+)/i);
    const keywordsMatch = keywordResult.match(/KEYWORDS:\s*(.+)/i);
    
    if (topicMatch?.[1]) {
      topic = topicMatch[1].trim();
      console.log(`[FALLBACK] ✅ Extracted topic: "${topic}"`);
    }
    
    if (keywordsMatch?.[1]) {
      keywords = keywordsMatch[1].trim();
      console.log(`[FALLBACK] ✅ Extracted keywords: "${keywords}"`);
    }
  } catch (e) {
    console.warn("[FALLBACK] ⚠️ Keyword extraction failed, using generic fallback");
  }

  const prompts: string[] = [];
  const angles = [
    "dramatic wide establishing shot",
    "intense close-up with shallow depth of field",
    "cinematic low-angle heroic perspective",
    "overhead aerial view showing scale and context",
    "medium shot with emotional dramatic lighting",
    "dynamic action shot with motion and energy",
    "intimate detailed portrait with environmental context"
  ];

  for (let i = 0; i < count; i++) {
    const angle = angles[i % angles.length];
    const prompt = `${topic}, ${keywords}, ${angle}, cinematic 4K ultra HD, professional photography, highly detailed, dramatic composition, epic atmosphere, rich vibrant colors, photorealistic quality`;
    prompts.push(prompt);
    console.log(`[FALLBACK] Prompt ${i + 1}: ${prompt.slice(0, 80)}...`);
  }

  return prompts;
}
