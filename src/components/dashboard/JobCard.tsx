import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from './ProgressBar';
import { Loader2, CheckCircle2, XCircle, Clock, Film, Wand2 } from 'lucide-react';
import type { Job } from '@/types/database';
import { formatDistanceToNow } from 'date-fns';

interface JobCardProps {
  job: Job;
}

const statusConfig = {
  pending: {
    icon: Clock,
    label: 'Pending',
    variant: 'secondary' as const,
  },
  processing: {
    icon: Loader2,
    label: 'Processing',
    variant: 'default' as const,
  },
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    variant: 'default' as const,
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    variant: 'destructive' as const,
  },
};

const typeConfig = {
  merge: {
    icon: Film,
    label: 'Merge',
  },
  ai_generate: {
    icon: Wand2,
    label: 'AI Generate',
  },
};

export function JobCard({ job }: JobCardProps) {
  const statusInfo = statusConfig[job.status];
  const typeInfo = typeConfig[job.type];
  const StatusIcon = statusInfo.icon;
  const TypeIcon = typeInfo.icon;

  return (
    <Card className="bg-card border-border">
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <StatusIcon 
              className={`h-5 w-5 flex-shrink-0 ${
                job.status === 'processing' ? 'animate-spin text-primary' :
                job.status === 'completed' ? 'text-primary' :
                job.status === 'failed' ? 'text-destructive' :
                'text-muted-foreground'
              }`}
            />
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">
                Job #{job.id.slice(0, 8)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="flex items-center gap-1">
              <TypeIcon className="h-3 w-3" />
              {typeInfo.label}
            </Badge>
          </div>

          <div className="flex items-center gap-4 min-w-[200px]">
            {job.status === 'processing' ? (
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Progress</span>
                  <span className="text-xs font-medium text-foreground">{job.progress}%</span>
                </div>
                <ProgressBar progress={job.progress} />
              </div>
            ) : (
              <Badge variant={statusInfo.variant}>
                {statusInfo.label}
              </Badge>
            )}
          </div>
        </div>

        {job.error_message && (
          <p className="mt-2 text-sm text-destructive truncate">
            {job.error_message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
