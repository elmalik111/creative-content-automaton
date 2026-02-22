import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Bot, Save, Loader2, Eye, EyeOff, CheckCircle2, XCircle, Copy, Webhook, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function TelegramSettings() {
  const [token, setToken] = useState('');
  const [savedToken, setSavedToken] = useState(''); // القيمة المحفوظة الفعلية في DB
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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

  // ===== جلب الـ token عند التحميل =====
  useEffect(() => {
    loadToken();
  }, []);

  const loadToken = async () => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // جلب الـ token الخاص بالـ user أولاً
      const { data: ownToken } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'telegram_token')
        .eq('user_id', user.id)
        .maybeSingle();

      if (ownToken?.value) {
        setToken(ownToken.value);
        setSavedToken(ownToken.value);
        return;
      }

      // fallback: الـ token المشترك (user_id IS NULL)
      const { data: sharedToken } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'telegram_token')
        .is('user_id', null)
        .maybeSingle();

      if (sharedToken?.value) {
        setToken(sharedToken.value);
        setSavedToken(sharedToken.value);
      }
    } catch (err) {
      console.error('Failed to load telegram token:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // ===== حفظ الـ token =====
  const handleSave = async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) return;

    // منع حفظ الـ masked token بدل الحقيقي
    if (trimmedToken.includes('•')) {
      toast.error('Please show the token first before saving');
      return;
    }

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('settings')
        .upsert(
          {
            key: 'telegram_token',
            value: trimmedToken,
            user_id: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,key' }
        );

      if (error) throw error;

      setSavedToken(trimmedToken);
      toast.success('تم حفظ Telegram token بنجاح ✓');

      // تحقق تلقائي بعد الحفظ
      await handleVerify(trimmedToken);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      toast.error('فشل الحفظ: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // ===== التحقق من الـ token =====
  const handleVerify = async (tokenOverride?: string) => {
    const activeToken = tokenOverride || savedToken;
    if (!activeToken) {
      toast.error('لا يوجد token محفوظ');
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
        toast.success('Telegram bot تم التحقق منه بنجاح');
        await checkWebhook();
      } else {
        toast.error(data.error || 'فشل التحقق');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setBotInfo({ valid: false, error: error.message });
      toast.error(error.message);
    } finally {
      setIsVerifying(false);
    }
  };

  // ===== فحص الـ webhook =====
  const checkWebhook = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-tokens', {
        body: { platform: 'telegram', action: 'check_webhook' },
      });
      if (error || !data?.webhook_info) return;
      setWebhookStatus({
        registered: !!data.webhook_info.url,
        url: data.webhook_info.url,
      });
    } catch {
      // Silently fail
    }
  };

  useEffect(() => {
    if (savedToken) checkWebhook();
  }, [savedToken]);

  // ===== تسجيل الـ webhook =====
  const handleRegisterWebhook = async () => {
    if (!savedToken) {
      toast.error('احفظ الـ token أولاً');
      return;
    }
    setIsRegisteringWebhook(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-tokens', {
        body: { platform: 'telegram', action: 'register_webhook' },
      });
      if (error) throw error;
      if (data.webhook_registered) {
        setWebhookStatus({ registered: true, url: data.webhook_url });
        toast.success('تم تسجيل Webhook بنجاح!');
      } else {
        setWebhookStatus({ registered: false, error: data.error || 'فشل تسجيل Webhook' });
        toast.error(data.error || 'فشل تسجيل Webhook');
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setWebhookStatus({ registered: false, error: error.message });
      toast.error(error.message);
    } finally {
      setIsRegisteringWebhook(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('تم نسخ Webhook URL!');
  };

  // عرض الـ token: masked أو كامل
  const displayValue = showToken
    ? token
    : token
      ? `${token.slice(0, 8)}${'•'.repeat(Math.max(0, token.length - 12))}${token.slice(-4)}`
      : '';

  const hasUnsavedChanges = token !== savedToken && !token.includes('•') && token.trim().length > 0;

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
              type="text"
              placeholder={isLoading ? 'Loading...' : 'Enter your Telegram bot token'}
              value={displayValue}
              onChange={(e) => {
                const val = e.target.value;
                // لو بيكتب فيه مباشرة، نتأكد إنه مش masked
                if (!val.includes('•')) setToken(val);
              }}
              onFocus={() => setShowToken(true)}
              onBlur={() => setShowToken(false)}
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
            disabled={isSaving || !token.trim() || token.includes('•')}
            variant={hasUnsavedChanges ? 'default' : 'outline'}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={() => handleVerify()}
            disabled={isVerifying || !savedToken}
          >
            {isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
          </Button>
        </div>

        {hasUnsavedChanges && (
          <p className="text-xs text-amber-500 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            تغييرات غير محفوظة — اضغط Save
          </p>
        )}

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
                  <span className="text-destructive text-sm">{botInfo.error}</span>
                </>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-muted-foreground">Webhook Status</label>
            {webhookStatus && (
              <Badge variant={webhookStatus.registered ? 'default' : 'secondary'}>
                {webhookStatus.registered ? 'Registered' : 'Not Registered'}
              </Badge>
            )}
          </div>

          {webhookStatus?.registered && webhookStatus.url && (
            <div className="p-3 rounded-lg border bg-primary/5 border-primary/20">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="text-sm">Webhook is active ✓</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">{webhookStatus.url}</p>
            </div>
          )}

          {webhookStatus && !webhookStatus.registered && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {webhookStatus.error || 'Webhook غير مسجل. اضغط الزر أدناه للتسجيل.'}
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleRegisterWebhook}
            disabled={isRegisteringWebhook || !savedToken}
            className="w-full"
            variant={webhookStatus?.registered ? 'outline' : 'default'}
          >
            {isRegisteringWebhook ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Webhook className="h-4 w-4 mr-2" />
            )}
            {webhookStatus?.registered ? 'Re-register Webhook' : 'Register Webhook'}
          </Button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-muted-foreground">Webhook URL</label>
          <div className="flex gap-2">
            <Input value={webhookUrl} readOnly className="font-mono text-xs bg-muted" />
            <Button variant="outline" size="icon" onClick={copyWebhookUrl}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
