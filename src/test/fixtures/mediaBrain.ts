/**
 * Media Brain — in-memory test fixtures.
 *
 * These build synthetic Meta rows, raw call rows, DID mappings, an Economics
 * record and an Instance record **entirely in memory**. Nothing is written to
 * `ringba_calls`, `ringfuel_calls`, `moja_calls`, `cannaball_calls` or any Meta
 * sync table — those are read-only, and the suite must run with no database and
 * no network.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ECONOMICS ARE $50 / 60% / $24 AND NOT $50 / 60% / $30
 *
 * The economics first sketched for this synthetic client were a $50 static
 * payout, a 60% billable rate and a $30 cost per call. Those describe a campaign
 * sitting at EXACTLY breakeven: per 10 calls, $300 spent, 6 billable, 6 × $50 =
 * $300 revenue, margin per call $0, margin 0%. No graduation candidate can be
 * built against them, because nothing clears breakeven with margin to spare.
 *
 * So the fixture uses a **$24 cost per call**: RPC = 0.6 × $50 = $30, cost per
 * billable call = $24 ÷ 0.6 = $40, margin per call $6, margin 20% — the target
 * band, and the same arithmetic as the corrected §16 worked example.
 * Volume is around 50 billable calls/week, which lands in the 25–100 weekly tier.
 * ---------------------------------------------------------------------------
 */

import type { ComputeEconomics, ComputeInstance } from '@/lib/mediaBrain/pull';
import type { DidMapping, MetaAdRow, VerticalRow } from '@/lib/mediaBrain/join';

/** $50 static payout, 60% billable, $24 cost per call → $40 cost per billable call, 20% margin. */
export const FIXTURE_ECONOMICS = {
  payout: 50,
  billableRate: 0.6,
  costPerCall: 24,
  billableMinDurationSeconds: 90,
  /** Only used under RTB. Kill threshold there is 2 × avg bid = $50. */
  avgBid: 25,
} as const;

export const WINDOW = { start: '2026-03-01', end: '2026-03-14', timezone: 'America/New_York' };

/** 14 consecutive ISO dates covering the window. */
export const WINDOW_DAYS = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 2, 1 + i));
  return d.toISOString().slice(0, 10);
});

export function economics(payoutMode: 'static' | 'rtb' = 'static'): ComputeEconomics {
  return {
    payout_mode: payoutMode,
    tracking_platform: 'ringba',
    payout: FIXTURE_ECONOMICS.payout,
    avg_bid: FIXTURE_ECONOMICS.avgBid,
    billable_min_duration_seconds: FIXTURE_ECONOMICS.billableMinDurationSeconds,
  };
}

/**
 * The Instance record. Every threshold is stored, exactly as intake would write
 * it — `computeWindow` reads them and never falls back on a default.
 *
 * min_calls 25 static / 35 RTB (8 ÷ 0.57², ×1.4 under RTB).
 * kill threshold 2 × payout = $100 static, 2 × avg bid = $50 RTB.
 * allowable cost per call = RPC × (1 − target) = $30 × 0.8 = $24.
 */
export function instance(payoutMode: 'static' | 'rtb' = 'static'): ComputeInstance {
  const rtb = payoutMode === 'rtb';
  return {
    actionable_gap: 0.57,
    min_calls: rtb ? 35 : 25,
    min_margin: 0.1,
    target_margin: 0.2,
    kill_threshold: rtb ? 2 * FIXTURE_ECONOMICS.avgBid : 2 * FIXTURE_ECONOMICS.payout,
    allowable_cost_per_call: 24,
  };
}

/** One synthetic ad: its Meta spend and the calls that joined to it. */
export interface AdSpec {
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  did: string;
  spend: number;
  clicks?: number;
  impressions?: number;
  /** TOTAL calls. */
  calls: number;
  /** Calls meeting the billable definition: long enough AND paid. */
  billableCalls: number;
  /**
   * Calls with a payout above zero. Defaults to `billableCalls`. Set it higher
   * to plant paid-but-short calls — under RTB that is the kill count, and under
   * static it is the signal that the billable definition is wrong.
   */
  paidCalls?: number;
  /** Payout on each paid call. Defaults to the static payout. */
  payoutPerPaidCall?: number;
  /** Connected calls. Defaults to every call. */
  connectedCalls?: number;
  /** Set false to leave this ad's spend with no DID mapping and no calls. */
  joins?: boolean;
  /**
   * Set false to keep the calls but create NO `client_dids` row for them, so the
   * DID path cannot resolve. Used to isolate the UTM tiers.
   */
  mapDid?: boolean;
  /**
   * Campaign name written on the CALL rows. Defaults to the fixture campaign,
   * which the vertical patterns match — override it with something unmatched to
   * stop the vertical fallback from catching the call.
   */
  callCampaignName?: string;
  /**
   * Attribution tags planted on the call, exactly as Ringba stores them in
   * `metadata` (`tag:User:*`). This is the UTM tier's only input.
   */
  utm?: {
    creativeId?: string;
    utmContent?: string;
    utmCampaign?: string;
    utmSource?: string;
  };
}

