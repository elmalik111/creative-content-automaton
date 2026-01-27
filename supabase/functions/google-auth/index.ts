import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { supabase, corsHeaders } from "../_shared/supabase.ts";

const YOUTUBE_CLIENT_ID = Deno.env.get("YOUTUBE_CLIENT_ID");
const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET");

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const redirectUri = url.searchParams.get("redirect_uri") || 
      `${url.origin.replace('/functions/v1/google-auth', '')}/auth/callback`;

    // Generate OAuth URL
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

    // Exchange code for tokens
    if (req.method === "POST") {
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
