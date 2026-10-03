// COMPARISONS — the one implementation of "versus what?".
//
// Pure: no database, no Deno. The drafter and the CPM bot both feed it snapshots
// built by _shared/metric-comparison-data.ts and render from what it returns.
//
// Rules, in order of importance:
//   1. Classify each side BEFORE any delta: available / no_delivery / missing.
//      Only available-vs-available may produce a percentage. Absent is not zero.
//   2. A small base prints two absolute values, never a percentage.
//   3. A side before clients.metrics_reliable_from withholds every revenue-derived
//      comparison, said once.
//   4. Same weekday is the headline. Day-over-day crosses weekends.

export type DayState = 'available' | 'no_delivery' | 'missing';
export type EngagementType = 'pay_per_call' | 'performance_media' | string | null;

export type MetricKey =
  | 'spend' | 'revenue' | 'profit' | 'calls' | 'impressions'
  | 'cost_per_call' | 'revenue_per_call' | 'cpm' | 'connected_pct' | 'billable_pct';

export type Polarity = 'neutral' | 'higher_better' | 'higher_worse';

export const POLARITY: Record<MetricKey, Polarity> = {
  spend: 'neutral',
  impressions: 'neutral',
  revenue: 'higher_better',
  profit: 'higher_better',
  calls: 'higher_better',
  connected_pct: 'higher_better',
  billable_pct: 'higher_better',
  revenue_per_call: 'higher_better',
  cost_per_call: 'higher_worse',
  cpm: 'higher_worse',
};

export const LABEL: Record<MetricKey, string> = {
  spend: 'spend', revenue: 'revenue', profit: 'profit', calls: 'calls', impressions: 'impressions',
  cost_per_call: 'cost per call', revenue_per_call: 'revenue per call', cpm: 'CPM',
  connected_pct: 'connected %', billable_pct: 'billable %',
};

export const METRICS_BY_ENGAGEMENT: Record<string, MetricKey[]> = {
  pay_per_call: ['spend', 'revenue', 'profit', 'calls', 'cost_per_call', 'revenue_per_call', 'connected_pct', 'billable_pct'],
  performance_media: ['spend', 'revenue', 'profit', 'calls', 'impressions', 'cost_per_call', 'cpm'],
};

/** Revenue-derived metrics: withheld when either side predates reliable capture. */
export const REVENUE_DERIVED = new Set<MetricKey>(['revenue', 'profit', 'revenue_per_call']);

export const MIN_BASE_SPEND = 50;
export const MIN_BASE_CALLS = 10;
export const MIN_BASE_REVENUE = 50;
export const MAX_SANE_CHANGE = 3; // ±300%

/** One side of a comparison: a single day or a 7-day window. */
export interface Snapshot {
  from: string;
  to: string;
  state: DayState;
  /** Why the state is what it is, in words, for disclosure. */
  stateNote?: string;
  /** Windows only: how many of the days were available and summed. */
  coverage?: { days: number; of: number };
  spend: number | null;
  /** null = not captured (unknown), never zero. */
  revenue: number | null;
  calls: number | null;
  connected: number | null;
  billable: number | null;
  impressions: number | null;
}

export type CompareLabel = 'vs_same_weekday' | 'vs_prior_day' | 'vs_prior_week';
/** The order the output is always in. Same weekday is the headline. */
export const COMPARE_ORDER: CompareLabel[] = ['vs_same_weekday', 'vs_prior_day', 'vs_prior_week'];

export interface MetricDelta {
  metric: MetricKey;
  /** pct: a percentage is allowed · points: rate change in percentage points ·
   *  absolute: base too small, print both values · withheld/unavailable: say why. */
  kind: 'pct' | 'points' | 'absolute' | 'withheld' | 'unavailable';
  current: number | null;
  baseline: number | null;
  pct: number | null;
  polarity: Polarity;
  /** better / worse / null (neutral or not computed). */
  verdict: 'better' | 'worse' | null;
  reason?: string;
  text: string;
}

export interface Comparison {
  label: CompareLabel;
  current: Snapshot;
  baseline: Snapshot;
  /** Set when the comparison cannot run at all; deltas are then empty. */
  unavailable: string | null;
  deltas: MetricDelta[];
}

// ─── classification ────────────────────────────────────────────────────────

/**
 * Classify one calendar day from its spend rows.
 *   rows exist AND (spend > 0 OR an active campaign row) → available
 *   rows exist, spend 0                                   → no_delivery ("was dark")
 *   no rows at all                                        → missing ("no data recorded")
 */