export interface Fixture {
  calls: Record<string, unknown>[];
  metaAds: MetaAdRow[];
  didMappings: DidMapping[];
  verticals: VerticalRow[];
  window: typeof WINDOW;
}

const CAMPAIGN = 'CPM | Final Expense | Prospecting';

/** Meta rows for one ad, split across all 14 days — one ad routinely has many. */
function metaRowsFor(spec: AdSpec): MetaAdRow[] {
  const perDay = spec.spend / WINDOW_DAYS.length;
  const clicks = spec.clicks ?? Math.max(spec.calls * 8, 40);
  const impressions = spec.impressions ?? clicks * 40;
  return WINDOW_DAYS.map((day) => ({
    platform_ad_id: spec.adId,
    platform_adset_id: spec.adsetId,
    platform_campaign_id: 'camp-1',
    ad_name: spec.adName,
    creative_name: spec.adName,
    adset_name: spec.adsetName,
    campaign_name: CAMPAIGN,
    platform: 'meta',
    spend: perDay,
    impressions: impressions / WINDOW_DAYS.length,
    clicks: clicks / WINDOW_DAYS.length,
    date_from: day,
    date_to: day,
  }));
}

/**
 * Raw `ringba_calls`-shaped rows for one ad. Durations and payouts are planted so
 * the adapter derives exactly the requested billable and paid counts:
 *   - billable calls: 120s and paid
 *   - paid-but-short calls: 30s and paid (below the 90s threshold)
 *   - the remainder: 120s and payout 0 (long but unpaid)
 */
function callsFor(spec: AdSpec): Record<string, unknown>[] {
  const paid = spec.paidCalls ?? spec.billableCalls;
  const payout = spec.payoutPerPaidCall ?? FIXTURE_ECONOMICS.payout;
  const connected = spec.connectedCalls ?? spec.calls;
  const campaignName = spec.callCampaignName ?? CAMPAIGN;
  // Ringba keeps its user tags inside `metadata`, so that is where they go.
  const metadata: Record<string, unknown> | undefined = spec.utm
    ? {
        source: 'ringba_api',
        ...(spec.utm.creativeId ? { 'tag:User:creative': spec.utm.creativeId } : {}),
        ...(spec.utm.utmContent ? { 'tag:User:utm_content': spec.utm.utmContent } : {}),
        ...(spec.utm.utmCampaign ? { 'tag:User:utm_campaign': spec.utm.utmCampaign } : {}),
        ...(spec.utm.utmSource ? { 'tag:User:utm_source': spec.utm.utmSource } : {}),
      }
    : undefined;
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < spec.calls; i++) {
    const isBillable = i < spec.billableCalls;
    const isPaidShort = !isBillable && i < paid;
    rows.push({
      call_id: `${spec.adId}-call-${i}`,
      call_date: `${WINDOW_DAYS[i % WINDOW_DAYS.length]}T15:00:00Z`,
      inbound_number: spec.did,
      campaign_name: campaignName,
      metadata,
      duration_seconds: isPaidShort ? 30 : 120,
      connected: i < connected,
      converted: isBillable,
      payout: isBillable || isPaidShort ? payout : 0,
      target_name: 'Buyer A',
    });
  }
  return rows;
}

/** Build a fixture from a list of ad specs. */
export function buildFixture(specs: AdSpec[]): Fixture {
  const joining = specs.filter((s) => s.joins !== false);
  return {
    calls: joining.flatMap(callsFor),
    metaAds: specs.flatMap(metaRowsFor),
    didMappings: joining
      .filter((s) => s.mapDid !== false)
      .map((s) => ({
        did: s.did,
        did_formatted: s.did,
        creative_name: s.adName,
        platform: 'meta',
        campaign_name: CAMPAIGN,
      })),
    verticals: [
      { vertical_id: 'final-expense', label: 'Final Expense', meta_patterns: ['Final Expense'], ringba_patterns: ['Final Expense'] },
    ],
    window: WINDOW,
  };
}

/* ------------------------------------------------------------------ *
 * The planted scenarios. Each name is asserted in mediaBrain.test.ts.
 * ------------------------------------------------------------------ */

