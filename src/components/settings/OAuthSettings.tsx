import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { useOAuthTokens, useSaveOAuthToken, useDisconnectOAuth } from '@/hooks/useOAuthTokens';
import { supabase } from '@/integrations/supabase/client';
import { Youtube, Instagram, Facebook, Link2, Unlink, Loader2, Eye, EyeOff, CheckCircle2, TestTube } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AccountInfo } from './AccountInfo';
import type { OAuthPlatform } from '@/types/database';

const platforms: {
  id: OAuthPlatform;
  name: string;
  icon: React.ElementType;
  color: string;
  supportsOAuth?: boolean;
}[] = [
  { 
    id: 'youtube', 
    name: 'YouTube', 
    icon: Youtube, 
    color: 'text-red-500',
    supportsOAuth: true,
  },
  { 
    id: 'instagram', 
    name: 'Instagram', 
    icon: Instagram, 
    color: 'text-pink-500',
  },
  { 
    id: 'facebook', 
    name: 'Facebook', 
    icon: Facebook, 
    color: 'text-blue-500',
  },
];

export function OAuthSettings() {
  const { data: tokens, isLoading } = useOAuthTokens();
  const saveToken = useSaveOAuthToken();
  const disconnectOAuth = useDisconnectOAuth();
  
  const [selectedPlatform, setSelectedPlatform] = useState<OAuthPlatform | null>(null);
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [accountName, setAccountName] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Verification state
  const [verifyingPlatform, setVerifyingPlatform] = useState<OAuthPlatform | null>(null);
  const [verificationResults, setVerificationResults] = useState<Record<string, {
    valid: boolean;
    account_info?: Record<string, unknown>;
    error?: string;
  }>>({});

  // Test publish state
  const [testingPlatform, setTestingPlatform] = useState<OAuthPlatform | null>(null);

  const getToken = (platform: OAuthPlatform) => {
    return tokens?.find(t => t.platform === platform && t.is_active);
  };

  const handleGoogleOAuth = async () => {
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-auth', {
        method: 'GET',
        body: null,
        headers: {},
      });

      // For GET with query params, we need to call differently
      const response = await fetch(
        `https://cidxcujlfkrzvvmljxqs.supabase.co/functions/v1/google-auth?action=auth_url&redirect_uri=${encodeURIComponent(window.location.origin + '/auth/callback')}`,
        {
          headers: {
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ''}`,
          },
        }
      );

      const responseData = await response.json();

      if (responseData.error) {
        throw new Error(responseData.error);
      }

      // Open OAuth popup/redirect
      window.location.href = responseData.auth_url;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      toast.error(error.message);
      setIsConnecting(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedPlatform || !accessToken.trim()) {
      toast.error('Please enter an access token');
      return;
    }

    try {
      await saveToken.mutateAsync({
        platform: selectedPlatform,
        access_token: accessToken,
        refresh_token: refreshToken || undefined,
        account_name: accountName || undefined,
      });
      toast.success(`${selectedPlatform} connected successfully`);
      resetForm();
      setIsOpen(false);
      
      // Auto-verify after connection
      handleVerify(selectedPlatform);
    } catch {
      toast.error('Failed to save token');
    }
  };

  const handleDisconnect = async (platform: OAuthPlatform) => {
    try {
      await disconnectOAuth.mutateAsync(platform);
      setVerificationResults(prev => {
        const newResults = { ...prev };
        delete newResults[platform];
        return newResults;
      });
      toast.success(`${platform} disconnected`);
    } catch {
      toast.error('Failed to disconnect');
    }
  };

  const handleVerify = async (platform: OAuthPlatform) => {
    setVerifyingPlatform(platform);
    try {
      const { data, error } = await supabase.functions.invoke('verify-tokens', {
        body: { platform },
      });

      if (error) throw error;

      setVerificationResults(prev => ({
        ...prev,
        [platform]: data,
      }));

      if (data.valid) {
        toast.success(`${platform} verification successful`);
      } else {
        toast.error(data.error || 'Verification failed');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setVerificationResults(prev => ({
        ...prev,
        [platform]: { valid: false, error: error.message },
      }));
      toast.error(error.message);
    } finally {
      setVerifyingPlatform(null);
    }
  };

  const handleTestPublish = async (platform: OAuthPlatform) => {
    setTestingPlatform(platform);
    try {
      const { data, error } = await supabase.functions.invoke('test-publish', {
        body: {
          platform,
          type: 'text',
          content: '✅ Test post from Video Automation Platform - Connection verified!',
          image_url: platform === 'instagram' ? 'https://placehold.co/1080x1080/png?text=Test' : undefined,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success(`Test post published! ${data.post_url ? `View: ${data.post_url}` : ''}`);
      } else {
        toast.error(data.error || 'Test publish failed');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      toast.error(error.message);
    } finally {
      setTestingPlatform(null);
    }
  };

  const resetForm = () => {
    setAccessToken('');
    setRefreshToken('');
    setAccountName('');
    setShowToken(false);
    setSelectedPlatform(null);
  };

  const openConnectDialog = (platform: OAuthPlatform) => {
    setSelectedPlatform(platform);
    setIsOpen(true);
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Link2 className="h-5 w-5" />
          Social Platform Connections
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-14 bg-muted animate-pulse rounded" />
            <div className="h-14 bg-muted animate-pulse rounded" />
            <div className="h-14 bg-muted animate-pulse rounded" />
          </div>
        ) : (
          platforms.map((platform) => {
            const token = getToken(platform.id);
            const Icon = platform.icon;
            const verification = verificationResults[platform.id];
            
            return (
              <div
                key={platform.id}
                className="p-3 rounded-lg bg-muted/50 border border-border space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon className={`h-6 w-6 ${platform.color}`} />
                    <div>
                      <p className="font-medium text-foreground">{platform.name}</p>
                      {token?.account_name && (
                        <p className="text-xs text-muted-foreground">{token.account_name}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {token ? (
                      <>
                        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Connected
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleVerify(platform.id)}
                          disabled={verifyingPlatform === platform.id}
                        >
                          {verifyingPlatform === platform.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Verify'
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleTestPublish(platform.id)}
                          disabled={testingPlatform === platform.id}
                        >
                          {testingPlatform === platform.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <TestTube className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDisconnect(platform.id)}
                          disabled={disconnectOAuth.isPending}
                          className="text-destructive hover:text-destructive"
                        >
                          <Unlink className="h-4 w-4" />
                        </Button>
                      </>
                    ) : platform.supportsOAuth ? (
                      <Button
                        size="sm"
                        onClick={handleGoogleOAuth}
                        disabled={isConnecting}
                      >
                        {isConnecting ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : (
                          <Link2 className="h-4 w-4 mr-1" />
                        )}
                        Connect with Google
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => openConnectDialog(platform.id)}
                      >
                        <Link2 className="h-4 w-4 mr-1" />
                        Add Token
                      </Button>
                    )}
                  </div>
                </div>

                {/* Show verification results */}
                {token && verification && (
                  <AccountInfo
                    isLoading={verifyingPlatform === platform.id}
                    isVerified={verification.valid}
                    accountInfo={verification.account_info as Record<string, unknown> | undefined}
                    error={verification.error}
                    expiresAt={token.expires_at}
                  />
                )}
              </div>
            );
          })
        )}

        <Dialog open={isOpen} onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) resetForm();
        }}>
          <DialogContent className="bg-card">
            <DialogHeader>
              <DialogTitle>
                Connect {selectedPlatform ? platforms.find(p => p.id === selectedPlatform)?.name : ''}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50 border border-border text-sm text-muted-foreground">
                <p className="mb-2">Get your access token from Graph API Explorer:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Go to <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Graph API Explorer</a></li>
                  <li>Select your app and get a User Access Token</li>
                  <li>Add required permissions (pages_manage_posts, instagram_basic, etc.)</li>
                  <li>Generate and copy the token</li>
                </ol>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="account-name">Account Name (optional)</Label>
                <Input
                  id="account-name"
                  placeholder="e.g., My Page"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="bg-background"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="access-token">Access Token *</Label>
                <div className="relative">
                  <Input
                    id="access-token"
                    type={showToken ? 'text' : 'password'}
                    placeholder="Enter access token from Graph API Explorer"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    className="bg-background pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <Button 
                onClick={handleConnect} 
                disabled={saveToken.isPending || !accessToken.trim()}
                className="w-full"
              >
                {saveToken.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Connect & Verify
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
