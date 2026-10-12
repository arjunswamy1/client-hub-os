// Reads RingFuel calls for one client and window and summarises them with the
// pure rules in ringfuel-call-rules.ts. Test calls are always excluded.
// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
import { reportingWindowBounds } from './reporting-day.ts';
import { summariseCalls, type CallQualitySummary, type RingFuelCallLike } from './ringfuel-call-rules.ts';

const COLS = 'id, call_start, end_reason, connection_duration_seconds, caller_number, revenue, revenue_reconciled';

export async function loadCallQuality(
  db: SupabaseClient, clientId: string, window: { from: string; to: string }, timeZone: string, now = new Date(),
): Promise<CallQualitySummary> {
  const { startTs, endTs } = reportingWindowBounds(window, timeZone);
  const rows: RingFuelCallLike[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('ringfuel_calls').select(COLS)
      .eq('client_id', clientId).eq('is_test', false)
      .gte('call_start', startTs).lte('call_start', endTs)
      .order('call_start', { ascending: true }).order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`ringfuel_calls read failed: ${error.message}`);
    rows.push(...((data ?? []) as RingFuelCallLike[]));
    if (!data || data.length < 1000) break;
  }
  return summariseCalls(rows, now);
}

/** One plain line for internal notes and the fact sheet; unknown parts say so, never zero. */
export function callQualityLine(q: CallQualitySummary): string {
  if (!q.calls) return 'Call quality: no calls recorded for this period.';
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const parts = [
    q.strict_connected !== null ? `${q.strict_connected} of ${q.calls} calls truly connected (${pct(q.strict_connected / q.calls)})` : 'connected calls unknown (end reason missing)',
    q.acl_seconds !== null ? `average connected length ${Math.round(q.acl_seconds)}s, median ${Math.round(q.median_seconds!)}s` : null,
    q.share_at ? `${pct(q.share_at.s90)} past 90s, ${pct(q.share_at.m10)} past 10m, ${pct(q.share_at.m20)} past 20m, ${pct(q.share_at.m30)} past 30m (of connected)` : null,
    q.repeat_call_rate !== null ? `${q.unique_callers} unique callers, repeat-call rate ${pct(q.repeat_call_rate)}` : 'repeat callers unknown (caller number missing)',
  ].filter(Boolean);
  return `Call quality: ${parts.join('; ')}.${q.revenue_provisional ? ' Revenue for some calls is still provisional (not yet confirmed by a RingFuel export or 7 days old).' : ''}`;
}

/** Strict call quality applies only to RingFuel call accounts paid per call (not the Jacuzzi lead sheet). */
export function hasRingFuelCallQuality(c: { slug?: string | null; call_source_tables?: string[] | null }): boolean {
  return c.slug !== 'jacuzzi' && (c.call_source_tables ?? []).includes('ringfuel_calls');
}
