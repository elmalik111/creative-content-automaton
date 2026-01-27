import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Job, JobType, JobStatus } from '@/types/database';

export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: async (): Promise<Job[]> => {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      
      return (data || []).map(job => ({
        ...job,
        type: job.type as JobType,
        status: job.status as JobStatus,
      }));
    },
    refetchInterval: 5000,
  });
}

export function useJobStats() {
  return useQuery({
    queryKey: ['job-stats'],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: activeJobs, error: activeError } = await supabase
        .from('jobs')
        .select('id', { count: 'exact' })
        .in('status', ['pending', 'processing']);

      if (activeError) throw activeError;

      const { data: completedToday, error: completedError } = await supabase
        .from('jobs')
        .select('id', { count: 'exact' })
        .eq('status', 'completed')
        .gte('created_at', today.toISOString());

      if (completedError) throw completedError;

      return {
        activeCount: activeJobs?.length || 0,
        completedTodayCount: completedToday?.length || 0,
      };
    },
    refetchInterval: 5000,
  });
}
