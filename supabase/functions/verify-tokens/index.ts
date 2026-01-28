import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.1";
import { supabase, corsHeaders } from "../_shared/supabase.ts";

const YOUTUBE_CLIENT_ID = Deno.env.get("YOUTUBE_CLIENT_ID");
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET");

interface VerifyRequest {
  platform: "youtube" | "instagram" | "facebook" | "telegram" | "elevenlabs";
  token?: string; // For ElevenLabs specific key verification
}

// ===== AUTH HELPER: Require any authenticated user =====
async function validateAuth(req: Request): Promise<{ valid: boolean; error?: string }> {
  const authHeader = req.headers.get("Authorization");
  
  // Check for service role key (internal calls)
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (authHeader === `Bearer ${serviceRoleKey}`) {
    return { valid: true };
  }
  
  // Check for user JWT
  if (!authHeader?.startsWith("Bearer ")) {
    return { valid: false, error: "Authorization header required" };
  }
  
  const token = authHeader.replace("Bearer ", "");
  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  
  const { data: userData, error: userError } = await anonClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return { valid: false, error: "Invalid or expired token" };
  }
  
  return { valid: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== SECURITY: Require any authenticated user =====
    const auth = await validateAuth(req);
    if (!auth.valid) {
      return new Response(
        JSON.stringify({ error: auth.error }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

  try {
    // First try to get Instagram Business Account through Facebook Pages
    const pagesResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,instagram_business_account{id,username,name,profile_picture_url,followers_count}&access_token=${tokenData.access_token}`
    );

    const pagesData = await pagesResponse.json();

    if (pagesData.error) {
      // Fallback: Try direct user endpoint (for personal accounts)
      const userResponse = await fetch(
        `https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${tokenData.access_token}`
      );
      const userData = await userResponse.json();
      
      if (userData.error) {
        return new Response(
          JSON.stringify({ valid: false, error: userData.error.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          valid: true,
          account_info: {
            id: userData.id,
            name: userData.name,
            type: "personal",
            note: "For Instagram publishing, connect a Business/Creator account linked to a Facebook Page"
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find pages with Instagram Business Account
    const instagramAccounts = pagesData.data?.filter(
      (page: { instagram_business_account?: unknown }) => page.instagram_business_account
    ).map((page: { 
      id: string; 
      name: string;
      instagram_business_account?: { 
        id: string; 
        username?: string; 
        name?: string;
        profile_picture_url?: string;
        followers_count?: number;
      } 
    }) => ({
      page_id: page.id,
      page_name: page.name,
      instagram_id: page.instagram_business_account?.id,
      username: page.instagram_business_account?.username,
      name: page.instagram_business_account?.name,
      picture: page.instagram_business_account?.profile_picture_url,
      followers: page.instagram_business_account?.followers_count,
    })) || [];

    if (instagramAccounts.length === 0) {
      return new Response(
        JSON.stringify({ 
          valid: false, 
          error: "No Instagram Business Account found. Make sure your Instagram is connected to a Facebook Page." 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const primaryAccount = instagramAccounts[0];
    
    // Update account name
    if (primaryAccount.username && primaryAccount.username !== tokenData.account_name) {
      await supabase
        .from("oauth_tokens")
        .update({ account_name: primaryAccount.username })
        .eq("id", tokenData.id);
    }

    return new Response(
      JSON.stringify({
        valid: true,
        account_info: {
          id: primaryAccount.instagram_id,
          name: primaryAccount.name || primaryAccount.username,
          username: primaryAccount.username,
          picture: primaryAccount.picture,
          followers: primaryAccount.followers,
          page_id: primaryAccount.page_id,
          page_name: primaryAccount.page_name,
          all_accounts: instagramAccounts,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return new Response(
      JSON.stringify({ valid: false, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
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

  try {
    // First, debug the token to check permissions
    const debugResponse = await fetch(
      `https://graph.facebook.com/v18.0/debug_token?input_token=${tokenData.access_token}&access_token=${tokenData.access_token}`
    );
    const debugData = await debugResponse.json();
    console.log("Token debug info:", JSON.stringify(debugData));

    // Get user info
    const userResponse = await fetch(
      `https://graph.facebook.com/v18.0/me?fields=id,name,picture.type(large)&access_token=${tokenData.access_token}`
    );

    const userData = await userResponse.json();

    if (userData.error) {
      return new Response(
        JSON.stringify({ 
          valid: false, 
          error: userData.error.message,
          error_code: userData.error.code,
          error_type: userData.error.type
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get pages with required permissions for posting
    const pagesResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token,picture.type(large),category,fan_count&access_token=${tokenData.access_token}`
    );

    const pagesData = await pagesResponse.json();

    if (pagesData.error) {
      console.log("Pages fetch error:", pagesData.error);
    }

    const pages = pagesData.data?.map((page: { 
      id: string; 
      name: string; 
      access_token?: string;
      picture?: { data?: { url?: string } };
      category?: string;
      fan_count?: number;
    }) => ({
      id: page.id,
      name: page.name,
      picture: page.picture?.data?.url,
      category: page.category,
      fans: page.fan_count,
      has_page_token: !!page.access_token,
    })) || [];

    // Update account name if different
    if (userData.name && userData.name !== tokenData.account_name) {
      await supabase
        .from("oauth_tokens")
        .update({ account_name: userData.name })
        .eq("id", tokenData.id);
    }

    // Get permissions
    const permissionsResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/permissions?access_token=${tokenData.access_token}`
    );
    const permissionsData = await permissionsResponse.json();
    const permissions = permissionsData.data?.filter(
      (p: { status: string }) => p.status === 'granted'
    ).map((p: { permission: string }) => p.permission) || [];

    return new Response(
      JSON.stringify({
        valid: true,
        account_info: {
          id: userData.id,
          name: userData.name,
          picture: userData.picture?.data?.url,
          pages,
          permissions,
          pages_count: pages.length,
          has_publish_permission: permissions.includes('pages_manage_posts') || permissions.includes('publish_pages'),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    return new Response(
      JSON.stringify({ valid: false, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
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
