// CLIENT CADENCE — which daily comparison an account gets, which day is its
// client call, and what a paused account's update says. Pure: no database.
//
// Read by the drafter (daily) and refresh-client-cadence (weekly). Nothing here
// guesses: a missing call day means no weekly rollup, ever, until a human or
// three same-weekday Wispr meetings set one.
import { reportingDay, weekdayIndex } from './reporting-day.ts';
import { fmtMoney, type DailyMode, type DayState } from './metric-comparisons.ts';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayLong = (i: number) => WEEKDAYS[i];

// ─── daily comparison mode ─────────────────────────────────────────────────

export const MODE_MIN_AVAILABLE_DAYS = 14;
export const WEEKDAY_SHAPED_RATIO = 0.6;

export interface ModeDay { date: string; state: DayState; spend: number | null }

/**
 * Resolve `auto` from the account's own last 28 days.
 *
 * Mean spend per weekday is taken over RECORDED days: an available day counts its
 * spend, a dark day (rows at $0) counts as $0 — a Sunday that is dark every week
 * is exactly the weekday shape this test exists to find. Days with no data
 * recorded are left out; they are unknown, not $0.
 *   lightest two weekdays < 60% of heaviest three → same_weekday
 *   otherwise                                     → prior_day
 *   fewer than 14 available days                  → same_weekday (thin history)
 */
