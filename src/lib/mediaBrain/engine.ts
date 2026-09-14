/**
 * Media Brain — Decision Engine (pure logic layer)
 *
 * Every formula in the Connect Paid Media decision framework is implemented
 * EXACTLY ONCE here. Import from this module; never re-derive a formula inline
 * in a component, hook, or edge function.
 *
 * @see docs/media-brain/01_Decision_Engine.md
 * @see docs/media-brain/03_Operating_Procedures.md
 *
 * Two hard rules govern this file:
 *
 * 1. NEVER MIX DENOMINATORS (§2). A metric built on total calls is never
 *    compared against the same metric built on billable calls. Each function
 *    below names its denominator in its JSDoc.
 * 2. NULL IS NOT ZERO (§6 Operating Procedures). Every metric returns `null`
 *    when its denominator is 0 or an input is missing — never 0, NaN, or
 *    Infinity. A null renders as "—". A zero rendered where a null belongs is
 *    exactly the failure the framework warns about: zero billable calls is a
 *    kill trigger, so a failed or empty pull must never look like performance.
 *
 * No React, no Supabase, no I/O, no side effects.
 */

/** Payout mode. STATIC = fixed contract price per billable call. RTB = payout set by live bidding, includes zeros. @see 01_Decision_Engine.md §1 */
export type PayoutMode = 'static' | 'rtb';

/** Whether a row's sample is large enough to act on. @see 01_Decision_Engine.md §4 */
export type ConfidenceState = 'sufficient' | 'insufficient' | 'decisive_zero';

/** Forced disposition every ad set and ad receives at every review. @see 03_Operating_Procedures.md §4 */
export type Verdict = 'keep' | 'cut' | 'hold';

/** Framework-settled defaults. @see 01_Decision_Engine.md §16 */
export const DEFAULTS = {
  /** Target margin % (§10 — 20–30% is the target band). */
  targetMargin: 0.2,
  /** Margin floor. Below this there is no cushion for normal volatility (§16). */
  minMargin: 0.1,
  /** Gap between angles you would act on. 0.57 → min_calls 25 (§4). */
  actionableGap: 0.57,
  /** Scale step lower bound (§16). */
  scaleStepMin: 0.1,
  /** Scale step upper bound (§16). */
  scaleStepMax: 0.2,
  /** Meta needs roughly this many conversions per ad set per week to exit learning phase (§4). */
  fragmentationFloor: 50,
} as const;


type Num = number | null | undefined;

/** True when a value is a usable finite number. */
function ok(v: Num): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Safe division: null unless both inputs are finite numbers and the
 * denominator is non-zero. Never returns NaN or Infinity.
 */
