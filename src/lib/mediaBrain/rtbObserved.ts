/**
 * Media Brain — RTB terms measured from live call data.
 *
 * §2 Decision Engine, §7 Intake: under STATIC the buyer states the payout and the
 * billable definition, and intake records what was stated. Under RTB there is no
 * stated payout to record — the auction sets it call by call. So the RTB terms are
 * MEASURED from the tracking platform's own calls over a named window, never quoted.
 *
 * Denominator rule (non-negotiable #1): under RTB, RPC uses TOTAL calls so no-bid
 * losses stay visible. The average WINNING bid uses paid calls only, because it
 * describes what the auction pays when it pays — the two are different questions
 * and are reported separately here.
 *
 * This module is pure. It computes; it does not fetch, and it does not decide.
 */

import { minCalls } from './engine';

export interface ObservedCall {
  /** Payout as the platform reported it. Null/absent is treated as no payout. */
  payout: number | null | undefined;
  /** Call duration in seconds as the platform reported it. */
  duration_seconds: number | null | undefined;
}

export interface RtbObservedTerms {
  /** Every call in the window — the RTB denominator. */
  totalCalls: number;
  /** Calls the auction actually paid for (payout > 0). */
  paidCalls: number;
  /** Sum of payouts in the window. */
  revenue: number;
  /** revenue ÷ total calls. The baseline RPC under RTB. */
  observedRpc: number | null;
  /** revenue ÷ paid calls. The average winning bid. */
  avgWinningBid: number | null;
  /** Lowest and highest single payout observed among paid calls. */
  bidFloor: number | null;
  bidCeiling: number | null;
  /** Duration range of paid calls — what the auction pays for in practice. */
  paidDurationMinSeconds: number | null;
  paidDurationMaxSeconds: number | null;
  /** Shortest paid call: the observed minimum duration for any payout. */
  minDurationWithPayout: number | null;
  /** paid calls ÷ total calls. */
  paidRate: number | null;
  /** Rows dropped because they carried no usable duration or payout field. */
  unusableRows: number;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Measure the RTB terms from a window of calls. An empty window returns zeroed
 * counts and null terms — never a fabricated estimate (§10: an empty pull is a
 * failure, and the caller must say so rather than continue).
 */
export function measureRtbTerms(calls: ObservedCall[]): RtbObservedTerms {
  let totalCalls = 0;
  let unusableRows = 0;
  let revenue = 0;
  const paidPayouts: number[] = [];
  const paidDurations: number[] = [];

  for (const c of calls) {
    const payout = num(c.payout);
    const duration = num(c.duration_seconds);
    if (payout === null && duration === null) {
      unusableRows += 1;
      continue;
    }
    totalCalls += 1;
    if (payout !== null && payout > 0) {
      revenue += payout;
      paidPayouts.push(payout);
      if (duration !== null) paidDurations.push(duration);
    }
  }

  const paidCalls = paidPayouts.length;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    totalCalls,
    paidCalls,
    revenue: round2(revenue),
    observedRpc: totalCalls > 0 ? round2(revenue / totalCalls) : null,
    avgWinningBid: paidCalls > 0 ? round2(revenue / paidCalls) : null,
    bidFloor: paidCalls > 0 ? Math.min(...paidPayouts) : null,
    bidCeiling: paidCalls > 0 ? Math.max(...paidPayouts) : null,
    paidDurationMinSeconds: paidDurations.length ? Math.min(...paidDurations) : null,
    paidDurationMaxSeconds: paidDurations.length ? Math.max(...paidDurations) : null,
    minDurationWithPayout: paidDurations.length ? Math.min(...paidDurations) : null,
    paidRate: totalCalls > 0 ? round2(paidCalls / totalCalls) : null,
    unusableRows,
  };
}

export interface RtbSufficiency {
  /** {min_calls} for RTB at the stated actionable gap. */
  required: number | null;
  observed: number;
  sufficient: boolean;
  note: string;
}

/**
 * Is the measured window big enough to be read as terms? The gate is the same
 * `{min_calls}` the ranking rules use (§4), taken at the RTB setting — measured
 * terms below it are shown and labelled insufficient, not hidden and not trusted.
 */
export function rtbSufficiency(totalCalls: number, actionableGap: number | null): RtbSufficiency {
  const required = minCalls(actionableGap, 'rtb');
  if (required === null) {
    return {
      required: null,
      observed: totalCalls,
      sufficient: false,
      note: 'No actionable gap stated, so {min_calls} cannot be computed — the window cannot be judged sufficient.',
    };
  }
  const sufficient = totalCalls >= required;
  return {
    required,
    observed: totalCalls,
    sufficient,
    note: sufficient
      ? `${totalCalls} calls in the window, at or above {min_calls} = ${required} for RTB.`
      : `${totalCalls} calls in the window, below {min_calls} = ${required} for RTB — treat these terms as provisional and re-measure once volume arrives.`,
  };
}

/** Which stored call table each tracking platform's calls live in. */
export const RTB_CALL_SOURCES = {
  ringba: { table: 'ringba_calls', dateColumn: 'call_date', label: 'Ringba' },
  ringba_4js: { table: 'ringba_calls_4js', dateColumn: 'call_date', label: 'Ringba (4Js)' },
  ringfuel: { table: 'ringfuel_calls', dateColumn: 'call_start', label: 'RingFuel' },
  moja: { table: 'moja_calls', dateColumn: 'call_start', label: 'Moja' },
  cannaball: { table: 'cannaball_calls', dateColumn: 'call_start', label: 'CallGrid' },
} as const;

export type RtbCallSourceKey = keyof typeof RTB_CALL_SOURCES;

export function rtbCallSource(trackingPlatform: string) {
  return (RTB_CALL_SOURCES as Record<string, { table: string; dateColumn: string; label: string } | undefined>)[
    trackingPlatform
  ];
}

/** The provenance line stored with the intake, so the terms can be re-derived. */
export function rtbProvenanceNote(
  sourceLabel: string,
  start: string,
  end: string,
  terms: RtbObservedTerms,
  sufficiency: RtbSufficiency,
): string {
  return [
    `RTB terms measured from ${sourceLabel} calls, ${start} to ${end}.`,
    `${terms.totalCalls} total calls, ${terms.paidCalls} paid (${terms.paidRate === null ? '—' : Math.round(terms.paidRate * 100)}% paid rate), $${terms.revenue} in payouts.`,
    `Observed RPC $${terms.observedRpc ?? '—'} on TOTAL calls; average winning bid $${terms.avgWinningBid ?? '—'} on paid calls only.`,
    sufficiency.note,
  ].join(' ');
}
