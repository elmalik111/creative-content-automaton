const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GEMINI_API_KEY  = Deno.env.get("GEMINI_API_KEY");

// =================================================================
// CORE
// =================================================================
export async function generateWithGemini(prompt: string): Promise<string> {
  if (LOVABLE_API_KEY) return generateWithLovableGateway(prompt);
  if (GEMINI_API_KEY)  return generateWithDirectGemini(prompt);
  throw new Error("No AI API key (LOVABLE_API_KEY or GEMINI_API_KEY required)");
}

async function generateWithLovableGateway(prompt: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Lovable Gateway ${res.status}: ${await res.text()}`);
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}

async function generateWithDirectGemini(prompt: string): Promise<string> {
  const res = await fetch(
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
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  interface GeminiResp { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
  const d: GeminiResp = await res.json();
  return d.candidates[0]?.content?.parts[0]?.text ?? "";
}

// =================================================================
// VOICEOVER SCRIPT
// =================================================================
export async function generateVoiceoverScript(
  title: string,
  description: string,
  duration: number
): Promise<string> {
  const prompt =
    "أنت كاتب محتوى محترف. اكتب نص تعليق صوتي بالعربية لفيديو قصير.\n\n" +
    "العنوان: " + title + "\n" +
    "الوصف: " + description + "\n" +
    "المدة المطلوبة: حوالي " + duration + " ثانية\n\n" +
    "التعليمات:\n" +
    "- اكتب نصًا جذابًا ومؤثرًا\n" +
    "- استخدم لغة بسيطة وواضحة\n" +
    "- اجعل النص مناسبًا للتلاوة بصوت عالٍ\n" +
    "- لا تضف أي تعليقات أو شروحات، فقط النص المطلوب\n\n" +
    "النص:";
  return generateWithGemini(prompt);
}

// =================================================================
// IMAGE PROMPTS — نهج مباشر وموثوق
// =================================================================
export async function generateImagePrompts(
  script: string,
  sceneCount: number
): Promise<string[]> {
  const count = Math.max(1, Math.min(sceneCount || 3, 10));
  console.log(`[GEMINI] generateImagePrompts: count=${count}`);
  console.log(`[GEMINI] script (أول 200 حرف): ${script.slice(0, 200)}`);

  // ─── خطوة 1: استخرج الموضوع بالإنجليزية ────────────────────────
  // هذه الخطوة ضرورية لأن Pollinations لا يفهم العربية جيداً
  const extractPrompt =
    "Read this Arabic script and respond with ONLY these 3 lines in English:\n" +
    "TOPIC: [the main subject/topic in 3-8 English words]\n" +
    "VISUALS: [5 specific visual elements from the content, comma-separated in English]\n" +
    "STYLE: [visual style, e.g. 'historical documentary, dramatic lighting']\n\n" +
    "Arabic script:\n" + script.slice(0, 600) + "\n\n" +
    "Respond with ONLY the 3 lines above. No extra text.";

  let topic   = "";
  let visuals = "";
  let style   = "cinematic, 4K, dramatic lighting";

  try {
    const raw = await generateWithGemini(extractPrompt);
    console.log(`[GEMINI] extract raw: ${raw.slice(0, 300)}`);

    const tLine = raw.match(/TOPIC:\s*(.+)/i)?.[1]?.trim() ?? "";
    const vLine = raw.match(/VISUALS:\s*(.+)/i)?.[1]?.trim() ?? "";
    const sLine = raw.match(/STYLE:\s*(.+)/i)?.[1]?.trim() ?? "";

    if (tLine.length > 2) topic   = tLine;
    if (vLine.length > 2) visuals = vLine;
    if (sLine.length > 2) style   = sLine;

    console.log(`[GEMINI] topic="${topic}" | visuals="${visuals}" | style="${style}"`);
  } catch (e) {
    console.error("[GEMINI] extract failed:", e instanceof Error ? e.message : e);
  }

  // ─── خطوة 2: اطلب الـ prompts بشكل واضح ────────────────────────
  const topicLine = topic
    ? `The video is about: "${topic}". Key visual elements: ${visuals || topic}.`
    : `Based on this Arabic voiceover: "${script.slice(0, 300)}"`;

  const imageGenPrompt =
    "You are an AI image prompt engineer for Pollinations.ai (Flux model).\n\n" +
    topicLine + "\n\n" +
    "Write EXACTLY " + count + " image generation prompts.\n\n" +
    "STRICT RULES:\n" +
    "- Write in ENGLISH ONLY\n" +
    "- Each prompt MUST visually depict: " + (topic || "the topic above") + "\n" +
    "- NO generic scenes: no random nature, no empty sky, no unrelated cities\n" +
    "- Each prompt: 40-70 words\n" +
    "- Include: specific subject + setting + lighting + style\n" +
    "- Numbered list: 1. ... 2. ... etc.\n" +
    "- Output ONLY the numbered list, nothing else\n\n" +
    "PROMPTS:";

  console.log(`[GEMINI] requesting ${count} prompts for topic: "${topic}"`);

  let result = "";
  try {
    result = await generateWithGemini(imageGenPrompt);
    console.log(`[GEMINI] raw prompts (${result.length} chars):\n${result}`);
  } catch (e) {
    console.error("[GEMINI] image prompt generation failed:", e instanceof Error ? e.message : e);
  }

  // ─── خطوة 3: parse الـ prompts ──────────────────────────────────
  const prompts: string[] = [];

  for (const line of result.split("\n")) {
    const clean = line.trim().replace(/\*+/g, "").replace(/^#+\s*/, "");
    if (!clean) continue;

    // أشكال: "1. " | "1) " | "1- " | "1: "
    const m = clean.match(/^\d+[.):\-]\s*(.+)/);
    const candidate = m ? m[1].trim() : "";

    if (candidate.length > 20 && !/[\u0600-\u06FF]/.test(candidate)) {
      prompts.push(candidate);
      if (prompts.length === count) break;
    }
  }

  // إذا فشل parsing المرقّم، خذ أي سطر إنجليزي طويل
  if (prompts.length === 0 && result.length > 0) {
    console.warn("[GEMINI] numbered parsing فشل، محاولة fallback parsing");
    for (const line of result.split("\n")) {
      const t = line.trim().replace(/\*+/g, "");
      if (t.length > 30 && !/[\u0600-\u06FF]/.test(t)) {
        prompts.push(t.replace(/^\d+[.):\-]\s*/, "").trim());
        if (prompts.length === count) break;
      }
    }
  }

  console.log(`[GEMINI] prompts parsed: ${prompts.length}/${count}`);
  prompts.forEach((p, i) => console.log(`  [${i+1}] ${p.slice(0, 80)}`));

  // ─── Fallback: يستخدم الـ topic — لا طبيعة عشوائية ─────────────
  const fallbackAngles = [
    "wide establishing shot",
    "dramatic close-up detail",
    "medium shot with depth of field",
    "overhead aerial perspective",
    "silhouette with dramatic backlight",
  ];

  while (prompts.length < count) {
    const i  = prompts.length;
    const angle = fallbackAngles[i % fallbackAngles.length];
    const fallback = topic
      ? `${topic}, ${visuals.split(",")[i % 3] || visuals || "detailed scene"}, ${angle}, ${style}, hyper-detailed, 8K`
      : `Cinematic scene, ${angle}, dramatic lighting, 4K, professional photography`;
    console.warn(`[GEMINI] fallback[${i+1}]: ${fallback.slice(0, 80)}`);
    prompts.push(fallback);
  }

  return prompts;
}

// =================================================================
// توليد metadata للنشر (عنوان + وصف + هاشتاجات)
// =================================================================
export async function generateVideoMetadata(script: string): Promise<{
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
}> {
  const prompt = 
    "Based on this Arabic video script, generate social media metadata in JSON format only.\n" +
    "Return ONLY valid JSON, no markdown, no explanation.\n\n" +
    "Required format:\n" +
    "{\n" +
    '  "title": "engaging Arabic title under 100 chars",\n' +
    '  "description": "Arabic description 2-3 sentences with keywords",\n' +
    '  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],\n' +
    '  "tags": ["tag1", "tag2", "tag3"]\n' +
    "}\n\n" +
    "Script:\n" + script.slice(0, 800);

  try {
    const raw = await generateWithGemini(prompt);
    console.log("[GEMINI] metadata raw:", raw.slice(0, 200));
    
    // استخراج JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    
    const data = JSON.parse(jsonMatch[0]);
    return {
      title: data.title || "فيديو جديد",
      description: data.description || "",
      hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
      tags: Array.isArray(data.tags) ? data.tags : [],
    };
  } catch (e) {
    console.error("[GEMINI] metadata error:", e instanceof Error ? e.message : e);
    return {
      title: "فيديو جديد",
      description: script.slice(0, 150),
      hashtags: ["#فيديو", "#محتوى"],
      tags: ["video", "content"],
    };
  }
}
