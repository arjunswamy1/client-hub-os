/**
 * Media Brain — Phase 2: the vertical read and per-vertical revenue.
 *
 * In-memory only. No database, no network. Every assertion is about a rule the
 * framework states, not about an implementation detail.
 */

import { describe, it, expect } from 'vitest';
import type { CanonicalCall } from '@/lib/mediaBrain/adapter';
import type { MetaAdRow } from '@/lib/mediaBrain/join';
import { joinCallsToMeta } from '@/lib/mediaBrain/join';
import * as engine from '@/lib/mediaBrain/engine';
import {
  verticalRead,
  assignAdToVertical,
  assignCallToVertical,
  type VerticalDefinition,
  type VerticalEconomics,
} from '@/lib/mediaBrain/verticalRead';

/** Every fixture call is ours unless a test deliberately plants another source. */
const OURS = 'Connect Paid Media';

const WINDOW = { start: '2026-03-01', end: '2026-03-30' };

const VERTICALS: VerticalDefinition[] = [
  {
    vertical_id: 'live-transfer',
    label: 'Live Transfer',
    ringba_patterns: ['Walk In tubs Live Transfer'],
    ringba_exact_match: true,
    meta_patterns: [],
  },
  {
    vertical_id: 'walk-in-tubs',
    label: 'Walk-In Tubs',
    ringba_patterns: ['Walk In tubs', 'Walk In tubs Canada'],
    ringba_exact_match: true,
    meta_patterns: ['WalkinTub*', '*WIT*', '*Tub*'],
  },
  {
    vertical_id: 'bathroom-remodel',
    label: 'Bathroom Remodel',
    ringba_patterns: ['Bathroom Remodel'],
    ringba_exact_match: true,
    meta_patterns: ['*Bath*'],
  },
];

const PLATFORM_ECO: VerticalEconomics = {
  revenue_source: 'platform',
  payout: 60,
  min_payout_threshold: 1,
  billable_min_duration_seconds: 90,
  attributed_publishers: [OURS],
};

const COMPUTED_ECO: VerticalEconomics = {
  revenue_source: 'computed',
  payout: 80,
  min_payout_threshold: 1,
  billable_min_duration_seconds: 90,
  attributed_publishers: [OURS],
};

function enginePlatform(over: Partial<CanonicalCall>) {
  return over.platform ?? platformFromUtmSource(over.utm_source ?? null);
}

function call(over: Partial<CanonicalCall> & { call_id: string }): CanonicalCall {
  const payout = over.payout_amount ?? 0;
  return {
    call_id: over.call_id,
    // Platform comes from utm_source alone (§3c); the override may state it.
    platform: enginePlatform(over),
    timestamp: '2026-03-10T12:00:00Z',
    ad_id: null,
    adset_id: null,
    campaign_id: null,
    campaign_name: null,
    creative_name: null,
    did: null,
    did_is_caller_number_fallback: false,
    duration_seconds: 120,
    connected: true,
    billable: false,
    paid: payout > 0,
    payout_looks_like_cost: false,
    payout_amount: payout,
    buyer_id: null,
    publisher: OURS,
    state: null,
    no_bid_reason: null,
    utm_campaign: null,
    utm_content: null,
    utm_source: null,
    utm_term: null,
    utm_medium: null,
    creative_id: null,
    ...over,
  };
}

function ad(over: Partial<MetaAdRow>): MetaAdRow {
  return {
    platform_ad_id: null,
    platform_adset_id: null,
    platform_campaign_id: null,
    ad_name: null,
    adset_name: null,
    campaign_name: null,
    platform: 'meta',
    spend: 0,
    impressions: 0,
    clicks: 0,
    ...over,
  };
}

const THRESHOLDS = { minCalls: 25, minMargin: 0.1, targetMargin: 0.2, killThreshold: 160 };