function divide(numerator: Num, denominator: Num): number | null {
  if (!ok(numerator) || !ok(denominator)) return null;
  if (denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

/* ------------------------------------------------------------------ *
 * §2 — Core metrics
 * ------------------------------------------------------------------ */

/**
 * Revenue per call. **Denominator: TOTAL calls** (§2).
 * RPC is always trailing — what calls actually paid. Under RTB the total-call
 * denominator keeps no-bid losses visible instead of hidden.
 * @see docs/media-brain/01_Decision_Engine.md §2
 */
export function rpc(revenue: Num, totalCalls: Num): number | null {
  return divide(revenue, totalCalls);
}

/**
 * Cost per call. **Denominator: TOTAL calls** (§2).
 * @see docs/media-brain/01_Decision_Engine.md §2
 */
export function costPerCall(spend: Num, totalCalls: Num): number | null {
  return divide(spend, totalCalls);
}

/**
 * Margin per call = RPC − cost per call. **Denominator: TOTAL calls on both sides** (§2).
 * This is a DECIDES metric — the primary ranking metric for cut/hold/scale.
 * @see docs/media-brain/01_Decision_Engine.md §2
 */
export function marginPerCall(revenue: Num, spend: Num, totalCalls: Num): number | null {
  const r = rpc(revenue, totalCalls);
  const c = costPerCall(spend, totalCalls);
  if (r === null || c === null) return null;
  return r - c;
}

/**
 * Profit = revenue − spend. No denominator.
 * @see docs/media-brain/01_Decision_Engine.md §2
 */
export function profit(revenue: Num, spend: Num): number | null {
  if (!ok(revenue) || !ok(spend)) return null;
  return revenue - spend;
}

/**
 * Margin % = profit ÷ revenue. **Denominator: revenue.**
 * @see docs/media-brain/01_Decision_Engine.md §2
 */
export function marginPct(revenue: Num, spend: Num): number | null {
  const p = profit(revenue, spend);
  return divide(p, revenue);
}

/**
 * Cost per billable call. **Denominator: BILLABLE calls** (§2).
 * [STATIC] This is the primary decision metric — billable is binary.
 * [RTB] Prefer total-call metrics; "billable" is not a clean line under bidding.
 * Never compare this against a total-call metric.
 * @see docs/media-brain/01_Decision_Engine.md §2
 */
export function costPerBillableCall(spend: Num, billableCalls: Num): number | null {
  return divide(spend, billableCalls);
}

/**
 * Call rate = calls ÷ clicks. **Denominator: clicks.**
 * A fast elimination signal — accumulates with every click, not only with
 * paying calls (§9).
 * @see docs/media-brain/01_Decision_Engine.md §9
 */
export function callRate(totalCalls: Num, clicks: Num): number | null {
  return divide(totalCalls, clicks);
}

/**
 * Connection rate = connected ÷ total calls. **Denominator: TOTAL calls.**
 * A downstream/diagnostic measure (§11 Step 1), NOT a creative elimination
 * signal — whether the buyer answers is routing, not ad quality.
 * @see docs/media-brain/01_Decision_Engine.md §9, §11
 */
export function connectionRate(connected: Num, totalCalls: Num): number | null {
  return divide(connected, totalCalls);
}

/**
 * Billable rate = billable ÷ connected. **Denominator: CONNECTED calls.**
 * @see docs/media-brain/01_Decision_Engine.md §2, §11
 */
export function billableRate(billable: Num, connected: Num): number | null {
  return divide(billable, connected);
}

/**
 * Allowable cost per call at margin m = RPC × (1 − m).
 * The most you can pay per call and still clear the target margin.
 * @see docs/media-brain/01_Decision_Engine.md §2
 */
export function allowableCostPerCall(rpcValue: Num, targetMargin: Num): number | null {
  if (!ok(rpcValue) || !ok(targetMargin)) return null;
  return rpcValue * (1 - targetMargin);
}

/**
 * Is this row paying more per call than it can afford? Compares a measured
 * cost per call against the instance's stored allowable cost per call — the
 * price above which the target margin cannot be cleared. **Denominator: TOTAL
 * calls on both sides** (§2 — never against a billable-denominated cost).
 * Null when either side is unavailable.
 * @see docs/media-brain/01_Decision_Engine.md §2
 */
export function exceedsAllowableCostPerCall(costPerCallValue: Num, allowable: Num): boolean | null {
  if (!ok(costPerCallValue) || !ok(allowable)) return null;
  return costPerCallValue > allowable;
}

/* ------------------------------------------------------------------ *
 * §4 — Confidence
 * ------------------------------------------------------------------ */

/**
 * `{min_calls}` ≈ (2√2 ÷ actionable gap)² = 8 ÷ gap², rounded up.
 *
 * The wobble on a SINGLE estimate is ≈ 1 ÷ √n, but ranking two angles compares
 * two independent noisy estimates, so the standard error of the DIFFERENCE is
 * larger by √2 — the detectable gap is ≈ 2√2 ÷ √n.
 *
 * [RTB] +40% — payout varies too, so margin per call is noisier.
 *
 * gap 0.57 static → 25 · gap 0.57 rtb → 35 · gap 0.40 static → 50
 * @see docs/media-brain/01_Decision_Engine.md §4, §16
 */
export function minCalls(actionableGap: Num, payoutMode: PayoutMode = 'static'): number | null {
  if (!ok(actionableGap) || actionableGap <= 0) return null;
  let n = Math.ceil(8 / actionableGap ** 2);
  if (payoutMode === 'rtb') n = Math.ceil(n * 1.4);
  return n;
}


/**
 * The count the kill rule reads — stated ONCE, here, so no page re-derives it.
 *
 * [STATIC] billable calls: the payout contract draws a clean line.
 * [RTB] PAID calls: payout is continuous and there is no clean billable line,
 * so "zero billable" is defined as zero calls with a payout above zero.
 *
 * @see docs/media-brain/01_Decision_Engine.md §2, §6.3, §12
 */
export function killCount(
  payoutMode: PayoutMode,
  row: { billable_calls?: Num; paid_calls?: Num },
): number | null {
  const v = payoutMode === 'rtb' ? row.paid_calls : row.billable_calls;
  return ok(v) ? v : null;
}

/**
 * Confidence state for a row.
 *
 * - `decisive_zero` — zero of the kill count (`killCount`) past the kill threshold. Decisive
 *   despite a low count; deliberately does NOT wait for `{min_calls}` (§6.3).
 * - `sufficient` — at or above `{min_calls}`. Act.
 * - `insufficient` — below it. Hold, and render greyed / marked *insufficient data*.
 *
 * Never surface a confident-looking recommendation on an insufficient sample.
 * @see docs/media-brain/01_Decision_Engine.md §4, §6.3
 */
export function confidenceState(
  billableCalls: Num,
  /** From `killCount()` — billable under static, PAID under RTB. */
  killCountValue: Num,
  minCallsValue: Num,
  spend: Num,
  killThresholdValue: Num,
): ConfidenceState {
  if (
    ok(killCountValue) &&
    killCountValue === 0 &&
    ok(spend) &&
    ok(killThresholdValue) &&
    spend >= killThresholdValue
  ) {
    return 'decisive_zero';
  }
  if (ok(billableCalls) && ok(minCallsValue) && billableCalls >= minCallsValue) {
    return 'sufficient';
  }
  return 'insufficient';
}

/**
 * Wobble around a measured rate built on `n` conversions ≈ 1 ÷ √n.
 * 10 → ±32% · 25 → ±20% · 50 → ±14% · 100 → ±10%.
 * Null when n <= 0.
 * @see docs/media-brain/01_Decision_Engine.md §4
 */
export function wobblePct(n: Num): number | null {
  if (!ok(n) || n <= 0) return null;
  return 1 / Math.sqrt(n);
}

/* ------------------------------------------------------------------ *
 * §6.3 / §16 — Kill threshold
 * ------------------------------------------------------------------ */

/**
 * Kill threshold: spend at which an entity with a ZERO kill count is killed.
 * The count itself is `killCount()` — billable calls under static, PAID calls
 * under RTB, where payout is continuous and billable has no clean line.
 * [STATIC] 2 × `{payout}` · [RTB] 2 × `{avg_bid}`.
 * This fires on any day, not only on review day, and does not wait for `{min_calls}`.
 * @see docs/media-brain/01_Decision_Engine.md §6.3, §16
 */
export function killThreshold(payoutMode: PayoutMode, payout: Num, avgBid: Num): number | null {
  const basis = payoutMode === 'rtb' ? avgBid : payout;
  if (!ok(basis)) return null;
  return 2 * basis;
}

/* ------------------------------------------------------------------ *
 * §4 — Volume tiers
 * ------------------------------------------------------------------ */

export interface VolumeTierResult {
  tier: 'under_5' | '5_25' | '25_100' | '100_300' | '300_plus';
  cutCadence: string;
  scaleCadence: string;
}

/**
 * Volume tier from billable calls per week. Cadence = how often you are
 * ALLOWED TO DECIDE, not how often you look. Cuts move faster than scale steps:
 * raising a budget resets Meta's learning, so stacked increases destroy the read.
 * @see docs/media-brain/01_Decision_Engine.md §4
 */
export function volumeTier(billableCallsPerWeek: Num): VolumeTierResult | null {
  if (!ok(billableCallsPerWeek) || billableCallsPerWeek < 0) return null;
  if (billableCallsPerWeek < 5) return { tier: 'under_5', cutCadence: 'Monthly', scaleCadence: 'Monthly' };
  if (billableCallsPerWeek < 25) return { tier: '5_25', cutCadence: 'Every 2 weeks', scaleCadence: 'Every 2 weeks' };
  if (billableCallsPerWeek < 100) return { tier: '25_100', cutCadence: 'Weekly', scaleCadence: 'Weekly' };
  if (billableCallsPerWeek < 300) return { tier: '100_300', cutCadence: 'Every 2-3 days', scaleCadence: 'Weekly' };
  return { tier: '300_plus', cutCadence: 'Daily', scaleCadence: 'Every 3-4 days' };
}

/* ------------------------------------------------------------------ *
 * §9 — Testing capacity
 * ------------------------------------------------------------------ */

/**
 * Budget one angle needs to be conclusively ranked:
 * `{min_calls}` × cost per billable call.
 * @see docs/media-brain/01_Decision_Engine.md §9
 */
export function costPerAngle(minCallsValue: Num, costPerBillableCallValue: Num): number | null {
  if (!ok(minCallsValue) || !ok(costPerBillableCallValue)) return null;
  return minCallsValue * costPerBillableCallValue;
}

/**
 * How many angles a test budget can rank properly:
 * `angles = test budget ÷ cost per angle`, floored, never negative.
 * Test fewer angles properly rather than five badly.
 * @see docs/media-brain/01_Decision_Engine.md §9
 */
export function maxAngles(testBudget: Num, costPerAngleValue: Num): number | null {
  const raw = divide(testBudget, costPerAngleValue);
  if (raw === null) return null;
  return Math.max(0, Math.floor(raw));
}

export interface FragmentationResult {
  /** Expected weekly conversions per ad set. */
  perAdSet: number | null;
  /** True when perAdSet is at or above the Meta learning-phase floor (50). */
  passes: boolean;
}

/**
 * Fragmentation check: expected weekly conversions ÷ active ad sets.
 * Well below 50 means volume is split across ad sets that will each learn
 * nothing — consolidate. A calculation to run, not an ad set count to obey.
 * @see docs/media-brain/01_Decision_Engine.md §4
 */
export function fragmentationCheck(expectedWeeklyConversions: Num, adSetCount: Num): FragmentationResult {
  const perAdSet = divide(expectedWeeklyConversions, adSetCount);
  return { perAdSet, passes: perAdSet !== null && perAdSet >= DEFAULTS.fragmentationFloor };
}

/* ------------------------------------------------------------------ *
 * §8 — Marginal return on a scale step
 * ------------------------------------------------------------------ */

export interface MarginalReturnResult {
  addedSpend: number;
  addedRevenue: number;
  /** Return on the ADDED spend — the number that decides. */
  marginalRoas: number | null;
  /** Return on all spend. Hides when incremental spend stops clearing the bar. */
  blendedRoas: number | null;
}

/**
 * Marginal return on a scale step. Judge the ADDED spend, not the blend:
 * blended ROAS hides the point at which incremental spend stops clearing the bar.
 * Returns null when added spend <= 0 (no step to judge).
 * @see docs/media-brain/01_Decision_Engine.md §8
 */
export function marginalReturn(
  baseSpend: Num,
  baseRevenue: Num,
  newSpend: Num,
  newRevenue: Num,
): MarginalReturnResult | null {
  if (!ok(baseSpend) || !ok(baseRevenue) || !ok(newSpend) || !ok(newRevenue)) return null;
  const addedSpend = newSpend - baseSpend;
  const addedRevenue = newRevenue - baseRevenue;
  if (addedSpend <= 0) return null;
  return {
    addedSpend,
    addedRevenue,
    marginalRoas: divide(addedRevenue, addedSpend),
    blendedRoas: divide(newRevenue, newSpend),
  };
}

/* ------------------------------------------------------------------ *
 * §10 — Margin bands
 * ------------------------------------------------------------------ */

export interface MarginBandResult {
  band: 'losing' | 'fragile' | 'thin' | 'decent' | 'good' | 'very_good' | 'excellent';
  verdict: string;
  action: string;
}

/**
 * Margin band for a margin %, anchored on THIS CLIENT's two stored values:
 * `minMargin` (the floor — below it there is no cushion) and `targetMargin`
 * (the band we are aiming at). Boundaries are never hardcoded: a client on a
 * 15% floor must not be judged against 10%.
 *
 * Bands, in terms of the two anchors:
 *   < 0                    losing
 *   < minMargin            fragile (below the floor)
 *   < minMargin × 1.5      thin but workable
 *   < targetMargin         decent
 *   < targetMargin × 1.5   good (target)
 *   < targetMargin × 2     very good
 *   ≥ targetMargin × 2     excellent
 *
 * With the framework defaults (floor 10%, target 20%) that reproduces the §10
 * table exactly: 10 / 15 / 20 / 30 / 40.
 *
 * Scale steps quoted from DEFAULTS so the range is stated in exactly one place.
 * [RTB] judge by the MEDIAN, not the mean.
 * @see docs/media-brain/01_Decision_Engine.md §10
 */
export function marginBand(
  marginPctValue: Num,
  minMargin: Num,
  targetMargin: Num,
): MarginBandResult | null {
  if (!ok(marginPctValue) || !ok(minMargin) || !ok(targetMargin)) return null;
  const step = `Scale one step of ${Math.round(DEFAULTS.scaleStepMin * 100)}-${Math.round(DEFAULTS.scaleStepMax * 100)}%`;
  if (marginPctValue < 0) return { band: 'losing', verdict: 'Losing', action: 'Stop' };
  if (marginPctValue < minMargin) return { band: 'fragile', verdict: 'Fragile', action: 'Below the floor — fix or stop' };
  if (marginPctValue < minMargin * 1.5) return { band: 'thin', verdict: 'Thin but workable', action: 'Hold, improve before scaling' };
  if (marginPctValue < targetMargin) return { band: 'decent', verdict: 'Decent', action: 'Hold or scale cautiously' };
  if (marginPctValue < targetMargin * 1.5) return { band: 'good', verdict: 'Good (target)', action: step };
  if (marginPctValue < targetMargin * 2) return { band: 'very_good', verdict: 'Very good', action: step };
  return { band: 'excellent', verdict: 'Excellent', action: step };
}


/* ------------------------------------------------------------------ *
 * §5 — RTB payout distribution
 * ------------------------------------------------------------------ */

export interface PayoutDistributionResult {
  median: number | null;
  p25: number | null;
  mean: number | null;
  /** Share of calls earning nothing. Rising means a demand problem, not a creative one. */
  zeroRate: number | null;
  /** Share of revenue carried by the top 10% of calls. */
  top10RevenueShare: number | null;
  count: number;
}

/** Nearest-rank percentile on an ascending-sorted array. */
function nearestRank(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/**
 * Median of a set of values by nearest rank. Null on an empty set — never 0.
 * Used for median call duration and, under RTB, for judging by the median
 * rather than the mean (§5, §10).
 * @see docs/media-brain/01_Decision_Engine.md §5, §10
 */
export function median(values: Num[] | null | undefined): number | null {
  const clean = (values ?? []).filter(ok);
  if (clean.length === 0) return null;
  return nearestRank([...clean].sort((a, b) => a - b), 0.5);
}


/**
 * Payout distribution for RTB. **Zeros are INCLUDED** in the array and in every
 * denominator — no-bid losses must stay visible. Judge by the median, not the
 * mean: nine calls at $20 and one at $200 average $38 while nine out of ten
 * lose money at a $30 cost per call.
 *
 * Percentiles use the nearest-rank method. Returns nulls on an empty array.
 * @see docs/media-brain/01_Decision_Engine.md §5
 */
export function payoutDistribution(payouts: Num[] | null | undefined): PayoutDistributionResult {
  const values = (payouts ?? []).filter(ok);
  const count = values.length;
  if (count === 0) {
    return { median: null, p25: null, mean: null, zeroRate: null, top10RevenueShare: null, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);
  const zeros = sorted.filter((v) => v === 0).length;
  const topCount = Math.max(1, Math.ceil(count * 0.1));
  const topTotal = sorted.slice(count - topCount).reduce((sum, v) => sum + v, 0);
  return {
    median: nearestRank(sorted, 0.5),
    p25: nearestRank(sorted, 0.25),
    mean: divide(total, count),
    zeroRate: divide(zeros, count),
    top10RevenueShare: divide(topTotal, total),
    count,
  };
}

/* ------------------------------------------------------------------ *
 * §2 / §3 — Revenue: platform-reported vs computed
 *
 * A payout field is not automatically revenue, and a payout field we cannot
 * see is not zero revenue.
 *
 * `platform` — the tracking platform reports real payouts. A call is billable
 * when it is long enough AND its payout is at or above the client's
 * `min_payout_threshold`, and revenue is the sum of those payouts. The
 * threshold exists because some syncs record telco COST in the payout field:
 * a $0.05 "payout" on a 14-second call is a carrier charge, not revenue.
 *
 * `computed` — the payouts are real but invisible to our access (BuyologyIQ's
 * Walk-In Tubs pays $80 per billable call and Ringba reports $0.00). That is a
 * DECLARED DATA LIMITATION, not a zero to be believed. Billable is decided by
 * duration alone and revenue is `payout × billable calls`. The platform payout
 * field is ignored entirely — reading it would report a real product as a total
 * loss.
 *
 * This selection lives here ONCE. No page, query or hook re-derives it.
 * @see docs/media-brain/01_Decision_Engine.md §2, §3
 * ------------------------------------------------------------------ */

/** Where a vertical's revenue comes from. @see 01_Decision_Engine.md §2 */
export type RevenueSource = 'platform' | 'computed';

/** The economics fields the revenue rule reads, per vertical. */
export interface RevenueEconomics {
  revenue_source: RevenueSource | string | null;
  /** Contracted payout per billable call. Required when the source is `computed`. */
  payout: Num;
  /** Smallest payout that counts as revenue rather than telco cost. */
  min_payout_threshold: Num;
  billable_min_duration_seconds: Num;
}

/** Framework default for the revenue threshold — mirrors the column default. */
export const MIN_PAYOUT_THRESHOLD_DEFAULT = 1.0;

/** Normalise the stored value; anything unrecognised is treated as `platform`. */
export function revenueSourceOf(eco: Pick<RevenueEconomics, 'revenue_source'>): RevenueSource {
  return eco.revenue_source === 'computed' ? 'computed' : 'platform';
}

/** The threshold actually applied, never left undefined. */
export function minPayoutThreshold(eco: Pick<RevenueEconomics, 'min_payout_threshold'>): number {
  return ok(eco.min_payout_threshold) ? eco.min_payout_threshold : MIN_PAYOUT_THRESHOLD_DEFAULT;
}

/**
 * Is this payout real revenue, or telco cost sitting in the payout field?
 * @see docs/media-brain/01_Decision_Engine.md §2
 */
export function payoutIsRevenue(payout: Num, threshold: Num): boolean {
  if (!ok(payout)) return false;
  return payout >= (ok(threshold) ? threshold : MIN_PAYOUT_THRESHOLD_DEFAULT);
}

/** The minimum a call needs to be judged billable. Both mappers and reads use this. */
export interface BillableCallInput {
  duration_seconds: Num;
  payout_amount: Num;
  /** The source's own conversion flag, where the table has one. */
  converted?: boolean | null;
}

/**
 * THE billable definition, stated once.
 *
 * `computed` → duration alone, because the payout field carries nothing we can
 * read. `platform` → duration AND a payout at or above the revenue threshold.
 * Returns false when the duration threshold is unknown — never guessed (§3).
 * @see docs/media-brain/01_Decision_Engine.md §2, §3
 */
export function isBillableCall(eco: RevenueEconomics, call: BillableCallInput): boolean {
  const minDuration = eco.billable_min_duration_seconds;
  if (!ok(minDuration)) return false;
  if (!ok(call.duration_seconds)) return false;
  if (call.duration_seconds < minDuration) return false;
  if (revenueSourceOf(eco) === 'computed') return true;
  if (call.converted === false) return false;
  return payoutIsRevenue(call.payout_amount, minPayoutThreshold(eco));
}

export interface ResolvedRevenue {
  source: RevenueSource;
  /** Null when the source is `computed` and no contracted payout is recorded. */
  revenue: number | null;
  /** Calls meeting the billable definition for this revenue source. */
  billableCalls: number;
  /** Calls with any payout above zero — including sub-threshold telco noise. */
  paidCalls: number;
  /** Calls whose payout clears the revenue threshold. */
  qualifyingPayoutCalls: number;
  /** Non-zero payouts BELOW the threshold — the telco-cost tail. */
  subThresholdPayoutCalls: number;
  /** Plain-language statement of where the number came from. Always rendered. */
  note: string;
}

/**
 * Resolve a set of calls into revenue plus its provenance. The ONLY place
 * revenue is decided. Rows carry their own `billable` where a mapper already
 * applied `isBillableCall` with the same economics; otherwise it is derived here.
 * @see docs/media-brain/01_Decision_Engine.md §2, §3
 */
export function resolveRevenue(
  eco: RevenueEconomics,
  rows: (BillableCallInput & { billable?: boolean })[],
): ResolvedRevenue {
  const source = revenueSourceOf(eco);
  const threshold = minPayoutThreshold(eco);
  let billableCalls = 0;
  let paidCalls = 0;
  let qualifyingPayoutCalls = 0;
  let subThresholdPayoutCalls = 0;
  let platformRevenue = 0;

  for (const row of rows) {
    const billable = typeof row.billable === 'boolean' ? row.billable : isBillableCall(eco, row);
    if (billable) billableCalls += 1;
    const payout = ok(row.payout_amount) ? row.payout_amount : 0;
    if (payout > 0) paidCalls += 1;
    if (payoutIsRevenue(payout, threshold)) {
      qualifyingPayoutCalls += 1;
      platformRevenue += payout;
    } else if (payout > 0) {
      subThresholdPayoutCalls += 1;
    }
  }

  if (source === 'computed') {
    const payout = eco.payout;
    return {
      source,
      revenue: ok(payout) ? payout * billableCalls : null,
      billableCalls,
      paidCalls,
      qualifyingPayoutCalls,
      subThresholdPayoutCalls,
      note: ok(payout)
        ? `Computed: the tracking platform does not expose this vertical's payouts, so revenue is the contracted $${payout.toFixed(2)} × ${billableCalls} billable calls. The platform payout field is ignored here — an invisible payout is a declared data limitation, not a zero.`
        : 'Computed revenue was requested but no contracted payout is recorded, so revenue is unavailable. It is not zero — re-run intake and supply the payout.',
    };
  }

  return {
    source,
    revenue: platformRevenue,
    billableCalls,
    paidCalls,
    qualifyingPayoutCalls,
    subThresholdPayoutCalls,
    note:
      `Platform: revenue is the sum of the ${qualifyingPayoutCalls} payouts at or above $${threshold.toFixed(2)}.` +
      (subThresholdPayoutCalls
        ? ` ${subThresholdPayoutCalls} further calls carry a non-zero payout below that threshold; those are excluded as telco cost recorded in the payout field, not revenue.`
        : ''),
  };
}

/* ------------------------------------------------------------------ *
 * Intake 3a — does the stated billable definition agree with the data?
 * ------------------------------------------------------------------ */

/** Above this, intake blocks and the operator must choose which definition governs. */
export const BILLABLE_DISAGREEMENT_LIMIT = 0.1;

export interface BillableAgreementResult {
  totalCalls: number;
  /** Long enough to be billable by the stated definition, but never paid. */
  billableByDefinitionUnpaid: number;
  /** Paid a real payout, but not billable by the stated definition. */
  paidNotBillableByDefinition: number;
  /** Both directions combined, over total calls. Null when there are no calls. */
  disagreementPct: number | null;
  /** True above BILLABLE_DISAGREEMENT_LIMIT — intake must not compute thresholds. */
  blocks: boolean;
  /** True when the payout side could not be checked because it is not visible. */
  durationSideOnly: boolean;
  note: string;
}

/**
 * Compare the STATED billable definition against what the platform's data
 * actually did over the window, in BOTH directions. One-directional checks miss
 * the more expensive error: calls the buyer paid for that our definition throws
 * away.
 *
 * Where `revenue_source = 'computed'` the platform payouts are not visible, so
 * only the duration side is validated and the check says so rather than
 * reporting perfect agreement.
 * @see docs/media-brain/02_Client_Intake.md Part A
 */
export function validateBillableDefinition(
  eco: RevenueEconomics,
  rows: BillableCallInput[],
): BillableAgreementResult {
  const source = revenueSourceOf(eco);
  const threshold = minPayoutThreshold(eco);
  const minDuration = eco.billable_min_duration_seconds;
  const totalCalls = rows.length;

  if (!ok(minDuration)) {
    return {
      totalCalls,
      billableByDefinitionUnpaid: 0,
      paidNotBillableByDefinition: 0,
      disagreementPct: null,
      blocks: true,
      durationSideOnly: source === 'computed',
      note: 'No billable duration threshold is stated, so the definition cannot be compared against the data at all. Supply it before any threshold is computed.',
    };
  }

  if (source === 'computed') {
    const longEnough = rows.filter((r) => ok(r.duration_seconds) && r.duration_seconds >= minDuration).length;
    return {
      totalCalls,
      billableByDefinitionUnpaid: 0,
      paidNotBillableByDefinition: 0,
      disagreementPct: null,
      blocks: false,
      durationSideOnly: true,
      note: `Platform payouts are not visible for this vertical, so only the duration side was validated: ${longEnough} of ${totalCalls} calls reach ${minDuration}s. The payout side cannot be checked and is declared unvalidated rather than reported as agreement.`,
    };
  }

  let billableByDefinitionUnpaid = 0;
  let paidNotBillableByDefinition = 0;
  for (const r of rows) {
    const longEnough = ok(r.duration_seconds) && r.duration_seconds >= minDuration;
    const paid = payoutIsRevenue(r.payout_amount, threshold);
    if (longEnough && !paid) billableByDefinitionUnpaid += 1;
    if (paid && !longEnough) paidNotBillableByDefinition += 1;
  }
  const disagreementPct = divide(billableByDefinitionUnpaid + paidNotBillableByDefinition, totalCalls);
  const blocks = disagreementPct !== null && disagreementPct > BILLABLE_DISAGREEMENT_LIMIT;
  return {
    totalCalls,
    billableByDefinitionUnpaid,
    paidNotBillableByDefinition,
    disagreementPct,
    blocks,
    durationSideOnly: false,
    note:
      `Of ${totalCalls} calls, ${billableByDefinitionUnpaid} are billable by the stated definition but were never paid, and ${paidNotBillableByDefinition} were paid but fall outside it.` +
      (blocks
        ? ` That is ${((disagreementPct as number) * 100).toFixed(1)}% disagreement, above the ${BILLABLE_DISAGREEMENT_LIMIT * 100}% limit — choose which definition governs before any threshold is computed.`
        : ' Within the 10% limit, so the stated definition may govern.'),
  };
}

/* ------------------------------------------------------------------ *
 * UNKNOWN thresholds and the SENSITIVITY BAND
 *
 * `billable_min_duration_seconds` is a contract term. Where a vertical's
 * revenue_source is `computed`, revenue IS payout x billable count, so that one
 * unconfirmed number decides revenue, RPC, margin per call, margin % and every
 * threshold derived from them. On BuyologyIQ's Walk-In Tubs the same 30 days
 * read +88.7% margin at 30s and -40.7% at 300s: the verdict flips on an input
 * nobody has supplied.
 *
 * So when the threshold is an UNKNOWN we publish no point estimate at all. We
 * publish the BAND across plausible thresholds, and say plainly that the true
 * figure depends on a contract term nobody has given us. A band that crosses
 * zero blocks verdicts outright.
 * @see docs/media-brain/01_Decision_Engine.md §1, §2
 * ------------------------------------------------------------------ */

/** The thresholds the band is evaluated at. Plausible call-duration terms. */
export const SENSITIVITY_DURATION_THRESHOLDS = [30, 60, 90, 120, 180, 240, 300];

/** Is this economics field declared UNKNOWN rather than stated? (§1) */
export function isUnknownField(
  unknownFields: string[] | null | undefined,
  field: string,
): boolean {
  if (!unknownFields?.length) return false;
  return unknownFields.some((f) => String(f).trim().toLowerCase() === field.toLowerCase());
}

/**
 * What an UNKNOWN `billable_min_duration_seconds` blocks. An UNKNOWN must name
 * what it blocks (§1), and for a `computed` vertical that is nearly everything.
 */
export function blockedByUnknownDuration(source: RevenueSource): string[] {
  return source === 'computed'
    ? ['revenue', 'RPC', 'margin per call', 'margin %', 'profit', 'cost per billable call', 'every threshold derived from them']
    : ['billable calls', 'cost per billable call'];
}

export interface SensitivityPoint {
  thresholdSeconds: number;
  billableCalls: number;
  /** Null when no contracted payout is recorded — the band cannot be drawn. */
  revenue: number | null;
  marginPerCall: number | null;
  marginPct: number | null;
}

export interface SensitivityBand {
  points: SensitivityPoint[];
  revenueLow: number | null;
  revenueHigh: number | null;
  marginPctLow: number | null;
  marginPctHigh: number | null;
  /** True when the band spans both profit and loss. */
  crossesZero: boolean;
  /** True whenever the band crosses zero — no verdict may be drawn from it. */
  verdictBlocking: boolean;
  note: string;
}

/**
 * The revenue/margin band across plausible duration thresholds. Renders INSTEAD
 * of revenue and margin whenever the threshold is UNKNOWN on a `computed`
 * vertical — never alongside a point estimate, which would be read as measured.
 */
export function revenueSensitivity(
  eco: RevenueEconomics,
  rows: BillableCallInput[],
  spend: Num,
  thresholds: number[] = SENSITIVITY_DURATION_THRESHOLDS,
): SensitivityBand {
  const source = revenueSourceOf(eco);
  const payoutThreshold = minPayoutThreshold(eco);
  const calls = rows.length;
  const spendNum = ok(spend) ? spend : 0;

  const points: SensitivityPoint[] = thresholds.map((t) => {
    let billableCalls = 0;
    let platformRevenue = 0;
    for (const r of rows) {
      const longEnough = ok(r.duration_seconds) && r.duration_seconds >= t;
      if (!longEnough) continue;
      if (source === 'computed') {
        billableCalls += 1;
        continue;
      }
      if (r.converted === false) continue;
      if (payoutIsRevenue(r.payout_amount, payoutThreshold)) {
        billableCalls += 1;
        platformRevenue += ok(r.payout_amount) ? r.payout_amount : 0;
      }
    }
    const revenue =
      source === 'computed' ? (ok(eco.payout) ? eco.payout * billableCalls : null) : platformRevenue;
    return {
      thresholdSeconds: t,
      billableCalls,
      revenue,
      marginPerCall: revenue === null ? null : marginPerCall(revenue, spendNum, calls),
      marginPct: revenue === null ? null : marginPct(revenue, spendNum),
    };
  });

  const revenues = points.map((p) => p.revenue).filter((v): v is number => v !== null);
  const margins = points.map((p) => p.marginPct).filter((v): v is number => v !== null);
  const revenueLow = revenues.length ? Math.min(...revenues) : null;
  const revenueHigh = revenues.length ? Math.max(...revenues) : null;
  const marginPctLow = margins.length ? Math.min(...margins) : null;
  const marginPctHigh = margins.length ? Math.max(...margins) : null;
  const crossesZero = marginPctLow !== null && marginPctHigh !== null && marginPctLow < 0 && marginPctHigh > 0;

  const range =
    revenueLow === null || revenueHigh === null
      ? 'The band cannot be drawn because no contracted payout is recorded — supply it at intake.'
      : `Across ${thresholds[0]}s to ${thresholds[thresholds.length - 1]}s, revenue runs $${revenueLow.toFixed(2)} to $${revenueHigh.toFixed(2)} and margin runs ${(marginPctLow! * 100).toFixed(1)}% to ${(marginPctHigh! * 100).toFixed(1)}%.`;

  return {
    points,
    revenueLow,
    revenueHigh,
    marginPctLow,
    marginPctHigh,
    crossesZero,
    verdictBlocking: crossesZero,
    note:
      `The billable duration threshold is UNKNOWN — assumed, not stated in any contract — and on a ${source} vertical it is the revenue. No point estimate is shown, only this range. ${range}` +
      (crossesZero
        ? ' THE RANGE CROSSES ZERO: on the same 30 days this vertical is either clearly profitable or losing money, depending entirely on a contract term nobody has supplied. No verdict may be drawn until it is.'
        : ''),
  };
}

/* ------------------------------------------------------------------ *
 * §3 — PUBLISHER ATTRIBUTION
 *
 * A tracking-platform campaign receives calls from every traffic source pointed
 * at it, not only from the media we buy. On BuyologyIQ the `Walk In tubs`
 * campaign took 1,144 calls in 30 days from six publishers; exactly 79 of them
 * came from Connect Paid Media. Dividing all 1,144 calls into our spend is the
 * same class of error as mixing denominators: it credits our media with someone
 * else's calls.
 *
 * So `attributed_publishers` on the Economics record is the definitive list of
 * publishers whose calls belong to this client's media buying, and EVERY metric,
 * verdict, vertical read and coverage figure filters on it. A call from any other
 * publisher is excluded from margin entirely and reported as excluded volume, so
 * the client's campaign total and our attributable total stay visibly different
 * numbers.
 *
 * There is NO default. An unconfigured list stops the pull — defaulting to "all
 * publishers" is precisely what produced the wrong read.
 * @see docs/media-brain/01_Decision_Engine.md §3
 * ------------------------------------------------------------------ */

/** Label used where a call carries no publisher at all. Never treated as ours. */
export const PUBLISHER_NOT_RECORDED = '(no publisher recorded)';

/** Has the operator stated whose calls these are? No list means no pull (§3). */
export function publisherAttributionConfigured(list: (string | null)[] | null | undefined): boolean {
  return !!list && list.some((p) => typeof p === 'string' && p.trim().length > 0);
}

/**
 * Does this call belong to our media buying? Exact match on the trimmed,
 * case-folded publisher name. A missing publisher is never assumed to be ours.
 */
export function isAttributedPublisher(
  publisher: string | null | undefined,
  list: (string | null)[] | null | undefined,
): boolean {
  if (!publisher || !publisherAttributionConfigured(list)) return false;
  const p = publisher.trim().toLowerCase();
  return (list ?? []).some((l) => typeof l === 'string' && l.trim().toLowerCase() === p);
}

export interface PublisherPartition<T> {
  /** Calls from a publisher on the list. The ONLY calls any metric may read. */
  attributed: T[];
  /** Calls belonging to someone else's media buying. Counted, never metered. */
  excluded: T[];
  excludedCalls: number;
  excludedByPublisher: { publisher: string; calls: number }[];
  note: string;
}

/**
 * Split calls into ours and everyone else's. The excluded side is reported
 * prominently rather than dropped — the system is not losing data, it is
 * declining to attribute other sources' calls to our spend.
 */
export function partitionByPublisher<T extends { publisher: string | null }>(
  calls: T[],
  list: (string | null)[] | null | undefined,
): PublisherPartition<T> {
  const attributed: T[] = [];
  const excluded: T[] = [];
  const counts = new Map<string, number>();
  for (const call of calls) {
    if (isAttributedPublisher(call.publisher, list)) {
      attributed.push(call);
      continue;
    }
    excluded.push(call);
    const key = call.publisher?.trim() || PUBLISHER_NOT_RECORDED;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const excludedByPublisher = [...counts.entries()]
    .map(([publisher, c]) => ({ publisher, calls: c }))
    .sort((a, b) => b.calls - a.calls);
  return {
    attributed,
    excluded,
    excludedCalls: excluded.length,
    excludedByPublisher,
    note: excluded.length
      ? `${excluded.length} of ${calls.length} calls came from ${excludedByPublisher.length} publisher${excludedByPublisher.length === 1 ? '' : 's'} not attributed to this client's media buying (${excludedByPublisher.map((e) => `${e.publisher} ${e.calls}`).join(', ')}). They are excluded from every metric and reported here: the tracking campaign total and our attributable total are different numbers and both are true.`
      : `All ${calls.length} calls came from attributed publishers.`,
  };
}
