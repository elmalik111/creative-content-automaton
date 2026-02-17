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
    "اريدك أن تعمل ككاتب سيناريو محترف لـ reals or Shorts videos متخصص في محتوى سرد اريد ان يكون الحوار او القصة بالشكل الغامض والصادم. هدفي هو كتابة سكربت.\n\n" +

    "العنوان: " + title + "\n" +

    "الوصف: " + description + "\n" +

    "المدة المطلوبة: حوالي " + duration + " ثانية\n\n" +

    "التعليمات:\n" +
    "- الخُطّاف (The Hook): ابدأ بجملة استهلالية تصدم المشاهد وتكسر معتقداته (مثال: 'كل ما تعرفه عن [X] هو كذبة'"كل ما تعلمته في المدرسة عن [اسم الشخصية] كان مجرد تجميل للحقيقة.. الواقع كان أقذر بكثير مما تتخيل.""السر الذي حاولت [جهة معينة، كالكنيسة أو الدولة] إخفاءه لـ 500 عام تم كشفه أخيراً.. وهذه هي الوثيقة.""لو كنت تعيش في زمن [حضارة معينة]، فاحتمالية بقائك حياً لصباح الغد كانت شبه مستحيلة.. والسبب سيفزعك.""توقف عن تخيل [اسم ملكة/شخصية] بالصورة التي تراها في الأفلام.. الذكاء الاصطناعي كشف شكلهم الحقيقي، والنتيجة ستصدمك.""البطل الذي تعتبره قدوة، كان في الواقع السفاح الأكثر دموية في عصره.. إليك الوجه المظلم الذي لا يريدونك أن تعرفه عن [الاسم].""هذا الطقس الذي كانت تمارسه حضارة [الاسم] هو السبب الحقيقي في فنائهم.. وما كانوا يفعله بالأطفال لا يصدقه عقل.""أغرب حالة وفاة في التاريخ ليست كما سمعت.. انتظر لتعرف كيف قتلت [شيء تافه] أعظم إمبراطور عرفته البشرية.""في قانون [دولة قديمة]، لو ارتكبت هذا الخطأ البسيط، سيكون مصيرك الموت بأبشع طريقة يمكن تخيلها.""أكبر خيانة في التاريخ لم تأتِ من عدو، بل من الشخص الذي كان ينام في الغرفة المجاورة لـ [اسم الشخصية].. إليك ما حدث.""لماذا كان الاستحمام جريمة في بلاط الملك [الاسم]؟ استعد، لأن التفاصيل القادمة قد تجعلك تشعر بالغثيان.").هذه امثله لبعض الحطافات ليس شرط ان تستخدمها ولكن سجب ان تسخدم خطاف و يجب أن يكون في أول 3 ثوانٍ\n" +
    "- السرد : "الدرامي" لا تسرد حقائق جافة، بل احكِ قصة. ركز على الجوانب المظلمة، الغريبة، أو 'المحرمة' التي لا تُذكر في الكتب المدرسية. "الراوي المتورط" (The First-Person POV)