describe('pooled DIDs', () => {
  it('resolve to a vertical but never to an ad-level decision', () => {
    // One pooled tracking number, six creatives across the calls that arrived on
    // it. The number identifies the Ringba campaign, and nothing finer.
    const calls = Array.from({ length: 6 }, (_, i) =>
      call({
        call_id: `pooled-${i}`,
        did: '+18884611277',
        campaign_name: 'Walk In tubs',
        payout_amount: 80,
      }),
    );

    const join = joinCallsToMeta({
      calls,
      didMappings: [],
      metaAds: [ad({ platform_ad_id: 'ad-1', ad_name: 'Tub_Static_1', campaign_name: 'BuyQ_WalkinTub', spend: 500 })],
      verticals: [{ vertical_id: 'walk-in-tubs', label: 'Walk-In Tubs', meta_patterns: ['*Tub*'], ringba_patterns: ['Walk In tubs'] }],
      window: WINDOW,
    });

    // Not one call is resolved at ad level: a pooled number cannot name a creative.
    expect(join.adLevelCalls).toBe(0);
    expect(join.resolutionCounts.did_ad).toBe(0);
    expect(join.rows.every((r) => r.adLevelEligible === false)).toBe(true);

    // But the vertical read still reports them, and marks itself non-decisional.
    const read = verticalRead({
      calls,
      metaAds: [ad({ ad_name: 'Tub_Static_1', campaign_name: 'BuyQ_WalkinTub', spend: 500 })],
      verticals: VERTICALS,
      economics: { byVertical: { 'walk-in-tubs': COMPUTED_ECO }, clientDefault: PLATFORM_ECO },
      thresholds: THRESHOLDS,
    });
    const tubs = read.rows.find((r) => r.vertical_id === 'walk-in-tubs')!;
    expect(tubs.calls).toBe(6);
    expect(tubs.adLevelDecisionEligible).toBe(false);
    expect(read.note).toMatch(/not an ad-level decision/i);
  });

  it('assign calls from the Ringba campaign name, never from creative matching', () => {
    expect(assignCallToVertical('Walk In tubs Live Transfer', VERTICALS)).toBe('live-transfer');
    expect(assignCallToVertical('Walk In tubs', VERTICALS)).toBe('walk-in-tubs');
    expect(assignCallToVertical('Some Other Campaign', VERTICALS)).toBeNull();
  });
});

describe('computed revenue', () => {
  it('is payout x billable calls and ignores the platform payout field entirely', () => {
    // The platform reports telco cents on every call. The contract pays $80.
    const calls = [
      call({ call_id: 'c1', campaign_name: 'Walk In tubs', duration_seconds: 300, payout_amount: 0.05 }),
      call({ call_id: 'c2', campaign_name: 'Walk In tubs', duration_seconds: 200, payout_amount: 0 }),
      call({ call_id: 'c3', campaign_name: 'Walk In tubs', duration_seconds: 12, payout_amount: 0.07 }),
    ];

    const read = verticalRead({
      calls,
      metaAds: [ad({ ad_name: 'Tub_Static_1', campaign_name: 'BuyQ_WalkinTub', spend: 100 })],
      verticals: VERTICALS,
      economics: { byVertical: { 'walk-in-tubs': COMPUTED_ECO }, clientDefault: PLATFORM_ECO },
      thresholds: THRESHOLDS,
    });
    const tubs = read.rows.find((r) => r.vertical_id === 'walk-in-tubs')!;

    expect(tubs.billableCalls).toBe(2); // duration alone decides
    expect(tubs.revenue).toBe(160); // 80 x 2, not 0.12
    expect(tubs.revenueSource).toBe('computed');
    expect(tubs.revenueNote).toMatch(/does not expose/i);
    expect(tubs.flags.join(' ')).toMatch(/declared data limitation, not a zero/i);
  });

  it('reports revenue as unavailable, not zero, when no contracted payout is recorded', () => {
    const resolved = engine.resolveRevenue(
      { ...COMPUTED_ECO, payout: null },
      [{ duration_seconds: 200, payout_amount: 0 }],
    );
    expect(resolved.revenue).toBeNull();
    expect(resolved.note).toMatch(/not zero/i);
  });
});

