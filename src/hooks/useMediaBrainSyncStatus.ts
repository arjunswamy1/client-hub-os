/**
 * Per-source delivery health for one client (media_brain_sync_status).
 *
 * This hook fetches and classifies staleness against the review window. It derives
 * no media figures. `never_run` and `stale` are deliberately kept apart: "never
 * delivered" and "stopped delivering" are different problems with different fixes,
 * and conflating them is what let Moja sit silent for three weeks.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type SyncSource = 'ringba' | 'moja' | 'meta' | 'google' | 'roku' | 'callgrid' | 'context_wispr';
export type SyncStatusValue = 'ok' | 'error' | 'stale' | 'never_run';

export interface SyncStatusRow {
  id: string;
  source: SyncSource;
  client_id: string | null;
  last_attempted_at: string | null;
  last_succeeded_at: string | null;
  rows_written: number | null;
  status: SyncStatusValue;
  error: string | null;
  token_status: string | null;
  detail: Record<string, unknown> | null;
  updated_at: string;
}

/** A source that has not succeeded inside this many hours has stopped delivering. */
export const REVIEW_WINDOW_HOURS = 48;

export interface SyncBreaker {
  source: SyncSource;
  /** The effective state — 'stale' is derived here, the other three are stored. */
  state: SyncStatusValue;
  row: SyncStatusRow;
  evidence: string;
  action: string;
}

const SOURCE_LABEL: Record<SyncSource, string> = {
  ringba: 'Ringba',
  moja: 'Moja',
  meta: 'Meta Ads',
  google: 'Google Ads',
  roku: 'Roku',
  callgrid: 'CallGrid',
  // A context feed that silently stops updating is the same class of defect as a
  // broken ad sync, and harder to notice because nothing errors.
  context_wispr: 'Wispr meeting notes',
};

const fmtStamp = (iso: string | null) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'never');

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

/** Pure: turn stored rows into breakers. Exported so it can be tested without a DB. */
export function syncBreakers(rows: SyncStatusRow[], reviewWindowHours = REVIEW_WINDOW_HOURS): SyncBreaker[] {
  const out: SyncBreaker[] = [];
  for (const row of rows) {
    const label = SOURCE_LABEL[row.source] ?? row.source;
    const age = hoursSince(row.last_succeeded_at);

    if (row.status === 'never_run') {
      out.push({
        source: row.source,
        state: 'never_run',
        row,
        evidence: `${label} has NEVER delivered a single record. ${row.error ?? 'No delivery has ever been received on this endpoint.'}`,
        action: `Register the ${label} endpoint at the source and send a test delivery. This is not a broken feed — it was never connected, so no amount of waiting will fix it. Nothing downstream can be read for ${label} until the first delivery lands.`,
      });
      continue;
    }

    if (row.status === 'error') {
      out.push({
        source: row.source,
        state: 'error',
        row,
        evidence: `${label} is erroring. Last attempt ${fmtStamp(row.last_attempted_at)}; last success ${fmtStamp(
          row.last_succeeded_at,
        )}. ${row.error ?? 'No error text recorded.'}${row.token_status ? ` Token status: ${row.token_status}.` : ''}`,
        action:
          row.token_status === 'expired' || row.token_status === 'invalid'
            ? `Reconnect ${label} in Settings — the credential no longer authenticates. Pause spend decisions that depend on ${label} until it syncs, and treat the missing data as unknown, not zero.`
            : `Investigate the ${label} error today and re-run the sync. Treat the missing window as unknown, not zero.`,
      });
      continue;
    }

    if (row.status === 'stale' || (age !== null && age > reviewWindowHours) || row.last_succeeded_at === null) {
      out.push({
        source: row.source,
        state: 'stale',
        row,
        evidence: `${label} has STOPPED delivering. Last success ${fmtStamp(row.last_succeeded_at)}${
          age !== null ? ` — ${Math.floor(age)}h ago, past the ${reviewWindowHours}h review window` : ''
        }. Last attempt ${fmtStamp(row.last_attempted_at)}.${row.error ? ` ${row.error}` : ''}`,
        action: `Check the ${label} feed today — it delivered before and does not now. Pause all spend decisions that rely on it and alert the account team; spend is accruing against data that is not arriving.`,
      });
    }
  }
  return out;
}

export function useMediaBrainSyncStatus(clientId: string | undefined) {
  return useQuery({
    queryKey: ['media-brain-sync-status', clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async (): Promise<SyncStatusRow[]> => {
      const { data, error } = await supabase
        .from('media_brain_sync_status')
        .select('*')
        .eq('client_id', clientId!)
        .order('source');
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as SyncStatusRow[];
    },
  });
}
