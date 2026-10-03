// Builds the snapshots the comparison layer needs from ONE call to the canonical
// metric engine (computeClientMetrics) over the 28 days ending on the reporting
// day. The drafter and the CPM bot both call buildComparisonSet(); the drafter's
// day series comes from the same loadDailySeries() result, so the 9am update and
// the bot can never disagree on spend, revenue or calls for a day.
import { computeClientMetrics, type ClientMetrics, type DayFigures } from './client-metrics.ts';
import type { ResolvedClientRow } from './client-resolve.ts';
import { addDays, dayEndsAt, reportingTimeZone } from './reporting-day.ts';
import { LOGGED_SPEND_SOURCES } from './metric-revision-log.ts';
import {
  classifyDay, classifyWindow, compare, isProvisional,
  type ComparisonSet, type DayState, type Observation, type Snapshot,
} from './metric-comparisons.ts';

export type ComparisonClient = ResolvedClientRow;
export { addDays };

export const SERIES_DAYS = 28;

const ENTITY_SCOPED = new Set(['roku_daily_metrics']);
const EVIDENCE_TABLES = new Set(['ad_daily_metrics', 'roku_daily_metrics', 'cannaball_spend']);

export interface SeriesDay extends DayFigures {
  state: DayState;
  impressions: number | null;
  /** Per spend source, this day's state — holding mode reports them separately. */
  sourceStates: { source: string; state: DayState }[];
}

export interface DailySeries {
  client: ComparisonClient;
  forDate: string;
  timeZone: string;
  engine: ClientMetrics;
  days: SeriesDay[];
}

/** Impressions, active-campaign evidence and per-source row presence. Never counts money or calls. */
async function dayEvidence(db: any, client: ComparisonClient, from: string, to: string) {
  const bySourceDay = new Map<string, Map<string, { rows: number; spend: number }>>();
  const impressions = new Map<string, { n: number; rows: number }>();
  const active = new Set<string>();
  const sources = (client.spend_source_tables ?? []).filter((t) => EVIDENCE_TABLES.has(t));
  for (const table of sources) {
    let q = db.from(table).select('date, spend, impressions').eq('client_id', client.id).gte('date', from).lte('date', to);
    if (ENTITY_SCOPED.has(table)) q = q.eq('entity', 'campaign');
    const { data, error } = await q.limit(20000);
    if (error) throw new Error(`${table}: ${error.message}`);
    const m = new Map<string, { rows: number; spend: number }>();
    bySourceDay.set(table, m);
    for (const r of data ?? []) {
      const d = String(r.date).slice(0, 10);
      const e = m.get(d) ?? { rows: 0, spend: 0 };
      e.rows++; e.spend += Number(r.spend ?? 0);
      m.set(d, e);
      if (r.impressions !== null && r.impressions !== undefined) {
        const i = impressions.get(d) ?? { n: 0, rows: 0 };
        i.n += Number(r.impressions); i.rows++;
        impressions.set(d, i);
      }
    }
  }
  // An active campaign row on a $0 day means it was live, not dark.
  if (sources.includes('ad_daily_metrics')) {
    const { data } = await db.from('ad_campaigns').select('date, status').eq('client_id', client.id)
      .gte('date', from).lte('date', to).limit(20000);
    for (const r of data ?? []) if (/^(active|enabled)$/i.test(String(r.status ?? ''))) active.add(String(r.date).slice(0, 10));
  }
  return { bySourceDay, impressions, active, sources };
}

