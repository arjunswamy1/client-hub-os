import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export function useShootBriefComments(briefId: string | null | undefined) {
  return useQuery({
    queryKey: ['shoot_brief_comments', briefId],
    queryFn: async () => {
      if (!briefId) return [];
      const { data, error } = await supabase
        .from('shoot_brief_comments' as any)
        .select('id, content, created_at, author_id, author:team_members!shoot_brief_comments_author_id_fkey(name, avatar_url)')
        .eq('brief_id', briefId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!briefId,
  });
}

export function useAddShootBriefComment() {
  const qc = useQueryClient();
  const { teamMember } = useAuth();
  return useMutation({
    mutationFn: async ({ briefId, content }: { briefId: string; content: string }) => {
      if (!teamMember) throw new Error('Not signed in');
      const { error } = await supabase.from('shoot_brief_comments' as any).insert({
        brief_id: briefId,
        author_id: teamMember.id,
        content,
      } as any);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['shoot_brief_comments', vars.briefId] });
    },
    onError: (err: any) => toast.error(err.message),
  });
}
