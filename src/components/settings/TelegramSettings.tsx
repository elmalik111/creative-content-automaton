import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSetting, useUpdateSetting } from '@/hooks/useSettings';
import { Bot, Save, Loader2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

export function TelegramSettings() {
  const { data: telegramToken, isLoading } = useSetting('telegram_token');
  const updateSetting = useUpdateSetting();
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (telegramToken) {
      setToken(telegramToken);
    }
  }, [telegramToken]);

  const handleSave = async () => {
    try {
      await updateSetting.mutateAsync({ key: 'telegram_token', value: token });
      toast.success('Telegram token saved successfully');
    } catch {
      toast.error('Failed to save Telegram token');
    }
  };

  const maskedToken = token ? `${token.slice(0, 8)}${'•'.repeat(Math.max(0, token.length - 12))}${token.slice(-4)}` : '';

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Bot className="h-5 w-5" />
          Telegram Bot Token
        </CardTitle>
      </CardHeader>
      <CardContent>
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
        </div>
      </CardContent>
    </Card>
  );
}