/** One canonical engine call, 28 days ending on forDate, classified day by day. */
export async function loadDailySeries(db: any, client: ComparisonClient, forDate: string): Promise<DailySeries> {
  const from = addDays(forDate, -(SERIES_DAYS - 1));
  const [engine, ev] = await Promise.all([
    computeClientMetrics(db, client, { from, to: forDate }),
    dayEvidence(db, client, from, forDate),
  ]);
  const days: SeriesDay[] = engine.days.map((d) => {
    const isActive = ev.active.has(d.date);
    const imp = ev.impressions.get(d.date);
    return {
      ...d,
      state: classifyDay({ rowCount: d.spendRows, spend: d.spend ?? 0, anyActiveCampaign: d.spendRows > 0 && isActive }),
      impressions: imp && imp.rows ? imp.n : null,
      sourceStates: (client.spend_source_tables ?? []).map((source) => {
        const e = ev.bySourceDay.get(source)?.get(d.date);
        // A source this layer cannot read row-by-row is judged from the engine's totals.
        if (!ev.bySourceDay.has(source)) {
          return { source, state: classifyDay({ rowCount: d.spendRows, spend: d.spend ?? 0, anyActiveCampaign: isActive }) };
        }
        return { source, state: classifyDay({ rowCount: e?.rows ?? 0, spend: e?.spend ?? 0, anyActiveCampaign: (e?.rows ?? 0) > 0 && isActive }) };
      }),
    };
  });
  return { client, forDate, timeZone: reportingTimeZone(client), engine, days };
}

const sum = (xs: (number | null)[]): number | null => (xs.some((x) => x === null) ? null : xs.reduce<number>((a, b) => a + (b as number), 0));

/** A single day or a window, summed over ITS available days only. */
export function snapshotFrom(series: SeriesDay[], from: string, to: string): Snapshot {
  const days = series.filter((d) => d.date >= from && d.date <= to);
  const single = from === to;
  const states = days.map((d) => d.state);
  const w = single ? { state: states[0] ?? 'missing' as DayState, availableDays: states[0] === 'available' ? 1 : 0 } : classifyWindow(states);
  const base: Snapshot = {
    from, to, state: w.state, stateNote: (w as { note?: string }).note,
    spend: null, revenue: null, calls: null, connected: null, billable: null, impressions: null,
  };
  if (w.state !== 'available') return base;
  const use = days.filter((d) => d.state === 'available');
  const impressionDays = use.filter((d) => d.impressions !== null);
  return {
    ...base,
    coverage: single ? undefined : { days: use.length, of: days.length },
    spend: sum(use.map((d) => d.spend)),
    revenue: sum(use.map((d) => d.revenue)),
    calls: sum(use.map((d) => d.calls)),
    connected: sum(use.map((d) => d.connected)),
    billable: sum(use.map((d) => d.converted)),
    impressions: impressionDays.length ? impressionDays.reduce((a, d) => a + (d.impressions ?? 0), 0) : null,
  };
}

/** UTC instant at which a calendar date ends in a timezone. Kept for callers; delegates to the shared helper. */
export const dayClosesAt = (isoDate: string, timeZone: string): Date => dayEndsAt(isoDate, timeZone);

/**
 * D-1 and its three comparisons for one client. `forDate` is the reporting day
 * (D-1); today is never passed in. Pass `series` to reuse an already-loaded read.
 */
export async function buildComparisonSet(
  db: any, client: ComparisonClient, forDate: string, series?: DailySeries,
): Promise<ComparisonSet> {
  const s = series ?? await loadDailySeries(db, client, forDate);
  const D = (n: number) => addDays(forDate, -(n - 1)); // D(1) = forDate
  const snap = (a: string, b: string) => snapshotFrom(s.days, a, b);
  const d1 = snap(D(1), D(1)), d2 = snap(D(2), D(2)), d8 = snap(D(8), D(8));
  const w1 = snap(D(7), D(1)), w2 = snap(D(14), D(8));
  const opts = { engagement: client.engagement_type, reliableFrom: client.metrics_reliable_from ?? null };

  const tracked = (client.spend_source_tables ?? []).filter((t) => (LOGGED_SPEND_SOURCES as readonly string[]).includes(t));
  let observations: Observation[] = [];
  if (tracked.length) {
    const { data: obs } = await db.from('metric_revision_log').select('source, observed_at, spend, revenue, calls')
      .eq('client_id', client.id).eq('metric_date', forDate).order('observed_at', { ascending: false }).limit(50);
    observations = (obs ?? []) as Observation[];
  }
  const provisional = isProvisional({
    observations, closedAt: dayEndsAt(forDate, s.timeZone), trackedSources: tracked,
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
