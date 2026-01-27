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

async function publishToYouTube(
  request: PublishRequest
): Promise<{ success: boolean; url?: string; error?: string }> {
  // Get stored OAuth refresh token from settings
  const { data: tokenSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "youtube_refresh_token")
    .maybeSingle();

  if (!tokenSetting?.value) {
    return { success: false, error: "YouTube not authenticated. Please connect your YouTube account." };
  }

  try {
    // Exchange refresh token for access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID!,
        client_secret: YOUTUBE_CLIENT_SECRET!,
        refresh_token: tokenSetting.value,
        grant_type: "refresh_token",
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      return { success: false, error: "Failed to refresh YouTube token" };
    }

    // Download video
    const videoResponse = await fetch(request.video_url);
    const videoBuffer = await videoResponse.arrayBuffer();

    // Upload to YouTube (resumable upload)
    const uploadResponse = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
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
      return { success: false, error: "Failed to initiate YouTube upload" };
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

    return { success: false, error: "Upload completed but no video ID received" };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { success: false, error: error.message };
  }
}

async function publishToInstagram(
  request: PublishRequest
): Promise<{ success: boolean; url?: string; error?: string }> {
  const { data: tokenSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "instagram_access_token")
    .maybeSingle();

  const { data: igIdSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "instagram_user_id")
    .maybeSingle();

  if (!tokenSetting?.value || !igIdSetting?.value) {
    return { success: false, error: "Instagram not authenticated" };
  }

  try {
    // Create media container
    const containerResponse = await fetch(
      `https://graph.facebook.com/v18.0/${igIdSetting.value}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "REELS",
          video_url: request.video_url,
          caption: `${request.title}\n\n${request.description}`,
          access_token: tokenSetting.value,
        }),
      }
    );

    const containerData = await containerResponse.json();

    if (!containerData.id) {
      return { success: false, error: "Failed to create media container" };
    }

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 30000));

    // Publish
    const publishResponse = await fetch(
      `https://graph.facebook.com/v18.0/${igIdSetting.value}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: containerData.id,
          access_token: tokenSetting.value,
        }),
      }
    );

    const publishData = await publishResponse.json();

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
  const { data: tokenSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "facebook_access_token")
    .maybeSingle();

  const { data: pageIdSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "facebook_page_id")
    .maybeSingle();

  if (!tokenSetting?.value || !pageIdSetting?.value) {
    return { success: false, error: "Facebook not authenticated" };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pageIdSetting.value}/videos`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_url: request.video_url,
          title: request.title,
          description: request.description,
          access_token: tokenSetting.value,
        }),
      }
    );

    const data = await response.json();

    if (data.id) {
      return {
        success: true,
        url: `https://facebook.com/${data.id}`,
      };
    }

    return { success: false, error: data.error?.message || "Upload failed" };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return { success: false, error: error.message };
  }
}