export const SCENARIOS = {
  /**
   * 1. Clear loser — 25 billable (at min_calls) but margin per call below
   * breakeven: revenue 25 × $50 = $1,250 against $1,400 spend over 100 calls,
   * so margin per call is −$1.50.
   */
  clearLoser: {
    adId: 'ad-loser',
    adName: 'Angle Loser',
    adsetId: 'adset-A',
    adsetName: 'Ad set A',
    did: '8005550101',
    spend: 1400,
    calls: 100,
    billableCalls: 25,
  } satisfies AdSpec,

  /**
   * 2. Graduation candidate — 30 billable, $1,500 revenue on $1,000 spend:
   * margin 33.3%, margin per call $5.00, top of ad set B.
   */
  graduationCandidate: {
    adId: 'ad-grad',
    adName: 'Angle Graduate',
    adsetId: 'adset-B',
    adsetName: 'Ad set B',
    did: '8005550102',
    spend: 1000,
    calls: 100,
    billableCalls: 30,
  } satisfies AdSpec,

  /** A weaker sibling in ad set B, so the group-leader gate has something to beat. */
  weakerSibling: {
    adId: 'ad-sibling',
    adName: 'Angle Sibling',
    adsetId: 'adset-B',
    adsetName: 'Ad set B',
    did: '8005550103',
    spend: 1150,
    calls: 100,
    billableCalls: 26,
  } satisfies AdSpec,

  /**
   * 3. Group leader on 8 billable calls — best in its own ad set, but far below
   * min_calls, so it is insufficient: a hold, and the volume gate fails.
   */
  underpoweredLeader: {
    adId: 'ad-underpowered',
    adName: 'Angle Underpowered',
    adsetId: 'adset-C',
    adsetName: 'Ad set C',
    did: '8005550104',
    spend: 300,
    calls: 40,
    billableCalls: 8,
  } satisfies AdSpec,

  /** 4. Past the kill threshold ($120 ≥ 2 × $50) with zero billable and zero paid. */
  killCandidate: {
    adId: 'ad-kill',
    adName: 'Angle Dead',
    adsetId: 'adset-D',
    adsetName: 'Ad set D',
    did: '8005550105',
    spend: 120,
    calls: 3,
    billableCalls: 0,
  } satisfies AdSpec,

  /** 5. Six billable calls at a good margin — 26.7%, but insufficient. */
  goodButThin: {
    adId: 'ad-thin',
    adName: 'Angle Six Calls',
    adsetId: 'adset-E',
    adsetName: 'Ad set E',
    did: '8005550106',
    spend: 220,
    calls: 20,
    billableCalls: 6,
  } satisfies AdSpec,

  /** 6. Meta spend with no DID mapping and no calls — a tracking flag, not a zero. */
  unjoinedSpend: {
    adId: 'ad-unjoined',
    adName: 'Angle Unjoined',
    adsetId: 'adset-F',
    adsetName: 'Ad set F',
    did: '8005550107',
    spend: 900,
    calls: 0,
    billableCalls: 0,
    joins: false,
  } satisfies AdSpec,

  /**
   * 9. Denominator guard — 100 total calls, 30 billable, $1,200 spend:
   * cost per call $12, cost per billable call $40. Materially different numbers
   * on materially different denominators.
   */
  denominatorSplit: {
    adId: 'ad-denom',
    adName: 'Angle Denominator',
    adsetId: 'adset-G',
    adsetName: 'Ad set G',
    did: '8005550108',
    spend: 1200,
    calls: 100,
    billableCalls: 30,
  } satisfies AdSpec,

  /**
   * 10. RTB kill count — zero billable (every paid call is short) but 3 paid
   * calls, on $120 spend, well past the $50 RTB kill threshold. Under RTB the
   * kill rule counts PAID calls, so this must NOT fire.
   */
  rtbPaidNotBillable: {
    adId: 'ad-rtb',
    adName: 'Angle RTB',
    adsetId: 'adset-H',
    adsetName: 'Ad set H',
    did: '8005550109',
    spend: 120,
    calls: 5,
    billableCalls: 0,
    paidCalls: 3,
    payoutPerPaidCall: 22,
  } satisfies AdSpec,

  /**
   * 11. UTM ad tier — the Meta ad id arrives on the call itself
   * (`tag:User:creative`). No DID mapping exists and the call's campaign name
   * matches no vertical pattern, so ONLY the UTM tier can resolve it.
   */
  utmAdByCreativeId: {
    adId: 'ad-utm',
    adName: 'Angle UTM Tagged',
    adsetId: 'adset-I',
    adsetName: 'Ad set I',
    did: '8005550110',
    spend: 1000,
    calls: 100,
    billableCalls: 30,
    mapDid: false,
    callCampaignName: 'Untagged Buyer Campaign',
    utm: { creativeId: 'ad-utm', utmSource: 'an' },
  } satisfies AdSpec,

  /**
   * 12. Campaign tier — only `utm_campaign` is present, carrying the Meta
   * campaign id. Resolves at campaign level and must be excluded from ad-level
   * verdict eligibility.
   */
  utmCampaignOnly: {
    adId: 'ad-camp-only',
    adName: 'Angle Campaign Only',
    adsetId: 'adset-J',
    adsetName: 'Ad set J',
    did: '8005550111',
    spend: 800,
    calls: 60,
    billableCalls: 20,
    mapDid: false,
    callCampaignName: 'Untagged Buyer Campaign',
    utm: { utmCampaign: 'camp-1', utmSource: 'an' },
  } satisfies AdSpec,

  /**
   * 13. No key at all — no UTM tags, no DID mapping, no vertical-matching
   * campaign name. These calls must land in `unjoinedCalls`, never in a row.
   */
  noAttributionKey: {
    adId: 'ad-nokey',
    adName: 'Angle No Key',
    adsetId: 'adset-K',
    adsetName: 'Ad set K',
    did: '8005550112',
    spend: 500,
    calls: 20,
    billableCalls: 6,
    mapDid: false,
    callCampaignName: 'Untagged Buyer Campaign',
  } satisfies AdSpec,
} as const;
