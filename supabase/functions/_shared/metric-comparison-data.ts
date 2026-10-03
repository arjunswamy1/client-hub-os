// Builds the snapshots the comparison layer needs, from the same canonical metric
// engine the CPM bot uses (computeClientMetrics). The drafter and the bot both call
// buildComparisonSet(); neither computes a comparison of its own.
import { computeClientMetrics } from './client-metrics.ts';
import type { ResolvedClientRow } from './client-resolve.ts';
import {
  classifyDay, classifyWindow, compare, isProvisional,
  type ComparisonSet, type DayState, type Observation, type Snapshot,
} from './metric-comparisons.ts';

/** Where a null reporting timezone is used to decide when a day has CLOSED. */
export const CLOSE_FALLBACK_TZ = 'America/New_York';

export interface ComparisonClient extends ResolvedClientRow {
  metrics_reliable_from?: string | null;
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const ENTITY_SCOPED = new Set(['roku_daily_metrics']);

/** Per-day spend rows, impressions and active-campaign evidence for the classifier. */
async function dayEvidence(db: any, client: ComparisonClient, from: string, to: string) {
  const byDay = new Map<string, { rows: number; spend: number; impressions: number; impressionRows: number; active: boolean }>();
  const get = (d: string) => {
    if (!byDay.has(d)) byDay.set(d, { rows: 0, spend: 0, impressions: 0, impressionRows: 0, active: false });
    return byDay.get(d)!;
  };
  for (const table of client.spend_source_tables ?? []) {
    if (!['ad_daily_metrics', 'roku_daily_metrics', 'cannaball_spend'].includes(table)) continue;
    let q = db.from(table).select('date, spend, impressions').eq('client_id', client.id).gte('date', from).lte('date', to);
    if (ENTITY_SCOPED.has(table)) q = q.eq('entity', 'campaign');
    const { data, error } = await q.limit(20000);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data ?? []) {
      const e = get(String(r.date).slice(0, 10));
      e.rows++;
      e.spend += Number(r.spend ?? 0);
      if (r.impressions !== null && r.impressions !== undefined) { e.impressions += Number(r.impressions); e.impressionRows++; }
    }
  }
  // An active campaign row on a $0 day means it was live, not dark.
  if ((client.spend_source_tables ?? []).includes('ad_daily_metrics')) {
    const { data } = await db.from('ad_campaigns').select('date, status').eq('client_id', client.id)
      .gte('date', from).lte('date', to).limit(20000);
    for (const r of data ?? []) {
      if (/^(active|enabled)$/i.test(String(r.status ?? ''))) {
        const d = String(r.date).slice(0, 10);
        if (byDay.has(d)) byDay.get(d)!.active = true;
      }
    }
  }
  return byDay;
}

async function snapshot(
  db: any, client: ComparisonClient, from: string, to: string,
  evidence: Awaited<ReturnType<typeof dayEvidence>>,
): Promise<Snapshot> {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const states: DayState[] = days.map((d) => {
    const e = evidence.get(d);
    return classifyDay({ rowCount: e?.rows ?? 0, spend: e?.spend ?? 0, anyActiveCampaign: e?.active });
  });
  const w = days.length === 1 ? { state: states[0] } : classifyWindow(states);
  const base: Snapshot = {
    from, to, state: w.state, stateNote: (w as { note?: string }).note,
    spend: null, revenue: null, calls: null, connected: null, billable: null, impressions: null,
  };
  if (w.state !== 'available') return base;

  const m = await computeClientMetrics(db, client, { from, to });
  const val = (k: string) => m.metrics.find((x) => x.key === k)?.value ?? null;
  const impressionRows = days.reduce((s, d) => s + (evidence.get(d)?.impressionRows ?? 0), 0);
  return {
    ...base,
    spend: val('spend'),
    revenue: val('revenue'),
    calls: val('calls'),
    connected: val('connected_calls'),
    billable: val('converted_calls'),
    impressions: impressionRows ? days.reduce((s, d) => s + (evidence.get(d)?.impressions ?? 0), 0) : null,
  };
}

/** UTC instant at which a calendar date ends in a timezone. */
export function dayClosesAt(isoDate: string, timeZone: string): Date {
  const next = addDays(isoDate, 1);
  const guess = new Date(`${next}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  return new Date(guess.getTime() - (local - guess.getTime()));
}

/**
 * D-1 and its three comparisons for one client. `forDate` is the reporting day
 * (D-1); today is never passed in.
 */
export async function buildComparisonSet(
  db: any, client: ComparisonClient, forDate: string, now: Date = new Date(),
): Promise<ComparisonSet> {
  const D = (n: number) => addDays(forDate, -(n - 1)); // D(1) = forDate
  const evidence = await dayEvidence(db, client, D(14), D(1));

  const [d1, d2, d8, w1, w2] = await Promise.all([
    snapshot(db, client, D(1), D(1), evidence),
    snapshot(db, client, D(2), D(2), evidence),
    snapshot(db, client, D(8), D(8), evidence),
    snapshot(db, client, D(7), D(1), evidence),
    snapshot(db, client, D(14), D(8), evidence),
  ]);
  const opts = { engagement: client.engagement_type, reliableFrom: client.metrics_reliable_from ?? null };

  const { data: obs } = await db.from('metric_revision_log').select('source, observed_at, spend, revenue, calls')
    .eq('client_id', client.id).eq('metric_date', forDate).order('observed_at', { ascending: false }).limit(50);
  const provisional = isProvisional({
    observations: (obs ?? []) as Observation[],
    closedAt: dayClosesAt(forDate, client.reporting_timezone || CLOSE_FALLBACK_TZ),
    now,
  });

  return {
    client: client.name,
    engagement: client.engagement_type,
    forDate,
    reliableFrom: opts.reliableFrom,
    day: d1,
    comparisons: [
      compare('vs_same_weekday', d1, d8, opts),
      compare('vs_prior_day', d1, d2, opts),
      compare('vs_prior_week', w1, w2, opts),
    ],
    provisional,
  };
}
