import { useState } from "react";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  MessageCircle,
  Key,
  Globe2,
  Shield,
  TestTube,
  Bug,
  Play,
} from "lucide-react";
import { TelegramSettings } from "@/components/settings/TelegramSettings";
import { ElevenLabsKeys } from "@/components/settings/ElevenLabsKeys";
import { OAuthSettings } from "@/components/settings/OAuthSettings";
import { ApiKeysSettings } from "@/components/settings/ApiKeysSettings";
import { ApiTester } from "@/components/settings/ApiTester";
import { EdgeFunctionDebug } from "@/components/settings/EdgeFunctionDebug";
import { PublishTester } from "@/components/settings/PublishTester";
import { cn } from "@/lib/utils";

const sections = [
  { id: "telegram", label: "Telegram", icon: MessageCircle },
  { id: "elevenlabs", label: "ElevenLabs", icon: Key },
  { id: "oauth", label: "OAuth Tokens", icon: Globe2 },
  { id: "apikeys", label: "API Keys", icon: Shield },
  { id: "tester", label: "API Tester", icon: TestTube },
  { id: "publish", label: "Publish Tester", icon: Play },
  { id: "debug", label: "Edge Debug", icon: Bug },
] as const;

type SectionId = (typeof sections)[number]["id"];

export default function SettingsPage() {
  const [active, setActive] = useState<SectionId>("telegram");

  const renderContent = () => {
    switch (active) {
      case "telegram":
        return <TelegramSettings />;
      case "elevenlabs":
        return <ElevenLabsKeys />;
      case "oauth":
        return <OAuthSettings />;
      case "apikeys":
        return <ApiKeysSettings />;
      case "tester":
        return <ApiTester />;
      case "publish":
        return <PublishTester />;
      case "debug":
        return <EdgeFunctionDebug />;
      default:
        return null;
    }
  };

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-xl font-bold">الإعدادات</h1>
        <p className="text-sm text-muted-foreground">
          إدارة المفاتيح والتكاملات والاختبارات
        </p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar within settings */}
        <Card className="card-shadow border-0 bg-card w-52 shrink-0 hidden md:block">
          <CardContent className="p-3 space-y-1">
            {sections.map((s) => {
              const Icon = s.icon;
              const isActive = active === s.id;
              return (
                <Button
                  key={s.id}
                  variant="ghost"
                  onClick={() => setActive(s.id)}
                  className={cn(
                    "w-full justify-start gap-2 font-medium",
                    isActive && "bg-primary text-primary-foreground hover:bg-primary"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {s.label}
                </Button>
              );
            })}
          </CardContent>
        </Card>

        {/* Mobile dropdown */}
        <select
          className="md:hidden block w-full rounded-lg border border-input bg-card p-2 mb-4"
          value={active}
          onChange={(e) => setActive(e.target.value as SectionId)}
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        {/* Main content */}
        <div className="flex-1">{renderContent()}</div>
      </div>
    </DashboardLayout>
  );
}