بدلاً من أن تكون معلقاً خارجياً، اجعل الشخصية التاريخية هي من تتحدث (باستخدام صور AI تعبيرية).
كيفية التنفيذ: ابدأ النص بضمير المتكلم. "أنا لستُ البطل الذي قرأتم عنه في الكتب.. أنا الرجل الذي أحرق مدينته ليرى الجمال".
التفاصيل المؤثرة: ركز على المشاعر الداخلية (الخوف، الندم، الغطرسة). هذا الأسلوب يخلق رابطاً نفسياً قوياً مع المشاهد ويجعله يشعر أنه يسمع اعترافاً سرياً.
يصلح لـ: السير الذاتية للشخصيات المثيرة للجدل "تأثير الفراشة" (The Domino Effect)
هذا الأسلوب يعتمد على ربط حدث تافه جداً بكارثة تاريخية عظمى.
كيفية التنفيذ: ابدأ بالحدث التافه. "هل تصدق أن سندوتشاً ضائعاً كان السبب في مقتل 20 مليون إنسان؟". ثم ابدأ بسرد التسلسل: (أ جاع القاتل -> توقف ليأكل -> تصادف مرور موكب الأرشيدوق فرانتس فرديناند -> بدأت الحرب العالمية الأولى).
التفاصيل المؤثرة: استخدم عبارات مثل "في تلك اللحظة تحديداً"، "لو تأخر ثانية واحدة لغير التاريخ".
يصلح لـ: الحروب، الاكتشافات الصدفة، الانهيارات الاقتصادية.
"مسرح الجريمة" (The Forensic Investigation)
عامل التاريخ كأنه "قضية جنائية" لم تُحل بعد.
كيفية التنفيذ: استخدم لغة التحقيق. "المكان: وادي الملوك. الضحية: ملك شاب. الأداة: ثقب في الجمجمة". ابدأ بعرض الأدلة (Exhibit A, Exhibit B) ثم استعرض النظريات.
التفاصيل المؤثرة: ركز على التفاصيل المادية (بقايا السم، خيانة في القصر، رسالة مفقودة). هذا الأسلوب يرفع من هرمون الدوبامين لدى المشاهد وهو يحاول "حل اللغز" معك.
يصلح لـ: الوفيات الغامضة، اختفاء الحضارات (مثل حضارة المايا)، الكنوز المفقودة.  "الانغماس الحسي" (The Sensory Immersion)
بدلاً من ذكر التواريخ، صِف ما يراه ويشمه ويسمعه الشخص في تلك اللحظة.
كيفية التنفيذ: "تخيل أنك تقف في وسط ساحة الكولوسيوم.. رائحة العرق والدم تملاً الأنوف، صراخ 50 ألف متفرج يصم الآذان، وملمس الرمل الخشن تحت قدميك المرتجفتين".
التفاصيل المؤثرة: لا تذكر "سنة 80 ميلادية"، بل اذكر "برودة النصل" أو "حرارة النيران". هذا الأسلوب "سينمائي" جداً ويجعل المشاهد لا يرمش.
يصلح لـ: وصف المعارك، الحياة اليومية في العصور القديمة، الكوارث الطبيعية.أسلوب "المقارنة الصادمة" (Then vs. Now)
اربط أغرب عادات الماضي بحياتنا الحالية لتظهر مدى "جنون" القدماء.
كيفية التنفيذ: "اليوم أنت تذهب للطبيب لتتعالج، لكن في لندن القرن السابع عشر، كان الطبيب سيصف لك (مسحوق المومياء البشرية) كدواء للصداع!".
التفاصيل المؤثرة: ركز على المقارنة بين الرفاهية الحالية والقسوة أو الغرابة القديمة. هذا الأسلوب يحقق "تريند" لأنه يلمس واقع المشاهد.
يصلح لـ: الطب القديم، عادات الزواج، قوانين العمل، النظافة الشخصية.\n" +
    "-الإيقاع: استخدم جملاً قصيرة جداً وقوية. تجنب الحشو. (فعل، فاعل، مفعول به - توقف)\n" +
    "- النهاية: اختم بجملة تترك المشاهد في حالة ذهول أو سؤال تفاعلي لزيادة التعليقات\n" +
    "- استخدم لغة عربية مصريه عاميه معاصرة وبسيطة، لكنها قوية ودرامية.\n" +
    "- اجعل النص مناسبًا للتلاوة بصوت عالٍ\n" +
    "- ركز على الكلمات التي تثير المشاعر (رعب، خيانة، مؤامرة، فضيحة، سر).\n" +
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
    ? `const topicLine = topic
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
  const prompt = 
   const metadataPrompt = 
  "You are a World-Class Viral Content Strategist and SEO Expert for YouTube and Social Media.\n" +
  "Your mission is to analyze the provided Arabic video script and generate high-converting metadata to maximize CTR and search visibility.\n\n" +
  "SCRIPT FOR ANALYSIS:\n" +
  script + "\n\n" +
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
