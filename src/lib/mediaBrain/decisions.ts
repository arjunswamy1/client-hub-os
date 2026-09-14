/**
 * Media Brain — decision rules (pure logic layer)
 *
 * §6 cut rules, §7 hold rules, the §7 graduation gates, the §8 scale
 * qualification and the §8 marginal-return verdict live HERE and nowhere else.
 * They were previously inline in `MediaBrainWeeklyPage.tsx`, where they could
 * not be tested and where a second copy of a rule could drift from the first.
 *
 * No React, no Supabase, no I/O. Every metric is read from a row that
 * `pull.ts` already computed through `engine.ts` — nothing is re-derived here.
 *
 * @see docs/media-brain/01_Decision_Engine.md §6, §7, §8
 * @see docs/media-brain/03_Operating_Procedures.md §4
 */

import * as engine from './engine';
import type { ConfidenceState, PayoutMode, Verdict } from './engine';

/** Thresholds a decision needs. Every one comes from the Instance record. */
export interface DecisionContext {
  payoutMode: PayoutMode;
  targetMargin: number;
  minMargin: number;
  minCalls: number | null;
  killThreshold: number | null;
  allowableCostPerCall: number | null;
}

/**
 * The subset of a pull row a decision reads. Deliberately narrow: a decision
 * must not reach for a metric whose denominator it has not been told about.
 */
export interface DecisionRow {
  entity_name: string;
  spend: number;
  /** TOTAL calls. Never compared against a billable-denominated metric (§2). */
  calls: number;
  billable_calls: number;
  paid_calls: number;
  /** Margin per call — TOTAL-call denominator on both sides. The DECIDES metric. */
  marginPerCall: number | null;
  marginPct: number | null;
  /** TOTAL-call denominator. */
  costPerCall: number | null;
  /** BILLABLE-call denominator. Reported, never compared against costPerCall. */
  costPerBillableCall: number | null;
  confidenceState: ConfidenceState;
  payoutDistribution?: engine.PayoutDistributionResult | null;
}

/** Peers of a row inside its own group, for the "last in its group" rules. */
export interface DecisionGroup {
  /** 'ad' rules compare against siblings; 'adset' rows have no angle peers. */
  level: 'ad' | 'adset';
  peers: DecisionRow[];
}

const money = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : '—';
const pct = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';
const num = (v: number | null | undefined) =>
  typeof v === 'number' && Number.isFinite(v) ? `${v}` : '—';

/** Best margin per call among the peers. Null when there are no comparable peers. */
export function groupBestMarginPerCall(peers: DecisionRow[]): number | null {
  const values = peers
    .map((p) => p.marginPerCall)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!values.length) return null;
  return Math.max(...values);
}

export interface VerdictSuggestion {
  verdict: Exclude<Verdict, ''> | Verdict;
  reason: string;
  confidenceState: ConfidenceState;
}

/**
 * The suggested keep / cut / hold for one entity.
 *
 * Order matters and mirrors the framework:
 *  1. `decisive_zero` — past the kill threshold with a zero kill count. Fires
 *     regardless of sample size; it deliberately does not wait for `{min_calls}` (§6.3).
 *  2. `insufficient` — below `{min_calls}`. A HOLD, never a performance verdict:
 *     no confident-looking recommendation is surfaced on an insufficient sample (§4).
 *  3. Margin per call at or below breakeven on a sufficient sample → cut (§6.1).
 *  4. An ad last in its group on margin per call while a sibling clears target → cut (§6.2).
 *  5. At or above target margin → keep. Otherwise a hold (§7).
 *
 * Nothing here compares a total-call metric against a billable-call metric.
 * @see docs/media-brain/01_Decision_Engine.md §6, §7
 */
