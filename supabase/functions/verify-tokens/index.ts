import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";

const YOUTUBE_CLIENT_ID = Deno.env.get("YOUTUBE_CLIENT_ID");
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET");

interface VerifyRequest {
  platform: "youtube" | "instagram" | "facebook" | "telegram" | "elevenlabs";
  token?: string; // For ElevenLabs specific key verification
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: VerifyRequest = await req.json();
    const { platform, token } = body;

    switch (platform) {
      case "youtube":
        return await verifyYouTube();
      case "instagram":
        return await verifyInstagram();
      case "facebook":
        return await verifyFacebook();
      case "telegram":
        return await verifyTelegram();
      case "elevenlabs":
        return await verifyElevenLabs(token);
      default:
        return new Response(
          JSON.stringify({ error: "Invalid platform" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Verify tokens error:", error);
    return new Response(
      JSON.stringify({ valid: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function verifyYouTube(): Promise<Response> {
  // Get stored token
  const { data: tokenData } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("platform", "youtube")
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenData) {
    return new Response(
      JSON.stringify({ valid: false, error: "No YouTube token found" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let accessToken = tokenData.access_token;

  // Check if token is expired and refresh if needed
  if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
    if (!tokenData.refresh_token || !YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
      return new Response(
        JSON.stringify({ valid: false, error: "Token expired and cannot refresh" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
      return new Response(
        JSON.stringify({ valid: false, error: "Token refresh failed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

  // Verify by getting channel info
  const channelResponse = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const channelData = await channelResponse.json();

  if (channelData.error) {
    return new Response(
      JSON.stringify({ valid: false, error: channelData.error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const channel = channelData.items?.[0];

  if (!channel) {
    return new Response(
      JSON.stringify({ valid: false, error: "No channel found" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      valid: true,
      account_info: {
        id: channel.id,
        name: channel.snippet?.title,
        picture: channel.snippet?.thumbnails?.default?.url,
        subscribers: channel.statistics?.subscriberCount,
        channel: {
          id: channel.id,
          title: channel.snippet?.title,
        },
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function verifyInstagram(): Promise<Response> {
  const { data: tokenData } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("platform", "instagram")
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenData) {
    return new Response(
      JSON.stringify({ valid: false, error: "No Instagram token found" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Verify by getting user info from Graph API
  const userResponse = await fetch(
    `https://graph.facebook.com/v18.0/me?fields=id,username,name,account_type&access_token=${tokenData.access_token}`
  );

  const userData = await userResponse.json();

  if (userData.error) {
    return new Response(
      JSON.stringify({ valid: false, error: userData.error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Update account name if different
  if (userData.username && userData.username !== tokenData.account_name) {
    await supabase
      .from("oauth_tokens")
      .update({ account_name: userData.username })
      .eq("id", tokenData.id);
  }

  return new Response(
    JSON.stringify({
      valid: true,
      account_info: {
        id: userData.id,
        name: userData.name || userData.username,
        username: userData.username,
        account_type: userData.account_type,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function verifyFacebook(): Promise<Response> {
  const { data: tokenData } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("platform", "facebook")
    .eq("is_active", true)
    .maybeSingle();

  if (!tokenData) {
    return new Response(
      JSON.stringify({ valid: false, error: "No Facebook token found" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get user info and pages
  const userResponse = await fetch(
    `https://graph.facebook.com/v18.0/me?fields=id,name,picture&access_token=${tokenData.access_token}`
  );

  const userData = await userResponse.json();

  if (userData.error) {
    return new Response(
      JSON.stringify({ valid: false, error: userData.error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Get pages
  const pagesResponse = await fetch(
    `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,picture&access_token=${tokenData.access_token}`
  );

  const pagesData = await pagesResponse.json();

  const pages = pagesData.data?.map((page: { id: string; name: string; picture?: { data?: { url?: string } } }) => ({
    id: page.id,
    name: page.name,
    picture: page.picture?.data?.url,
  })) || [];

  // Update account name if different
  if (userData.name && userData.name !== tokenData.account_name) {
    await supabase
      .from("oauth_tokens")
      .update({ account_name: userData.name })
      .eq("id", tokenData.id);
  }

  return new Response(
    JSON.stringify({
      valid: true,
      account_info: {
        id: userData.id,
        name: userData.name,
        picture: userData.picture?.data?.url,
        pages,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function verifyTelegram(): Promise<Response> {
  const { data: tokenSetting } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "telegram_token")
    .maybeSingle();

  if (!tokenSetting?.value) {
    return new Response(
      JSON.stringify({ valid: false, error: "No Telegram token found" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Verify by calling getMe
  const botResponse = await fetch(
    `https://api.telegram.org/bot${tokenSetting.value}/getMe`
  );

  const botData = await botResponse.json();

  if (!botData.ok) {
    return new Response(
      JSON.stringify({ valid: false, error: botData.description || "Invalid token" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const bot = botData.result;

  return new Response(
    JSON.stringify({
      valid: true,
      account_info: {
        id: bot.id,
        name: bot.first_name,
        username: bot.username,
        can_read_messages: bot.can_read_all_group_messages,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

async function verifyElevenLabs(specificKey?: string): Promise<Response> {
  let apiKey = specificKey;

  if (!apiKey) {
    // Get first active key
    const { data: keyData } = await supabase
      .from("elevenlabs_keys")
      .select("api_key")
      .eq("is_active", true)
      .order("usage_count", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!keyData) {
      return new Response(
        JSON.stringify({ valid: false, error: "No ElevenLabs key found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    apiKey = keyData.api_key;
  }

  // Verify by getting user info
  const userResponse = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": apiKey! },
  });

  if (!userResponse.ok) {
    return new Response(
      JSON.stringify({ valid: false, error: "Invalid API key" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const userData = await userResponse.json();

  return new Response(
    JSON.stringify({
      valid: true,
      account_info: {
        id: userData.user_id,
        name: userData.first_name || userData.user_id,
        subscription: userData.subscription?.tier,
        character_count: userData.subscription?.character_count,
        character_limit: userData.subscription?.character_limit,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
