import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ElevenLabsKey } from '@/types/database';

export function useElevenLabsKeys() {
  return useQuery({
    queryKey: ['elevenlabs-keys'],
    queryFn: async (): Promise<ElevenLabsKey[]> => {
      const { data, error } = await supabase
        .from('elevenlabs_keys')
        .select('*')
        .order('usage_count', { ascending: true });

      if (error) throw error;
      return data || [];
    },
  });
}

export function useAddElevenLabsKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ name, apiKey }: { name: string; apiKey: string }) => {
      const { error } = await supabase
        .from('elevenlabs_keys')
        .insert({ name, api_key: apiKey });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['elevenlabs-keys'] });
    },
  });
}

export function useRemoveElevenLabsKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('elevenlabs_keys')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['elevenlabs-keys'] });
    },
  });
}

export function useToggleElevenLabsKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('elevenlabs_keys')
        .update({ is_active: isActive })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['elevenlabs-keys'] });
    },
  });
}
