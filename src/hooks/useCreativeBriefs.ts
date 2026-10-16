
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useClient } from '@/contexts/ClientContext';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export function useCreativeBriefs(options?: { allClients?: boolean }) {
  const { activeClient } = useClient();
  const { teamMember, isDesigner } = useAuth();

  return useQuery({
    queryKey: ['creative_briefs', options?.allClients ? 'all' : activeClient?.id, isDesigner ? teamMember?.id : null],
    queryFn: async () => {
      let query = supabase
        .from('creative_briefs')
        .select(`
          *,
          client:clients!creative_briefs_client_id_fkey(id, name, color),
          assigned_to:team_members!creative_briefs_assigned_to_id_fkey(id, name, email, avatar_url),
          created_by:team_members!creative_briefs_created_by_id_fkey(id, name),
          accepted_by:team_members!creative_briefs_accepted_by_id_fkey(id, name)
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (!options?.allClients && activeClient) {
        query = query.eq('client_id', activeClient.id);
      }

      if (isDesigner && teamMember) {
        query = query.eq('assigned_to_id', teamMember.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((b: any) => ({
        ...b,
        client_name: b.client?.name || (b.client_id ? 'Unknown' : 'Internal'),
        client_color: b.client?.color || '#94a3b8',
      }));
    },
    enabled: options?.allClients ? true : !!activeClient,
  });
}

export function useCreativeDeliverables(briefId: string | null) {
  return useQuery({
    queryKey: ['creative_deliverables', briefId],
    queryFn: async () => {
      if (!briefId) return [];
      const { data, error } = await supabase
        .from('creative_deliverables')
        .select('*, uploaded_by:team_members!creative_deliverables_uploaded_by_id_fkey(name)')
        .eq('brief_id', briefId)
        .order('concept_label', { ascending: true })
        .order('size_label', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!briefId,
  });
}

export function useCreativeReviews(briefId: string | null) {
  return useQuery({
    queryKey: ['creative_reviews', briefId],
    queryFn: async () => {
      if (!briefId) return [];
      const { data, error } = await supabase
        .from('creative_reviews')
        .select('*, reviewer:team_members!creative_reviews_reviewer_id_fkey(name)')
        .eq('brief_id', briefId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!briefId,
  });
}

export function useBriefComments(briefId: string | null) {
  return useQuery({
    queryKey: ['brief_comments', briefId],
    queryFn: async () => {
      if (!briefId) return [];
      const { data, error } = await supabase
        .from('creative_brief_comments')
        .select('*, author:team_members!creative_brief_comments_author_id_fkey(name, avatar_url)')
        .eq('brief_id', briefId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!briefId,
  });
}

export function useTimeEntries(briefId?: string | null, teamMemberId?: string | null) {
  return useQuery({
    queryKey: ['creative_time_entries', briefId, teamMemberId],
    queryFn: async () => {
      let query = supabase
        .from('creative_time_entries')
        .select('*, brief:creative_briefs!creative_time_entries_brief_id_fkey(title, client_id), client:clients!creative_time_entries_client_id_fkey(name, color)')
        .is('deleted_at', null)
        .order('started_at', { ascending: false });

      if (briefId) query = query.eq('brief_id', briefId);
      if (teamMemberId) query = query.eq('team_member_id', teamMemberId);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: true,
  });
}

export function useDesignerCap(teamMemberId: string | null) {
  const month = new Date();
  month.setDate(1);
  const monthStr = month.toISOString().slice(0, 10);

  return useQuery({
    queryKey: ['designer_cap', teamMemberId, monthStr],
    queryFn: async () => {
      if (!teamMemberId) return { cap_hours: 80 };
      const { data } = await supabase
        .from('designer_monthly_caps')
        .select('*')
        .eq('team_member_id', teamMemberId)
        .eq('month', monthStr)
        .maybeSingle();
      return data || { cap_hours: 80 };
    },
    enabled: !!teamMemberId,
  });
}

export function useBriefMutations() {
  const queryClient = useQueryClient();
  const { teamMember } = useAuth();

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, extras }: { id: string; status: string; extras?: Record<string, any> }) => {
      const updates: any = { status, ...extras };
      if (status === 'on_hold' && !String(extras?.hold_reason ?? '').trim()) throw new Error('A reason is required to put a request on hold.');
      if (status === 'submitted') updates.submitted_at = new Date().toISOString();
      if (status === 'approved') updates.approved_at = new Date().toISOString();
      if (status === 'delivered') {
        updates.delivered_at = new Date().toISOString();
        updates.trafficked_by_id = teamMember?.id;
        updates.trafficked_at = new Date().toISOString();
      }
      const { error } = await supabase.from('creative_briefs').update(updates as any).eq('id', id);
      if (error) throw error;
      // The database queued the designer DM on the transition into submitted; ask
      // for delivery. A Slack problem never blocks the submission.
      if (status === 'submitted') deliverBriefNotifications(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
      queryClient.invalidateQueries({ queryKey: ['brief_notifications'] });
      toast.success('Status updated');
    },
    onError: (err: any) => toast.error(/hold_reason_required/.test(err.message) ? 'A reason is required to put a request on hold.' : err.message),
  });

  // Same conditional accept statement the Slack button uses (accepted_via = 'tracker').
  const acceptBrief = useMutation({
    mutationFn: async (briefId: string) => {
      const { data, error } = await supabase.rpc('accept_creative_brief', { p_brief_id: briefId });
      if (error) throw error;
      const r = data as any;
      if (r?.outcome !== 'accepted') throw new Error(refusalMessage(r));
      deliverBriefNotifications(briefId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
      queryClient.invalidateQueries({ queryKey: ['brief_notifications'] });
      toast.success('Brief accepted');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const addComment = useMutation({
    mutationFn: async ({ briefId, content }: { briefId: string; content: string }) => {
      const { error } = await supabase.from('creative_brief_comments').insert({
        brief_id: briefId,
        author_id: teamMember!.id,
        content,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brief_comments'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const addReview = useMutation({
    mutationFn: async ({ briefId, deliverableId, action, comments }: {
      briefId: string; deliverableId?: string; action: string; comments: string;
    }) => {
      const { error: reviewError } = await supabase.from('creative_reviews').insert({
        brief_id: briefId,
        deliverable_id: deliverableId || null,
        reviewer_id: teamMember!.id,
        action,
        comments: comments || null,
      } as any);
      if (reviewError) throw reviewError;

      if (deliverableId) {
        const newStatus = action === 'approved' ? 'approved' : 'revision_requested';
        const updates: any = { status: newStatus };
        if (action !== 'approved') updates.revision_note = comments;
        else {
          updates.approved_by_id = teamMember!.id;
          updates.approved_at = new Date().toISOString();
        }
        const { error } = await supabase.from('creative_deliverables').update(updates).eq('id', deliverableId);
        if (error) throw error;
      } else {
        const newStatus = action === 'approved' ? 'approved' : 'revision_requested';
        const { error } = await supabase.from('creative_briefs').update({ status: newStatus } as any).eq('id', briefId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
      queryClient.invalidateQueries({ queryKey: ['creative_reviews'] });
      queryClient.invalidateQueries({ queryKey: ['creative_deliverables'] });
      toast.success('Review submitted');
    },
    onError: (err: any) => toast.error(err.message),
  });

  return { updateStatus, addComment, addReview, acceptBrief };
}

function deliverBriefNotifications(briefId: string) {
  supabase.functions.invoke('brief-notifications', { body: { action: 'deliver', brief_id: briefId } })
    .catch((e) => console.warn('brief notification delivery deferred:', e));
}

function refusalMessage(r: any): string {
  switch (r?.outcome) {
    case 'rejected_already_accepted': return `Already accepted${r.accepted_by ? ` by ${r.accepted_by}` : ''}.`;
    case 'rejected_not_assignee': return r.current_assignee ? `This brief is assigned to ${r.current_assignee}.` : 'This brief is not assigned to you.';
    case 'rejected_not_submitted': return `This brief is ${String(r.status ?? 'no longer submitted').replace(/_/g, ' ')}.`;
    case 'rejected_unknown_actor': return 'Your account is not linked to a team member.';
    default: return 'Could not accept this brief.';
  }
}

export function useBriefNotifications(briefId: string | null) {
  return useQuery({
    queryKey: ['brief_notifications', briefId],
    queryFn: async () => {
      const { data, error } = await supabase.from('brief_notifications')
        .select('id, kind, status, last_error, attempts, recipient:team_members!brief_notifications_recipient_team_member_id_fkey(name)')
        .eq('brief_id', briefId!).order('created_at');
      if (error) throw error;
      return data || [];
    },
    enabled: !!briefId,
  });
}