describe('platform revenue', () => {
  it('excludes sub-threshold payouts that are telco cost sitting in the payout field', () => {
    const resolved = engine.resolveRevenue(PLATFORM_ECO, [
      { duration_seconds: 400, payout_amount: 60 },
      { duration_seconds: 14, payout_amount: 0.05 },
      { duration_seconds: 13, payout_amount: 0.07 },
    ]);
    expect(resolved.revenue).toBe(60);
    expect(resolved.paidCalls).toBe(3);
    expect(resolved.qualifyingPayoutCalls).toBe(1);
    expect(resolved.subThresholdPayoutCalls).toBe(2);
  });

  it('keeps a 100%-paid vertical out of its neighbour RPC', () => {
    const calls = [
      // Live Transfer: every call pays $55.
      ...Array.from({ length: 4 }, (_, i) =>
        call({ call_id: `lt-${i}`, campaign_name: 'Walk In tubs Live Transfer', duration_seconds: 400, payout_amount: 55 }),
      ),
      // Walk-In Tubs: the platform shows nothing.
      ...Array.from({ length: 4 }, (_, i) =>
        call({ call_id: `wit-${i}`, campaign_name: 'Walk In tubs', duration_seconds: 400, payout_amount: 0 }),
      ),
    ];

    const read = verticalRead({
      calls,
      metaAds: [ad({ ad_name: 'Tub_Static_1', campaign_name: 'BuyQ_WalkinTub', spend: 400 })],
      verticals: VERTICALS,
      economics: {
        byVertical: { 'live-transfer': { ...PLATFORM_ECO, payout: 55 }, 'walk-in-tubs': COMPUTED_ECO },
        clientDefault: PLATFORM_ECO,
      },
      thresholds: THRESHOLDS,
    });

    const lt = read.rows.find((r) => r.vertical_id === 'live-transfer')!;
    const wit = read.rows.find((r) => r.vertical_id === 'walk-in-tubs')!;

    expect(lt.revenue).toBe(220);
    expect(lt.rpc).toBe(55);
    // The neighbour's RPC is its own $80 computed rate, not a blend with $55.
    expect(wit.revenue).toBe(320);
    expect(wit.rpc).toBe(80);
    // And a blended read of all eight calls would have said $67.50 — which is
    // exactly the number the split exists to avoid reporting.
    expect(engine.rpc(540, 8)).toBe(67.5);
  });
});

describe('unclassified', () => {
  it('holds an ad that matches no vertical pattern rather than defaulting it', () => {
    const mixed = ad({ ad_name: 'SameRoomSixDays_Static', campaign_name: '08/19 Ringba_Lifetime_Statics - Copy', spend: 565.46 });
    expect(assignAdToVertical(mixed, VERTICALS)).toBeNull();

    const read = verticalRead({
      calls: [call({ call_id: 'x', campaign_name: 'Walk In tubs', payout_amount: 0 })],
      metaAds: [
        mixed,
        ad({ ad_name: 'Tub_Static_3', campaign_name: '08/19 Ringba_Lifetime_Statics - Copy', spend: 100 }),
        ad({ ad_name: 'Bath_CB_Walk', campaign_name: '08/19 Ringba_Lifetime_Statics - Copy', spend: 50 }),
      ],
      verticals: VERTICALS,
      economics: { byVertical: {}, clientDefault: PLATFORM_ECO },
      thresholds: THRESHOLDS,
    });

    // The mixed campaign is resolved at AD level; the ad matching neither goes
    // to unclassified and its spend is never moved onto a product.
    expect(read.rows.find((r) => r.vertical_id === 'walk-in-tubs')!.spend).toBe(100);
    expect(read.rows.find((r) => r.vertical_id === 'bathroom-remodel')!.spend).toBe(50);
    expect(read.unclassified.spend).toBeCloseTo(565.46, 2);
    expect(read.unclassifiedAdNames).toContain('SameRoomSixDays_Static');
    expect(read.mixedCampaigns).toContain('08/19 Ringba_Lifetime_Statics - Copy');
  });
});

describe('intake validation (3a)', () => {
  it('reports disagreement in both directions and blocks above 10%', () => {
    const rows = [
      ...Array.from({ length: 80 }, () => ({ duration_seconds: 400, payout_amount: 60 })),
      ...Array.from({ length: 15 }, () => ({ duration_seconds: 400, payout_amount: 0 })), // billable, unpaid
      ...Array.from({ length: 5 }, () => ({ duration_seconds: 20, payout_amount: 60 })), // paid, not billable
    ];
    const result = engine.validateBillableDefinition(PLATFORM_ECO, rows);
    expect(result.billableByDefinitionUnpaid).toBe(15);
    expect(result.paidNotBillableByDefinition).toBe(5);
    expect(result.disagreementPct).toBeCloseTo(0.2, 5);
    expect(result.blocks).toBe(true);
  });

  it('validates only the duration side where platform payouts are not visible', () => {
    const result = engine.validateBillableDefinition(COMPUTED_ECO, [
      { duration_seconds: 400, payout_amount: 0 },
      { duration_seconds: 10, payout_amount: 0 },
    ]);
    expect(result.durationSideOnly).toBe(true);
    expect(result.blocks).toBe(false);
    expect(result.note).toMatch(/not visible/i);
  });

  it('blocks when no billable duration threshold is stated at all', () => {
    const result = engine.validateBillableDefinition(
      { ...PLATFORM_ECO, billable_min_duration_seconds: null },
      [{ duration_seconds: 400, payout_amount: 60 }],
    );
    expect(result.blocks).toBe(true);
    expect(result.disagreementPct).toBeNull();
  });
});

