import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/dashboard/ProgressBar';
import { useJobDetails } from '@/hooks/useJobDetails';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Ban, ExternalLink, Loader2, PauseCircle, RefreshCw } from 'lucide-react';

const AR_STEP_LABELS: Record<string, string> = {
  validate_inputs: 'التحقق من البيانات',
  upload: 'رفع الملفات',
  merge: 'دمج الفيديو',
  finalize: 'إنهاء وإخراج الملف',
};

const AR_STATUS_LABELS: Record<string, string> = {
  pending: 'قيد الانتظار',
  processing: 'جارٍ التنفيذ',
  completed: 'اكتمل',
  failed: 'فشل',
};

export function JobTracker({
  jobId,
  onStopTracking,
}: {
  jobId: string;
  onStopTracking: () => void;
}) {
  const { data: job, isLoading, refetch } = useJobDetails(jobId);
  const [isCancelling, setIsCancelling] = useState(false);

  const currentStep = useMemo(() => {
    if (!job?.steps?.length) return null;
    const processing = job.steps.find((s) => s.status === 'processing');
    if (processing) return processing;
    // fallback: last step
    return job.steps[job.steps.length - 1];
  }, [job?.steps]);

  const cancelJob = async () => {
    if (!jobId) return;
    setIsCancelling(true);
    try {
      const now = new Date().toISOString();
      const message = 'Cancelled by user';

      await supabase
        .from('jobs')
        .update({ status: 'failed', error_message: message })
        .eq('id', jobId);

      await supabase
        .from('job_steps')
        .update({ status: 'failed', error_message: message, completed_at: now })
        .eq('job_id', jobId)
        .in('status', ['pending', 'processing']);

      toast.success('تم إلغاء العملية');
      await refetch();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      toast.error(`فشل الإلغاء: ${err.message}`);
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-foreground">تتبّع عملية الدمج</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              تحديث
            </Button>
            <Button variant="outline" size="sm" onClick={onStopTracking}>
              <PauseCircle className="h-4 w-4 mr-2" />
              إيقاف المتابعة
            </Button>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Job: <span className="font-mono">{jobId}</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            جارٍ تحميل التفاصيل...
          </div>
        ) : !job ? (
          <div className="text-sm text-muted-foreground">لم يتم العثور على Job.</div>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">الحالة</div>
                <div className="mt-1">
                  <Badge variant={job.status === 'failed' ? 'destructive' : job.status === 'completed' ? 'default' : 'secondary'}>
                    {AR_STATUS_LABELS[job.status] || job.status}
                  </Badge>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">الخطوة الحالية</div>
                <div className="mt-1 text-sm text-foreground">
                  {currentStep ? (AR_STEP_LABELS[currentStep.step_name] || currentStep.step_name) : '—'}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">التقدّم</div>
                <div className="mt-1 text-sm text-foreground">{job.progress}%</div>
              </div>
            </div>

            <div>
              <ProgressBar progress={job.progress} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="destructive"
                onClick={cancelJob}
                disabled={isCancelling || job.status === 'completed' || job.status === 'failed'}
              >
                {isCancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Ban className="h-4 w-4 mr-2" />
                )}
                إلغاء العملية
              </Button>

              <Button asChild variant="outline">
                <Link to={`/job/${jobId}`}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  فتح صفحة التفاصيل
                </Link>
              </Button>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="text-sm font-medium text-foreground mb-2">الخطوات</div>
              <div className="space-y-2">
                {job.steps?.length ? (
                  job.steps.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <span className="text-foreground">
                          {AR_STEP_LABELS[s.step_name] || s.step_name}
                        </span>
                        {s.error_message ? (
                          <div className="text-xs text-destructive truncate">{s.error_message}</div>
                        ) : null}
                      </div>
                      <Badge variant={s.status === 'failed' ? 'destructive' : s.status === 'completed' ? 'default' : 'secondary'}>
                        {AR_STATUS_LABELS[s.status] || s.status}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">لا توجد خطوات مسجّلة بعد.</div>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
