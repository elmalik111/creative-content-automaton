// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";

interface TelegramMessage {
  message?: {
    chat: { id: number };
    text?: string;
    from?: { id: number; first_name?: string };
  };
}

interface CreateCommand {
  title: string;
  description: string;
  voice_type: string;
  scene_count: number;
  duration: number;
}

// Rate limiting cache (in-memory for this function instance)
const rateLimitCache: Map<number, { count: number; resetAt: number }> = new Map();
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX_REQUESTS = 10; // Max 10 jobs per 5 minutes per chat

function checkRateLimit(chatId: number): boolean {
  const now = Date.now();
  const entry = rateLimitCache.get(chatId);
  
  if (!entry || now > entry.resetAt) {
    rateLimitCache.set(chatId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  entry.count++;
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== SECURITY: Validate Telegram Webhook Secret =====
    const telegramSecretToken = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    const expectedSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    
    // If a secret is configured, enforce validation
    if (expectedSecret && telegramSecretToken !== expectedSecret) {
      console.error("Invalid Telegram webhook secret token");
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const body: TelegramMessage = await req.json();
    
    // ===== SECURITY: Validate message structure =====
    if (!body.message?.chat?.id || typeof body.message.chat.id !== "number") {
      console.error("Invalid message structure");
      return new Response("OK", { headers: corsHeaders });
    }
    
    if (!body.message?.text) {
      return new Response("OK", { headers: corsHeaders });
    }

    const chatId = body.message.chat.id;
    const text = body.message.text;

    // Get Telegram token from settings
    const { data: tokenSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "telegram_token")
      .maybeSingle();

    const telegramToken = tokenSetting?.value;

    if (!telegramToken) {
      console.error("Telegram token not configured");
      return new Response("OK", { headers: corsHeaders });
    }

    // Check for /create command
    if (text.startsWith("/create")) {
      const command = parseCreateCommand(text);
      
      if (!command) {
        await sendTelegramMessage(
          telegramToken,
          chatId,
          `❌ صيغة غير صحيحة. استخدم:

/create
عنوان: عنوان الفيديو
وصف: وصف المحتوى
نوع_الصوت: male_arabic أو female_arabic
عدد_المشاهد: 5
الطول: 60`
        );
        return new Response("OK", { headers: corsHeaders });
      }

      // ===== SECURITY: Rate limiting per chat =====
      if (!checkRateLimit(chatId)) {
        await sendTelegramMessage(
          telegramToken,
          chatId,
          "⚠️ تباطأ قليلاً! لقد وصلت إلى الحد الأقصى للطلبات (10 كل 5 دقائق). حاول مرة أخرى لاحقاً."
        );
        return new Response("OK", { headers: corsHeaders });
      }

      // Create AI generation job
      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          type: "ai_generate",
          status: "pending",
          progress: 0,
          source_url: `telegram:${chatId}`,
          input_data: { ...command, platforms: ["youtube", "instagram", "facebook"] },
        })
        .select()
        .single();

      if (error) {
        await sendTelegramMessage(
          telegramToken,
          chatId,
          "❌ حدث خطأ في إنشاء المهمة. حاول مرة أخرى."
        );
        return new Response("OK", { headers: corsHeaders });
      }

      await sendTelegramMessage(
        telegramToken,
        chatId,
        `✅ تم استلام طلبك!

🎬 العنوان: ${command.title}
📝 الوصف: ${command.description}
🎤 نوع الصوت: ${command.voice_type}
🖼️ عدد المشاهد: ${command.scene_count}
⏱️ المدة: ${command.duration} ثانية

🔄 رقم المهمة: ${job.id.slice(0, 8)}

سيتم إعلامك عند الانتهاء...`
      );

      // Trigger AI generation
      const baseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      fetch(`${baseUrl}/functions/v1/ai-generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ job_id: job.id }),
      });
    } else if (text === "/status") {
      // Get recent jobs for this chat
      const { data: jobs } = await supabase
        .from("jobs")
        .select("*")
        .eq("source_url", `telegram:${chatId}`)
        .order("created_at", { ascending: false })
        .limit(5);

      if (!jobs || jobs.length === 0) {
        await sendTelegramMessage(telegramToken, chatId, "لا توجد مهام حالياً.");
      } else {
        const statusEmojiMap: Record<string, string> = {
          pending: "⏳",
          processing: "🔄",
          completed: "✅",
          failed: "❌",
        };
        const statusText = jobs.map((job) => {
          const statusEmoji = statusEmojiMap[job.status as string] || "❓";
          return `${statusEmoji} ${job.id.slice(0, 8)} - ${job.status} (${job.progress}%)`;
        }).join("\n");

        await sendTelegramMessage(
          telegramToken,
          chatId,
          `📊 آخر المهام:\n\n${statusText}`
        );
      }
    } else if (text === "/help" || text === "/start") {
      await sendTelegramMessage(
        telegramToken,
        chatId,
        `🎬 مرحباً! أنا بوت إنشاء الفيديوهات التلقائي.

الأوامر المتاحة:

/create - إنشاء فيديو جديد
/status - عرض حالة المهام
/help - عرض المساعدة

لإنشاء فيديو، استخدم:

/create
عنوان: كيف تنجح في الحياة
وصف: فيديو تحفيزي عن النجاح
نوع_الصوت: male_arabic
عدد_المشاهد: 5
الطول: 60`
      );
    }

    return new Response("OK", { headers: corsHeaders });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response("OK", { headers: corsHeaders });
  }
});

// ===== INPUT VALIDATION CONSTANTS =====
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1000;
const MIN_SCENE_COUNT = 1;
const MAX_SCENE_COUNT = 20;
const MIN_DURATION = 10;
const MAX_DURATION = 300;
const VALID_VOICE_TYPES = ["male_arabic", "female_arabic"];

/**
 * Sanitizes text input to prevent injection attacks
 */
function sanitizeText(text: string, maxLength: number): string {
  // Trim and truncate
  let sanitized = text.trim().slice(0, maxLength);
  // Remove control characters except newlines
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return sanitized;
}

function parseCreateCommand(text: string): CreateCommand | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  
  if (lines.length < 2) return null;

  const data: Partial<CreateCommand> = {};

  for (const line of lines) {
    if (line.startsWith("/create")) continue;
    
    const [key, ...valueParts] = line.split(":");
    const value = valueParts.join(":").trim();
    
    switch (key.trim()) {
      case "عنوان":
        data.title = sanitizeText(value, MAX_TITLE_LENGTH);
        break;
      case "وصف":
        data.description = sanitizeText(value, MAX_DESCRIPTION_LENGTH);
        break;
      case "نوع_الصوت":
        data.voice_type = value;
        break;
      case "عدد_المشاهد":
        data.scene_count = parseInt(value) || 5;
        break;
      case "الطول":
        data.duration = parseInt(value) || 60;
        break;
    }
  }

  // ===== SECURITY: Validate required fields =====
  if (!data.title || data.title.length === 0) return null;
  if (!data.description || data.description.length === 0) return null;

  // ===== SECURITY: Validate voice type =====
  if (data.voice_type && !VALID_VOICE_TYPES.includes(data.voice_type)) {
    data.voice_type = "male_arabic"; // Default to safe value
  }

  // ===== SECURITY: Validate numeric bounds =====
  const sceneCount = data.scene_count || 5;
  if (sceneCount < MIN_SCENE_COUNT || sceneCount > MAX_SCENE_COUNT) {
    data.scene_count = Math.max(MIN_SCENE_COUNT, Math.min(MAX_SCENE_COUNT, sceneCount));
  }

  const duration = data.duration || 60;
  if (duration < MIN_DURATION || duration > MAX_DURATION) {
    data.duration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, duration));
  }

  return {
    title: data.title,
    description: data.description || "",
    voice_type: data.voice_type || "male_arabic",
    scene_count: data.scene_count || 5,
    duration: data.duration || 60,
  };
}

async function sendTelegramMessage(token: string, chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });
}
