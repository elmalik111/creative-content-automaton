const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GEMINI_API_KEY  = Deno.env.get("GEMINI_API_KEY");

// =================================================================
// CORE: generateWithGemini
// =================================================================
export async function generateWithGemini(prompt: string): Promise<string> {
  if (LOVABLE_API_KEY) return generateWithLovableGateway(prompt);
  if (GEMINI_API_KEY)  return generateWithDirectGemini(prompt);
  throw new Error("No AI API key configured (LOVABLE_API_KEY or GEMINI_API_KEY required)");
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
  if (!res.ok) throw new Error(`Lovable Gateway error ${res.status}: ${await res.text()}`);
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
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
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
// HELPERS
// =================================================================
function parsePromptList(text: string, count: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/\*+/g, "");
    if (!line) continue;
    // أشكال: "1. " | "1) " | "1- " | "1: "
    const m = line.match(/^\d+[.):\-]\s*(.+)/);
    const candidate = m ? m[1].trim() : "";
    if (candidate.length > 20 && !/[\u0600-\u06FF]/.test(candidate)) {
      out.push(candidate);
      if (out.length === count) break;
    }
  }
  // إذا فشل parsing المرقّم، خذ أي سطر إنجليزي طويل
  if (out.length === 0) {
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line.length > 30 && !/[\u0600-\u06FF]/.test(line)) {
        out.push(line.replace(/^\d+[.):\-]\s*/, "").trim());
        if (out.length === count) break;
      }
    }
  }
  return out;
}

// =================================================================
// IMAGE PROMPTS — نهج ثنائي المرحلة
// =================================================================
export async function generateImagePrompts(
  script: string,
  sceneCount: number
): Promise<string[]> {
  const count = Math.max(1, Math.min(sceneCount || 3, 10));

  // ─── المرحلة 1: استخراج الموضوع من السكريبت ───────────────────
  // هذه المرحلة هي جوهر الإصلاح:
  // بدلاً من إرسال النص العربي مباشرة، نستخرج منه أولاً:
  //   SUBJECT  - الموضوع الرئيسي بالإنجليزية
  //   ELEMENTS - العناصر البصرية الرئيسية
  //   MOOD     - الطابع البصري

  const extractPrompt =
    "You are a visual researcher. Read the following Arabic text and extract its core visual identity.\n\n" +
    "Arabic text:\n" +
    "---\n" +
    script.slice(0, 800) +
    "\n---\n\n" +
    "Respond with EXACTLY these 3 lines and nothing else:\n" +
    "SUBJECT: <the specific main subject in English — e.g. 'Hatshepsut, female pharaoh of ancient Egypt' or 'climate change effects on coral reefs'>\n" +
    "ELEMENTS: <5 concrete visual elements directly from the text, comma-separated in English>\n" +
    "MOOD: <visual mood in English — e.g. 'epic historical, golden tones, dramatic shadows'>";

  let subject  = "";
  let elements = "";
  let mood     = "cinematic, dramatic, 4K";

  try {
    const raw = await generateWithGemini(extractPrompt);
    console.log("[GEMINI-EXTRACT] raw:", raw.slice(0, 250));
    const sMatch = raw.match(/SUBJECT:\s*(.+)/i);
    const eMatch = raw.match(/ELEMENTS:\s*(.+)/i);
    const mMatch = raw.match(/MOOD:\s*(.+)/i);
    subject  = sMatch?.[1]?.trim() ?? "";
    elements = eMatch?.[1]?.trim() ?? "";
    mood     = mMatch?.[1]?.trim() || mood;
    console.log(`[GEMINI-EXTRACT] subject="${subject}" | elements="${elements}" | mood="${mood}"`);
  } catch (e) {
    console.warn("[GEMINI-EXTRACT] failed:", e instanceof Error ? e.message : e);
  }

  // إذا فشل الاستخراج، نستخدم النص كما هو
  const topicContext = subject
    ? "VIDEO TOPIC: " + subject + "\nKEY VISUALS: " + (elements || subject) + "\nMOOD: " + mood
    : "VIDEO SCRIPT (Arabic): " + script.slice(0, 500);

  // ─── المرحلة 2: توليد الـ prompts مرتكزة على الموضوع ──────────
  const imagePrompt =
    "You are an expert Flux AI image prompt engineer.\n\n" +
    topicContext + "\n\n" +
    "Write EXACTLY " + count + " image prompts in ENGLISH ONLY.\n\n" +
    "CRITICAL RULES:\n" +
    "1. Every prompt MUST be about: " + (subject || "the video topic above") + "\n" +
    "2. NEVER use generic scenes (no random nature, sky, city, or abstract backgrounds)\n" +
    "3. Each prompt MUST include the specific subject from above\n" +
    "4. Length: 60-90 words per prompt\n" +
    "5. Style: cinematic 4K, dramatic lighting, hyper-detailed\n" +
    "6. Each prompt shows a DIFFERENT aspect/angle of the same topic\n" +
    "7. Output ONLY a numbered list — no headers, no explanations\n\n" +
    "PROMPTS:";

  console.log(`[GEMINI-IMAGE] Requesting ${count} prompts for: "${subject.slice(0, 60)}"`);
  const result = await generateWithGemini(imagePrompt);
  console.log(`[GEMINI-IMAGE] Response ${result.length}ch: ${result.slice(0, 250)}`);

  const prompts = parsePromptList(result, count);
  console.log(`[GEMINI-IMAGE] Parsed ${prompts.length}/${count}`);

  // ─── Fallback: يستخدم الموضوع المستخرج — لا طبيعة عشوائية ─────
  const angles = [
    "wide establishing shot", "dramatic close-up", "medium shot with depth",
    "overhead aerial view",   "silhouette against dramatic sky",
  ];
  while (prompts.length < count) {
    const i  = prompts.length;
    const fb = subject
      ? subject + ", " + (elements.split(",")[i % 3] || elements) + ", " +
        angles[i % angles.length] + ", cinematic 4K, dramatic lighting, hyper-detailed, " + mood
      : "Cinematic " + angles[i % angles.length] + ", dramatic lighting, 4K";
    console.warn(`[GEMINI-IMAGE] fallback[${i+1}]: ${fb.slice(0, 80)}`);
    prompts.push(fb);
  }

  return prompts;
}
