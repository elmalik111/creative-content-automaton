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
  youtube_type?: "shorts" | "long"; // اختياري
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
    await supabase.from("job_steps")
      .update({ output_data: { publish_results: results } })
      .eq("job_id", body.job_id)
      .eq("step_name", "publishing");

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
// TOKEN HELPER — يقرأ الـ token مباشرة بدون /me/accounts
// =================================================================
async function getToken(platform: string): Promise<string | null> {
  const { data } = await supabase
    .from("oauth_tokens")
    .select("access_token, refresh_token, expires_at, id")
    .eq("platform", platform)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  // YouTube: تحديث token منتهي الصلاحية
  if (platform === "youtube" && data.expires_at && new Date(data.expires_at) < new Date()) {
    if (!data.refresh_token || !YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) return null;

    const refreshResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    const refreshData = await refreshResp.json();
    if (refreshData.error) {
      console.error("[PUBLISH] YouTube token refresh failed:", refreshData.error);
      return null;
    }

    const expiresAt = refreshData.expires_in
      ? new Date(Date.now() + refreshData.expires_in * 1000).toISOString() : null;

    await supabase.from("oauth_tokens")
      .update({ access_token: refreshData.access_token, expires_at: expiresAt })
      .eq("id", data.id);

    return refreshData.access_token;
  }

  return data.access_token;
}

// Instagram: جلب ig_user_id من الـ token مباشرة
async function getInstagramUserId(accessToken: string): Promise<string | null> {
  // جرب /me أولاً
  const r = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,instagram_business_account&access_token=${accessToken}`);
  const d = await r.json();

  if (d.instagram_business_account?.id) return d.instagram_business_account.id;

  // جرب كـ Instagram Business token مباشرة
  const r2 = await fetch(`https://graph.facebook.com/v18.0/me?access_token=${accessToken}`);
  const d2 = await r2.json();
  console.log("[PUBLISH] Instagram /me:", JSON.stringify(d2).slice(0, 200));

  // إذا كان الـ id موجود مباشرة (Instagram token)
  if (d2.id) return d2.id;

  return null;
}

// =================================================================
// YOUTUBE
// =================================================================
async function publishToYouTube(req: PublishRequest): Promise<{ success: boolean; url?: string; error?: string }> {
  const accessToken = await getToken("youtube");
  if (!accessToken) return { success: false, error: "YouTube غير متصل أو انتهت صلاحية الـ token" };

  const isShorts = req.youtube_type === "shorts";

  // Shorts: يحتاج #Shorts في العنوان أو الوصف
  const title = isShorts
    ? (req.title.includes("#Shorts") ? req.title : req.title + " #Shorts")
    : req.title;

  const categoryId = "27"; // Education — مناسب للمحتوى التاريخي

  // الخطوة 1: إنشاء resumable upload session
  const initResp = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify({
        snippet: {
          title,
          description: req.description,
          tags: req.tags?.length ? req.tags : ["محتوى", "فيديو", "عربي"],
          defaultLanguage: "ar",
          categoryId,
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

  // الخطوة 2: رفع الفيديو بـ streaming
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
    const url = isShorts
      ? `https://youtube.com/shorts/${videoData.id}`
      : `https://youtube.com/watch?v=${videoData.id}`;
    return { success: true, url };
  }
  return { success: false, error: videoData.error?.message || "لم يُرجع YouTube معرف الفيديو" };
}

// =================================================================
// INSTAGRAM
// =================================================================
async function publishToInstagram(req: PublishRequest): Promise<{ success: boolean; url?: string; error?: string }> {
  const accessToken = await getToken("instagram");
  if (!accessToken) return { success: false, error: "Instagram غير متصل" };

  const igUserId = await getInstagramUserId(accessToken);
  if (!igUserId) return { success: false, error: "Instagram: لم يتم العثور على حساب Business" };

  console.log(`[PUBLISH] Instagram ig_user_id: ${igUserId}`);

  // إنشاء media container
  const containerResp = await fetch(
    `https://graph.facebook.com/v18.0/${igUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "REELS",
        video_url: req.video_url,
        caption: `${req.title}\n\n${req.description}`,
        access_token: accessToken,
      }),
    }
  );

  const containerData = await containerResp.json();
  if (containerData.error) return { success: false, error: containerData.error.message };
  if (!containerData.id) return { success: false, error: "فشل إنشاء media container" };

  console.log(`[PUBLISH] Instagram container: ${containerData.id}`);

  // انتظار معالجة المحتوى (حد 60 ثانية)
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 10000));

    const statusResp = await fetch(
      `https://graph.facebook.com/v18.0/${containerData.id}?fields=status_code&access_token=${accessToken}`
    );
    const statusData = await statusResp.json();
    console.log(`[PUBLISH] Instagram status[${i+1}]: ${statusData.status_code}`);

    if (statusData.status_code === "FINISHED") break;
    if (statusData.status_code === "ERROR") return { success: false, error: "فشل معالجة الفيديو في Instagram" };
  }

  // نشر الـ container
  const publishResp = await fetch(
    `https://graph.facebook.com/v18.0/${igUserId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: accessToken,
      }),
    }
  );

  const publishData = await publishResp.json();
  if (publishData.error) return { success: false, error: publishData.error.message };
  if (publishData.id) return { success: true, url: `https://instagram.com/reel/${publishData.id}` };

  return { success: false, error: "فشل النشر على Instagram" };
}

// =================================================================
// FACEBOOK — يستخدم الـ Page token مباشرة
// =================================================================
async function publishToFacebook(req: PublishRequest): Promise<{ success: boolean; url?: string; error?: string }> {
  const accessToken = await getToken("facebook");
  if (!accessToken) return { success: false, error: "Facebook غير متصل" };

  // جلب Page ID من /me
  const meResp = await fetch(`https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${accessToken}`);
  const meData = await meResp.json();

  if (meData.error) {
    console.error("[PUBLISH] Facebook /me error:", meData.error.message);
    return { success: false, error: meData.error.message };
  }

  const pageId = meData.id;
  console.log(`[PUBLISH] Facebook Page ID: ${pageId} (${meData.name})`);

  // نشر الفيديو على الصفحة
  const resp = await fetch(
    `https://graph.facebook.com/v18.0/${pageId}/videos`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_url: req.video_url,
        title: req.title,
        description: req.description,
        access_token: accessToken,
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
