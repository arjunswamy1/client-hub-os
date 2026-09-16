/**
 * Delivery health for the context feed (context_sync_log).
 *
 * Fetches and hands over; the fold into the shared sync-status shape lives once
 * in src/lib/contextFeed.ts. Agency-level sync rows carry no client_id, so both
 * the client's own rows and the agency rows are read.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { contextSyncStatusRow, type ContextSyncLogRow } from '@/lib/contextFeed';
import type { SyncStatusRow } from './useMediaBrainSyncStatus';

export function useContextSyncStatus(clientId: string | undefined, source = 'wispr') {
  return useQuery({
    queryKey: ['context-sync-status', clientId, source],
    staleTime: 60_000,
    queryFn: async (): Promise<SyncStatusRow> => {
      let query = supabase
        .from('context_sync_log')
        .select('source, client_id, last_sync_at, status, items_synced, error_message')
        .eq('source', source)
        .order('last_sync_at', { ascending: false })
        .limit(50);
      if (clientId) query = query.or(`client_id.eq.${clientId},client_id.is.null`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return contextSyncStatusRow((data ?? []) as unknown as ContextSyncLogRow[], source);
    },
  });
}