describe('UNKNOWN duration threshold on a computed vertical', () => {
  // 100 calls: 40 reach 300s, another 30 reach 120s, the rest are short. At a
  // low threshold the vertical is hugely profitable; at a high one it loses money.
  const calls: CanonicalCall[] = [
    ...Array.from({ length: 40 }, (_, i) =>
      call({ call_id: `long-${i}`, campaign_name: 'Walk In tubs', duration_seconds: 320, payout_amount: 0 }),
    ),
    ...Array.from({ length: 30 }, (_, i) =>
      call({ call_id: `mid-${i}`, campaign_name: 'Walk In tubs', duration_seconds: 130, payout_amount: 0 }),
    ),
    ...Array.from({ length: 30 }, (_, i) =>
      call({ call_id: `short-${i}`, campaign_name: 'Walk In tubs', duration_seconds: 20, payout_amount: 0 }),
    ),
  ];
  const metaAds: MetaAdRow[] = [
    {
      platform_ad_id: 'ad-tub',
      ad_name: 'WalkinTub_Static',
      campaign_name: 'Tubs',
      platform_campaign_id: 'c1',
      spend: 4000,
    } as unknown as MetaAdRow,
  ];

  const read = verticalRead({
    calls,
    metaAds,
    verticals: VERTICALS,
    economics: {
      byVertical: {
        'walk-in-tubs': { ...COMPUTED_ECO, unknown_fields: ['billable_min_duration_seconds'] },
      },
      clientDefault: PLATFORM_ECO,
    },
    thresholds: { minCalls: 25, minMargin: 0.1, targetMargin: 0.2, killThreshold: 160 },
  });
  const row = read.rows.find((r) => r.vertical_id === 'walk-in-tubs')!;

  it('exposes no point-estimate revenue, RPC or margin', () => {
    expect(row.revenue).toBeNull();
    expect(row.rpc).toBeNull();
    expect(row.marginPerCall).toBeNull();
    expect(row.marginPct).toBeNull();
    expect(row.profit).toBeNull();
    // The billable count is itself decided by the unknown threshold.
    expect(row.billableCalls).toBeNull();
    expect(row.costPerBillableCall).toBeNull();
  });

  it('still reports the figures that are measured', () => {
    expect(row.calls).toBe(100);
    expect(row.spend).toBe(4000);
    expect(row.costPerCall).toBe(40);
  });

  it('names what the UNKNOWN blocks', () => {
    expect(row.durationThresholdUnknown).toBe(true);
    expect(row.blockedFigures).toContain('revenue');
    expect(row.blockedFigures).toContain('margin %');
  });

  it('publishes a sensitivity band instead, and flags a band that crosses zero as verdict-blocking', () => {
    const band = row.sensitivity!;
    expect(band).toBeTruthy();
    // 30s → 70 billable × $80 = $5,600 revenue against $4,000 spend: profit.
    expect(band.points.find((p) => p.thresholdSeconds === 30)!.revenue).toBe(5600);
    // 300s → 40 billable × $80 = $3,200: a loss.
    expect(band.points.find((p) => p.thresholdSeconds === 300)!.revenue).toBe(3200);
    expect(band.marginPctLow!).toBeLessThan(0);
    expect(band.marginPctHigh!).toBeGreaterThan(0);
    expect(band.crossesZero).toBe(true);
    expect(band.verdictBlocking).toBe(true);
    expect(band.note).toMatch(/crosses zero/i);
  });

  describe('once the threshold is stated (removed from unknown_fields)', () => {
    const stated = verticalRead({
      calls,
      metaAds,
      verticals: VERTICALS,
      economics: {
        byVertical: {
          'walk-in-tubs': {
            ...COMPUTED_ECO,
            unknown_fields: [],
            billable_min_duration_seconds: 90,
            declared_flags: ['payout assumed from client terms; not verified against platform payout data.'],
          },
        },
        clientDefault: PLATFORM_ECO,
      },
      thresholds: { minCalls: 25, minMargin: 0.1, targetMargin: 0.2, killThreshold: 160 },
    });
    const statedRow = stated.rows.find((r) => r.vertical_id === 'walk-in-tubs')!;

    it('renders the point estimate and drops the band, with no special case for the vertical', () => {
      expect(statedRow.durationThresholdUnknown).toBe(false);
      expect(statedRow.sensitivity).toBeNull();
      expect(statedRow.blockedFigures).toEqual([]);
      // 70 calls at or above 90s × $80.
      expect(statedRow.billableCalls).toBe(70);
      expect(statedRow.revenue).toBe(5600);
      expect(statedRow.rpc).toBeCloseTo(56, 6);
      expect(statedRow.marginPct).toBeCloseTo((5600 - 4000) / 5600, 6);
    });

    it('keeps revenue labelled computed and renders the record\'s own caveat verbatim', () => {
      expect(statedRow.revenueSource).toBe('computed');
      expect(statedRow.flags).toContain(
        'payout assumed from client terms; not verified against platform payout data.',
      );
    });
  });
});