export function classifyDay(input: { rowCount: number; spend: number; anyActiveCampaign?: boolean }): DayState {
  if (input.rowCount <= 0) return 'missing';
  if (input.spend > 0 || input.anyActiveCampaign) return 'available';
  return 'no_delivery';
}

/** A trailing-7 window is comparable when at least this many of its days are available. */
export const MIN_WINDOW_DAYS = 5;

/**
 * A 7-day window sums ONLY its available days, and is comparable when at least
 * five of them are available. Coverage is carried so the output can state it.
 */
export function classifyWindow(days: DayState[]): { state: DayState; note?: string; availableDays: number } {
  const available = days.filter((d) => d === 'available').length;
  if (available >= MIN_WINDOW_DAYS) return { state: 'available', availableDays: available };
  if (days.every((d) => d === 'no_delivery')) return { state: 'no_delivery', availableDays: 0 };
  const missing = days.filter((d) => d === 'missing').length;
  const dark = days.filter((d) => d === 'no_delivery').length;
  const parts = [`only ${available} of ${days.length} days had delivery`];
  if (dark) parts.push(`${dark} dark`);
  if (missing) parts.push(`${missing} with no data recorded`);
  return { state: available === 0 && missing === days.length ? 'missing' : 'missing', note: parts.join(', '), availableDays: available };
}

// ─── derived values ────────────────────────────────────────────────────────

const div = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : a / b;

export function metricValue(s: Snapshot, m: MetricKey): number | null {
  switch (m) {
    case 'spend': return s.spend;
    case 'revenue': return s.revenue;
    case 'profit': return s.revenue === null || s.spend === null ? null : s.revenue - s.spend;
    case 'calls': return s.calls;
    case 'impressions': return s.impressions;
    case 'cost_per_call': return div(s.spend, s.calls);
    case 'revenue_per_call': return div(s.revenue, s.calls);
    case 'cpm': return s.impressions ? div(s.spend === null ? null : s.spend * 1000, s.impressions) : null;
    case 'connected_pct': return div(s.connected, s.calls);
    case 'billable_pct': return div(s.billable, s.connected);
  }
}

// ─── formatting ────────────────────────────────────────────────────────────

