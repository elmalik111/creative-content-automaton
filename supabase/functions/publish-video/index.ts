import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";

interface PublishRequest {
  job_id: string;
  video_url: string;
  title: string;
  description: string;
  platforms: ("youtube" | "instagram" | "facebook")[];
}

const YOUTUBE_CLIENT_ID = Deno.env.get("YOUTUBE_CLIENT_ID");
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== SECURITY: Require Service Role Key or Valid JWT =====
    const authHeader = req.headers.get("Authorization");
    
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    // Allow service role key (internal calls) or validate JWT
    if (token !== serviceRoleKey) {
      // Validate as user JWT
      const { data, error: authError } = await supabase.auth.getUser(token);
      
      if (authError || !data.user) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      // Check if user is admin
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user.id)
        .eq("role", "admin")
        .maybeSingle();
      
      if (!roleData) {
        return new Response(
          JSON.stringify({ error: "Admin access required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const body: PublishRequest = await req.json();

    const results: Record<string, { success: boolean; url?: string; error?: string }> = {};

    // Publish to each platform
    for (const platform of body.platforms) {
      try {
        switch (platform) {
          case "youtube":
            results.youtube = await publishToYouTube(body);
            break;
          case "instagram":
            results.instagram = await publishToInstagram(body);
            break;
          case "facebook":
            results.facebook = await publishToFacebook(body);
            break;
        }
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        results[platform] = { success: false, error: e.message };
      }
    }

    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Publish error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function getValidAccessToken(platform: string): Promise<{ access_token: string; page_access_token?: string; page_id?: string; ig_user_id?: string } | null> {
  const { data: tokenData } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("platform", platform)
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenData) return null;

  let accessToken = tokenData.access_token;

  // Check if token is expired and needs refresh (only for YouTube)
  if (platform === "youtube" && tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
    if (!tokenData.refresh_token || !YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
      return null;
    }

    // Refresh the token
    const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: tokenData.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    const refreshData = await refreshResponse.json();

    if (refreshData.error) {
      console.error("Token refresh failed:", refreshData.error);
      return null;
    }

    // Update token in database
    const expiresAt = refreshData.expires_in 
      ? new Date(Date.now() + refreshData.expires_in * 1000).toISOString()
      : null;

    await supabase
      .from("oauth_tokens")
      .update({ 
        access_token: refreshData.access_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq("id", tokenData.id);

    accessToken = refreshData.access_token;
  }

  // For Facebook, get page access token
  if (platform === "facebook") {
    const pagesResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token=${accessToken}`
    );
    const pagesData = await pagesResponse.json();
    const page = pagesData.data?.[0];
    
    if (page) {
      return { 
        access_token: accessToken, 
        page_access_token: page.access_token,
        page_id: page.id 
      };
    }
  }

  // For Instagram, get IG user ID
  if (platform === "instagram") {
    const pagesResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,instagram_business_account&access_token=${accessToken}`
    );
    const pagesData = await pagesResponse.json();
    const pageWithIG = pagesData.data?.find(
      (page: { instagram_business_account?: { id: string } }) => page.instagram_business_account
    );
    
    if (pageWithIG) {
      return { 
        access_token: accessToken,
        ig_user_id: pageWithIG.instagram_business_account.id 
      };
    }
  }

  return { access_token: accessToken };
}

async function publishToYouTube(
  request: PublishRequest
): Promise<{ success: boolean; url?: string; error?: string }> {
  const tokenInfo = await getValidAccessToken("youtube");

  if (!tokenInfo) {
    return { success: false, error: "YouTube not authenticated or token expired" };
  }

  try {
    // Download video
    const videoResponse = await fetch(request.video_url);
    const videoBuffer = await videoResponse.arrayBuffer();

    // Upload to YouTube (resumable upload)
    const uploadResponse = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenInfo.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          snippet: {
            title: request.title,
            description: request.description,
            tags: ["automation", "ai"],
          },
          status: {
            privacyStatus: "public",
          },
        }),
      }
    );

    const uploadUrl = uploadResponse.headers.get("Location");

    if (!uploadUrl) {
      const errorData = await uploadResponse.json();
      return { success: false, error: errorData.error?.message || "Failed to initiate YouTube upload" };
    }

    // Upload the actual video
    const finalResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
      },
      body: videoBuffer,
    });

    const videoData = await finalResponse.json();

    if (videoData.id) {
      return {
        success: true,
        url: `https://youtube.com/watch?v=${videoData.id}`,
      };
    }

    return { success: false, error: videoData.error?.message || "Upload completed but no video ID received" };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { success: false, error: error.message };
  }
}

async function publishToInstagram(
  request: PublishRequest
): Promise<{ success: boolean; url?: string; error?: string }> {
  const tokenInfo = await getValidAccessToken("instagram");

  if (!tokenInfo?.ig_user_id) {
    return { success: false, error: "Instagram not authenticated or no business account linked" };
  }

  try {
    // Create media container
    const containerResponse = await fetch(
      `https://graph.facebook.com/v18.0/${tokenInfo.ig_user_id}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "REELS",
          video_url: request.video_url,
          caption: `${request.title}\n\n${request.description}`,
          access_token: tokenInfo.access_token,
        }),
      }
    );

    const containerData = await containerResponse.json();

    if (containerData.error) {
      return { success: false, error: containerData.error.message };
    }

    if (!containerData.id) {
      return { success: false, error: "Failed to create media container" };
    }

    // Wait for processing (poll status)
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      
      const statusResponse = await fetch(
        `https://graph.facebook.com/v18.0/${containerData.id}?fields=status_code&access_token=${tokenInfo.access_token}`
      );
      const statusData = await statusResponse.json();
      
      if (statusData.status_code === "FINISHED") break;
      if (statusData.status_code === "ERROR") {
        return { success: false, error: "Media processing failed" };
      }
      
      attempts++;
    }

    // Publish
    const publishResponse = await fetch(
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

    const publishData = await publishResponse.json();

    if (publishData.error) {
      return { success: false, error: publishData.error.message };
    }

    if (publishData.id) {
      return {
        success: true,
        url: `https://instagram.com/reel/${publishData.id}`,
      };
    }

    return { success: false, error: "Publish failed" };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { success: false, error: error.message };
  }
}

async function publishToFacebook(
  request: PublishRequest
): Promise<{ success: boolean; url?: string; error?: string }> {
  const tokenInfo = await getValidAccessToken("facebook");

  if (!tokenInfo?.page_id || !tokenInfo?.page_access_token) {
    return { success: false, error: "Facebook not authenticated or no page linked" };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${tokenInfo.page_id}/videos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_url: request.video_url,
          title: request.title,
          description: request.description,
          access_token: tokenInfo.page_access_token,
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    if (data.id) {
      return {
        success: true,
        url: `https://facebook.com/${data.id}`,
      };
    }

    return { success: false, error: "Upload failed" };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { success: false, error: error.message };
  }
}
