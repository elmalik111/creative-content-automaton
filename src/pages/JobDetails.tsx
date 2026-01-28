import { useParams, Link } from 'react-router-dom';
import { useJobDetails } from '@/hooks/useJobDetails';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/dashboard/ProgressBar';
import { 
  ArrowLeft, 
  Download, 
  Film, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Loader2,
  FileVideo,
  Mic,
  Image,
  Merge,
  Send
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

const stepIcons: Record<string, React.ElementType> = {
  'validate_inputs': FileVideo,
  'script_generation': FileVideo,
  'voice_generation': Mic,
  'image_generation': Image,
  'media_merge': Merge,
  'publishing': Send,
  'upload': FileVideo,
  'merge': Merge,
  'finalize': FileVideo,
};

const stepLabels: Record<string, string> = {
  'validate_inputs': 'Validate Inputs',
  'script_generation': 'Script Generation',
  'voice_generation': 'Voice Generation',
  'image_generation': 'Image Generation',
  'media_merge': 'Media Merge',
  'publishing': 'Publishing',
  'upload': 'File Upload',
  'merge': 'Video Merge',
  'finalize': 'Finalize',
};

export default function JobDetails() {
  const { id } = useParams<{ id: string }>();
  const { data: job, isLoading } = useJobDetails(id || '');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-destructive/10 text-destructive border-destructive/20">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'processing':
        return (
          <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Processing
          </Badge>
        );
      default:
        return (
          <Badge className="bg-muted text-muted-foreground">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
    }
  };

  const getStepStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-destructive" />;
      case 'processing':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background dark">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Skeleton className="h-8 w-32 mb-6" />
          <Skeleton className="h-48 mb-6" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-background dark">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <Link to="/">
            <Button variant="ghost" className="mb-6">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <Card className="bg-card border-border">
            <CardContent className="py-12 text-center">
              <Film className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">Job not found</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background dark">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <Link to="/">
          <Button variant="ghost" className="mb-6">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>

        {/* Job Overview */}
        <Card className="bg-card border-border mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Film className="h-5 w-5" />
                Job Details
              </CardTitle>
              {getStatusBadge(job.status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Job ID</p>
                <p className="font-mono text-sm">{job.id.slice(0, 8)}...</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Type</p>
                <Badge variant="outline" className="capitalize">
                  {job.type === 'ai_generate' ? 'AI Generate' : 'Merge'}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-sm">{formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last Updated</p>
                <p className="text-sm">{format(new Date(job.updated_at), 'PPp')}</p>
              </div>
            </div>

            {/* Progress */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{job.progress}%</span>
              </div>
              <ProgressBar progress={job.progress} />
            </div>

            {/* Error Message */}
            {job.error_message && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <p className="font-medium mb-1">Error</p>
                <p>{job.error_message}</p>
              </div>
            )}

            {/* Download */}
            {job.output_url && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2 text-green-500">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">Video Ready</span>
                </div>
                <a href={job.output_url} target="_blank" rel="noopener noreferrer">
                  <Button size="sm">
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Steps Timeline */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Processing Steps</CardTitle>
          </CardHeader>
          <CardContent>
            {job.steps.length > 0 ? (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-[22px] top-0 bottom-0 w-0.5 bg-border" />
                
                <div className="space-y-6">
                  {job.steps.map((step, index) => {
                    const StepIcon = stepIcons[step.step_name] || FileVideo;
                    const label = stepLabels[step.step_name] || step.step_name;
                    
                    return (
                      <div key={step.id} className="relative flex gap-4">
                        {/* Step indicator */}
                        <div className="relative z-10 flex items-center justify-center w-11 h-11 rounded-full bg-card border-2 border-border">
                          {getStepStatusIcon(step.status)}
                        </div>
                        
                        {/* Step content */}
                        <div className="flex-1 pb-2">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <StepIcon className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{label}</span>
                            </div>
                            {getStatusBadge(step.status)}
                          </div>
                          
                          <div className="text-xs text-muted-foreground space-y-1">
                            {step.started_at && (
                              <p>Started: {format(new Date(step.started_at), 'PPp')}</p>
                            )}
                            {step.completed_at && (
                              <p>Completed: {format(new Date(step.completed_at), 'PPp')}</p>
                            )}
                          </div>
                          
                          {step.error_message && (
                            <div className="mt-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                              {step.error_message}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No processing steps recorded yet</p>
                <p className="text-sm">Steps will appear as the job progresses</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
