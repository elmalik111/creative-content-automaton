import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { JobCard } from './JobCard';
import { useJobs } from '@/hooks/useJobs';
import { Skeleton } from '@/components/ui/skeleton';
import { ListVideo } from 'lucide-react';

export function JobsList() {
  const { data: jobs, isLoading } = useJobs();

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <ListVideo className="h-5 w-5" />
          Recent Jobs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </>
        ) : jobs && jobs.length > 0 ? (
          jobs.map((job) => <JobCard key={job.id} job={job} />)
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <ListVideo className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No jobs yet</p>
            <p className="text-sm">Jobs will appear here when created</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
