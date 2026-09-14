/**
 * Media Brain — the VERTICAL READ.
 *
 * This is information for a human, not a decision. The Decision Engine's
 * cut/hold/scale verdicts are ad-level rules and must never render here: a
 * vertical row is dozens of ads blended together, and blending hides exactly the
 * differences a verdict acts on.
 *
 * Why it exists: on a pooled-DID account the dialed number cannot identify a
 * creative. On BuyologyIQ, 76% of calls arrive on numbers drawn from rotating
 * pools and 100 of 302 numbers carried up to six different creatives, so
 * DID → creative would misattribute. But DID → Ringba campaign is stable — every
 * one of those 302 numbers maps to exactly one campaign — so the dialed number is
 * a reliable VERTICAL key even where it is a useless ad key.
 *
 * Assignment rules, stated once:
 *   - CALLS are assigned by the Ringba campaign name on the call (which the DID
 *     determines), matched against each vertical's `ringba_patterns`. Never by
 *     creative matching.
 *   - META SPEND is assigned by the ad name first, then the Meta campaign name,
 *     both against `meta_patterns`. Where a campaign's name matches more than one
 *     vertical the campaign is MIXED, and only an ad-name match may assign it —
 *     an ad in a mixed campaign that matches no vertical's patterns is reported
 *     as UNCLASSIFIED and is never assigned to a vertical by default.
 *
 * Every formula comes from engine.ts. Revenue comes from engine.resolveRevenue.
 *
 * @see docs/media-brain/01_Decision_Engine.md §2, §3
 */

import type { CanonicalCall } from './adapter';
import * as engine from './engine';
import type { ConfidenceState, RevenueEconomics, ResolvedRevenue, SensitivityBand } from './engine';
import type { MetaAdRow } from './join';

/** The vertical definition this read groups on. Sourced from `client_verticals`. */
export interface VerticalDefinition {
  vertical_id: string;
  label: string | null;
  emoji?: string | null;
  /** Ringba campaign-name patterns. Assign CALLS. Support `*` wildcards. */
  ringba_patterns: string[] | null;
  /** Meta ad-name / campaign-name patterns. Assign SPEND. Support `*` wildcards. */
  meta_patterns: string[] | null;
  ringba_exact_match?: boolean | null;
}

/** Economics plus its provenance: was the payout confirmed, what is UNKNOWN. */
export type VerticalEconomics = RevenueEconomics & {
  payout_confirmed?: boolean | null;
  /**
   * Publishers whose calls belong to this client's media buying. Calls from any
   * other publisher are excluded from every figure on the row and counted as
   * excluded volume instead. @see engine.partitionByPublisher
   */
  attributed_publishers?: (string | null)[] | null;
  /** Field names declared UNKNOWN — assumed, not stated. @see engine.isUnknownField */
  unknown_fields?: string[] | null;
  /**
   * Caveats stated on the record itself, rendered verbatim beside the figures.
   * Used where a term is confirmed by the client but still unverified against
   * platform data — a trusted contract term is not a measurement.
   */
  declared_flags?: string[] | null;
};


/** Per-vertical economics, keyed by `vertical_id`. Falls back to the client default. */
export interface VerticalEconomicsMap {
  byVertical: Record<string, VerticalEconomics>;
  clientDefault: VerticalEconomics;
}

export interface VerticalReadThresholds {
  minCalls: number | null;
  minMargin: number | null;
  targetMargin: number | null;
  killThreshold: number | null;
}

export interface VerticalReadRow {
  vertical_id: string;
  label: string;
  spend: number;
  calls: number;
  paidCalls: number;
  /** Null when the billable duration threshold is UNKNOWN — it decides this count. */
  billableCalls: number | null;
  revenue: number | null;
  revenueSource: engine.RevenueSource | 'unclassified';
  revenueNote: string;
  rpc: number | null;
  costPerCall: number | null;
  costPerBillableCall: number | null;
  marginPerCall: number | null;
  marginPct: number | null;
  profit: number | null;
  confidence: ConfidenceState;
  /** Kept explicit so the UI never renders a verdict at this level. */
  adLevelDecisionEligible: false;
  /** True when `billable_min_duration_seconds` is declared UNKNOWN. */
  durationThresholdUnknown: boolean;
  /** What that UNKNOWN blocks, named. Empty when nothing is blocked. */
  blockedFigures: string[];
  /**
   * Renders INSTEAD of revenue and margin when the threshold is UNKNOWN on a
   * `computed` vertical. Never alongside a point estimate.
   */
  sensitivity: SensitivityBand | null;
  /** Calls on this vertical's tracking campaign that belong to another publisher. */
  excludedPublisherCalls: number;
  excludedByPublisher: { publisher: string; calls: number }[];
  /** Meta's own reported conversions for the spend assigned here. Reconciliation only. */
  metaConversions: number;
  /**
   * Meta's conversions minus our attributed calls. A material gap is the story,
   * not something to reconcile away (§6 Operating Procedures).
   */
  conversionDiscrepancy: number | null;
  /** Named data caveats — unconfirmed payouts, zero-payout campaigns, and so on. */
  flags: string[];
  resolution: ResolvedRevenue | null;
}


