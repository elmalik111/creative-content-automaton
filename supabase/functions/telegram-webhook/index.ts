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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: TelegramMessage = await req.json();
    
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

      // Create AI generation job
      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          type: "ai_generate",
          status: "pending",
          progress: 0,
          source_url: `telegram:${chatId}`,
          input_data: command,
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
        data.title = value;
        break;
      case "وصف":
        data.description = value;
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

  if (!data.title || !data.description) return null;

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
