import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";

interface TestPublishRequest {
  platform: "youtube" | "instagram" | "facebook";
  type: "text" | "image";
  content: string;
  image_url?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: TestPublishRequest = await req.json();
    const { platform, type, content, image_url } = body;

    let result: { success: boolean; post_url?: string; error?: string };

    switch (platform) {
      case "youtube":
        result = await testYouTubePost(content);
        break;
      case "facebook":
        result = await testFacebookPost(content, type === "image" ? image_url : undefined);
        break;
      case "instagram":
        result = await testInstagramPost(content, image_url);
        break;
      default:
        return new Response(
          JSON.stringify({ success: false, error: "Invalid platform" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Test publish error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function testYouTubePost(content: string): Promise<{ success: boolean; post_url?: string; error?: string }> {
  const { data: tokenData } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("platform", "youtube")
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenData) {
    return { success: false, error: "YouTube not connected" };
  }

  // YouTube doesn't have a simple text post API for regular channels
  // Community posts require specific channel eligibility (1000+ subscribers)
  // Instead, we'll verify the connection by getting channel info
  
  const channelResponse = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    }
  );

  const channelData = await channelResponse.json();

  if (channelData.error) {
    return { success: false, error: channelData.error.message };
  }

  const channel = channelData.items?.[0];

  if (channel) {
    return { 
      success: true, 
      post_url: `https://youtube.com/channel/${channel.id}`,
      error: "Note: Community posts require 500+ subscribers. Connection verified successfully."
    };
  }

  return { success: false, error: "No channel found" };
}

async function testFacebookPost(
  content: string, 
  imageUrl?: string
): Promise<{ success: boolean; post_url?: string; error?: string }> {
  const { data: tokenData } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("platform", "facebook")
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenData) {
    return { success: false, error: "Facebook not connected" };
  }

  // Get page access token (first available page)
  const pagesResponse = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token=${tokenData.access_token}`
  );

  const pagesData = await pagesResponse.json();

  if (pagesData.error) {
    return { success: false, error: pagesData.error.message };
  }

  const page = pagesData.data?.[0];

  if (!page) {
    return { success: false, error: "No Facebook page found. Please connect a page." };
  }

  // Post to the page
  const postEndpoint = imageUrl 
    ? `https://graph.facebook.com/v18.0/${page.id}/photos`
    : `https://graph.facebook.com/v18.0/${page.id}/feed`;

  const postBody: Record<string, string> = {
    access_token: page.access_token,
  };

  if (imageUrl) {
    postBody.url = imageUrl;
    postBody.caption = content;
  } else {
    postBody.message = content;
  }

  const postResponse = await fetch(postEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(postBody),
  });

  const postData = await postResponse.json();

  if (postData.error) {
    return { success: false, error: postData.error.message };
  }

  const postId = postData.id || postData.post_id;

  return { 
    success: true, 
    post_url: `https://facebook.com/${postId}` 
  };
}

async function testInstagramPost(
  content: string, 
  imageUrl?: string
): Promise<{ success: boolean; post_url?: string; error?: string }> {
  const { data: tokenData } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("platform", "instagram")
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenData) {
    return { success: false, error: "Instagram not connected" };
  }

  if (!imageUrl) {
    return { success: false, error: "Instagram requires an image. Please provide image_url." };
  }

  // Get Instagram Business Account ID
  // First, get Facebook pages
  const pagesResponse = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?fields=id,instagram_business_account&access_token=${tokenData.access_token}`
  );

  const pagesData = await pagesResponse.json();

  if (pagesData.error) {
    return { success: false, error: pagesData.error.message };
  }

  // Find page with Instagram business account
  const pageWithIG = pagesData.data?.find(
    (page: { instagram_business_account?: { id: string } }) => page.instagram_business_account
  );

  if (!pageWithIG) {
    return { success: false, error: "No Instagram Business Account found. Please connect your Instagram to a Facebook Page." };
  }

  const igAccountId = pageWithIG.instagram_business_account.id;

  // Create media container
  const containerResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: content,
        access_token: tokenData.access_token,
      }),
    }
  );

  const containerData = await containerResponse.json();

  if (containerData.error) {
    return { success: false, error: containerData.error.message };
  }

  // Publish the container
  const publishResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerData.id,
        access_token: tokenData.access_token,
      }),
    }
  );

  const publishData = await publishResponse.json();

  if (publishData.error) {
    return { success: false, error: publishData.error.message };
  }

  return { 
    success: true, 
    post_url: `https://instagram.com/p/${publishData.id}` 
  };
}