export interface VerticalReadResult {
  rows: VerticalReadRow[];
  /** Spend and calls that matched no vertical. Never folded into a vertical. */
  unclassified: VerticalReadRow;
  /** Meta campaign names whose patterns matched more than one vertical. */
  mixedCampaigns: string[];
  /** Ad names inside a mixed campaign that matched no vertical's patterns. */
  unclassifiedAdNames: string[];
  /** Ringba campaign names on calls that matched no vertical. */
  unclassifiedCallCampaigns: string[];
  /**
   * Volume excluded because it came from a publisher this client does not buy.
   * Reported prominently: the tracking campaign total and our attributable total
   * are different numbers and both are true.
   */
  excluded: {
    calls: number;
    byPublisher: { publisher: string; calls: number }[];
    note: string;
  };
  /** Always rendered beside the read, so the reader knows why they are here. */
  note: string;
}

/* ---------------- pattern matching ---------------- */

/** `*` wildcards, case-insensitive. `Tub*`, `*WIT*`, `*Bath*` all behave as written. */
export function matchesPattern(value: string | null | undefined, pattern: string): boolean {
  if (!value || !pattern) return false;
  const v = value.toLowerCase().trim();
  const p = pattern.toLowerCase().trim();
  if (!p.includes('*')) return v.includes(p);
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(v);
}

function matchesAny(value: string | null | undefined, patterns: string[] | null | undefined): boolean {
  if (!patterns || !patterns.length) return false;
  return patterns.some((p) => matchesPattern(value, p));
}

/** Calls are assigned by the Ringba campaign name the DID resolves to. */
export function assignCallToVertical(
  campaignName: string | null,
  verticals: VerticalDefinition[],
): string | null {
  for (const v of verticals) {
    if (!v.ringba_patterns?.length) continue;
    if (v.ringba_exact_match) {
      if (v.ringba_patterns.some((p) => (campaignName ?? '').toLowerCase().trim() === p.toLowerCase().trim())) {
        return v.vertical_id;
      }
      continue;
    }
    if (matchesAny(campaignName, v.ringba_patterns)) return v.vertical_id;
  }
  return null;
}

/** Which verticals a Meta campaign name matches. More than one means MIXED. */
export function verticalsMatchingCampaign(
  campaignName: string | null,
  verticals: VerticalDefinition[],
): string[] {
  return verticals.filter((v) => matchesAny(campaignName, v.meta_patterns)).map((v) => v.vertical_id);
}

/** The vertical an ad's own NAME identifies, if any. */
export function verticalFromAdName(ad: MetaAdRow, verticals: VerticalDefinition[]): string | null {
  const matches = verticals.filter((v) => matchesAny(ad.ad_name, v.meta_patterns));
  return matches.length === 1 ? matches[0].vertical_id : null;
}

/**
 * Ad-name match first, campaign name second. In a MIXED campaign only the ad name
 * may assign; an ad matching nothing is unclassified, never defaulted.
 */
export function assignAdToVertical(
  ad: MetaAdRow,
  verticals: VerticalDefinition[],
  /** Campaign names known to carry ads from more than one vertical. */
  mixedCampaigns?: Set<string>,
): string | null {
  const byAdName = verticalFromAdName(ad, verticals);
  if (byAdName) return byAdName;
  if (ad.campaign_name && mixedCampaigns?.has(ad.campaign_name)) return null;
  const campaignMatches = verticalsMatchingCampaign(ad.campaign_name, verticals);
  if (campaignMatches.length === 1) return campaignMatches[0];
  return null;
}