export function suggestVerdict(
  row: DecisionRow,
  ctx: DecisionContext,
  group?: DecisionGroup,
): VerdictSuggestion {
  const rtb = ctx.payoutMode === 'rtb';
  const state = row.confidenceState;

  if (state === 'decisive_zero') {
    return {
      verdict: 'cut',
      reason: `Spend of ${money(row.spend)} is past the kill threshold of ${money(ctx.killThreshold)} at zero ${
        rtb ? 'paid calls (under RTB "zero billable" means zero calls with a payout above zero)' : 'billable calls'
      }. This fires regardless of sample size.`,
      confidenceState: state,
    };
  }

  if (state === 'insufficient') {
    return {
      verdict: 'hold',
      reason: `Only ${num(row.billable_calls)} billable calls against a required ${num(
        ctx.minCalls,
      )} — no confident verdict is available yet.`,
      confidenceState: state,
    };
  }

  if ((row.marginPerCall ?? 0) <= 0) {
    return {
      verdict: 'cut',
      reason: `Margin per call ${money(row.marginPerCall)} is at or below breakeven on a sufficient sample${
        rtb ? ' — check that both mean and median fail before cutting under RTB.' : '.'
      }`,
      confidenceState: state,
    };
  }

  if (group?.level === 'ad') {
    const best = groupBestMarginPerCall(group.peers);
    if (
      best !== null &&
      (row.marginPerCall ?? -Infinity) < best &&
      (row.marginPct ?? 0) < ctx.targetMargin
    ) {
      return {
        verdict: 'cut',
        reason: `Last on margin per call in its group (${money(
          row.marginPerCall,
        )}) while another angle clears target margin.`,
        confidenceState: state,
      };
    }
  }

  if ((row.marginPct ?? 0) >= ctx.targetMargin) {
    return {
      verdict: 'keep',
      reason: `Margin ${pct(row.marginPct)} is at or above the ${pct(ctx.targetMargin)} target.`,
      confidenceState: state,
    };
  }

  return {
    verdict: 'hold',
    reason: `Margin ${pct(row.marginPct)} clears the floor but is below target — keep spend level, do not expand.`,
    confidenceState: state,
  };
}

export type GraduationGateName = 'margin' | 'group_leader' | 'volume';

export interface GraduationGatesResult {
  /** Clears breakeven with margin to spare — at or above target margin. */
  g1: boolean;
  /** Top of its group on margin per call. */
  g2: boolean;
  /** At or above `{min_calls}`. */
  g3: boolean;
  /** g1 && g2 && g3. Two of three is never a pass. */
  passes: boolean;
  /** Named failing gates, so the reason a graduation is not offered is explicit. */
  failed: GraduationGateName[];
  detail: { margin: string; groupLeader: string; volume: string };
}

/**
 * The §7 graduation gate. All three, or it is not a pass — two of three is
 * never a pass, and the failing gate is named rather than implied.
 * @see docs/media-brain/01_Decision_Engine.md §7
 */
export function graduationGates(
  row: DecisionRow,
  group: DecisionGroup,
  ctx: DecisionContext,
): GraduationGatesResult {
  const best = groupBestMarginPerCall(group.peers);
  const g1 = (row.marginPct ?? -1) >= ctx.targetMargin;
  const g2 = best !== null && (row.marginPerCall ?? -Infinity) >= best;
  const g3 = ctx.minCalls !== null && row.billable_calls >= ctx.minCalls;
  const failed: GraduationGateName[] = [];
  if (!g1) failed.push('margin');
  if (!g2) failed.push('group_leader');
  if (!g3) failed.push('volume');
  return {
    g1,
    g2,
    g3,
    passes: g1 && g2 && g3,
    failed,
    detail: {
      margin: `${pct(row.marginPct)} vs target ${pct(ctx.targetMargin)}`,
      groupLeader: `${money(row.marginPerCall)} vs best ${money(best)}`,
      volume: `${num(row.billable_calls)} of ${num(ctx.minCalls)}`,
    },
  };
}

/** The judgements a human supplies; they cannot be computed from the pull. */
export interface ScaleChecks {
  /** Held at or above target across two consecutive decision windows. */
  held: boolean;
  /** Buyer capacity headroom. */
  capacity: boolean;
  /** [RTB] no-bid rate and buyer mix stable. */
  stableMix: boolean;
  /** Requested step, in percent. */
  stepPct: number;
}

export interface ScaleQualificationResult {
  marginOk: boolean;
  callsOk: boolean;
  held: boolean;
  capacity: boolean;
  /** [RTB] revenue carried by the top 10% of calls — a scale blocker over 50%. */
  outlierCarried: boolean;
  stableMixOk: boolean;
  stepInRange: boolean;
  /** All four conditions plus the RTB extras. The step range is reported separately. */
  eligible: boolean;
  failed: string[];
}

