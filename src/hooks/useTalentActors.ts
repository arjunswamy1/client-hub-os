import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { TalentActor } from '@/types/production';

export function useTalentActors() {
  return useQuery({
    queryKey: ['talent_actors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('talent_actors')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as TalentActor[];
    },
  });
}

export function useTalentActor(id: string | undefined) {
  return useQuery({
    queryKey: ['talent_actor', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('talent_actors')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TalentActor | null;
    },
    enabled: !!id,
  });
}

export function useUpdateActor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<TalentActor> }) => {
      const { error } = await supabase
        .from('talent_actors')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['talent_actors'] });
      qc.invalidateQueries({ queryKey: ['talent_actor', vars.id] });
    },
  });
}