/**
 * Which Meta campaigns are MIXED — either their name matches more than one
 * vertical, or their ads' own names resolve to more than one vertical. A mixed
 * campaign can only ever be assigned ad by ad.
 */
export function findMixedCampaigns(metaAds: MetaAdRow[], verticals: VerticalDefinition[]): Set<string> {
  const byCampaign = new Map<string, Set<string>>();
  const mixed = new Set<string>();
  for (const ad of metaAds) {
    const campaign = ad.campaign_name;
    if (!campaign) continue;
    if (verticalsMatchingCampaign(campaign, verticals).length > 1) mixed.add(campaign);
    const fromName = verticalFromAdName(ad, verticals);
    if (!fromName) continue;
    const set = byCampaign.get(campaign) ?? new Set<string>();
    set.add(fromName);
    byCampaign.set(campaign, set);
  }
  for (const [campaign, set] of byCampaign) if (set.size > 1) mixed.add(campaign);
  return mixed;
}

/* ---------------- the read ---------------- */

/** A call reduced to what the revenue rule reads. Drops any stored `billable`. */
function toRevenueRow(call: CanonicalCall): engine.BillableCallInput {
  return { duration_seconds: call.duration_seconds, payout_amount: call.payout_amount };
}

function emptyRow(vertical_id: string, label: string): VerticalReadRow {
  return {
    vertical_id,
    label,
    spend: 0,
    calls: 0,
    paidCalls: 0,
    billableCalls: 0,
    revenue: 0,
    revenueSource: 'platform',
    revenueNote: '',
    rpc: null,
    costPerCall: null,
    costPerBillableCall: null,
    marginPerCall: null,
    marginPct: null,
    profit: null,
    confidence: 'insufficient',
    adLevelDecisionEligible: false,
    durationThresholdUnknown: false,
    blockedFigures: [],
    sensitivity: null,
    excludedPublisherCalls: 0,
    excludedByPublisher: [],
    metaConversions: 0,
    conversionDiscrepancy: null,
    flags: [],
    resolution: null,
  };

}

export interface VerticalReadInput {
  calls: CanonicalCall[];
  metaAds: MetaAdRow[];
  verticals: VerticalDefinition[];
  economics: VerticalEconomicsMap;
  thresholds: VerticalReadThresholds;
  /** Share of calls resolved at ad level, shown beside the read. */
  adLevelPct?: number | null;
}

