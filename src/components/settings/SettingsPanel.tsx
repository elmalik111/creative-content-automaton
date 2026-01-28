import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { TelegramSettings } from './TelegramSettings';
import { ElevenLabsKeys } from './ElevenLabsKeys';
import { OAuthSettings } from './OAuthSettings';
import { ApiKeysSettings } from './ApiKeysSettings';
import { ApiTester } from './ApiTester';
import { EdgeFunctionDebug } from './EdgeFunctionDebug';
import { Settings } from 'lucide-react';

export function SettingsPanel() {
  return (
    <div className="space-y-4">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Settings className="h-5 w-5" />
            Settings
          </CardTitle>
        </CardHeader>
      </Card>
      
      <TelegramSettings />
      <ElevenLabsKeys />
      <OAuthSettings />
      <ApiKeysSettings />
      <ApiTester />
      <EdgeFunctionDebug />
    </div>
  );
}
