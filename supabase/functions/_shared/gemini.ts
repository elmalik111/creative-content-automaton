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
    "أنت الآن كاتب سيناريو محترف (Scriptwriter) لـ Shorts/Reels، متخصص في تحويل القصص التاريخية والواقعية إلى تجارب بصرية صادمة، وغامضة.\n" +
    "### المهمة المطلوبة:\n" +
    "اكتب سكربت فيديو (بالعامية المصرية) يركز على **حدث واحد أو موقف محدد** (Specific Incident) داخل الموضوع، وليس ملخصاً للموضوع كامل. ابحث عن اللحظة الأكثر صدمة أو غموضاً وركز عليها.\n\n" +
    "- العنوان: " + title + "\n" +
    "- الوصف: " + description + "\n" +
    "- المدة المستهدفة: " + duration + " ثانية\n\n" +

    "يجب ان يتكون السكربت من:\n" +
    "1. الاثاره والصراع فى القصه.\n" +
    "2. ظهور العقبات والتحديات والفشل والنجاح.\n" +
    "3. تحديات تحتوى على خساره اذا لم تتم.\n" +
    "4. تحول مفاجأ فى حبكة الاسكربت.\n" +
    "5. الوصول الى النتيجه التى يتوقعها المشاهد.\n" +
    "6. ختام السكربت بمحاوله للحفاظ على المشاهد والحصول على تفاعل او تعليق.\n\n" +

    "### أولاً: الخطّافات (The Hooks) - اختر واحداً يبدأ في أول 3 ثوانٍ:\n" +
    "1. (اللحظة اللي [الاسم] قرر فيها ينهي كل حاجة، ماكانتش زي ما سمعت.. الحقيقة أغرب بكثير).\n" +
    "2. (تخيل إن غلطة تافهة مدتها 30 ثانية كانت السبب في دمار إمبراطورية كاملة.. ده اللي حصل في [الموقف]).\n" +
    "3. (الجثة اللي لقوها في [المكان] غيرت مسار التاريخ، والسر كان مستخبي في تفصيلة صغيرة الكل تجاهلها).\n" +
    "4. (الكل فاكر إن [الاسم] مات بطل، بس الحقيقة إنه مات وهو بيعمل أكتر حاجة قذرة ممكن تتخيلها).\n" +
    "5. (لو كنت واقف ورا الباب في الليلة دي، كنت هتشوف منظر هيخليك متنمش طول حياتك).\n" +
    "6. (في سر مدفون تحت [مكان محدد]، السر ده بيكشف إن [الاسم] ماكنش الشخص اللي إنت فاكره).\n" +
    "7. (ليه العالم كله خايف يفتح الصندوق ده؟ وليه [الاسم] فضل يصرخ لحد آخر ثانية في حياته؟).\n" +
    "8. (كلنا سمعنا عن [الحدث]، بس محدش قالك إيه اللي حصل فعلاً في 'الخيمة' أو 'الغرفة' دي).\n\n" +

    "### ثانيا: القواعد الفنية والإيقاع:\n" +
    "- **اللغة:** عامية مصرية معاصرة 'قوية' ودرامية، وليست فصحى.\n" +
    "- **الإيقاع:** جمل قصيرة جداً (Snap-shots). وقفات درامية (توقف) بعد كل معلومة صادمة.\n" +
    "- **التركيز:** ممنوع سرد سيرة ذاتية. ركز على 'المكان، الزمان، القرار، النتيجة الصادمة'.\n\n" +

    "### ثالثا: النهاية (The Outro):\n" +
    "- اختم بسؤال تفاعلي أو جملة تترك المشاهد مذهولاً (مثلاً: تفتكروا التاريخ لسه مخبي إيه؟ / لو كنت مكانه، كنت هتختار تموت بطل ولا تعيش خاين؟).\n\n" +

    "**تعليمات مهمة جداً:** سيكون السكربت عبارة عن تعليق صوتى فقط. اكتب فقط النص الذي سيُقرأ بصوت عالٍ.\n" +
    "ممنوع تماماً إضافة أي مما يلي:\n" +
    "- وصف مشاهد أو صور (مثل: 'صورة لسفينة في البحر')\n" +
    "- عناوين أقسام (مثل: 'المشهد الأول' أو 'الخطاف')\n" +
    "- تعليمات إخراجية (مثل: 'موسيقى تشويق' أو 'زووم على الوجه')\n" +
    "- أي نص بين أقواس مربعة أو تعليقات\n" +
    "- أي شرح لطريقة السرد أو الأسلوب\n\n" +
    "اكتب النص المنطوق فقط، من أول كلمة لآخر كلمة، بدون أي إضافات.\n\n" +
    "ابدأ بكتابة السكربت مباشرة. لا تضف أي تعليقات مثل 'إليك السكربت' أو 'أتمنى أن يعجبك'. فقط النص.\n\n" +
    "النص:";

  const raw = await generateWithGemini(prompt);
  
  // تنظيف السكربت من أي عناصر غير صوتية تسربت
  const cleaned = raw
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true; // keep empty lines for pacing
      // Remove lines that look like scene descriptions or headers
      if (/^\*\*.*\*\*$/.test(trimmed)) return false; // **bold headers**
      if (/^#{1,3}\s/.test(trimmed)) return false; // markdown headers
      if (/^\[.*\]$/.test(trimmed)) return false; // [bracketed directions]
      if (/^(المشهد|مشهد|صورة|صوت|موسيقى|زووم|كت|فيد|الخطاف|النهاية|الأوترو)\s*[\d:]/i.test(trimmed)) return false;
      if (/^\(.*وصف.*\)$/i.test(trimmed)) return false; // (وصف ...)
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // collapse multiple empty lines
    .trim();
  
  return cleaned;
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
  const extractPrompt ="You are an Expert Visual Director and Script Analyst.\n" +
    "Your task is to analyze the following Arabic script and extract the most impactful visual essence for image generation.\n\n" +
    "STRICT OUTPUT RULES:\n" +
    "- Respond with EXACTLY 3 lines in English.\n" +
    "- Do not use Markdown, bolding, or any extra characters.\n" +
    "- Ensure English terminology is professional and cinematic.\n\n" +
    "Arabic script:\n" + script.slice(0, 600) + "\n\n" +
    "FORMAT TO FOLLOW:\n" +
    "TOPIC: [Summarize the core narrative essence in 3-8 powerful English words]\n" +
    "VISUALS: [5 highly detailed, descriptive visual elements found in the script, separated by commas]\n" +
    "STYLE: [Specific artistic style, mood, lighting, and camera angle, e.g., 'Cinematic hyper-realistic, dramatic chiaroscuro lighting, 8k resolution']\n\n" +
    "ANALYSIS RESULT:";

  let topic   = "";
  let visuals = "";
  let style   = "8k resolution, sharp focus, intricate textures";

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
    ? `The core topic is: "${topic}". Key visual elements to emphasize: ${visuals || topic}.`
    : `Analyze the visual imagery implied by this Arabic narration segment: "${script.slice(0, 300)}..."`;

const imageGenPrompt =
  "You are a Master Cinematic Prompt Writer for state-of-the-art AI image models (like Flux).\n" +
  "Your goal is to translate the input below into stunning, highly detailed visual descriptions.\n\n" +
  "INPUT DATA:\n" +
  topicLine + "\n\n" +
  "TASK: Create EXACTLY " + count + " distinct, high-quality image generation prompts.\n\n" +
  "STRICT & CRITICAL GUIDELINES:\n" +
  "- **ENGLISH ONLY**.\n" +
  "- **Relevance:** Every single prompt MUST directly visualize the specific subject matter from the input data. Absolutely NO generic scenes, empty landscapes, or unrelated filler.\n" +
  "- **Word Count:** 50-80 words per prompt (to allow for rich detail).\n" +
  "- **Aesthetic Goal:** Aim for 'Cinematic Masterpiece', 'Hyper-realistic Photography', or 'Detailed Historical Recreation'.\n" +
  "- **Required Prompt Structure:** Start with the main SUBJECT & ACTION -> place them in a detailed ENVIRONMENT -> describe the MOOD & LIGHTING (e.g., dramatic, golden hour, cinematic fog) -> end with TECHNICAL SPECS (e.g., 8k resolution, highly detailed, sharp focus, intricate textures, photorealistic).\n" +
  "- **Variety:** Ensure each of the " + count + " prompts provides a unique angle or composition (e.g., wide shot, close-up portrait, dynamic action angle).\n\n" +
  "OUTPUT FORMAT: A clean numbered list ONLY (1., 2., etc.). No introductory text.\n\n" +
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
  const metadataPrompt = 
  "You are a World-Class Viral Content Strategist and SEO Expert for YouTube and Social Media.\n" +
  "Your mission is to analyze the provided Arabic video script and generate high-converting metadata to maximize CTR and search visibility.\n\n" +
  "SCRIPT FOR ANALYSIS:\n" +
  script.slice(0, 800) + "\n\n" +
  "GUIDELINES FOR GENERATION:\n" +
  "- **Title:** Must be a 'Magnetic Hook' in Arabic. Use curiosity, mystery, or a shocking fact from the script. Keep it under 60 characters for maximum mobile visibility.\n" +
  "- **Description:** Write 2-3 compelling Arabic sentences. Start with a hook that summarizes the most interesting part of the video, followed by a natural flow of keywords for SEO.\n" +
  "- **Hashtags:** Provide 5 high-traffic, relevant Arabic hashtags.\n" +
  "- **Tags:** Provide a mix of broad and specific keywords for the YouTube algorithm.\n\n" +
  "STRICT OUTPUT RULE: Return ONLY the raw JSON object. No Markdown backticks (```), no 'json' labels, and no introductory or concluding text. The output must be immediately parseable by JSON.parse().\n\n" +
  "REQUIRED FORMAT:\n" +
  "{\n" +
  '  "title": "Magnetic Arabic Title",\n' +
  '  "description": "Engaging Arabic SEO description",\n' +
  '  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],\n' +
  '  "tags": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]\n' +
  "}";

  try {
    const raw = await generateWithGemini(metadataPrompt);
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
