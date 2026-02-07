import { useParams, Link } from 'react-router-dom';
import { useJobDetails } from '@/hooks/useJobDetails';
import { DashboardLayout } from '@/layouts/DashboardLayout';
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
  'validate_inputs': 'التحقق من المدخلات',
  'script_generation': 'إنشاء النص',
  'voice_generation': 'إنشاء الصوت',
  'image_generation': 'إنشاء الصور',
  'media_merge': 'دمج الوسائط',
  'publishing': 'النشر',
  'upload': 'رفع الملفات',
  'merge': 'دمج الفيديو',
  'finalize': 'إنهاء',
};

const statusLabels: Record<string, string> = {
  completed: 'مكتمل',
  failed: 'فشل',
  processing: 'قيد التنفيذ',
  pending: 'في الانتظار',
};

export default function JobDetails() {
  const { id } = useParams<{ id: string }>();
  const { data: job, isLoading } = useJobDetails(id || '');

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {statusLabels.completed}
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-destructive/10 text-destructive border-destructive/20">
            <XCircle className="h-3 w-3 mr-1" />
            {statusLabels.failed}
          </Badge>
        );
      case 'processing':
        return (
          <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            {statusLabels.processing}
          </Badge>
        );
      default:
        return (
          <Badge className="bg-muted text-muted-foreground">
            <Clock className="h-3 w-3 mr-1" />
            {statusLabels.pending}
          </Badge>
        );
    }
  };

  const getStepStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-destructive" />;
      case 'processing':
        return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto space-y-6">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      </DashboardLayout>
    );
  }

  if (!job) {
    return (
      <DashboardLayout>
        <div className="max-w-4xl mx-auto">
          <Link to="/">
            <Button variant="ghost" className="mb-6">
              <ArrowLeft className="h-4 w-4 ml-2" />
              رجوع
            </Button>
          </Link>
          <Card>
            <CardContent className="py-12 text-center">
              <Film className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">المهمة غير موجودة</p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <Link to="/">
          <Button variant="ghost">
            <ArrowLeft className="h-4 w-4 ml-2" />
            رجوع للوحة التحكم
          </Button>
        </Link>

        {/* Job Overview */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Film className="h-5 w-5" />
                تفاصيل المهمة
              </CardTitle>
              {getStatusBadge(job.status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">رقم المهمة</p>
                <p className="font-mono text-sm">{job.id.slice(0, 8)}...</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">النوع</p>
                <Badge variant="outline" className="capitalize">
                  {job.type === 'ai_generate' ? 'إنشاء بالذكاء' : 'دمج'}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">تاريخ الإنشاء</p>
                <p className="text-sm">{formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">آخر تحديث</p>
                <p className="text-sm">{format(new Date(job.updated_at), 'PPp')}</p>
              </div>
            </div>

            {/* Progress */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">التقدم</span>
                <span className="font-medium">{job.progress}%</span>
              </div>
              <ProgressBar progress={job.progress} />
            </div>

            {/* Error Message */}
            {job.error_message && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <p className="font-medium mb-1">خطأ</p>
                <p>{job.error_message}</p>
              </div>
            )}

            {/* Download */}
            {job.output_url && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-medium">الفيديو جاهز</span>
                </div>
                <a href={job.output_url} target="_blank" rel="noopener noreferrer">
                  <Button size="sm">
                    <Download className="h-4 w-4 ml-2" />
                    تحميل
                  </Button>
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Steps Timeline */}
        <Card>
          <CardHeader>
            <CardTitle>مراحل التنفيذ</CardTitle>
          </CardHeader>
          <CardContent>
            {job.steps.length > 0 ? (
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute right-[22px] top-0 bottom-0 w-0.5 bg-border" />
                
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
                              <p>بدأ: {format(new Date(step.started_at), 'PPp')}</p>
                            )}
                            {step.completed_at && (
                              <p>اكتمل: {format(new Date(step.completed_at), 'PPp')}</p>
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
                <p>لا توجد مراحل مسجلة بعد</p>
                <p className="text-sm">ستظهر المراحل عند بدء تنفيذ المهمة</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
