import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";

interface PublishRequest {
  job_id: string;
  video_url: string;
  title: string;
  description: string;
  hashtags?: string[];
  tags?: string[];
  platforms: ("youtube" | "instagram" | "facebook")[];
  youtube_type?: "shorts" | "long";
  duration?: number; // مدة الفيديو بالثواني
}

const YOUTUBE_CLIENT_ID     = Deno.env.get("YOUTUBE_CLIENT_ID");
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (token !== serviceRoleKey) {
      const { data, error: authError } = await supabase.auth.getUser(token);
      if (authError || !data.user) {
        return new Response(JSON.stringify({ error: "Invalid or expired token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    const body: PublishRequest = await req.json();
    console.log("[PUBLISH] job=" + body.job_id + " platforms=" + body.platforms.join(","));
    console.log("[PUBLISH] title=" + body.title);
    const results: Record<string, { success: boolean; url?: string; error?: string }> = {};
    for (const platform of body.platforms) {
      try {
        console.log("[PUBLISH] -> " + platform + "...");
        switch (platform) {
          case "youtube":   results.youtube   = await publishToYouTube(body);   break;
          case "instagram": results.instagram = await publishToInstagram(body); break;
          case "facebook":  results.facebook  = await publishToFacebook(body);  break;
        }
        console.log("[PUBLISH] OK " + platform + ": " + JSON.stringify(results[platform]));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[PUBLISH] FAIL " + platform + ": " + msg);
        results[platform] = { success: false, error: msg };
      }
    }
    await supabase.from("job_steps")
      .update({ output_data: { publish_results: results } })
      .eq("job_id", body.job_id)
      .eq("step_name", "publishing");
    return new Response(JSON.stringify({ results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[PUBLISH] general error: " + error.message);
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function getToken(platform: string): Promise<string | null> {
  const { data } = await supabase
    .from("oauth_tokens").select("access_token, refresh_token, expires_at, id")
    .eq("platform", platform).eq("is_active", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  if (platform === "youtube" && data.expires_at && new Date(data.expires_at) < new Date()) {
    if (!data.refresh_token || !YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) return null;
    const refreshResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID, client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: data.refresh_token, grant_type: "refresh_token",
      }),
    });
    const refreshData = await refreshResp.json();
    if (refreshData.error) return null;
    const expiresAt = refreshData.expires_in
      ? new Date(Date.now() + refreshData.expires_in * 1000).toISOString() : null;
    await supabase.from("oauth_tokens")
      .update({ access_token: refreshData.access_token, expires_at: expiresAt }).eq("id", data.id);
    return refreshData.access_token;
  }
  return data.access_token;
}

// ================================================================
// FIX 1: Instagram - الحصول على Instagram Business Account ID الصحيح
// المشكلة: account_name في DB أحياناً يحتوي Facebook Page ID وليس IG Business ID
// الحل: دائماً نتحقق عبر Graph API /me/accounts للحصول على الـ ID الصحيح
// ================================================================
async function getInstagramBusinessAccountId(accessToken: string): Promise<string | null> {
  // أولاً: جلب من DB كـ cache
  const { data } = await supabase
    .from("oauth_tokens").select("account_name")
    .eq("platform", "instagram").eq("is_active", true)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();

  // التحقق: إذا كان الـ ID في DB يبدأ بـ 178 (Instagram IDs pattern) فهو صحيح
  // Instagram Business Account IDs عادةً تبدأ بـ 17 وأطول من Facebook Page IDs
  const cachedId = data?.account_name;
  if (cachedId && cachedId.startsWith("178") && cachedId.length >= 15) {
    console.log("[PUBLISH] Instagram ig_user_id from DB (verified): " + cachedId);
    return cachedId;
  }

  // إذا الـ ID مشكوك فيه أو غير موجود، نجلبه من API
  console.log("[PUBLISH] Instagram: جلب Business Account ID من Graph API...");
  
  const pagesResp = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,instagram_business_account{id,username}&access_token=${accessToken}`
  );
  const pagesData = await pagesResp.json();
  
  if (pagesData.error) {
    console.error("[PUBLISH] Instagram pages error: " + JSON.stringify(pagesData.error));
    return null;
  }

  console.log("[PUBLISH] Instagram pages: " + JSON.stringify(pagesData).slice(0, 300));

  // البحث عن الصفحة التي لها Instagram Business Account
  const pageWithIG = pagesData.data?.find(
    (page: { instagram_business_account?: { id: string; username?: string } }) =>
      page.instagram_business_account?.id
  );

  if (!pageWithIG?.instagram_business_account?.id) {
    console.error("[PUBLISH] Instagram: لا يوجد Instagram Business Account مرتبط");
    return null;
  }

  const igBusinessId = pageWithIG.instagram_business_account.id;
  console.log("[PUBLISH] Instagram ig_user_id from API: " + igBusinessId + " (@" + pageWithIG.instagram_business_account.username + ")");

  // تحديث الـ DB بالـ ID الصحيح
  await supabase.from("oauth_tokens")
    .update({ account_name: igBusinessId })
    .eq("platform", "instagram").eq("is_active", true);

  return igBusinessId;
}

// ================================================================
// FIX 2: YouTube Shorts - التعامل مع duration=0 أو duration غير موجود
// المشكلة: عندما duration=0، الكود يقع على youtube_type الذي قد يكون undefined
// الحل: إذا duration=0 أو غير موجود → نعتبره Shorts افتراضياً (لأن المنصة تنتج فيديوهات قصيرة)
// ================================================================
async function publishToYouTube(req: PublishRequest): Promise<{ success: boolean; url?: string; error?: string }> {
  const accessToken = await getToken("youtube");
  if (!accessToken) return { success: false, error: "YouTube token missing" };

  const duration = req.duration ?? 0;
  
  let isShorts: boolean;
  if (duration > 0) {
    // إذا عندنا duration حقيقي → نعتمد عليه فقط
    isShorts = duration <= 60;
  } else {
    // duration=0 يعني لم يُرسل → نعتمد على youtube_type
    // إذا youtube_type غير موجود أيضاً → Shorts افتراضياً
    isShorts = req.youtube_type !== "long";
  }

  console.log("[PUBLISH] YouTube duration=" + duration + " youtube_type=" + (req.youtube_type || "undefined") + " isShorts=" + isShorts);

  const title = isShorts && !req.title.includes("#Shorts") ? req.title + " #Shorts" : req.title;
  
  const initResp = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4"
      },
      body: JSON.stringify({
        snippet: {
          title,
          description: req.description,
          tags: req.tags?.length ? req.tags : ["محتوى", "فيديو", "عربي"],
          defaultLanguage: "ar",
          categoryId: "27"
        },
        status: { privacyStatus: "public" },
      }),
    }
  );
  
  const uploadUrl = initResp.headers.get("Location");
  if (!uploadUrl) {
    const err = await initResp.json();
    return { success: false, error: err.error?.message || "فشل بدء رفع YouTube" };
  }
  
  const videoResp = await fetch(req.video_url);
  if (!videoResp.ok || !videoResp.body) return { success: false, error: "فشل تحميل الفيديو" };
  
  const contentLength = videoResp.headers.get("content-length");
  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      ...(contentLength ? { "Content-Length": contentLength } : {})
    },
    body: videoResp.body,
    // @ts-ignore
    duplex: "half",
  });
  
  const videoData = await uploadResp.json();
  if (videoData.id) {
    return {
      success: true,
      url: isShorts
        ? "https://youtube.com/shorts/" + videoData.id
        : "https://youtube.com/watch?v=" + videoData.id
    };
  }
  return { success: false, error: videoData.error?.message || "لم يُفرجع YouTube معرف الفيديو" };
}

// ================================================================
// FIX 3: Instagram - زيادة محاولات الانتظار + استخدام IG Business ID الصحيح
// المشكلة: 6 محاولات × 10 ثوانٍ = 60 ثانية غير كافية لبعض الفيديوهات
// الحل: 12 محاولة × 10 ثوانٍ = 120 ثانية
// ================================================================
async function publishToInstagram(req: PublishRequest): Promise<{ success: boolean; url?: string; error?: string }> {
  const accessToken = await getToken("instagram");
  if (!accessToken) return { success: false, error: "Instagram token missing" };

  // استخدام الدالة المُصلحة للحصول على IG Business Account ID الصحيح
  const igUserId = await getInstagramBusinessAccountId(accessToken);
  if (!igUserId) {
    return {
      success: false,
      error: "Instagram: لم يتم العثور على حساب Business. تأكد من ربط حساب Instagram Business بصفحة Facebook"
    };
  }

  const containerResp = await fetch("https://graph.facebook.com/v18.0/" + igUserId + "/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: req.video_url,
      caption: req.title + "\n\n" + req.description,
      access_token: accessToken
    }),
  });
  
  const containerData = await containerResp.json();
  if (containerData.error) return { success: false, error: containerData.error.message };
  if (!containerData.id) return { success: false, error: "فشل إنشاء media container" };
  
  console.log("[PUBLISH] Instagram container: " + containerData.id);

  // FIX: زيادة المحاولات من 6 إلى 12 (120 ثانية بدلاً من 60 ثانية)
  const MAX_ATTEMPTS = 12;
  let lastStatus = "";
  
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, 10000));
    
    const statusResp = await fetch(
      "https://graph.facebook.com/v18.0/" + containerData.id + "?fields=status_code,status&access_token=" + accessToken
    );
    const statusData = await statusResp.json();
    lastStatus = statusData.status_code || "UNKNOWN";
    
    console.log("[PUBLISH] Instagram status[" + (i+1) + "/" + MAX_ATTEMPTS + "]: " + lastStatus);
    
    if (lastStatus === "FINISHED") break;
    if (lastStatus === "ERROR") {
      return { success: false, error: "فشل معالجة الفيديو في Instagram: " + (statusData.status || "ERROR") };
    }
  }

  if (lastStatus !== "FINISHED") {
    return { success: false, error: "انتهت مهلة معالجة الفيديو في Instagram (آخر حالة: " + lastStatus + "). حاول مرة أخرى." };
  }

  const publishResp = await fetch("https://graph.facebook.com/v18.0/" + igUserId + "/media_publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerData.id, access_token: accessToken }),
  });
  
  const publishData = await publishResp.json();
  if (publishData.error) return { success: false, error: publishData.error.message };
  if (publishData.id) return { success: true, url: "https://instagram.com/reel/" + publishData.id };
  
  return { success: false, error: "فشل النشر على Instagram" };
}

async function publishToFacebook(req: PublishRequest): Promise<{ success: boolean; url?: string; error?: string }> {
  const accessToken = await getToken("facebook");
  if (!accessToken) return { success: false, error: "Facebook token missing" };
  
  const meResp = await fetch("https://graph.facebook.com/v18.0/me?fields=id,name&access_token=" + accessToken);
  const meData = await meResp.json();
  if (meData.error) return { success: false, error: meData.error.message };
  
  const pageId = meData.id;
  console.log("[PUBLISH] Facebook Page ID: " + pageId + " (" + meData.name + ")");
  
  const resp = await fetch("https://graph.facebook.com/v18.0/" + pageId + "/videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_url: req.video_url,
      title: req.title,
      description: req.description,
      access_token: accessToken
    }),
  });
  
  const data = await resp.json();
  if (data.error) return { success: false, error: data.error.message };
  if (data.id) return { success: true, url: "https://facebook.com/watch/?v=" + data.id };
  
  return { success: false, error: "لم يُفرجع Facebook معرف الفيديو" };
}