export function fmtMoney(v: number, opts: { compact?: boolean; cents?: boolean } = {}): string {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (opts.compact && a >= 1000) return `${sign}$${(a / 1000).toFixed(a >= 10000 ? 1 : 2).replace(/\.0+$/, '')}k`;
  const cents = opts.cents ?? a < 100;
  return `${sign}$${a.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;
}

export function fmtValue(m: MetricKey, v: number | null): string {
  if (v === null) return 'unknown';
  switch (m) {
    case 'spend': case 'revenue': case 'profit': return fmtMoney(v, { cents: Math.abs(v) < 100 });
    case 'cost_per_call': case 'revenue_per_call': case 'cpm': return fmtMoney(v, { cents: true });
    case 'calls': case 'impressions': return Math.round(v).toLocaleString('en-US');
    case 'connected_pct': case 'billable_pct': return `${(v * 100).toFixed(1)}%`;
  }
}

const signed = (n: number, digits = 0) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)}`;

function verdictFor(p: Polarity, change: number): 'better' | 'worse' | null {
  if (p === 'neutral' || change === 0) return null;
  const up = change > 0;
  return (p === 'higher_better') === up ? 'better' : 'worse';
}

/** Render "was dark" / "no data recorded" — never a number, never a percentage. */
export function stateWords(s: Snapshot): string {
  if (s.state === 'no_delivery') return 'was dark';
  if (s.state === 'missing') return s.stateNote ? `no data recorded (${s.stateNote})` : 'no data recorded';
  return 'available';
}

// ─── the delta ─────────────────────────────────────────────────────────────

/** Why this metric cannot carry a percentage on this base, or null if it can. */
export function smallBaseReason(m: MetricKey, base: Snapshot): string | null {
  const spendBased: MetricKey[] = ['spend', 'cost_per_call', 'cpm', 'impressions', 'profit'];
  const callBased: MetricKey[] = ['calls', 'cost_per_call', 'revenue_per_call', 'connected_pct', 'billable_pct'];
  if (spendBased.includes(m) && (base.spend ?? 0) < MIN_BASE_SPEND) return `baseline spend under $${MIN_BASE_SPEND}`;
  if (callBased.includes(m) && (base.calls ?? 0) < MIN_BASE_CALLS) return `baseline under ${MIN_BASE_CALLS} calls`;
  if (REVENUE_DERIVED.has(m) && (base.revenue ?? 0) < MIN_BASE_REVENUE) return `baseline revenue under $${MIN_BASE_REVENUE}`;
  return null;
}

export function compareMetric(m: MetricKey, cur: Snapshot, base: Snapshot, revenueWithheld: boolean): MetricDelta {
  const polarity = POLARITY[m];
  const c = metricValue(cur, m);
  const b = metricValue(base, m);
  const out = (d: Omit<MetricDelta, 'metric' | 'polarity' | 'current' | 'baseline'>): MetricDelta =>
    ({ metric: m, polarity, current: c, baseline: b, ...d });

  if (REVENUE_DERIVED.has(m) && revenueWithheld) {
    return out({ kind: 'withheld', pct: null, verdict: null, reason: 'revenue baseline not comparable', text: '' });
  }
  if (c === null || b === null) {
    return out({ kind: 'unavailable', pct: null, verdict: null, reason: 'not captured on one side', text: '' });
  }

  // Profit can cross zero, so a percentage of it is never meaningful: two values.
  if (m === 'profit') {
    const swung = Math.sign(c) !== Math.sign(b) && c !== 0 && b !== 0;
    const v = verdictFor(polarity, c - b);
    const text = swung
      ? `profit swung from ${signedMoney(b)} to ${signedMoney(c)}`
      : `profit ${signedMoney(c)} (was ${signedMoney(b)})${v ? ` — ${v}` : ''}`;
    return out({ kind: 'absolute', pct: null, verdict: v, text });
  }

  // Rates move in points, not percent-of-percent.
  if (m === 'connected_pct' || m === 'billable_pct') {
    const small = smallBaseReason(m, base);
    if (small) return out({ kind: 'absolute', pct: null, verdict: null, reason: small, text: `${LABEL[m]} ${fmtValue(m, b)} → ${fmtValue(m, c)}` });
    const pts = (c - b) * 100;
    const v = verdictFor(polarity, pts);
    return out({ kind: 'points', pct: null, verdict: v, text: `${LABEL[m]} ${signed(pts, 1)} pts${v ? ` (${v})` : ''}` });
  }

  const small = smallBaseReason(m, base);
  const pct = b === 0 ? null : (c - b) / Math.abs(b);
  if (small || pct === null || Math.abs(pct) > MAX_SANE_CHANGE) {
    const reason = small ?? (pct === null ? 'zero baseline' : 'change beyond ±300%');
    return out({ kind: 'absolute', pct: null, verdict: null, reason, text: `${LABEL[m]} ${fmtValue(m, b)} → ${fmtValue(m, c)}` });
  }
  const v = verdictFor(polarity, pct);
  const pctText = `${signed(pct * 100)}%`;
  return out({ kind: 'pct', pct, verdict: v, text: `${LABEL[m]} ${pctText}${v ? ` (${v})` : ''}` });
}

const signedMoney = (v: number) => (v > 0 ? `+${fmtMoney(v, { compact: Math.abs(v) >= 10000 })}` : fmtMoney(v, { compact: Math.abs(v) >= 10000 }));

/** Is either side before the date revenue capture can be trusted? */
export function predatesReliability(s: Snapshot, reliableFrom: string | null): boolean {
  return !!reliableFrom && s.from < reliableFrom;
}

export function compare(
  label: CompareLabel, cur: Snapshot, base: Snapshot,
  opts: { engagement: EngagementType; reliableFrom: string | null },
): Comparison {
  const metrics = METRICS_BY_ENGAGEMENT[opts.engagement ?? ''] ?? METRICS_BY_ENGAGEMENT.pay_per_call;
  if (cur.state !== 'available' || base.state !== 'available') {
    const which = cur.state !== 'available'
      ? `reporting day ${stateWords(cur)}`
      : `baseline ${stateWords(base)}`;
    return { label, current: cur, baseline: base, unavailable: which, deltas: [] };
  }
  const revenueWithheld = predatesReliability(cur, opts.reliableFrom) || predatesReliability(base, opts.reliableFrom);
  return {
    label, current: cur, baseline: base, unavailable: null,
    deltas: metrics.map((m) => compareMetric(m, cur, base, revenueWithheld)),
  };
}

// ─── provisionality ────────────────────────────────────────────────────────

export interface Observation { source: string; observed_at: string; spend: number | null; revenue: number | null; calls: number | null }

export const REVISION_TOLERANCE = 0.02;

/**
 * A day is provisional only when, for some spend source the account syncs:
 *   - its last two observations for the date disagree by more than 2%, or
 *   - no observation of the date was recorded after the date closed in the
 *     account's reporting timezone (nothing has looked at the finished day yet).
 * Otherwise it is settled, and a settled day carries no disclosure at all.
 * There is no wall-clock rule: a 9am run on a settled day is settled.
 * `trackedSources` empty = the account's spend feeds are not revision-logged, so
 * provisionality cannot be judged; `tracked: false` says so instead of guessing.
 */
export function isProvisional(input: {
  observations: Observation[]; closedAt: Date; trackedSources: string[];
}): { provisional: boolean; reason: string | null; tracked: boolean } {
  if (!input.trackedSources.length) return { provisional: false, reason: null, tracked: false };
  for (const source of input.trackedSources) {
    const list = input.observations.filter((o) => o.source === source)
      .sort((x, y) => y.observed_at.localeCompare(x.observed_at));
    const [a, b] = list;
    if (!a || new Date(a.observed_at).getTime() <= input.closedAt.getTime()) {
      return { provisional: true, reason: `no sync has recorded ${source} for this day since it closed`, tracked: true };
    }
    if (!b) continue;
    for (const k of ['spend', 'revenue', 'calls'] as const) {
      const x = a[k], y = b[k];
      if (x === null || y === null) continue;
      const base = Math.max(Math.abs(x), Math.abs(y));
      if (base > 0 && Math.abs(x - y) / base > REVISION_TOLERANCE) {
        return { provisional: true, reason: `${source} ${k} was still being revised between the last two syncs`, tracked: true };
      }
    }
  }
  return { provisional: false, reason: null, tracked: true };
}

// ─── output ────────────────────────────────────────────────────────────────

export interface ComparisonSet {
  client: string;
  engagement: EngagementType;
  forDate: string;
  reliableFrom: string | null;
  day: Snapshot;
  comparisons: Comparison[];
  provisional: { provisional: boolean; reason: string | null; tracked?: boolean };
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const weekdayOf = (iso: string) => WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()];
const prettyDay = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}`;
};
const prettyShort = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}`;
};

