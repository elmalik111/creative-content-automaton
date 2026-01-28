import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.1";
import { supabase, corsHeaders } from "../_shared/supabase.ts";

const YOUTUBE_CLIENT_ID = Deno.env.get("YOUTUBE_CLIENT_ID");
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET");

// ===== AUTH HELPER: Require admin role for POST =====
async function validateAdminAuth(req: Request): Promise<{ valid: boolean; error?: string }> {
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
  
  // Check admin role using service role client
  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .eq("role", "admin")
    .maybeSingle();
  
  if (!roleData) {
    return { valid: false, error: "Admin access required" };
  }
  
  return { valid: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const redirectUri = url.searchParams.get("redirect_uri") || 
      `${url.origin.replace('/functions/v1/google-auth', '')}/auth/callback`;

    // Generate OAuth URL (public - no auth needed)
    if (req.method === "GET" && action === "auth_url") {
      if (!YOUTUBE_CLIENT_ID) {
        return new Response(
          JSON.stringify({ error: "YouTube client ID not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const scopes = [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube.force-ssl"
      ];

      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", YOUTUBE_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", scopes.join(" "));
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");

      return new Response(
        JSON.stringify({ auth_url: authUrl.toString(), redirect_uri: redirectUri }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Exchange code for tokens (requires admin auth)
    if (req.method === "POST") {
      // ===== SECURITY: Require admin for token exchange =====
      const auth = await validateAdminAuth(req);
      if (!auth.valid) {
        return new Response(
          JSON.stringify({ error: auth.error }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const body = await req.json();
      const { code, redirect_uri } = body;

      if (!code) {
        return new Response(
          JSON.stringify({ error: "Authorization code required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
        return new Response(
          JSON.stringify({ error: "YouTube credentials not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Exchange code for tokens
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: YOUTUBE_CLIENT_ID,
          client_secret: YOUTUBE_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirect_uri || redirectUri,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.error) {
        return new Response(
          JSON.stringify({ error: tokenData.error_description || tokenData.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get channel info
      const channelResponse = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        }
      );

      const channelData = await channelResponse.json();
      const channel = channelData.items?.[0];
      const channelName = channel?.snippet?.title || "Unknown Channel";
      const channelId = channel?.id || "";

      // Calculate expiration
      const expiresAt = tokenData.expires_in 
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null;

      // Deactivate existing YouTube tokens
      await supabase
        .from("oauth_tokens")
        .update({ is_active: false })
        .eq("platform", "youtube");

      // Save new token
      const { error: saveError } = await supabase
        .from("oauth_tokens")
        .insert({
          platform: "youtube",
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || null,
          expires_at: expiresAt,
          scope: tokenData.scope || null,
          account_name: channelName,
          is_active: true,
        });

      if (saveError) {
        console.error("Error saving token:", saveError);
        return new Response(
          JSON.stringify({ error: "Failed to save token" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          channel: {
            id: channelId,
            name: channelName,
            picture: channel?.snippet?.thumbnails?.default?.url,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("Google Auth error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
