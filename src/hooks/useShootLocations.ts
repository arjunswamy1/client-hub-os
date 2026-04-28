import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShootLocation } from '@/types/production';

export function useShootLocations() {
  return useQuery({
    queryKey: ['shoot_locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shoot_locations')
        .select('*')
        .order('name');
      if (error) throw error;
      return (data || []) as unknown as ShootLocation[];
    },
  });
}

export function useUpsertLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (loc: Partial<ShootLocation> & { name: string; city: string }) => {
      if (loc.id) {
        const { error } = await supabase
          .from('shoot_locations')
          .update(loc as any)
          .eq('id', loc.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('shoot_locations').insert(loc as any);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoot_locations'] }),
  });
}

export function useDeleteLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('shoot_locations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shoot_locations'] }),
  });
}