const LINE_PREFIX: Record<CompareLabel, (s: ComparisonSet, c: Comparison) => string> = {
  vs_same_weekday: (_s, c) => `vs last ${weekdayOf(c.baseline.from)}`,
  vs_prior_day: (_s, c) => `vs ${weekdayOf(c.baseline.from)}`,
  vs_prior_week: (_s, c) => `7d vs prior 7d${coverageWords(c)}`,
};

function coverageWords(c: Comparison): string {
  const a = c.current.coverage, b = c.baseline.coverage;
  if (!a || !b || (a.days === a.of && b.days === b.of)) return '';
  return a.days === b.days ? ` (${a.days} of ${a.of} days)` : ` (${a.days} and ${b.days} of ${a.of} days)`;
}

/** Which metrics a comparison line carries — the four that decide, then the rest. */
const LINE_METRICS: MetricKey[] = ['spend', 'profit', 'calls', 'cost_per_call'];

export function renderComparisonLine(set: ComparisonSet, c: Comparison): string {
  const prefix = LINE_PREFIX[c.label](set, c);
  if (c.unavailable) return `${prefix}: not comparable — ${c.unavailable}`;
  const parts = c.deltas
    .filter((d) => LINE_METRICS.includes(d.metric) && (d.kind === 'pct' || d.kind === 'absolute' || d.kind === 'points'))
    .sort((a, b) => LINE_METRICS.indexOf(a.metric) - LINE_METRICS.indexOf(b.metric))
    .map((d) => d.text);
  return `${prefix}: ${parts.length ? parts.join(', ') : 'nothing comparable'}`;
}