export function resolveDailyMode(history: ModeDay[]): { mode: DailyMode; reason: string } {
  const recent = history.slice(-28);
  const available = recent.filter((d) => d.state === 'available').length;
  if (available < MODE_MIN_AVAILABLE_DAYS) {
    return { mode: 'same_weekday', reason: `history is thin — ${available} available days in the last 28 (need ${MODE_MIN_AVAILABLE_DAYS}), so the safer same-weekday comparison is used` };
  }
  const byWd = new Map<number, number[]>();
  for (const d of recent) {
    if (d.state === 'missing') continue;
    const wd = weekdayIndex(d.date);
    if (!byWd.has(wd)) byWd.set(wd, []);
    byWd.get(wd)!.push(d.state === 'available' ? d.spend ?? 0 : 0);
  }
  const means = [...byWd.entries()].map(([wd, v]) => ({ wd, mean: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => b.mean - a.mean);
  if (means.length < 5) {
    return { mode: 'same_weekday', reason: `only ${means.length} weekdays have recorded data, too few to judge the weekly shape` };
  }
  const heavy = means.slice(0, 3), light = means.slice(-2);
  const avg = (xs: { mean: number }[]) => xs.reduce((a, b) => a + b.mean, 0) / xs.length;
  const ratio = avg(heavy) > 0 ? avg(light) / avg(heavy) : 1;
  const names = (xs: { wd: number }[]) => xs.map((x) => WEEKDAYS[x.wd].slice(0, 3)).join('/');
  const pct = Math.round(ratio * 100);
  return ratio < WEEKDAY_SHAPED_RATIO
    ? { mode: 'same_weekday', reason: `weekday-shaped: lightest days (${names(light)}) average ${pct}% of the heaviest (${names(heavy)}) over ${available} available days` }
    : { mode: 'prior_day', reason: `flat across the week: lightest days (${names(light)}) average ${pct}% of the heaviest (${names(heavy)}) over ${available} available days` };
}

/** The mode a daily update uses. A manual value always wins. */
export function effectiveMode(
  client: { daily_comparison_mode?: string | null; daily_comparison_mode_resolved?: string | null },
  liveHistory: ModeDay[],
): { mode: DailyMode; source: 'manual' | 'stored_auto' | 'live_auto'; reason: string } {
  const m = client.daily_comparison_mode;
  if (m === 'same_weekday' || m === 'prior_day') return { mode: m, source: 'manual', reason: 'set by hand' };
  const stored = client.daily_comparison_mode_resolved;
  if (stored === 'same_weekday' || stored === 'prior_day') return { mode: stored, source: 'stored_auto', reason: 'weekly auto resolution' };
  const live = resolveDailyMode(liveHistory);
  return { mode: live.mode, source: 'live_auto', reason: `${live.reason} (resolved live — weekly refresh has not run)` };
}

/** The weekly rollup appears only on the client call day. A null call day never shows it. */
export function isClientCallDay(client: { client_call_day?: number | null }, todayLocal: string): boolean {
  return client.client_call_day !== null && client.client_call_day !== undefined &&
    weekdayIndex(todayLocal) === client.client_call_day;
}

// ─── client call day from Wispr ────────────────────────────────────────────

export const CALL_DAY_MIN_OCCURRENCES = 3;
export const CALL_DAY_WINDOW_DAYS = 42;

/**
 * At least three meetings on distinct dates falling on the same local weekday in
 * the last six weeks. Several meetings on one date count once. A tie, or no
 * weekday reaching three, returns null with the counts so a human can decide.
 */
export function deriveCallDay(
  meetings: { occurred_at: string }[], timeZone: string, now: Date = new Date(),
): { day: number | null; counts: Record<string, number>; reason: string } {
  const since = now.getTime() - CALL_DAY_WINDOW_DAYS * 86_400_000;
  const dates = new Set<string>();
  for (const m of meetings) {
    const t = new Date(m.occurred_at).getTime();
    if (Number.isNaN(t) || t < since || t > now.getTime()) continue;
    dates.add(reportingDay(m.occurred_at, timeZone));
  }
  const counts: Record<string, number> = {};
  for (const d of dates) {
    const wd = WEEKDAYS[weekdayIndex(d)];
    counts[wd] = (counts[wd] ?? 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || top[1] < CALL_DAY_MIN_OCCURRENCES) {
    return { day: null, counts, reason: top ? `best is ${top[0]} with ${top[1]} meeting date(s) in 6 weeks — under the ${CALL_DAY_MIN_OCCURRENCES} needed` : 'no meetings in the last 6 weeks' };
  }
  if (second && second[1] === top[1]) return { day: null, counts, reason: `${top[0]} and ${second[0]} tie at ${top[1]} — a human must choose` };
  return { day: WEEKDAYS.indexOf(top[0]), counts, reason: `${top[1]} meeting dates on ${top[0]} in the last 6 weeks` };
}

// ─── holding mode ──────────────────────────────────────────────────────────

export const FOCUS_STALE_DAYS = 7;

export interface HoldingInput {
  client: string;
  forDate: string;
  /** Per spend source, the reporting day's state — never collapsed. */
  sourceStates: { source: string; state: DayState }[];
  /** Consecutive days, ending on forDate, with no available day; null = longer than the history read. */
  daysWithoutDelivery: number | null;
  /** Of those days, how many were dark and how many had nothing recorded. */
  darkDays: number;
  missingDays: number;
  /** Tracked calls that still arrived on forDate (a missing-spend day that may have delivered). */
  callsOnDay: number | null;
  lastDelivery: { date: string; spend: number | null; calls: number | null; revenue: number | null } | null;
  focus: { text: string | null; updatedAt: string | null };
  now: Date;
}

const short = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}`;
};

export function focusIsStale(updatedAt: string | null, now: Date): boolean {
  if (!updatedAt) return true;
  return now.getTime() - new Date(updatedAt).getTime() > FOCUS_STALE_DAYS * 86_400_000;
}

/**
 * The update for an account with no delivery on the reporting day. No
 * percentages, no comparisons: how long it has been off and why that is
 * (dark vs no data recorded, kept apart), the last day that did deliver, and
 * what we are working on.
 */
export function renderHolding(h: HoldingInput): string {
  const lines: string[] = [];
  const dark = h.sourceStates.filter((s) => s.state === 'no_delivery').map((s) => s.source);
  const missing = h.sourceStates.filter((s) => s.state === 'missing').map((s) => s.source);
  const what: string[] = [];
  if (dark.length) what.push('dark — spend recorded at $0');
  if (missing.length) what.push('no data recorded — nothing has arrived from the spend feed');
  const span = h.daysWithoutDelivery === null
    ? 'for longer than the last 4 weeks'
    : h.daysWithoutDelivery === 1 ? `on ${short(h.forDate)}` : `for ${h.daysWithoutDelivery} days to ${short(h.forDate)}`;
  const split = h.darkDays && h.missingDays ? ` (${h.darkDays} dark, ${h.missingDays} with no data recorded)` : '';
  lines.push(`${h.client} — no delivery ${span}${split}: ${what.join('; ')}.`);
  if (missing.length && h.callsOnDay) {
    lines.push(`${h.callsOnDay} call${h.callsOnDay === 1 ? '' : 's'} still arrived, so it may have delivered and the spend has not landed.`);
  }
  if (h.lastDelivery) {
    const bits: string[] = [];
    if (h.lastDelivery.spend !== null) bits.push(`${fmtMoney(h.lastDelivery.spend, { cents: h.lastDelivery.spend < 100 })} spend`);
    if (h.lastDelivery.calls !== null) bits.push(`${h.lastDelivery.calls.toLocaleString('en-US')} calls`);
    if (h.lastDelivery.revenue !== null) bits.push(`${fmtMoney(h.lastDelivery.revenue, { cents: h.lastDelivery.revenue < 100 })} revenue`);
    lines.push(`Last delivery: ${short(h.lastDelivery.date)}${bits.length ? ` — ${bits.join(', ')}` : ''}.`);
  } else {
    lines.push('No delivery recorded yet on this account.');
  }
  if (h.focus.text) {
    const stale = focusIsStale(h.focus.updatedAt, h.now);
    lines.push(stale
      ? `What we're working on (last updated ${h.focus.updatedAt ? short(h.focus.updatedAt.slice(0, 10)) : 'at an unknown date'} — may be stale): ${h.focus.text}`
      : `What we're working on: ${h.focus.text}`);
  } else {
    lines.push("What we're working on: not recorded — the account lead needs to set it before this goes out.");
  }
  return lines.join('\n');
}
