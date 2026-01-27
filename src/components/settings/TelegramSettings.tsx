import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSetting, useUpdateSetting } from '@/hooks/useSettings';
import { supabase } from '@/integrations/supabase/client';
import { Bot, Save, Loader2, Eye, EyeOff, CheckCircle2, XCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';

export function TelegramSettings() {
  const { data: telegramToken, isLoading } = useSetting('telegram_token');
  const updateSetting = useUpdateSetting();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
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

        {/* Webhook URL */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">Webhook URL</label>
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
          <p className="text-xs text-muted-foreground">
            Set this URL as your bot's webhook in Telegram Bot API
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