describe('publisher attribution (§3)', () => {
  it('excludes another publisher\'s calls from every metric while counting them as excluded volume', () => {
    // Same tracking campaign, two traffic sources: 10 of ours, 40 someone else's.
    const ours = Array.from({ length: 10 }, (_, i) =>
      call({ call_id: `ours-${i}`, campaign_name: 'Walk In tubs', duration_seconds: 200, publisher: OURS }),
    );
    const theirs = Array.from({ length: 40 }, (_, i) =>
      call({ call_id: `theirs-${i}`, campaign_name: 'Walk In tubs', duration_seconds: 200, publisher: 'BIQ' }),
    );
    const read = verticalRead({
      calls: [...ours, ...theirs],
      metaAds: [ad({ platform_ad_id: 'a1', ad_name: 'WalkinTub Static', campaign_name: 'Tubs', spend: 800, conversions: 3 })],
      verticals: VERTICALS,
      economics: { byVertical: { 'walk-in-tubs': COMPUTED_ECO }, clientDefault: PLATFORM_ECO },
      thresholds: THRESHOLDS,
    });

    const tubs = read.rows.find((r) => r.vertical_id === 'walk-in-tubs')!;
    // Metrics see only our 10 calls.
    expect(tubs.calls).toBe(10);
    expect(tubs.excludedPublisherCalls).toBe(40);
    expect(tubs.excludedByPublisher).toEqual([{ publisher: 'BIQ', calls: 40 }]);
    // Cost per call is our spend over OUR calls — $80, not $16.
    expect(tubs.costPerCall).toBeCloseTo(80, 6);
    // And the excluded volume is reported, not lost.
    expect(read.excluded.calls).toBe(40);
    expect(read.excluded.byPublisher).toEqual([{ publisher: 'BIQ', calls: 40 }]);
    // Reconciliation line: Meta's conversions beside our attributed calls.
    expect(tubs.metaConversions).toBe(3);
    expect(tubs.conversionDiscrepancy).toBe(-7);
  });

  it('never treats a call with no publisher recorded as ours', () => {
    const split = engine.partitionByPublisher(
      [{ publisher: null }, { publisher: OURS }, { publisher: 'squeeze media group ss' }],
      [OURS, 'Squeeze Media Group SS'],
    );
    expect(split.attributed).toHaveLength(2); // exact match is case-insensitive
    expect(split.excludedByPublisher).toEqual([{ publisher: engine.PUBLISHER_NOT_RECORDED, calls: 1 }]);
  });
});

describe('sensitivity band direction (§8)', () => {
  const spend = 6000;
  const eco = { ...COMPUTED_ECO, payout: 80 };

  it('permits a verdict when the band is negative throughout', () => {
    // 79 calls, only 42 reaching 90s: at $80 a call this loses money at every
    // plausible threshold, so the DIRECTION is established.
    const rows = [
      ...Array.from({ length: 42 }, () => ({ duration_seconds: 200, payout_amount: 0 })),
      ...Array.from({ length: 37 }, () => ({ duration_seconds: 20, payout_amount: 0 })),
    ];
    const band = engine.revenueSensitivity(eco, rows, spend);
    expect(band.marginPctHigh).toBeLessThan(0);
    expect(band.direction).toBe('negative');
    expect(band.crossesZero).toBe(false);
    expect(band.directionEstablished).toBe(true);
    expect(band.verdictBlocking).toBe(false);
    expect(band.note).toContain('NEGATIVE THROUGHOUT');
  });

  it('blocks a verdict when the band crosses zero', () => {
    const rows = [
      ...Array.from({ length: 40 }, () => ({ duration_seconds: 320, payout_amount: 0 })),
      ...Array.from({ length: 60 }, () => ({ duration_seconds: 40, payout_amount: 0 })),
    ];
    const band = engine.revenueSensitivity(eco, rows, 4000);
    expect(band.crossesZero).toBe(true);
    expect(band.direction).toBe('mixed');
    expect(band.directionEstablished).toBe(false);
    expect(band.verdictBlocking).toBe(true);
  });
});
