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
  scopeClause,
  type ComparisonSet, type DayState, type Observation, type Snapshot, type ScopeEvent,
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

const sum = (xs: (number | null)[]): number | null => (!xs.length || xs.some((x) => x === null) ? null : xs.reduce<number>((a, b) => a + (b as number), 0));
/**
 * Revenue over days. The engine already returns $0 for a day the feed covered
 * with no in-scope calls and null for a day it has not reported, so any null
 * day makes the total unknown. An empty set is null — never $0.
 */
const sumRevenue = (days: SeriesDay[]): number | null => sum(days.map((d) => d.revenue));
/** The first reason any day's calls are null, for the period's disclosure. */
const callsMissingOf = (days: SeriesDay[]): string | null => {
  const d = days.find((x) => x.calls === null);
  return d ? (d.callsMissingReason ?? 'calls not recorded') : null;
};

/**
 * The combined Saturday + Sunday reporting period. Recorded dark days count as
 * zero inside it; a day with no data recorded at all makes the period missing,
 * named, rather than a smaller weekend that reads as a quiet one.
 */
export function periodSnapshot(series: SeriesDay[], from: string, to: string): Snapshot {
  const days = series.filter((d) => d.date >= from && d.date <= to);
  const base: Snapshot = { from, to, state: 'missing', spend: null, revenue: null, calls: null, connected: null, billable: null, impressions: null };
  const missing = days.filter((d) => d.state === 'missing');
  if (!days.length || missing.length) {
    return { ...base, stateNote: `no data recorded for ${missing.map((d) => d.date).join(', ') || from}` };
  }
  if (days.every((d) => d.state === 'no_delivery')) return { ...base, state: 'no_delivery' };
  const imp = days.filter((d) => d.impressions !== null);
  return {
    ...base, state: 'available',
    spend: sum(days.map((d) => d.spend)),
    revenue: sumRevenue(days),
    calls: sum(days.map((d) => d.calls)),
    connected: sum(days.map((d) => d.connected)),
    billable: sum(days.map((d) => d.converted)),
    impressions: imp.length ? imp.reduce((a, d) => a + (d.impressions ?? 0), 0) : null,
    callsMissing: callsMissingOf(days),
  };
}

/** True when this reporting day is a Sunday and the account rolls the weekend up into Monday's update. */
export function isWeekendRollup(client: { weekend_rollup?: boolean | null }, forDate: string): boolean {
  return client.weekend_rollup !== false && new Date(`${forDate}T12:00:00Z`).getUTCDay() === 0;
}

/** Scope events for one client, read-only. */
export async function loadScopeEvents(db: any, clientId: string): Promise<ScopeEvent[]> {
  const { data, error } = await db.from('client_scope_events').select('effective_date, kind, description').eq('client_id', clientId).limit(200);
  if (error) throw new Error(`client_scope_events: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => ({ effective_date: String(r.effective_date).slice(0, 10), kind: String(r.kind), description: r.description ?? null }));
}

/** One context line per event effective in the 7 days ending on forDate. */
export function scopeContextLines(events: ScopeEvent[], forDate: string): string[] {
  const since = addDays(forDate, -6);
  return events.filter((e) => e.effective_date >= since && e.effective_date <= forDate)
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date))
    .map((e) => `Scope change: ${scopeClause(e)} — numbers either side of it measure different things, not a performance change.`);
}

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
    revenue: sumRevenue(use),
    calls: sum(use.map((d) => d.calls)),
    connected: sum(use.map((d) => d.connected)),
    billable: sum(use.map((d) => d.converted)),
    impressions: impressionDays.length ? impressionDays.reduce((a, d) => a + (d.impressions ?? 0), 0) : null,
    callsMissing: callsMissingOf(use),
  };
}

/** UTC instant at which a calendar date ends in a timezone. Kept for callers; delegates to the shared helper. */
export const dayClosesAt = (isoDate: string, timeZone: string): Date => dayEndsAt(isoDate, timeZone);

/**
 * D-1 and its three comparisons for one client. `forDate` is the reporting day
 * (D-1); today is never passed in. Pass `series` to reuse an already-loaded read.
 */
export async function buildComparisonSet(
  db: any, client: ComparisonClient, forDate: string, series?: DailySeries, scopeEvents?: ScopeEvent[],
): Promise<ComparisonSet> {
  const s = series ?? await loadDailySeries(db, client, forDate);
  const events = scopeEvents ?? await loadScopeEvents(db, client.id);
  const D = (n: number) => addDays(forDate, -(n - 1)); // D(1) = forDate
  const snap = (a: string, b: string) => snapshotFrom(s.days, a, b);
  const weekend = isWeekendRollup(client, forDate);
  // Monday's update reports Sat + Sun as ONE period; every figure, and both
  // daily comparisons, use that same period (vs last weekend, vs Thu–Fri).
  const d1 = weekend ? periodSnapshot(s.days, D(2), D(1)) : snap(D(1), D(1));
  const d2 = weekend ? periodSnapshot(s.days, D(4), D(3)) : snap(D(2), D(2));
  const d8 = weekend ? periodSnapshot(s.days, D(9), D(8)) : snap(D(8), D(8));
  const w1 = snap(D(7), D(1)), w2 = snap(D(14), D(8));
  const opts = { engagement: client.engagement_type, reliableFrom: client.metrics_reliable_from ?? null, scopeEvents: events };

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
    periodFrom: weekend ? D(2) : forDate,
    scopeNotes: scopeContextLines(events, forDate),
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
