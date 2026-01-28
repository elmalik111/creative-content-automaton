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
    // ===== SECURITY: Require any authenticated user =====
    const authHeader = req.headers.get("Authorization");
    
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !data.user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

  console.log("Testing Facebook connection with token...");

  // Get page access token (first available page)
  const pagesResponse = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token=${tokenData.access_token}`
  );

  const pagesData = await pagesResponse.json();
  console.log("Pages response:", JSON.stringify(pagesData));

  if (pagesData.error) {
    return { success: false, error: `Facebook API: ${pagesData.error.message}` };
  }

  const page = pagesData.data?.[0];

  if (!page) {
    return { success: false, error: "No Facebook page found. Please connect a page with pages_manage_posts permission." };
  }

  console.log(`Posting to page: ${page.name} (${page.id})`);

  // Simple text post to the page
  const postResponse = await fetch(
    `https://graph.facebook.com/v18.0/${page.id}/feed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        message: content,
        access_token: page.access_token,
      }),
    }
  );

  const postData = await postResponse.json();
  console.log("Post response:", JSON.stringify(postData));

  if (postData.error) {
    return { success: false, error: `Post failed: ${postData.error.message}` };
  }

  const postId = postData.id;

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

  // Use a real public *direct* image URL if not provided (IG is picky about content-type/redirects)
  const testImageUrl =
    imageUrl ||
    "https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg";

  console.log("Testing Instagram with image:", testImageUrl);

  // Get Instagram Business Account ID via Facebook pages
  const pagesResponse = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,instagram_business_account{id,username}&access_token=${tokenData.access_token}`
  );

  const pagesData = await pagesResponse.json();
  console.log("Pages with IG:", JSON.stringify(pagesData));

  if (pagesData.error) {
    return { success: false, error: `Facebook API: ${pagesData.error.message}` };
  }

  // Find page with Instagram business account
  const pageWithIG = pagesData.data?.find(
    (page: { instagram_business_account?: { id: string } }) => page.instagram_business_account
  );

  if (!pageWithIG) {
    return { 
      success: false, 
      error: "No Instagram Business Account found. Make sure your Instagram is linked to a Facebook Page and you have instagram_basic + instagram_content_publish permissions." 
    };
  }

  const igAccountId = pageWithIG.instagram_business_account.id;
  console.log(`Using IG account: ${igAccountId}`);

  // Create media container
  const containerResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        image_url: testImageUrl,
        caption: content,
        access_token: tokenData.access_token,
      }),
    }
  );

  const containerData = await containerResponse.json();
  console.log("Container response:", JSON.stringify(containerData));

  if (containerData.error) {
    return { success: false, error: `Container creation failed: ${containerData.error.message}` };
  }

  // Wait a moment for the container to be ready
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Publish the container
  const publishResponse = await fetch(
    `https://graph.facebook.com/v18.0/${igAccountId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        creation_id: containerData.id,
        access_token: tokenData.access_token,
      }),
    }
  );

  const publishData = await publishResponse.json();
  console.log("Publish response:", JSON.stringify(publishData));

  if (publishData.error) {
    return { success: false, error: `Publish failed: ${publishData.error.message}` };
  }

  // Get permalink
  const mediaResponse = await fetch(
    `https://graph.facebook.com/v18.0/${publishData.id}?fields=permalink&access_token=${tokenData.access_token}`
  );
  const mediaData = await mediaResponse.json();

  return { 
    success: true, 
    post_url: mediaData.permalink || `https://instagram.com` 
  };
}
