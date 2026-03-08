import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useJobDetails } from '@/hooks/useJobDetails';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ProgressBar } from '@/components/dashboard/ProgressBar';
import { toast } from 'sonner';
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
  Send,
  RotateCcw,
  StopCircle,
  Ban,
  AlertTriangle,
  Timer
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

// SLA limits per step in seconds
const STEP_SLA: Record<string, number> = {
  validate_inputs: 30,
  script_generation: 60,
  voice_generation: 120,
  image_generation: 300,
  media_merge: 600,
  merge: 600,
  publishing: 120,
  upload: 120,
  finalize: 60,
};

function useElapsedSeconds(startedAt: string | null, isActive: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isActive || !startedAt) {
      setElapsed(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [startedAt, isActive]);

  return elapsed;
}

function formatElapsed(secs: number) {
  if (secs < 60) return `${secs}ث`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}د ${s}ث` : `${m}د`;
}

function StepTimer({ startedAt, stepName, status }: { startedAt: string | null; stepName: string; status: string }) {
  const isActive = status === 'processing';
  const elapsed = useElapsedSeconds(startedAt, isActive);
  const sla = STEP_SLA[stepName];
  const isOverSLA = sla !== undefined && elapsed > sla;

  if (!isActive || !startedAt) return null;

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full border ${
      isOverSLA
        ? 'text-destructive border-destructive/30 bg-destructive/10 animate-pulse'
        : 'text-blue-600 border-blue-500/20 bg-blue-500/10'
    }`}>
      {isOverSLA ? <AlertTriangle className="h-3 w-3" /> : <Timer className="h-3 w-3" />}
      {formatElapsed(elapsed)}
      {isOverSLA && sla && <span className="opacity-70">/ {formatElapsed(sla)}</span>}
    </span>
  );
}

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
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const handleRetryMerge = async () => {
    if (!id || retrying) return;
    setRetrying(true);
    try {
      const { data, error } = await supabase.functions.invoke('retry-merge', {
        body: { job_id: id },
      });
      if (error) throw error;
      toast.success('تم بدء إعادة الدمج بنجاح');
      queryClient.invalidateQueries({ queryKey: ['job-details', id] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`فشل إعادة الدمج: ${msg}`);
    } finally {
      setRetrying(false);
    }
  };

  const handleCancelJob = async () => {
    if (!id || cancelling) return;
    setCancelling(true);
    try {
      const { data, error } = await supabase.functions.invoke('cancel-job', {
        body: { job_id: id },
      });
      if (error) throw error;
      toast.success('تم إلغاء المهمة بنجاح');
      queryClient.invalidateQueries({ queryKey: ['job-details', id] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`فشل إلغاء المهمة: ${msg}`);
    } finally {
      setCancelling(false);
    }
  };

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

  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  const toNumber = (...values: unknown[]): number | undefined => {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return undefined;
  };

  const imageStep = job.steps.find((step) => step.step_name === 'image_generation');
  const mergeStep = job.steps.find((step) => step.step_name === 'merge' || step.step_name === 'media_merge');
  const imageOutput = asRecord(imageStep?.output_data);
  const mergeOutput = asRecord(mergeStep?.output_data);
  const mergeDiagnostics = asRecord(mergeOutput.diagnostics);

  const sentImageCount = toNumber(
    mergeOutput.requested_image_count,
    imageOutput.total_succeeded,
    Array.isArray(imageOutput.image_urls) ? imageOutput.image_urls.length : undefined
  );

  const providerImageCount = toNumber(
    mergeOutput.provider_reported_image_count,
    mergeDiagnostics.provider_reported_image_count,
    mergeDiagnostics.received_images,
    mergeOutput.image_count
  );

  const hasImageCounter = sentImageCount !== undefined || providerImageCount !== undefined;
  const hasImageMismatch =
    sentImageCount !== undefined &&
    providerImageCount !== undefined &&
    sentImageCount !== providerImageCount;

  const payloadVariantRaw = mergeOutput.payload_variant ?? mergeDiagnostics.payload_variant;
  const payloadVariant =
    typeof payloadVariantRaw === 'string' && payloadVariantRaw.trim()
      ? payloadVariantRaw.trim()
      : undefined;

  const payloadVariantLabels: Record<string, string> = {
    image_urls_only: 'image_urls_only',
    images_only: 'images_only',
    imageUrls_only: 'imageUrls_only',
    single_or_video: 'single_or_video',
  };

  const providerStatusEndpointRaw =
    mergeOutput.provider_status_endpoint ??
    mergeDiagnostics.provider_status_endpoint ??
    mergeOutput.status_url ??
    mergeDiagnostics.status_url;

  const providerStatusEndpoint =
    typeof providerStatusEndpointRaw === 'string' && providerStatusEndpointRaw.trim()
      ? providerStatusEndpointRaw.trim()
      : undefined;

  const mergeStartedAtMs = mergeStep?.started_at ? new Date(mergeStep.started_at).getTime() : undefined;
  const mergeElapsedMinutes =
    mergeStep?.status === 'processing' && mergeStartedAtMs
      ? Math.max(0, Math.floor((Date.now() - mergeStartedAtMs) / 60000))
      : undefined;
  const isMergeSlow = (mergeElapsedMinutes ?? 0) >= 8;

  // Can retry merge if merge step failed or job failed with completed images
  const canRetryMerge =
    (mergeStep?.status === 'failed' || (job.status === 'failed' && imageStep?.status === 'completed')) &&
    !retrying;

  // Can cancel if job is processing or pending
  const canCancel =
    (job.status === 'processing' || job.status === 'pending') && !cancelling;

  const isCancelledByUser =
    job.status === 'failed' &&
    typeof job.error_message === 'string' &&
    job.error_message.toLowerCase().includes('cancel');

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <Link to="/">
            <Button variant="ghost">
              <ArrowLeft className="h-4 w-4 ml-2" />
              رجوع للوحة التحكم
            </Button>
          </Link>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {canRetryMerge && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetryMerge}
                disabled={retrying}
              >
                {retrying ? (
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4 ml-2" />
                )}
                {retrying ? 'جارٍ إعادة الدمج...' : 'إعادة الدمج'}
              </Button>
            )}

            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancelJob}
                disabled={cancelling}
              >
                {cancelling ? (
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                ) : (
                  <Ban className="h-4 w-4 ml-2" />
                )}
                {cancelling ? 'جارٍ الإلغاء...' : 'إلغاء المهمة'}
              </Button>
            )}
          </div>
        </div>

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

            {/* Cancelled by user notice */}
            {isCancelledByUser && (
              <Alert>
                <StopCircle className="h-4 w-4" />
                <AlertTitle>تم الإلغاء</AlertTitle>
                <AlertDescription>
                  تم إلغاء هذه المهمة بواسطة المستخدم.
                  {canRetryMerge && ' يمكنك إعادة الدمج بنفس الصور والصوت.'}
                </AlertDescription>
              </Alert>
            )}

            {hasImageCounter && (
              <div className="p-3 rounded-lg border bg-muted/30 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">عداد صور الدمج</p>
                  <Badge variant={hasImageMismatch ? 'destructive' : 'outline'}>
                    {hasImageMismatch ? 'عدم تطابق' : 'متطابق'}
                  </Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md bg-background/70 border px-3 py-2">
                    <p className="text-xs text-muted-foreground mb-1">الصور المرسلة للدمج</p>
                    <p className="font-semibold">{sentImageCount ?? 'غير متاح'}</p>
                  </div>
                  <div className="rounded-md bg-background/70 border px-3 py-2">
                    <p className="text-xs text-muted-foreground mb-1">الصور المؤكدة من المزود</p>
                    <p className="font-semibold">{providerImageCount ?? 'غير متاح'}</p>
                  </div>
                </div>

                {hasImageMismatch && (
                  <Alert variant="destructive">
                    <AlertTitle>تنبيه فوري: عدم تطابق في الصور</AlertTitle>
                    <AlertDescription>
                      تم إرسال {sentImageCount} صورة للدمج بينما المزود أكد {providerImageCount} فقط، وقد يسبب ذلك فيديو بعدد صور أقل من المتوقع.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">سجل Payload الدمج</p>
                <Badge variant="outline">{payloadVariant ? 'متوفر' : 'غير متوفر'}</Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div className="rounded-md bg-background/70 border px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-1">Payload Variant</p>
                  <p className="font-semibold">{payloadVariant ? (payloadVariantLabels[payloadVariant] ?? payloadVariant) : 'غير متاح'}</p>
                </div>
                <div className="rounded-md bg-background/70 border px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-1">Provider Status Endpoint</p>
                  <p className="font-mono text-xs break-all">{providerStatusEndpoint ?? 'غير متاح'}</p>
                </div>
              </div>
            </div>

            {isMergeSlow && (
              <Alert>
                <AlertTitle>تنبيه أداء: الدمج بطيء</AlertTitle>
                <AlertDescription>
                  خطوة الدمج تعمل منذ {mergeElapsedMinutes} دقيقة. يمكنك إلغاء المهمة وإعادة تشغيلها.
                </AlertDescription>
              </Alert>
            )}

            {/* Error Message */}
            {job.error_message && !isCancelledByUser && (
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
                  {job.steps.map((step) => {
                    const StepIcon = stepIcons[step.step_name] || FileVideo;
                    const label = stepLabels[step.step_name] || step.step_name;
                    const isFailedMerge =
                      (step.step_name === 'merge' || step.step_name === 'media_merge') &&
                      step.status === 'failed';

                    const sla = STEP_SLA[step.step_name];
                    const completedDuration =
                      step.started_at && step.completed_at
                        ? Math.floor(
                            (new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()) / 1000
                          )
                        : null;
                    const isCompletedOverSLA =
                      completedDuration !== null && sla !== undefined && completedDuration > sla;
                    
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
                              {/* Live timer for active steps */}
                              <StepTimer
                                startedAt={step.started_at}
                                stepName={step.step_name}
                                status={step.status}
                              />
                              {/* Completed duration badge */}
                              {completedDuration !== null && (
                                <span className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full border ${
                                  isCompletedOverSLA
                                    ? 'text-amber-600 border-amber-500/30 bg-amber-500/10'
                                    : 'text-muted-foreground border-border bg-muted/40'
                                }`}>
                                  <Timer className="h-3 w-3" />
                                  {formatElapsed(completedDuration)}
                                  {isCompletedOverSLA && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {isFailedMerge && canRetryMerge && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={handleRetryMerge}
                                  disabled={retrying}
                                >
                                  <RotateCcw className="h-3 w-3 ml-1" />
                                  إعادة
                                </Button>
                              )}
                              {getStatusBadge(step.status)}
                            </div>
                          </div>
                          
                          <div className="text-xs text-muted-foreground space-y-1">
                            {step.started_at && (
                              <p>بدأ: {format(new Date(step.started_at), 'PPp')}</p>
                            )}
                            {step.completed_at && (
                              <p>اكتمل: {format(new Date(step.completed_at), 'PPp')}</p>
                            )}
                          </div>

                          {/* SLA warning for completed step that took too long */}
                          {isCompletedOverSLA && sla && (
                            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              استغرقت هذه الخطوة {formatElapsed(completedDuration!)} وهو أبطأ من المتوقع ({formatElapsed(sla)})
                            </div>
                          )}
                          
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
