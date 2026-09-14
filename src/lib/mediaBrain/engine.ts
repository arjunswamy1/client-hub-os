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
 * Confidence state for a row.
 *
 * - `decisive_zero` — zero billable calls past the kill threshold. Decisive
 *   despite a low count; deliberately does NOT wait for `{min_calls}` (§6.3).
 * - `sufficient` — at or above `{min_calls}`. Act.
 * - `insufficient` — below it. Hold, and render greyed / marked *insufficient data*.
 *
 * Never surface a confident-looking recommendation on an insufficient sample.
 * @see docs/media-brain/01_Decision_Engine.md §4, §6.3
 */
export function confidenceState(
  billableCalls: Num,
  minCallsValue: Num,
  spend: Num,
  killThresholdValue: Num,
): ConfidenceState {
  if (
    ok(billableCalls) &&
    billableCalls === 0 &&
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
 * Kill threshold: spend at which an entity with ZERO billable calls is killed.
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
