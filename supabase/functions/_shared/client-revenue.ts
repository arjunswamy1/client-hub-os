/**
// Edge-runtime copy of src/lib/mediaBrain/clientRevenue.ts — edge functions cannot
// import from src/. Keep the two in step; the RULE is stated once, here and there.
 * WHICH FIELD IS CPM'S MONEY — decided once, from the account's engagement type.
 *
 * `performance_media` (Spektrafin, Cannaball, Jacuzzi, RateQuote) — CPM buys the
 * media directly and is paid per converted call or per lead. The call table's
 * `revenue` column is CPM's income; profit = revenue − media spend, and downside
 * is capped at media spend (a negative result is profit not earned, never a debt).
 * `payout` is NOT income on these accounts and is never copied into revenue.
 *
 * `pay_per_call` (BuyologyIQ, RRM, Hablyte, PPC Media) — CPM is the publisher and
 * `payout` is what CPM is paid, which is what the rest of the Media Brain assumes.
 *
 * Any report that would otherwise reach for `payout` or `revenue` directly goes
 * through `resolveClientRevenue` instead: one place, one rule.
 *
 * @see docs/media-brain/01_Decision_Engine.md §7 (absent is not zero)
 */

export type EngagementType =
  | 'performance_media'
  | 'pay_per_call'
  | 'ecommerce'
  | 'creative_only'
  | 'pre_launch'
  | 'self_managed';

/** The money field for an engagement type, or null when calls are not the income. */
export type RevenueField = 'revenue' | 'payout' | null;

export interface RevenueClient {
  engagement_type?: string | null;
}

export interface RevenueCallRow {
  /** The call table's `payout` column — what a buyer paid a publisher. */
  payout?: unknown;
  /** The call table's `revenue` column — what CPM earned on a media-buy account. */
  revenue?: unknown;
  /**
   * Did the source actually deliver a revenue figure for this call? False means
   * UNKNOWN, never zero — a thin webhook that omits revenue says nothing about
   * what the call earned.
   */
  revenue_captured?: boolean | null;
}

export interface ResolvedClientRevenue {
  /** Which column decided, given the engagement type. */
  field: RevenueField;
  /** The money this call earned CPM, or null when it was never captured. */
  amount: number | null;
  /** True only when the deciding field actually carried a value. */
  captured: boolean;
  /** Plain-language provenance, always available to a report. */
  note: string;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The money field for this engagement type. Null = calls are not CPM's income. */
export function revenueFieldForEngagement(engagement?: string | null): RevenueField {
  switch (engagement) {
    case 'performance_media':
      return 'revenue';
    case 'pay_per_call':
      return 'payout';
    default:
      // ecommerce / creative_only / pre_launch / self_managed / unclassified:
      // call revenue is not how CPM is paid here. Named, never guessed.
      return null;
  }
}

/**
 * THE per-call money resolver. Picks the field from `clients.engagement_type`
 * rather than letting each report choose, and reports an uncaptured revenue as
 * unknown instead of zero.
 */
export function resolveClientRevenue(
  client: RevenueClient | null | undefined,
  call: RevenueCallRow,
): ResolvedClientRevenue {
  const engagement = client?.engagement_type ?? null;
  const field = revenueFieldForEngagement(engagement);

  if (field === null) {
    return {
      field: null,
      amount: null,
      captured: false,
      note: engagement
        ? `Engagement type "${engagement}" is not paid per call, so neither the revenue nor the payout column is CPM's income here.`
        : 'This account has no engagement type recorded, so no money field can be chosen. Set clients.engagement_type — the framework does not fall back on a default.',
    };
  }

  if (field === 'revenue') {
    // Performance media: revenue is the money and an absent revenue is UNKNOWN.
    // The payout column is deliberately ignored, never substituted.
    if (call.revenue_captured === false) {
      return {
        field,
        amount: null,
        captured: false,
        note: 'Revenue was never delivered for this call, so its earnings are UNKNOWN — excluded, not counted as zero.',
      };
    }
    const revenue = num(call.revenue);
    if (revenue === null) {
      return {
        field,
        amount: null,
        captured: false,
        note: 'No revenue value on this call, so its earnings are UNKNOWN. Payout is not CPM\'s income on a media-buy account and is not substituted.',
      };
    }
    return {
      field,
      amount: revenue,
      captured: true,
      note: 'Performance media: revenue is CPM\'s income (profit = revenue − media spend). The payout column is ignored on this account.',
    };
  }

  // Pay per call: CPM is the publisher and payout is what CPM is paid.
  const payout = num(call.payout);
  if (payout === null) {
    return {
      field,
      amount: null,
      captured: false,
      note: 'No payout value on this call, so what CPM was paid is UNKNOWN.',
    };
  }
  return {
    field,
    amount: payout,
    captured: true,
    note: 'Pay per call: CPM is the publisher, so payout is what CPM is paid.',
  };
}

/**
 * Sum a set of calls through the resolver, keeping uncaptured calls visible
 * rather than letting them read as zero earnings.
 */
export function sumClientRevenue(
  client: RevenueClient | null | undefined,
  calls: RevenueCallRow[],
): { total: number; capturedCalls: number; uncapturedCalls: number; field: RevenueField; complete: boolean } {
  let total = 0;
  let capturedCalls = 0;
  let uncapturedCalls = 0;
  const field = revenueFieldForEngagement(client?.engagement_type ?? null);
  for (const call of calls) {
    const r = resolveClientRevenue(client, call);
    if (r.captured && r.amount !== null) {
      total += r.amount;
      capturedCalls += 1;
    } else {
      uncapturedCalls += 1;
    }
  }
  return { total, capturedCalls, uncapturedCalls, field, complete: uncapturedCalls === 0 };
}
