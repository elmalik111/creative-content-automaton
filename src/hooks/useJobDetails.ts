import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Job, JobStep, JobType, JobStatus } from '@/types/database';

export interface JobWithSteps extends Job {
  steps: JobStep[];
}

export function useJobDetails(jobId: string) {
  return useQuery({
    queryKey: ['job-details', jobId],
    queryFn: async (): Promise<JobWithSteps | null> => {
      // "Tick" the job-status edge function so long-running provider jobs (FFmpeg merge)
      // can be advanced reliably without depending on background serverless execution.
      // We intentionally ignore errors here to avoid breaking the UI.
      try {
        await supabase.functions.invoke('job-status', {
          body: { job_id: jobId },
        });
      } catch {
        // no-op
      }

      // Fetch job
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();

      if (jobError) throw jobError;
      if (!job) return null;

      // Fetch steps
      const { data: steps, error: stepsError } = await supabase
        .from('job_steps')
        .select('*')
        .eq('job_id', jobId)
        .order('step_order');

      if (stepsError) throw stepsError;

      return {
        ...job,
        type: job.type as JobType,
        status: job.status as JobStatus,
        steps: (steps || []).map(step => ({
          ...step,
          status: step.status as JobStep['status'],
        })),
      };
    },
    refetchInterval: 3000,
    enabled: !!jobId,
  });
}