function headlineFigures(set: ComparisonSet): string {
  const s = set.day;
  if (s.state !== 'available') return `spend ${stateWords(s)}`;
  const bits: string[] = [];
  if (s.spend !== null) bits.push(`${fmtMoney(s.spend, { cents: s.spend < 100 })} spend`);
  if (s.revenue !== null) bits.push(`${fmtMoney(s.revenue, { cents: s.revenue < 100 })} revenue`);
  const p = metricValue(s, 'profit');
  if (p !== null) bits.push(`${signedMoney(p)} profit`);
  if (s.calls !== null) bits.push(`${s.calls.toLocaleString('en-US')} calls`);
  const cpc = metricValue(s, 'cost_per_call');
  if (cpc !== null && cpc >= 1) bits.push(`${fmtMoney(cpc, { cents: true })} per call`);
  return bits.join(' · ');
}

/** Disclosures, each said once. */
export function disclosures(set: ComparisonSet): string[] {
  const out: string[] = [];
  if (set.provisional.provisional) out.push(`${prettyShort(set.forDate)} is provisional (${set.provisional.reason}).`);
  const withheld = set.comparisons.some((c) => c.deltas.some((d) => d.kind === 'withheld'));
  if (withheld && set.reliableFrom) out.push(`Revenue baselines before ${prettyShort(set.reliableFrom)} aren't comparable.`);
  return out;
}

/** The block that opens a full update. */
export function renderFullComparison(set: ComparisonSet): string {
  const lines = [`${set.client} — ${prettyDay(set.forDate)}`, headlineFigures(set)];
  for (const label of COMPARE_ORDER) {
    const c = set.comparisons.find((x) => x.label === label);
    if (c) lines.push(renderComparisonLine(set, c));
  }
  const d = disclosures(set);
  if (d.length) lines.push(`⚠ ${d.join(' ')}`);
  return lines.join('\n');
}

export type DailyMode = 'same_weekday' | 'prior_day';
const MODE_LABEL: Record<DailyMode, CompareLabel> = { same_weekday: 'vs_same_weekday', prior_day: 'vs_prior_day' };

/**
 * The daily update's comparison block: ONE daily comparison (the account's
 * resolved mode), plus the trailing-7 rollup only when `weekly` is true — the
 * client call day. The bot uses renderFullComparison (all three) instead.
 */
export function renderDailyComparison(set: ComparisonSet, opts: { mode: DailyMode; weekly: boolean }): string {
  const lines = [`${set.client} — ${prettyDay(set.forDate)}`, headlineFigures(set)];
  const daily = set.comparisons.find((x) => x.label === MODE_LABEL[opts.mode]);
  if (daily) lines.push(renderComparisonLine(set, daily));
  if (opts.weekly) {
    const w = set.comparisons.find((x) => x.label === 'vs_prior_week');
    if (w) lines.push(renderComparisonLine(set, w));
  }
  const shown = set.comparisons.filter((c) => c.label === MODE_LABEL[opts.mode] || (opts.weekly && c.label === 'vs_prior_week'));
  const d = disclosures({ ...set, comparisons: shown });
  if (d.length) lines.push(`⚠ ${d.join(' ')}`);
  return lines.join('\n');
}

/**
 * The one delta a one-liner may carry: the daily-mode change on the most
 * material metric. Material = largest absolute percentage, and only a real
 * percentage qualifies.
 */
export function headlineDelta(set: ComparisonSet, mode: DailyMode = 'same_weekday'): string | null {
  const c = set.comparisons.find((x) => x.label === MODE_LABEL[mode]);
  if (!c || c.unavailable) return null;
  const pcts = c.deltas.filter((d) => d.kind === 'pct' && d.pct !== null);
  if (!pcts.length) return null;
  const best = pcts.sort((a, b) => Math.abs(b.pct!) - Math.abs(a.pct!))[0];
  const label = LABEL[best.metric];
  const vs = mode === 'same_weekday' ? `vs last ${weekdayOf(c.baseline.from)}` : `vs ${weekdayOf(c.baseline.from)}`;
  return `${label[0].toUpperCase()}${label.slice(1)} ${signed(best.pct! * 100)}% ${vs}${best.verdict ? ` (${best.verdict})` : ''}.`;
}

/** A compact block for a model prompt: numbers are final, never recomputed. */
export function comparisonPromptBlock(set: ComparisonSet): string {
  return [
    '--- COMPARISONS (computed; quote, never recompute; same weekday is the headline) ---',
    renderFullComparison(set),
    'Rules: a missing side is "no data recorded", a dark side is "was dark" — neither is zero or a decline. Two values joined by → mean the base was too small for a percentage; never turn them into one.',
    '--- END COMPARISONS ---',
  ].join('\n');
}
