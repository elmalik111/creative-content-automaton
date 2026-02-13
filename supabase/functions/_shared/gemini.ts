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

  // Step 1: extract topic from the Arabic script
  const topicPrompt =
    "Read this Arabic voiceover script and extract in English:\n" +
    "SUBJECT: [the main subject - person name, place, event, or topic]\n" +
    "ELEMENTS: [3-5 key visual elements from the script, comma-separated]\n" +
    "MOOD: [visual mood/tone]\n\n" +
    "Arabic script:\n" +
    script.slice(0, 600) +
    "\n\nRespond ONLY with the three lines above. No extra text.";

  let subject = "";
  let elements = "";
  let mood = "cinematic, dramatic";

  try {
    const topicResult = await generateWithGemini(topicPrompt);
    console.log("[GEMINI] Topic result:", topicResult.slice(0, 200));
    const subMatch  = topicResult.match(/SUBJECT:\s*(.+)/i);
    const elMatch   = topicResult.match(/ELEMENTS:\s*(.+)/i);
    const moodMatch = topicResult.match(/MOOD:\s*(.+)/i);
    if (subMatch?.[1]  && subMatch[1].trim().length > 1)  subject  = subMatch[1].trim();
    if (elMatch?.[1]   && elMatch[1].trim().length > 1)   elements = elMatch[1].trim();
    if (moodMatch?.[1] && moodMatch[1].trim().length > 1) mood     = moodMatch[1].trim();
    console.log(`[GEMINI] Subject="${subject}" Elements="${elements}" Mood="${mood}"`);
  } catch (e) {
    console.warn("[GEMINI] Topic extraction failed:", e instanceof Error ? e.message : String(e));
  }

  // Step 2: generate image prompts grounded in the extracted subject
  const subjectLine = subject
    ? "The video is about: " + subject + ". Key visuals: " + (elements || subject) + "."
    : "Based on this Arabic script: " + script.slice(0, 400);

  const imagePromptRequest =
    "You are an expert AI image prompt engineer.\n\n" +
    subjectLine + "\n\n" +
    "Create EXACTLY " + count + " image generation prompts in ENGLISH ONLY.\n" +
    "Each prompt MUST depict the specific subject above — NOT generic nature or sky.\n\n" +
    "RULES:\n" +
    "- Exactly " + count + " prompts, numbered 1 to " + count + "\n" +
    "- ENGLISH ONLY\n" +
    "- Each prompt: 50-80 words\n" +
    "- EVERY prompt must mention: " + (subject || "the main topic") + "\n" +
    "- Cinematic 4K quality, professional photography or digital painting\n" +
    "- Each prompt shows a different scene/angle\n" +
    "- Output ONLY the numbered list, nothing else\n\n" +
    "PROMPTS:";

  console.log(`[GEMINI] Requesting ${count} prompts. Subject: "${subject}"`);
  const result = await generateWithGemini(imagePromptRequest);
  console.log(`[GEMINI] Raw response (${result.length} chars): ${result.slice(0, 300)}`);

  let prompts = parseImagePrompts(result, count);
  console.log(`[GEMINI] Parsed ${prompts.length}/${count} prompts`);

  // Fallback uses the extracted subject — never generic
  const angles = [
    "wide establishing shot",
    "close-up detail shot",
    "dramatic low-angle view",
    "medium shot with depth of field",
    "aerial overhead view",
  ];
  while (prompts.length < count) {
    const i = prompts.length;
    const angle = angles[i % angles.length];
    const fb = subject
      ? `${subject}, ${elements || "detailed historical setting"}, ${angle}, cinematic lighting, 4K ultra HD, highly detailed, ${mood}`
      : `Cinematic ${angle}, dramatic lighting, professional photography, 4K`;
    console.warn(`[GEMINI] Fallback prompt ${i + 1}: ${fb.slice(0, 70)}`);
    prompts.push(fb);
  }

  return prompts;
}
