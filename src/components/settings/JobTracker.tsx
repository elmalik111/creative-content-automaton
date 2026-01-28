import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/dashboard/ProgressBar';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { AlertTriangle, Ban, ExternalLink, Loader2, PauseCircle, RefreshCw } from 'lucide-react';

const SUPABASE_URL = "https://cidxcujlfkrzvvmljxqs.supabase.co";

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

interface JobLog {
  step: string;
  status: string;
  message: string;
  duration_ms?: number;
  started_at?: string;
  completed_at?: string;
  output_data?: unknown;
  error?: string;
}

interface JobStatusResponse {
  job_id: string;
  type: string;
  status: string;
  progress: number;
  output_url?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  logs: JobLog[];
  is_stuck: boolean;
  stuck_warning?: string;
  is_complete: boolean;
  is_failed: boolean;
  can_cancel: boolean;
}

export function JobTracker({
  jobId,
  onStopTracking,
}: {
  jobId: string;
  onStopTracking: () => void;
}) {
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [pollingActive, setPollingActive] = useState(true);

  // Fetch job status via edge function
  const fetchJobStatus = useCallback(async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/job-status/${jobId}`);
      if (!res.ok) {
        const errText = await res.text();
        console.error('Job status fetch error:', errText);
        return;
      }
      const data: JobStatusResponse = await res.json();
      setJobStatus(data);
      
      // Stop polling if job is done
      if (data.is_complete || data.is_failed) {
        setPollingActive(false);
      }
    } catch (err) {
      console.error('Failed to fetch job status:', err);
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  // Polling every 2 seconds
  useEffect(() => {
    if (!jobId) return;
    
    fetchJobStatus();
    
    if (!pollingActive) return;
    
    const interval = setInterval(fetchJobStatus, 2000);
    return () => clearInterval(interval);
  }, [jobId, pollingActive, fetchJobStatus]);

  const currentStep = useMemo(() => {
    if (!jobStatus?.logs?.length) return null;
    const processing = jobStatus.logs.find((s) => s.status === 'processing');
    if (processing) return processing;
    return jobStatus.logs[jobStatus.logs.length - 1];
  }, [jobStatus?.logs]);

  const cancelJob = async () => {
    if (!jobId) return;
    setIsCancelling(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/cancel-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        toast.success('تم إلغاء العملية');
        setPollingActive(false);
        await fetchJobStatus();
      } else {
        toast.error(data.message || 'فشل الإلغاء');
      }
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
            <Button variant="outline" size="sm" onClick={fetchJobStatus}>
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
          {pollingActive && <span className="ml-2 text-primary">● يتم التحديث تلقائياً</span>}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            جارٍ تحميل التفاصيل...
          </div>
        ) : !jobStatus ? (
          <div className="text-sm text-muted-foreground">لم يتم العثور على Job.</div>
        ) : (
          <>
            {/* Stuck Warning */}
            {jobStatus.is_stuck && jobStatus.stuck_warning && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">تحذير: العملية قد تكون متعطلة</div>
                  <div className="text-sm">{jobStatus.stuck_warning}</div>
                </div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">الحالة</div>
                <div className="mt-1">
                  <Badge variant={jobStatus.is_failed ? 'destructive' : jobStatus.is_complete ? 'default' : 'secondary'}>
                    {AR_STATUS_LABELS[jobStatus.status] || jobStatus.status}
                  </Badge>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">الخطوة الحالية</div>
                <div className="mt-1 text-sm text-foreground">
                  {currentStep ? (AR_STEP_LABELS[currentStep.step] || currentStep.step) : '—'}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">التقدّم</div>
                <div className="mt-1 text-sm text-foreground">{jobStatus.progress}%</div>
              </div>
            </div>

            <div>
              <ProgressBar progress={jobStatus.progress} />
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="destructive"
                onClick={cancelJob}
                disabled={isCancelling || !jobStatus.can_cancel}
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

            {/* Logs Section */}
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="text-sm font-medium text-foreground mb-2">سجل العمليات (Logs)</div>
              <div className="space-y-2 max-h-[200px] overflow-auto">
                {jobStatus.logs?.length ? (
                  jobStatus.logs.map((log, idx) => (
                    <div key={idx} className="flex items-start justify-between gap-2 text-sm border-b border-border/50 pb-2 last:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-foreground font-medium">
                            {AR_STEP_LABELS[log.step] || log.step}
                          </span>
                          <Badge 
                            variant={log.status === 'failed' ? 'destructive' : log.status === 'completed' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {AR_STATUS_LABELS[log.status] || log.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{log.message}</div>
                        {log.error && (
                          <div className="text-xs text-destructive mt-1">❌ {log.error}</div>
                        )}
                        {log.output_data && typeof log.output_data === 'object' && (
                          <details className="mt-1">
                            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                              تفاصيل السيرفر
                            </summary>
                            <pre className="text-xs bg-muted/50 p-2 rounded mt-1 overflow-auto max-h-[100px]">
                              {JSON.stringify(log.output_data, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                      {log.duration_ms !== undefined && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {(log.duration_ms / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">لا توجد سجلات بعد.</div>
                )}
              </div>
            </div>

            {/* Error Display */}
            {jobStatus.error_message && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30">
                <div className="text-sm font-medium text-destructive">خطأ:</div>
                <div className="text-sm text-destructive/90 mt-1">{jobStatus.error_message}</div>
              </div>
            )}

            {/* Output URL */}
            {jobStatus.output_url && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/30">
                <div className="text-sm font-medium text-primary">الفيديو جاهز:</div>
                <a 
                  href={jobStatus.output_url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline break-all"
                >
                  {jobStatus.output_url}
                </a>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
