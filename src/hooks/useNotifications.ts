
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useEffect } from 'react';

export function useNotifications() {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', teamMember?.id],
    queryFn: async () => {
      if (!teamMember) return [];
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('recipient_id', teamMember.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!teamMember,
  });

  // Realtime subscription
  useEffect(() => {
    if (!teamMember) return;
    const channel = supabase
      .channel('notifications-' + teamMember.id)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${teamMember.id}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [teamMember?.id, queryClient]);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!teamMember) return;
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('recipient_id', teamMember.id)
        .eq('is_read', false);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unreadCount = notifications.filter((n: any) => !n.is_read).length;

  return { notifications, unreadCount, markRead, markAllRead };
}

export async function createNotification(params: {
  recipientId: string;
  type: string;
  title: string;
  message?: string;
  briefId?: string;
}) {
  const { error } = await supabase.from('notifications').insert({
    recipient_id: params.recipientId,
    type: params.type,
    title: params.title,
    message: params.message || null,
    brief_id: params.briefId || null,
  });
  if (error) console.error('Failed to create notification:', error);
}
