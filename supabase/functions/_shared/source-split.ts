// Per-source split (e.g. Roku vs Universal Ads) for accounts whose tracking
// numbers are date-ranged to a platform in client_did_periods. Calls and payout
// follow the DID's platform on the call's reporting day; spend comes from the
// engine's per-source day totals. A DID with no period that day is UNATTRIBUTED,
// never guessed. Pure rules first, then one loader.
// deno-lint-ignore no-explicit-any
type Db = any;
import { reportingDay, reportingWindowBounds } from './reporting-day.ts';

export interface DidPeriod { did: string; platform: string; effective_from: string; effective_to: string | null }
export interface SplitCall { did: string | null; call_start: string; connected: boolean | null; payout: number | null }

export interface CallRates {
  calls: number; connected: number | null; revenue: number | null; spend: number | null;
  /** Revenue ÷ connected calls — matches CallGrid's RPC. Media Brain's canonical RPC (÷ total calls) is reported separately. */
  revenue_per_connected_call: number | null;
  revenue_per_call: number | null;
  cost_per_connected_call: number | null;
  /** (calls − connected) ÷ calls. */
  no_connect_rate: number | null;
  roas: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Rates from totals. Unknown inputs give null, never 0; a zero denominator gives null. */
export function callRates(t: { calls: number; connected: number | null; revenue: number | null; spend: number | null }): CallRates {
  const { calls, connected, revenue, spend } = t;
  return {
    calls, connected, revenue: revenue === null ? null : r2(revenue), spend: spend === null ? null : r2(spend),
    revenue_per_connected_call: revenue !== null && connected ? r2(revenue / connected) : null,
    revenue_per_call: revenue !== null && calls ? r2(revenue / calls) : null,
    cost_per_connected_call: spend !== null && spend > 0 && connected ? r2(spend / connected) : null,
    no_connect_rate: connected !== null && calls ? r4((calls - connected) / calls) : null,
    roas: revenue !== null && spend ? r2(revenue / spend) : null,
  };
}

const digits = (d: string | null) => (d ?? '').replace(/\D/g, '').slice(-10);

export function platformFor(periods: DidPeriod[], did: string | null, day: string): string | null {
  const key = digits(did);
  if (!key) return null;
  const hit = periods.find((p) => digits(p.did) === key && p.effective_from <= day && (!p.effective_to || p.effective_to >= day));
  return hit?.platform ?? null;
}

/** spendBySource keys are engine labels (roku, universal_ads, …); period platforms use the same labels. */
export function splitBySource(calls: SplitCall[], periods: DidPeriod[], spendBySource: Record<string, number>, timeZone: string) {
  const acc = new Map<string, { calls: number; connected: number; revenue: number }>();
  for (const c of calls) {
    const p = platformFor(periods, c.did, reportingDay(c.call_start, timeZone)) ?? 'unattributed';
    const a = acc.get(p) ?? { calls: 0, connected: 0, revenue: 0 };
    a.calls++; if (c.connected) a.connected++; a.revenue += Number(c.payout ?? 0);
    acc.set(p, a);
  }
  const labels = [...new Set([...Object.keys(spendBySource), ...acc.keys()])].sort();
  return labels.map((source) => {
    const a = acc.get(source) ?? { calls: 0, connected: 0, revenue: 0 };
    const spend = source === 'unattributed' ? null : (spendBySource[source] ?? null);
    return { source, ...callRates({ calls: a.calls, connected: a.connected, revenue: a.revenue, spend }) };
  });
}

/** Accounts that split by source: Cannaball (cannaball_calls + date-ranged DID periods). */
export const SPLIT_CALL_TABLES: Record<string, string> = { cannaball: 'cannaball_calls' };

export async function loadSourceSplit(
  db: Db, client: { id: string; slug?: string | null }, window: { from: string; to: string }, timeZone: string, spendBySource: Record<string, number>,
) {
  const table = client.slug ? SPLIT_CALL_TABLES[client.slug] : undefined;
  if (!table) return null;
  const { data: periods } = await db.from('client_did_periods').select('did, platform, effective_from, effective_to').eq('client_id', client.id);
  if (!periods?.length) return null;
  const { startTs, endTs } = reportingWindowBounds(window, timeZone);
  const calls: SplitCall[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db.from(table).select('id, did, call_start, connected, payout').eq('client_id', client.id)
      .gte('call_start', startTs).lte('call_start', endTs).order('call_start').order('id').range(f, f + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    calls.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return {
    basis: 'Calls and payout follow the tracking number\'s platform on the call day (client_did_periods); spend is per source from the spend feeds. Revenue = payout.',
    sources: splitBySource(calls, periods, spendBySource, timeZone),
  };
}
