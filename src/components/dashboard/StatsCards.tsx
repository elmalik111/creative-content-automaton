import { Card, CardContent } from '@/components/ui/card';
import { Activity, CheckCircle2 } from 'lucide-react';
import { useJobStats } from '@/hooks/useJobs';
import { Skeleton } from '@/components/ui/skeleton';

export function StatsCards() {
  const { data: stats, isLoading } = useJobStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <Skeleton className="h-20" />
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <Skeleton className="h-20" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-full bg-primary/10">
              <Activity className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Active Jobs</p>
              <p className="text-3xl font-bold text-foreground">
                {stats?.activeCount || 0}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="bg-card border-border">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-full bg-primary/10">
              <CheckCircle2 className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Completed Today</p>
              <p className="text-3xl font-bold text-foreground">
                {stats?.completedTodayCount || 0}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
