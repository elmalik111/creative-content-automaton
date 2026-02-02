import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSetting, useUpdateSetting } from '@/hooks/useSettings';
import { supabase } from '@/integrations/supabase/client';
import { Bot, Save, Loader2, Eye, EyeOff, CheckCircle2, XCircle, Copy, Webhook, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function TelegramSettings() {
  const { data: telegramToken, isLoading } = useSetting('telegram_token');
  const updateSetting = useUpdateSetting();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRegisteringWebhook, setIsRegisteringWebhook] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{
    registered: boolean;
    url?: string;
    error?: string;
  } | null>(null);
  const [botInfo, setBotInfo] = useState<{
    valid: boolean;
    name?: string;
    username?: string;
    error?: string;
  } | null>(null);

  const webhookUrl = `https://cidxcujlfkrzvvmljxqs.supabase.co/functions/v1/telegram-webhook`;

  useEffect(() => {
    if (telegramToken) {
      setToken(telegramToken);
    }
  }, [telegramToken]);

  const handleSave = async () => {
    try {
      await updateSetting.mutateAsync({ key: 'telegram_token', value: token });
      toast.success('Telegram token saved successfully');
      // Auto-verify after save
      handleVerify();
    } catch {
      toast.error('Failed to save Telegram token');
    }
  };

  const handleVerify = async () => {
    if (!token) {
      toast.error('Please enter a token first');
      return;
    }

    setIsVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-tokens', {
        body: { platform: 'telegram' },
      });

      if (error) throw error;

      setBotInfo({
        valid: data.valid,
        name: data.account_info?.name,
        username: data.account_info?.username,
        error: data.error,
      });

      if (data.valid) {
        toast.success('Telegram bot verified successfully');
      } else {
        toast.error(data.error || 'Verification failed');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setBotInfo({ valid: false, error: error.message });
      toast.error(error.message);
    } finally {
      setIsVerifying(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied!');
  };

  const handleRegisterWebhook = async () => {
    if (!token) {
      toast.error('Please save a bot token first');
      return;
    }

    setIsRegisteringWebhook(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-tokens', {
        body: { platform: 'telegram', action: 'register_webhook' },
      });

      if (error) throw error;

      if (data.webhook_registered) {
        setWebhookStatus({
          registered: true,
          url: data.webhook_url,
        });
        toast.success('Webhook registered successfully! Your bot is now ready to receive commands.');
      } else {
        setWebhookStatus({
          registered: false,
          error: data.error || 'Failed to register webhook',
        });
        toast.error(data.error || 'Failed to register webhook');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setWebhookStatus({ registered: false, error: error.message });
      toast.error(error.message);
    } finally {
      setIsRegisteringWebhook(false);
    }
  };

  const handleCheckWebhook = async () => {
    if (!token) return;

    try {
      const { data, error } = await supabase.functions.invoke('verify-tokens', {
        body: { platform: 'telegram', action: 'check_webhook' },
      });

      if (error) throw error;

      if (data.webhook_info) {
        setWebhookStatus({
          registered: !!data.webhook_info.url,
          url: data.webhook_info.url,
        });
      }
    } catch {
      // Silently fail for check
    }
  };

  // Check webhook status on load
  useEffect(() => {
    if (telegramToken) {
      handleCheckWebhook();
    }
  }, [telegramToken]);

  const maskedToken = token ? `${token.slice(0, 8)}${'•'.repeat(Math.max(0, token.length - 12))}${token.slice(-4)}` : '';

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Bot className="h-5 w-5" />
          Telegram Bot
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={showToken ? 'text' : 'password'}
              placeholder="Enter your Telegram bot token"
              value={showToken ? token : (token ? maskedToken : '')}
              onChange={(e) => setToken(e.target.value)}
              disabled={isLoading}
              className="pr-10 bg-background border-input"
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
          <Button 
            onClick={handleSave} 
            disabled={updateSetting.isPending || !token}
          >
            {updateSetting.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
          <Button 
            variant="outline"
            onClick={handleVerify} 
            disabled={isVerifying || !token}
          >
            {isVerifying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Verify'
            )}
          </Button>
        </div>

        {/* Bot info */}
        {botInfo && (
          <div className={`p-3 rounded-lg border ${botInfo.valid ? 'bg-primary/5 border-primary/20' : 'bg-destructive/5 border-destructive/20'}`}>
            <div className="flex items-center gap-2">
              {botInfo.valid ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span className="font-medium">{botInfo.name}</span>
                  <Badge variant="secondary" className="text-xs">@{botInfo.username}</Badge>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-destructive">{botInfo.error}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Webhook Status & Registration */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-muted-foreground">Webhook Status</label>
            {webhookStatus && (
              <Badge variant={webhookStatus.registered ? "default" : "secondary"}>
                {webhookStatus.registered ? "Registered" : "Not Registered"}
              </Badge>
            )}
          </div>

          {webhookStatus?.registered && webhookStatus.url && (
            <div className="p-3 rounded-lg border bg-primary/5 border-primary/20">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="text-sm">Webhook is active and receiving messages</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{webhookStatus.url}</p>
            </div>
          )}

          {webhookStatus && !webhookStatus.registered && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {webhookStatus.error || "Webhook is not registered. Click the button below to register."}
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleRegisterWebhook}
            disabled={isRegisteringWebhook || !token}
            className="w-full"
            variant={webhookStatus?.registered ? "outline" : "default"}
          >
            {isRegisteringWebhook ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Webhook className="h-4 w-4 mr-2" />
            )}
            {webhookStatus?.registered ? "Re-register Webhook" : "Register Webhook"}
          </Button>
        </div>

        {/* Webhook URL (for reference) */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">Webhook URL (for reference)</label>
          <div className="flex gap-2">
            <Input
              value={webhookUrl}
              readOnly
              className="font-mono text-xs bg-muted"
            />
            <Button variant="outline" size="icon" onClick={copyWebhookUrl}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