export function verticalRead({
  calls,
  metaAds,
  verticals,
  economics,
  thresholds,
  adLevelPct,
}: VerticalReadInput): VerticalReadResult {
  const callsByVertical = new Map<string, CanonicalCall[]>();
  const unclassifiedCalls: CanonicalCall[] = [];
  const unclassifiedCallCampaigns = new Set<string>();

  for (const call of calls) {
    const id = assignCallToVertical(call.campaign_name, verticals);
    if (!id) {
      unclassifiedCalls.push(call);
      if (call.campaign_name) unclassifiedCallCampaigns.add(call.campaign_name);
      continue;
    }
    const bucket = callsByVertical.get(id) ?? [];
    bucket.push(call);
    callsByVertical.set(id, bucket);
  }

  const spendByVertical = new Map<string, number>();
  const conversionsByVertical = new Map<string, number>();
  let unclassifiedSpend = 0;
  let unclassifiedConversions = 0;
  const mixedCampaigns = findMixedCampaigns(metaAds, verticals);
  const unclassifiedAdNames = new Set<string>();

  for (const ad of metaAds) {
    const id = assignAdToVertical(ad, verticals, mixedCampaigns);
    const spend = Number.isFinite(ad.spend) ? (ad.spend as number) : 0;
    const conversions = Number.isFinite(ad.conversions) ? (ad.conversions as number) : 0;
    if (!id) {
      unclassifiedSpend += spend;
      unclassifiedConversions += conversions;
      if (ad.ad_name) unclassifiedAdNames.add(ad.ad_name);
      continue;
    }
    spendByVertical.set(id, (spendByVertical.get(id) ?? 0) + spend);
    conversionsByVertical.set(id, (conversionsByVertical.get(id) ?? 0) + conversions);
  }

  const rows = verticals.map((v) => {
    const eco = economics.byVertical[v.vertical_id] ?? economics.clientDefault;
    const allBucket = callsByVertical.get(v.vertical_id) ?? [];
    const spend = spendByVertical.get(v.vertical_id) ?? 0;
    // §3 — only calls from publishers this client actually buys may reach a
    // metric. Everything else belongs to another buyer's media and is counted as
    // excluded volume, never divided into our spend.
    const publisherList = eco.attributed_publishers ?? economics.clientDefault.attributed_publishers;
    const split = engine.partitionByPublisher(allBucket, publisherList);
    const bucket = split.attributed;
    // Strip each call's stored `billable`: it was derived from the CLIENT-level
    // economics, and this vertical may bill differently. The vertical's own
    // economics decide, in the engine.
    const resolved = engine.resolveRevenue(eco, bucket.map(toRevenueRow));

    const row = emptyRow(v.vertical_id, v.label ?? v.vertical_id);
    row.spend = spend;
    row.calls = bucket.length;
    row.paidCalls = resolved.paidCalls;
    row.billableCalls = resolved.billableCalls;
    row.revenue = resolved.revenue;
    row.revenueSource = resolved.source;
    row.revenueNote = resolved.note;
    row.resolution = resolved;
    row.excludedPublisherCalls = split.excludedCalls;
    row.excludedByPublisher = split.excludedByPublisher;
    row.metaConversions = conversionsByVertical.get(v.vertical_id) ?? 0;
    row.conversionDiscrepancy = row.metaConversions - row.calls;

    const revenue = resolved.revenue;
    row.rpc = revenue === null ? null : engine.rpc(revenue, row.calls);
    row.costPerCall = engine.costPerCall(spend, row.calls);
    row.costPerBillableCall = engine.costPerBillableCall(spend, resolved.billableCalls);
    row.marginPerCall = revenue === null ? null : engine.marginPerCall(revenue, spend, row.calls);
    row.profit = revenue === null ? null : engine.profit(revenue, spend);
    row.marginPct = revenue === null ? null : engine.marginPct(revenue, spend);
    row.confidence = engine.confidenceState(
      resolved.billableCalls,

      resolved.billableCalls,
      thresholds.minCalls,
      spend,
      thresholds.killThreshold,
    );

    if (split.excludedCalls) {
      row.flags.push(
        `${split.excludedCalls} calls on this tracking campaign came from other publishers (${split.excludedByPublisher.map((e) => `${e.publisher} ${e.calls}`).join(', ')}) and are excluded from every figure here — they belong to someone else's media buying.`,
      );
    }
    // Caveats stated on the record itself, verbatim. A confirmed contract term
    // the platform does not corroborate still has to read as trusted, not measured.
    for (const declared of eco.declared_flags ?? []) {
      if (declared && declared.trim()) row.flags.push(declared.trim());
    }

    if (eco.revenue_source === 'computed') {
      row.flags.push(
        'Revenue is computed from the contracted payout because the tracking platform does not expose this vertical\'s payouts. A payout we cannot see is a declared data limitation, not a zero.',
      );
    }
    if ((eco as { payout_confirmed?: boolean | null }).payout_confirmed === false) {
      row.flags.push('The payout used here was observed in the data, not confirmed by contract. Confirm it at intake.');
    }
    if (row.calls > 0 && resolved.paidCalls === 0 && resolved.source === 'platform') {
      row.flags.push('No call in this vertical carries any payout, so it may need its own economics record rather than the client default.');
    }
    if (resolved.subThresholdPayoutCalls > 0) {
      row.flags.push(
        `${resolved.subThresholdPayoutCalls} calls carry a non-zero payout below the revenue threshold; excluded as telco cost recorded in the payout field.`,
      );
    }

    // §1 — UNKNOWN discipline. The billable duration threshold is a contract
    // term; on a `computed` vertical it IS the revenue, so an assumed threshold
    // must never be presented as a measurement. Suppress every figure it
    // decides and publish the band instead.
    // Two different unknowns block the same figures: not knowing WHERE the line is
    // (`billable_min_duration_seconds`) and not knowing WHICH duration it is drawn on
    // (`billable_duration_field` — Moja reports two, and which one the buyer bills on is
    // unconfirmed). Either one makes the billable count unknowable, so both take this path.
    const unknownThreshold = engine.isUnknownField(eco.unknown_fields, 'billable_min_duration_seconds');
    const unknownDurationField = engine.isUnknownField(eco.unknown_fields, 'billable_duration_field');
    const durationUnknown = unknownThreshold || unknownDurationField;
    if (durationUnknown) {
      row.durationThresholdUnknown = true;
      row.blockedFigures = engine.blockedByUnknownDuration(resolved.source);
      row.sensitivity = engine.revenueSensitivity(eco, bucket.map(toRevenueRow), spend);
      row.billableCalls = null;
      row.costPerBillableCall = null;
      if (resolved.source === 'computed') {
        row.revenue = null;
        row.rpc = null;
        row.marginPerCall = null;
        row.marginPct = null;
        row.profit = null;
        row.confidence = 'insufficient';
      }
      row.revenueNote = row.sensitivity.note;
      row.flags.push(
        `UNKNOWN: billable_min_duration_seconds is assumed, not stated. It blocks ${row.blockedFigures.join(', ')}.`,
      );
    }
    return row;

  });

  const unclassifiedSplit = engine.partitionByPublisher(
    unclassifiedCalls,
    economics.clientDefault.attributed_publishers,
  );
  const unclassified = emptyRow('unclassified', 'Unclassified');
  unclassified.spend = unclassifiedSpend;
  unclassified.calls = unclassifiedSplit.attributed.length;
  unclassified.excludedPublisherCalls = unclassifiedSplit.excludedCalls;
  unclassified.excludedByPublisher = unclassifiedSplit.excludedByPublisher;
  unclassified.metaConversions = unclassifiedConversions;
  unclassified.conversionDiscrepancy = unclassifiedConversions - unclassified.calls;
  const unclassifiedResolved = engine.resolveRevenue(
    economics.clientDefault,
    unclassifiedSplit.attributed.map(toRevenueRow),
  );
  unclassified.paidCalls = unclassifiedResolved.paidCalls;
  unclassified.billableCalls = unclassifiedResolved.billableCalls;
  unclassified.revenue = unclassifiedResolved.revenue;
  unclassified.revenueSource = 'unclassified';
  unclassified.revenueNote =
    'These calls and this spend matched no vertical pattern. They are reported here rather than assigned to a vertical by default — a defaulted assignment would move real money onto the wrong product.';
  unclassified.costPerCall = engine.costPerCall(unclassifiedSpend, unclassified.calls);
  unclassified.costPerBillableCall = engine.costPerBillableCall(unclassifiedSpend, unclassifiedResolved.billableCalls);
  unclassified.confidence = engine.confidenceState(
    unclassifiedResolved.billableCalls,

    unclassifiedResolved.billableCalls,
    thresholds.minCalls,
    unclassifiedSpend,
    thresholds.killThreshold,
  );
  unclassified.resolution = unclassifiedResolved;

  // The excluded total across the whole read, so nobody reads a smaller call
  // count as lost data.
  const excludedCounts = new Map<string, number>();
  for (const r of [...rows, unclassified]) {
    for (const e of r.excludedByPublisher) excludedCounts.set(e.publisher, (excludedCounts.get(e.publisher) ?? 0) + e.calls);
  }
  const excludedByPublisher = [...excludedCounts.entries()]
    .map(([publisher, c]) => ({ publisher, calls: c }))
    .sort((a, b) => b.calls - a.calls);
  const excludedCalls = excludedByPublisher.reduce((sum, e) => sum + e.calls, 0);

  const coverage =
    adLevelPct === null || adLevelPct === undefined
      ? ''
      : ` Ad-level attribution currently covers ${(adLevelPct * 100).toFixed(1)}% of calls, which is why the read is at vertical level.`;

  return {
    rows,
    unclassified,
    mixedCampaigns: [...mixedCampaigns],
    unclassifiedAdNames: [...unclassifiedAdNames],
    unclassifiedCallCampaigns: [...unclassifiedCallCampaigns],
    excluded: {
      calls: excludedCalls,
      byPublisher: excludedByPublisher,
      note: excludedCalls
        ? `${excludedCalls} calls from ${excludedByPublisher.length} other publisher${excludedByPublisher.length === 1 ? '' : 's'} are excluded from every figure above (${excludedByPublisher.map((e) => `${e.publisher} ${e.calls}`).join(', ')}). Nothing is lost: the client's tracking campaigns received them, but they came from traffic this client's media buying did not pay for, so dividing them into our spend would credit our media with someone else's calls.`
        : 'Every call in the window came from an attributed publisher.',
    },
    note:
      'This is a vertical read, not an ad-level decision. Cut, hold and scale verdicts are ad-level rules and are deliberately not shown here — a vertical row blends dozens of ads, and blending hides the differences a verdict acts on.' +
      coverage,
  };
}
