import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { useOAuthTokens, useSaveOAuthToken, useDisconnectOAuth } from '@/hooks/useOAuthTokens';
import { Youtube, Instagram, Facebook, Link2, Unlink, Loader2, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { OAuthPlatform } from '@/types/database';

const platforms: {
  id: OAuthPlatform;
  name: string;
  icon: React.ElementType;
  color: string;
  authUrl?: string;
}[] = [
  { 
    id: 'youtube', 
    name: 'YouTube', 
    icon: Youtube, 
    color: 'text-red-500',
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

  const getToken = (platform: OAuthPlatform) => {
    return tokens?.find(t => t.platform === platform && t.is_active);
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
    } catch {
      toast.error('Failed to save token');
    }
  };

  const handleDisconnect = async (platform: OAuthPlatform) => {
    try {
      await disconnectOAuth.mutateAsync(platform);
      toast.success(`${platform} disconnected`);
    } catch {
      toast.error('Failed to disconnect');
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
            
            return (
              <div
                key={platform.id}
                className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border"
              >
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
                      <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
                        Connected
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDisconnect(platform.id)}
                        disabled={disconnectOAuth.isPending}
                        className="text-destructive hover:text-destructive"
                      >
                        <Unlink className="h-4 w-4 mr-1" />
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => openConnectDialog(platform.id)}
                    >
                      <Link2 className="h-4 w-4 mr-1" />
                      Connect
                    </Button>
                  )}
                </div>
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
                <p className="mb-2">To get your access token:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  {selectedPlatform === 'youtube' && (
                    <>
                      <li>Go to Google Cloud Console</li>
                      <li>Enable YouTube Data API v3</li>
                      <li>Create OAuth 2.0 credentials</li>
                      <li>Use OAuth Playground to get tokens</li>
                    </>
                  )}
                  {(selectedPlatform === 'instagram' || selectedPlatform === 'facebook') && (
                    <>
                      <li>Go to Meta Developer Portal</li>
                      <li>Create or select your app</li>
                      <li>Get a long-lived access token</li>
                      <li>Paste it below</li>
                    </>
                  )}
                </ol>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="account-name">Account Name (optional)</Label>
                <Input
                  id="account-name"
                  placeholder="e.g., My Channel"
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
                    placeholder="Enter access token"
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

              {selectedPlatform === 'youtube' && (
                <div className="space-y-2">
                  <Label htmlFor="refresh-token">Refresh Token (optional)</Label>
                  <Input
                    id="refresh-token"
                    type="password"
                    placeholder="Enter refresh token"
                    value={refreshToken}
                    onChange={(e) => setRefreshToken(e.target.value)}
                    className="bg-background"
                  />
                </div>
              )}

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
                Connect
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
