import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useJobs } from "@/hooks/useJobs";
import { Skeleton } from "@/components/ui/skeleton";
import { ListVideo, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";

const statusConfig: Record<
  string,
  { icon: React.ElementType; color: string; label: string }
> = {
  pending: { icon: Clock, color: "bg-muted text-muted-foreground", label: "في الانتظار" },
  processing: { icon: Loader2, color: "bg-warning/15 text-warning", label: "جارٍ" },
  completed: { icon: CheckCircle2, color: "bg-success/15 text-success", label: "مكتمل" },
  failed: { icon: XCircle, color: "bg-destructive/15 text-destructive", label: "فشل" },
};

export function JobsList() {
  const { data: jobs, isLoading } = useJobs();

  const recentJobs = jobs?.slice(0, 6) ?? [];

  return (
    <Card className="card-shadow border-0 bg-card">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <ListVideo className="h-5 w-5 text-primary" />
          آخر المهام
        </CardTitle>
        <Link to="/" className="text-xs text-primary hover:underline">
          عرض الكل
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
            <Skeleton className="h-16 rounded-lg" />
          </>
        ) : recentJobs.length > 0 ? (
          recentJobs.map((job) => {
            const cfg = statusConfig[job.status] ?? statusConfig.pending;
            const Icon = cfg.icon;

            return (
              <Link
                key={job.id}
                to={`/job/${job.id}`}
                className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/40 hover:bg-muted transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${cfg.color}`}
                  >
                    <Icon
                      className={`h-4 w-4 ${
                        job.status === "processing" ? "animate-spin" : ""
                      }`}
                    />
                  </div>
                  <div>
                    <p className="font-medium text-sm line-clamp-1">
                      {(job.input_data as any)?.title ?? `Job ${job.id.slice(0, 8)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      منذ{" "}
                      {formatDistanceToNow(new Date(job.created_at), {
                        locale: ar,
                        addSuffix: false,
                      })}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {cfg.label}
                </Badge>
              </Link>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground">
            <ListVideo className="h-10 w-10 mb-3 opacity-40" />
            <p className="font-medium">لا توجد مهام بعد</p>
            <p className="text-xs">سيتم عرض المهام هنا عند إنشائها</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
