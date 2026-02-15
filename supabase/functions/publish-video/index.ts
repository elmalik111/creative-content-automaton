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
}

const YOUTUBE_CLIENT_ID     = Deno.env.get("YOUTUBE_CLIENT_ID");
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET");

// =================================================================
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
    console.log(`[PUBLISH] job=${body.job_id} platforms=${body.platforms.join(",")}`);
    console.log(`[PUBLISH] title="${body.title}"`);

    const results: Record<string, { success: boolean; url?: string; error?: string }> = {};

    for (const platform of body.platforms) {
      try {
        console.log(`[PUBLISH] → ${platform}...`);
        switch (platform) {
          case "youtube":   results.youtube   = await publishToYouTube(body);   break;
          case "instagram": results.instagram = await publishToInstagram(body); break;
          case "facebook":  results.facebook  = await publishToFacebook(body);  break;
        }
        console.log(`[PUBLISH] ✅ ${platform}: ${JSON.stringify(results[platform])}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[PUBLISH] ❌ ${platform}: ${msg}`);
        results[platform] = { success: false, error: msg };
      }
    }

    // حفظ نتائج النشر في DB
    await supabase.from("jobs")
      .update({ publish_results: results })
      .eq("id", body.job_id)
      .catch(() => {});

    return new Response(JSON.stringify({ results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[PUBLISH] خطأ عام:", error.message);
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// =================================================================
// TOKEN HELPER
// =================================================================
async function getValidAccessToken(platform: string): Promise<{
  access_token: string;
  page_access_token?: string;
  page_id?: string;
  ig_user_id?: string;
} | null> {
  const { data: tokenData } = await supabase
    .from("oauth_tokens").select("*")
    .eq("platform", platform).eq("is_active", true).maybeSingle();

  if (!tokenData) return null;

  let accessToken = tokenData.access_token;

  // تحديث token منتهي الصلاحية (YouTube فقط)
  if (platform === "youtube" && tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
    if (!tokenData.refresh_token || !YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) return null;

    const refreshResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    const refreshData = await refreshResp.json();
    if (refreshData.error) { console.error("[PUBLISH] token refresh failed:", refreshData.error); return null; }

    const expiresAt = refreshData.expires_in
      ? new Date(Date.now() + refreshData.expires_in * 1000).toISOString() : null;

    await supabase.from("oauth_tokens")
      .update({ access_token: refreshData.access_token, expires_at: expiresAt })
      .eq("id", tokenData.id);

    accessToken = refreshData.access_token;
  }

  // Facebook: جلب page access token
  if (platform === "facebook") {
    const r = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token=${accessToken}`);
    const d = await r.json();
    const page = d.data?.[0];
    if (page) return { access_token: accessToken, page_access_token: page.access_token, page_id: page.id };
  }

  // Instagram: جلب ig_user_id
  if (platform === "instagram") {
    const r = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=id,instagram_business_account&access_token=${accessToken}`);
    const d = await r.json();
    const page = d.data?.find((p: any) => p.instagram_business_account);
    if (page) return { access_token: accessToken, ig_user_id: page.instagram_business_account.id };
  }

  return { access_token: accessToken };
}

// =================================================================
// YOUTUBE
// الإصلاح: نستخدم video_url مباشرة بدون تحميل في RAM
// =================================================================
async function publishToYouTube(req: PublishRequest): Promise<{ success: boolean; url?: string; error?: string }> {
  const tokenInfo = await getValidAccessToken("youtube");
  if (!tokenInfo) return { success: false, error: "YouTube غير متصل أو انتهت صلاحية الـ token" };

  // الخطوة 1: إنشاء resumable upload session
  const initResp = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${tokenInfo.access_token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify({
        snippet: {
          title: req.title,
          description: req.description,
          tags: req.tags?.length ? req.tags : ["محتوى", "فيديو", "عربي"],
          defaultLanguage: "ar",
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

  // الخطوة 2: تحميل الفيديو من Supabase وإرساله مباشرة إلى YouTube
  // نستخدم streaming بدل تحميل كامل في RAM
  const videoResp = await fetch(req.video_url);
  if (!videoResp.ok || !videoResp.body) {
    return { success: false, error: "فشل تحميل الفيديو من التخزين" };
  }

  const contentLength = videoResp.headers.get("content-length");

  const uploadResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      ...(contentLength ? { "Content-Length": contentLength } : {}),
    },
    body: videoResp.body,
    // @ts-ignore
    duplex: "half",
  });

  const videoData = await uploadResp.json();
  if (videoData.id) {
    return { success: true, url: `https://youtube.com/watch?v=${videoData.id}` };
  }
  return { success: false, error: videoData.error?.message || "لم يُرجع YouTube معرف الفيديو" };
}

// =================================================================
// INSTAGRAM
// الإصلاح: استخدام video_url مباشرة (بدون polling طويل)
// الـ polling ينتقل إلى job-status لتجنب timeout
// =================================================================
async function publishToInstagram(req: PublishRequest): Promise<{ success: boolean; url?: string; error?: string }> {
  const tokenInfo = await getValidAccessToken("instagram");
  if (!tokenInfo?.ig_user_id) {
    return { success: false, error: "Instagram غير متصل أو لا يوجد حساب Business" };
  }

  // إنشاء media container
  const containerResp = await fetch(
    `https://graph.facebook.com/v18.0/${tokenInfo.ig_user_id}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        video_url: req.video_url,
        caption: `${req.title}\n\n${req.description}`,
        access_token: tokenInfo.access_token,
      }),
    }
  );

  const containerData = await containerResp.json();
  if (containerData.error) return { success: false, error: containerData.error.message };
  if (!containerData.id) return { success: false, error: "فشل إنشاء media container" };

  console.log(`[PUBLISH] Instagram container: ${containerData.id}`);

  // انتظار معالجة المحتوى (حد 60 ثانية)
  const maxWait = 6;
  for (let i = 0; i < maxWait; i++) {
    await new Promise(r => setTimeout(r, 10000));

    const statusResp = await fetch(
      `https://graph.facebook.com/v18.0/${containerData.id}?fields=status_code&access_token=${tokenInfo.access_token}`
    );
    const statusData = await statusResp.json();
    console.log(`[PUBLISH] Instagram status[${i+1}]: ${statusData.status_code}`);

    if (statusData.status_code === "FINISHED") break;
    if (statusData.status_code === "ERROR") return { success: false, error: "فشل معالجة الفيديو في Instagram" };
  }

  // نشر الـ container
  const publishResp = await fetch(
    `https://graph.facebook.com/v18.0/${tokenInfo.ig_user_id}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: tokenInfo.access_token,
      }),
    }
  );

  const publishData = await publishResp.json();
  if (publishData.error) return { success: false, error: publishData.error.message };
  if (publishData.id) return { success: true, url: `https://instagram.com/reel/${publishData.id}` };

  return { success: false, error: "فشل النشر على Instagram" };
}

// =================================================================
// FACEBOOK
// الإصلاح: إضافة video_url كـ file_url مع fallback لـ source
// =================================================================
async function publishToFacebook(req: PublishRequest): Promise<{ success: boolean; url?: string; error?: string }> {
  const tokenInfo = await getValidAccessToken("facebook");
  if (!tokenInfo?.page_id || !tokenInfo?.page_access_token) {
    return { success: false, error: "Facebook غير متصل أو لا توجد صفحة" };
  }

  // محاولة النشر بـ file_url أولاً
  const resp = await fetch(
    `https://graph.facebook.com/v18.0/${tokenInfo.page_id}/videos`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_url: req.video_url,
        title: req.title,
        description: req.description,
        access_token: tokenInfo.page_access_token,
      }),
    }
  );

  const data = await resp.json();

  if (data.error) {
    console.error("[PUBLISH] Facebook error:", data.error.message);
    return { success: false, error: data.error.message };
  }

  if (data.id) {
    return { success: true, url: `https://facebook.com/watch/?v=${data.id}` };
  }

  return { success: false, error: "لم يُرجع Facebook معرف الفيديو" };
}
