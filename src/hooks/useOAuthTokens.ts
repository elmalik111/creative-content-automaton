import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { OAuthToken, OAuthPlatform } from '@/types/database';

export function useOAuthTokens() {
  return useQuery({
    queryKey: ['oauth-tokens'],
    queryFn: async (): Promise<OAuthToken[]> => {
      const { data, error } = await supabase
        .from('oauth_tokens')
        .select('*')
        .order('platform');

      if (error) throw error;
      return (data || []).map(token => ({
        ...token,
        platform: token.platform as OAuthPlatform,
      }));
    },
  });
}

export function useOAuthToken(platform: OAuthPlatform) {
  return useQuery({
    queryKey: ['oauth-tokens', platform],
    queryFn: async (): Promise<OAuthToken | null> => {
      const { data, error } = await supabase
        .from('oauth_tokens')
        .select('*')
        .eq('platform', platform)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      return data ? {
        ...data,
        platform: data.platform as OAuthPlatform,
      } : null;
    },
  });
}

export function useSaveOAuthToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (token: {
      platform: OAuthPlatform;
      access_token: string;
      refresh_token?: string;
      expires_at?: string;
      scope?: string;
      account_name?: string;
    }) => {
      // Deactivate existing tokens for this platform
      await supabase
        .from('oauth_tokens')
        .update({ is_active: false })
        .eq('platform', token.platform);

      // Insert new token
      const { error } = await supabase
        .from('oauth_tokens')
        .insert({
          platform: token.platform,
          access_token: token.access_token,
          refresh_token: token.refresh_token || null,
          expires_at: token.expires_at || null,
          scope: token.scope || null,
          account_name: token.account_name || null,
          is_active: true,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-tokens'] });
    },
  });
}

export function useDisconnectOAuth() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (platform: OAuthPlatform) => {
      const { error } = await supabase
        .from('oauth_tokens')
        .update({ is_active: false })
        .eq('platform', platform);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-tokens'] });
    },
  });
}
