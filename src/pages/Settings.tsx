import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { Link } from "react-router-dom";

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background dark">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <header className="flex items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Settings className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">الإعدادات</h1>
              <p className="text-sm text-muted-foreground">
                إدارة المفاتيح والتكاملات والاختبارات
              </p>
            </div>
          </div>

          <Button asChild variant="outline">
            <Link to="/">العودة للوحة التحكم</Link>
          </Button>
        </header>

        <main>
          <SettingsPanel />
        </main>
      </div>
    </div>
  );
}
