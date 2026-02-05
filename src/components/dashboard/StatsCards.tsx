import { Card, CardContent } from "@/components/ui/card";
import { useJobStats } from "@/hooks/useJobs";
import { CheckCircle2, Clock, XCircle, Film, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function StatsCards() {
  const { data: stats, isLoading } = useJobStats();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="card-shadow border-0 bg-card">
            <CardContent className="p-5">
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const completed = stats?.completedTodayCount ?? 0;
  const active = stats?.activeCount ?? 0;

  const cards = [
    {
      label: "الفيديوهات المكتملة",
      value: completed.toLocaleString(),
      icon: Film,
      change: "+12%",
      changeUp: true,
      accent: "primary",
    },
    {
      label: "قيد الانتظار",
      value: active.toLocaleString(),
      icon: Clock,
      change: "",
      changeUp: false,
      accent: "warning",
    },
    {
      label: "مكتملة اليوم",
      value: completed.toLocaleString(),
      icon: CheckCircle2,
      change: "+8%",
      changeUp: true,
      accent: "success",
    },
    {
      label: "فاشلة",
      value: "0",
      icon: XCircle,
      change: "",
      changeUp: false,
      accent: "destructive",
    },
  ];

  const accentColors: Record<string, string> = {
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/15 text-destructive",
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className="card-shadow hover-lift border-0 bg-card">
            <CardContent className="flex items-center gap-4 p-5">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-xl ${accentColors[card.accent]}`}
              >
                <Icon className="h-6 w-6" />
              </div>
              <div className="flex-1 space-y-1">
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className="text-2xl font-bold">{card.value}</p>
                {card.change && (
                  <p
                    className={`text-xs flex items-center gap-1 ${
                      card.changeUp ? "text-success" : "text-muted-foreground"
                    }`}
                  >
                    <TrendingUp className="h-3 w-3" />
                    {card.change}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
