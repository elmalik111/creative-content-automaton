import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, HardDrive, Cpu, Activity } from "lucide-react";

export function ServerStatus() {
  const stats = [
    { label: "استخدام المعالج", value: "45%", icon: Cpu },
    { label: "الذاكرة", value: "2.4 GB", icon: Activity },
    { label: "التخزين", value: "45 GB", icon: HardDrive },
    { label: "وقت التشغيل", value: "99.9%", icon: Server },
  ];

  return (
    <Card className="card-shadow border-0 bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Server className="h-4 w-4 text-primary" />
          حالة الخادم
          <span className="mr-auto text-xs text-muted-foreground">
            Oracle Cloud - VM.Standard.E2.1
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                className="flex flex-col items-center justify-center rounded-lg bg-muted/40 py-4 px-2"
              >
                <Icon className="mb-2 h-5 w-5 text-muted-foreground" />
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground text-center">{s.label}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
