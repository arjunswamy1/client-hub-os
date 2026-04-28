import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShootBrief, ShootScript, ShootCast, ShootFootage } from '@/types/production';

export function useShootBriefs() {
  return useQuery({
    queryKey: ['shoot_briefs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shoot_briefs')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ShootBrief[];
    },
  });
}

export function useShootBrief(id: string | undefined) {
  return useQuery({
    queryKey: ['shoot_brief', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('shoot_briefs')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ShootBrief | null;
    },
    enabled: !!id,
  });
}

export function useShootScripts(briefId: string | undefined) {
  return useQuery({
    queryKey: ['shoot_scripts', briefId],
    queryFn: async () => {
      if (!briefId) return [];
      const { data, error } = await supabase
        .from('shoot_scripts')
        .select('*')
        .eq('brief_id', briefId)
        .order('position');
      if (error) throw error;
      return (data || []) as unknown as ShootScript[];
    },
    enabled: !!briefId,
  });
}

export function useShootCast(briefId: string | undefined) {
  return useQuery({
    queryKey: ['shoot_cast', briefId],
    queryFn: async () => {
      if (!briefId) return [];
      const { data, error } = await supabase
        .from('shoot_cast')
        .select('*, actor:talent_actors(*)')
        .eq('brief_id', briefId);
      if (error) throw error;
      return (data || []) as unknown as ShootCast[];
    },
    enabled: !!briefId,
  });
}

export function useShootFootage(briefId: string | undefined) {
  return useQuery({
    queryKey: ['shoot_footage', briefId],
    queryFn: async () => {
      if (!briefId) return [];
      const { data, error } = await supabase
        .from('shoot_footage')
        .select('*')
        .eq('brief_id', briefId)
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ShootFootage[];
    },
    enabled: !!briefId,
  });
}

export function useUpdateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<ShootBrief> }) => {
      const { error } = await supabase.from('shoot_briefs').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['shoot_briefs'] });
      qc.invalidateQueries({ queryKey: ['shoot_brief', vars.id] });
    },
  });
}

export function useDeleteBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('shoot_briefs').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoot_briefs'] }),
  });
}