/**
 * The §8 scale gate: margin at or above target, held across two consecutive
 * decision windows, enough calls, and buyer capacity headroom. Under RTB the
 * no-bid rate and buyer mix must also be stable and the distribution must not
 * be carried by outliers.
 * @see docs/media-brain/01_Decision_Engine.md §8
 */
export function scaleQualification(
  row: DecisionRow,
  ctx: DecisionContext,
  checks: ScaleChecks,
): ScaleQualificationResult {
  const rtb = ctx.payoutMode === 'rtb';
  const marginOk = (row.marginPct ?? -1) >= ctx.targetMargin;
  const callsOk = ctx.minCalls !== null && row.billable_calls >= ctx.minCalls;
  const outlierCarried = rtb && (row.payoutDistribution?.top10RevenueShare ?? 0) > 0.5;
  const stableMixOk = !rtb || checks.stableMix;
  const stepInRange =
    checks.stepPct >= engine.DEFAULTS.scaleStepMin * 100 &&
    checks.stepPct <= engine.DEFAULTS.scaleStepMax * 100;
  const eligible =
    marginOk && callsOk && checks.held && checks.capacity && stableMixOk && !outlierCarried;
  const failed: string[] = [];
  if (!marginOk) failed.push('margin below target');
  if (!callsOk) failed.push('below min_calls');
  if (!checks.held) failed.push('not held across two decision windows');
  if (!checks.capacity) failed.push('no buyer capacity headroom');
  if (!stableMixOk) failed.push('no-bid rate or buyer mix not stable');
  if (outlierCarried) failed.push('distribution carried by outliers');
  return { marginOk, callsOk, held: checks.held, capacity: checks.capacity, outlierCarried, stableMixOk, stepInRange, eligible, failed };
}

export interface MarginalVerdictResult {
  addedSpend: number;
  addedRevenue: number;
  marginalRoas: number | null;
  blendedRoas: number | null;
  /** ROAS a step must return to clear the target margin: 1 ÷ (1 − target). */
  requiredRoas: number;
  marginalPasses: boolean;
  /** Reported only to show what the blend was hiding. It never decides. */
  blendedPasses: boolean;
  verdict: 'scale_again' | 'stop_scaling';
  reason: string;
}

/**
 * §8 — did the LAST increment clear the bar?
 *
 * Judge the marginal return on the added spend, never blended ROAS: the blend
 * hides the point at which incremental spend stops clearing the target. A step
 * clears when its marginal ROAS reaches 1 ÷ (1 − target margin) — the ROAS at
 * which margin % equals the target.
 *
 * Null when there is no step to judge (added spend at or below zero).
 * @see docs/media-brain/01_Decision_Engine.md §8
 */
export function marginalVerdict(
  base: { spend: number | null; revenue: number | null },
  next: { spend: number | null; revenue: number | null },
  ctx: DecisionContext,
): MarginalVerdictResult | null {
  const r = engine.marginalReturn(base.spend, base.revenue, next.spend, next.revenue);
  if (!r) return null;
  const requiredRoas = 1 / (1 - ctx.targetMargin);
  const marginalPasses = r.marginalRoas !== null && r.marginalRoas >= requiredRoas;
  const blendedPasses = r.blendedRoas !== null && r.blendedRoas >= requiredRoas;
  return {
    ...r,
    requiredRoas,
    marginalPasses,
    blendedPasses,
    verdict: marginalPasses ? 'scale_again' : 'stop_scaling',
    reason: marginalPasses
      ? `The added ${money(r.addedSpend)} returned ${money(r.addedRevenue)} — a marginal ROAS of ${
          r.marginalRoas?.toFixed(2) ?? '—'
        } against the ${requiredRoas.toFixed(2)} needed for a ${pct(ctx.targetMargin)} margin. The step cleared the bar.`
      : `The added ${money(r.addedSpend)} returned ${money(r.addedRevenue)} — a marginal ROAS of ${
          r.marginalRoas?.toFixed(2) ?? '—'
        } against the ${requiredRoas.toFixed(2)} needed for a ${pct(ctx.targetMargin)} margin.${
          blendedPasses
            ? ` Blended ROAS of ${r.blendedRoas?.toFixed(2)} still looks fine — that is exactly what the blend hides.`
            : ''
        } Stop scaling; do not grant another increase on the blended number.`,
  };
}
