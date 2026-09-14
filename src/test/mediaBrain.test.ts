/**
 * Media Brain — Phase 2: prove the engine decides correctly.
 *
 * Runs entirely against in-memory fixtures. No database, no network, no clock.
 * The real call tables and Meta sync tables are read-only and are never touched.
 */

import { describe, expect, it } from 'vitest';

import * as engine from '@/lib/mediaBrain/engine';
import * as decisions from '@/lib/mediaBrain/decisions';
import { fromRingba } from '@/lib/mediaBrain/adapter';
import * as mapping from '@/lib/mediaBrain/didMapping';
import { computeWindow } from '@/lib/mediaBrain/pull';
import type { PullRow, PullWindowSuccess } from '@/lib/mediaBrain/pull';
import { rowClass } from '@/components/mediaBrain/shared';
import {
  SCENARIOS,
  buildFixture,
  economics,
  instance,
  type AdSpec,
} from './fixtures/mediaBrain';

/** Compute a window from ad specs, asserting success. */
function compute(specs: AdSpec[], payoutMode: 'static' | 'rtb' = 'static'): PullWindowSuccess {
  const f = buildFixture(specs);
  const res = computeWindow({
    calls: f.calls,
    metaAds: f.metaAds,
    didMappings: f.didMappings,
    verticals: f.verticals,
    instance: instance(payoutMode),
    economics: economics(payoutMode),
    window: f.window,
  });
  if (res.ok !== true) throw new Error(`expected a successful pull, got: ${res.error}`);
  return res;
}

function ctxFor(res: PullWindowSuccess): decisions.DecisionContext {
  return {
    payoutMode: res.payoutMode,
    targetMargin: res.thresholds.targetMargin,
    minMargin: res.thresholds.minMargin,
    minCalls: res.thresholds.minCalls,
    killThreshold: res.thresholds.killThreshold,
    allowableCostPerCall: res.thresholds.allowableCostPerCall,
  };
}

function rowFor(res: PullWindowSuccess, adName: string): PullRow {
  const row = res.rows.find((r) => r.entity_name === adName || r.entity_ref === adName);
  if (!row) throw new Error(`no row for "${adName}" — rows: ${res.rows.map((r) => r.entity_name).join(', ')}`);
  return row;
}

function adPeers(res: PullWindowSuccess, adsetName: string) {
  return res.rows.filter((r) => r.adset_name === adsetName);
}

describe('Media Brain — planted decision cases', () => {
  it('1. clear loser at min_calls with margin below breakeven → cut', () => {
    const res = compute([SCENARIOS.clearLoser]);
    const row = rowFor(res, SCENARIOS.clearLoser.adName);

    expect(row.billable_calls).toBe(25);
    expect(row.confidenceState).toBe('sufficient');
    expect(row.marginPerCall).toBeLessThan(0);

    const s = decisions.suggestVerdict(row, ctxFor(res), { level: 'ad', peers: [row] });
    expect(s.verdict).toBe('cut');
  });

  it('2. graduation candidate passes all three gates', () => {
    const res = compute([SCENARIOS.graduationCandidate, SCENARIOS.weakerSibling]);
    const ctx = ctxFor(res);
    const row = rowFor(res, SCENARIOS.graduationCandidate.adName);
    const peers = adPeers(res, SCENARIOS.graduationCandidate.adsetName);

    expect(peers.length).toBe(2);
    expect(row.marginPct!).toBeGreaterThan(ctx.targetMargin);
    const gates = decisions.graduationGates(row, { level: 'ad', peers }, ctx);
    expect(gates.g1).toBe(true);
    expect(gates.g2).toBe(true);
    expect(gates.g3).toBe(true);
    expect(gates.passes).toBe(true);
    expect(decisions.suggestVerdict(row, ctx, { level: 'ad', peers }).verdict).toBe('keep');
  });

  it('3. group leader on 8 billable calls → hold, and the VOLUME gate is the one that fails', () => {
    const res = compute([SCENARIOS.underpoweredLeader]);
    const ctx = ctxFor(res);
    const row = rowFor(res, SCENARIOS.underpoweredLeader.adName);
    const peers = adPeers(res, SCENARIOS.underpoweredLeader.adsetName);

    expect(row.billable_calls).toBe(8);
    expect(row.marginPct!).toBeGreaterThan(ctx.targetMargin);
    expect(decisions.suggestVerdict(row, ctx, { level: 'ad', peers }).verdict).toBe('hold');

    const gates = decisions.graduationGates(row, { level: 'ad', peers }, ctx);
    expect(gates.passes).toBe(false);
    expect(gates.g1).toBe(true);
    expect(gates.g2).toBe(true);
    expect(gates.failed).toEqual(['volume']);
  });

  it('4. past the kill threshold with zero billable → decisive_zero, fires without waiting for min_calls', () => {
    const res = compute([SCENARIOS.killCandidate]);
    const ctx = ctxFor(res);
    const row = rowFor(res, SCENARIOS.killCandidate.adName);

    expect(res.thresholds.killThreshold).toBe(100);
    expect(row.spend).toBeGreaterThanOrEqual(100);
    expect(row.billable_calls).toBe(0);
    expect(row.killCount).toBe(0);
    expect(row.confidenceState).toBe('decisive_zero');

    // Deliberately fires far below min_calls: only 3 calls in the window.
    expect(row.calls).toBeLessThan(res.thresholds.minCalls!);

    const s = decisions.suggestVerdict(row, ctx, { level: 'ad', peers: [row] });
    expect(s.verdict).toBe('cut');
    expect(res.breakers.some((b) => b.includes(SCENARIOS.killCandidate.adName))).toBe(true);
  });

  it('5. six billable calls at a good margin → insufficient, no performance verdict, renders greyed', () => {
    const res = compute([SCENARIOS.goodButThin]);
    const ctx = ctxFor(res);
    const row = rowFor(res, SCENARIOS.goodButThin.adName);

    expect(row.billable_calls).toBe(6);
    expect(row.marginPct!).toBeGreaterThan(ctx.targetMargin);
    expect(row.confidenceState).toBe('insufficient');

    const s = decisions.suggestVerdict(row, ctx, { level: 'ad', peers: [row] });
    expect(s.verdict).toBe('hold');
    expect(s.reason.toLowerCase()).toContain('billable calls');
    expect(rowClass('insufficient')).toMatch(/opacity|muted/);
  });

  it('6. Meta rows that do not join land in unjoinedSpend, never as a zero-call entity', () => {
    const res = compute([SCENARIOS.graduationCandidate, SCENARIOS.unjoinedSpend]);

    expect(res.rows.some((r) => r.entity_name === SCENARIOS.unjoinedSpend.adName)).toBe(false);
    // Unjoined spend is reported per Meta row, so sum the entity's rows.
    const flagged = res.unjoinedSpend.filter((u) => u.entity === SCENARIOS.unjoinedSpend.adName);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.reduce((a, u) => a + u.spend, 0)).toBeCloseTo(SCENARIOS.unjoinedSpend.spend, 4);
    expect(res.breakers.some((b) => /tracking/i.test(b))).toBe(true);
  });

  it('7. zero Meta rows is a failure, not an empty report', () => {
    const f = buildFixture([SCENARIOS.graduationCandidate]);
    const res = computeWindow({
      calls: f.calls,
      metaAds: [],
      didMappings: f.didMappings,
      verticals: f.verticals,
      instance: instance(),
      economics: economics(),
      window: f.window,
    });
    expect(res.ok).toBe(false);
    if (res.ok !== true) expect(res.error).toMatch(/no Meta rows|sync/i);
  });

  it('8. blended ROAS passes while the marginal return fails → stop scaling', () => {
    const ctx = ctxFor(compute([SCENARIOS.graduationCandidate]));
    const v = decisions.marginalVerdict(
      { spend: 1000, revenue: 1300 },
      { spend: 1150, revenue: 1450 },
      ctx,
    )!;

    expect(v.blendedPasses).toBe(true); // 1450 / 1150 = 1.26 ≥ 1.25
    expect(v.marginalPasses).toBe(false); // 150 / 150 = 1.00
    expect(v.verdict).toBe('stop_scaling');
  });

  it('9. denominator guard — cost per call and cost per billable call use their own denominators', () => {
    const res = compute([SCENARIOS.denominatorSplit]);
    const row = rowFor(res, SCENARIOS.denominatorSplit.adName);

    expect(row.calls).toBe(100);
    expect(row.billable_calls).toBe(30);
    expect(row.costPerCall!).toBeCloseTo(1200 / 100, 6);
    expect(row.costPerBillableCall!).toBeCloseTo(1200 / 30, 6);
    expect(row.rpc!).toBeCloseTo((30 * 50) / 100, 6);
    expect(row.marginPerCall!).toBeCloseTo(row.rpc! - row.costPerCall!, 6);

    // The allowable-cost test is a cost-per-CALL test against an RPC-derived
    // ceiling. It must never be applied to cost per billable call.
    expect(row.overAllowableCostPerCall).toBe(
      engine.exceedsAllowableCostPerCall(row.costPerCall, res.thresholds.allowableCostPerCall),
    );
    expect(
      engine.exceedsAllowableCostPerCall(row.costPerCall, res.thresholds.allowableCostPerCall),
    ).not.toBe(
      engine.exceedsAllowableCostPerCall(row.costPerBillableCall, res.thresholds.allowableCostPerCall),
    );
  });

  it('10. under RTB the kill rule counts PAID calls — billable 0 with 3 paid does not fire', () => {
    const res = compute([SCENARIOS.rtbPaidNotBillable], 'rtb');
    const row = rowFor(res, SCENARIOS.rtbPaidNotBillable.adName);

    expect(res.payoutMode).toBe('rtb');
    expect(res.thresholds.killThreshold).toBe(50);
    expect(row.spend).toBeGreaterThanOrEqual(50);
    expect(row.billable_calls).toBe(0);
    expect(row.paid_calls).toBe(3);
    expect(row.killCount).toBe(3);
    expect(engine.killCount('rtb', row)).toBe(3);
    expect(engine.killCount('static', row)).toBe(0);
    expect(row.confidenceState).not.toBe('decisive_zero');
    expect(res.breakers.some((b) => b.includes(SCENARIOS.rtbPaidNotBillable.adName))).toBe(false);
  });
  it('11. a call carrying a Meta ad id in its UTM tags resolves at the utm_ad tier', () => {
    const res = compute([SCENARIOS.utmAdByCreativeId]);
    const row = rowFor(res, SCENARIOS.utmAdByCreativeId.adName);

    // No DID mapping exists for this call and its campaign name matches no
    // vertical pattern, so the UTM tier is the only thing that could have joined it.
    expect(row.resolution).toBe('utm_ad');
    expect(row.adLevelEligible).toBe(true);
    expect(row.level).toBe('ad');
    expect(row.platform_ad_id).toBe(SCENARIOS.utmAdByCreativeId.adId);
    expect(res.resolutionCounts.utm_ad).toBe(SCENARIOS.utmAdByCreativeId.calls);
    expect(res.resolutionCounts.did_ad).toBe(0);
    expect(res.resolutionCounts.none).toBe(0);
    expect(res.adLevelCalls).toBe(SCENARIOS.utmAdByCreativeId.calls);
    expect(res.joinLevel).toBe('ad');
  });

  it('12. a call with only utm_campaign resolves at campaign level and is barred from ad-level verdicts', () => {
    const res = compute([SCENARIOS.utmCampaignOnly]);
    const row = res.rows[0];

    expect(row.resolution).toBe('utm_campaign');
    expect(row.level).toBe('campaign');
    // The point of the tier split: campaign-level rows cannot carry a per-ad verdict.
    expect(row.adLevelEligible).toBe(false);
    expect(row.platform_ad_id).toBeNull();
    expect(res.resolutionCounts.utm_campaign).toBe(SCENARIOS.utmCampaignOnly.calls);
    expect(res.resolutionCounts.utm_ad).toBe(0);
    expect(res.resolutionCounts.did_ad).toBe(0);
    // Ad-level coverage is zero even though every call joined to something.
    expect(res.adLevelCalls).toBe(0);
    expect(res.joinLevel).toBe('campaign');
    expect(res.rows.filter((r) => r.adLevelEligible)).toHaveLength(0);
    expect(res.joinNote).toContain('excluded from ad-level verdicts');
  });

  it('13. a call with no UTM tags, no DID mapping and no vertical match lands in unjoinedCalls', () => {
    const res = compute([SCENARIOS.noAttributionKey]);

    expect(res.rows).toHaveLength(0);
    expect(res.unjoinedCalls).toHaveLength(SCENARIOS.noAttributionKey.calls);
    expect(res.resolutionCounts.none).toBe(SCENARIOS.noAttributionKey.calls);
    expect(res.adLevelCalls).toBe(0);
    expect(res.joinLevel).toBe('none');
    // Its spend is a tracking flag, not an entity with zero calls.
    expect(res.unjoinedSpend.length).toBeGreaterThan(0);
  });

  /**
   * 14. Ringba: `did` comes from the dialed-number column. When it is absent the
   * canonical call falls back to `inbound_number` — which on this account is the
   * CALLER's number — and MUST flag that it did so, because a mapping match on a
   * caller's number is a coincidence, not attribution.
   */
  it('flags a DID that fell back to the caller number, and does not flag a real dialed number', () => {
    const real = fromRingba(
      { call_id: 'c1', call_date: '2026-01-01T00:00:00Z', did: '+18884611277', inbound_number: '+15551234567', duration_seconds: 120, payout: 50, connected: true, converted: true },
      { billableMinDurationSeconds: 60 },
    );
    expect(real.did).toBe('+18884611277');
    expect(real.did_is_caller_number_fallback).toBe(false);

    const fallback = fromRingba(
      { call_id: 'c2', call_date: '2026-01-01T00:00:00Z', did: null, inbound_number: '+15551234567', duration_seconds: 120, payout: 50, connected: true, converted: true },
      { billableMinDurationSeconds: 60 },
    );
    expect(fallback.did).toBe('+15551234567');
    expect(fallback.did_is_caller_number_fallback).toBe(true);
  });

});

describe('publisher attribution stops and filters the pull (§3)', () => {
  it('returns ok: false when attributed_publishers is empty — never defaults to all publishers', () => {
    const f = buildFixture([SCENARIOS.graduationCandidate]);
    const res = computeWindow({
      calls: f.calls,
      metaAds: f.metaAds,
      didMappings: f.didMappings,
      verticals: f.verticals,
      instance: instance(),
      economics: { ...economics(), attributed_publishers: [] },
      window: f.window,
    });
    expect(res.ok).toBe(false);
    // An empty list on a record that states no scoping is an UNANSWERED question,
    // and it stops the pull just as a required-but-unconfigured list does.
    if (res.ok === false) expect(res.error).toMatch(/never read as "dedicated"|does not default to all publishers/);
  });

  it('excludes another publisher\'s calls from every metric and counts them as excluded volume', () => {
    const f = buildFixture([
      SCENARIOS.graduationCandidate,
      {
        ...SCENARIOS.graduationCandidate,
        adId: 'ad-other-publisher',
        adName: 'Angle Other Publisher',
        did: '8005559999',
        spend: 0,
        publisher: 'Squeeze Media Group SS',
      },
    ]);
    const res = computeWindow({
      calls: f.calls,
      metaAds: f.metaAds,
      didMappings: f.didMappings,
      verticals: f.verticals,
      instance: instance(),
      economics: economics(),
      window: f.window,
    });
    expect(res.ok).toBe(true);
    if (res.ok !== true) return;
    // Only our publisher's 100 calls are metered.
    expect(res.totals.calls).toBe(SCENARIOS.graduationCandidate.calls);
    expect(res.excludedPublisherCalls).toBe(SCENARIOS.graduationCandidate.calls);
    expect(res.excludedByPublisher).toEqual([
      { publisher: 'Squeeze Media Group SS', calls: SCENARIOS.graduationCandidate.calls },
    ]);
    expect(res.breakers.some((b) => b.includes('Publisher attribution'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Ad-level attribution: unavailable is a different fact from 0%.
 * ------------------------------------------------------------------ */

describe('ad-level availability — no click key in the feed', () => {
  const call = (over: Partial<mapping.MappingCall> = {}): mapping.MappingCall => ({
    call_id: 'c1',
    timestamp: '2026-03-02T15:00:00Z',
    did: '+15055550142',
    caller_number: '+16067270011',
    campaign_name: 'RRM - Windows - Meta',
    creative_name: null,
    target_name: null,
    payout_amount: 0,
    click_keys: [],
    utm_campaign: null,
    utm_content: null,
    utm_source: 'facebook',
    utm_term: null,
    utm_medium: null,
    creative_id: null,
    ...over,
  });

  it('reports unavailable, with a reason, when no call carries any ad-level key', () => {
    const a = mapping.adLevelAvailability([call(), call({ call_id: 'c2' })]);
    expect(a.available).toBe(false);
    expect(a.keysPresent).toEqual([]);
    expect(a.reason).toContain('ad-level attribution unavailable');
    expect(a.reason).toContain('no click key in the feed');
  });

  it('reports available — a low number, not an unavailable one — as soon as one key appears', () => {
    const withClick = mapping.adLevelAvailability([call(), call({ call_id: 'c2', click_keys: ['gclid'] })]);
    expect(withClick.available).toBe(true);
    expect(withClick.keysPresent).toContain('gclid');

    const withUtm = mapping.adLevelAvailability([call({ utm_content: '1202100000009' })]);
    expect(withUtm.available).toBe(true);
    expect(withUtm.keysPresent).toContain('utm_content');
  });

  it('reads click keys off a raw row and out of its jsonb bags', () => {
    expect(mapping.readClickKeys({ gclid: 'Cj-1', fbclid: '' })).toEqual(['gclid']);
    expect(mapping.readClickKeys({ custom_tags: { msclkid: 'ms-1' } })).toEqual(['msclkid']);
    expect(mapping.readClickKeys({ raw_payload: { utm_content: 'x' } })).toEqual([]);
  });

  it('never counts an unreplaced [GCLID] literal as a click key', () => {
    expect(mapping.readClickKeys({ gclid: '[GCLID]' })).toEqual([]);
    expect(mapping.readClickKeys({ custom_tags: { fbclid: '[FBCLID]' } })).toEqual([]);
    const a = mapping.adLevelAvailability([call({ click_keys: mapping.readClickKeys({ gclid: '[GCLID]' }) })]);
    expect(a.available).toBe(false);
    expect(a.reason).toContain('unavailable');
  });

  it('separates "no key exists" from "a key exists but nothing joined"', () => {
    const unavailable = mapping.adLevelAvailability([call(), call({ call_id: 'c2' })]);
    expect(unavailable.available).toBe(false);
    expect(unavailable.callsWithKey).toBe(0);

    const zeroCoverage = mapping.adLevelAvailability([call({ click_keys: ['gclid'] }), call({ call_id: 'c2' })]);
    expect(zeroCoverage.available).toBe(true);
    expect(zeroCoverage.callsWithKey).toBe(1);
    expect(zeroCoverage.totalCalls).toBe(2);
    expect(zeroCoverage.keyRate).toBeCloseTo(0.5);
    expect(zeroCoverage.reason).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Click-key readiness — the operator's test result, per key.
 * ------------------------------------------------------------------ */

describe('click-key readiness on a webhook receipt', () => {
  const verdictFor = (bags: unknown[], key: string) =>
    readiness.clickKeyReadiness(bags).find((v) => v.key === key)!;

  it('a real gclid reports arrived-with-value and flips the headline off unavailable', () => {
    const verdicts = readiness.clickKeyReadiness([{ gclid: 'Cj0KCQ-real' }]);
    const g = verdicts.find((v) => v.key === 'gclid')!;
    expect(g.state).toBe('value');
    expect(g.value).toBe('Cj0KCQ-real');
    const head = readiness.clickKeyHeadline(verdicts);
    expect(head.adLevelKeyArrived).toBe(true);
    expect(head.headline).toContain('gclid');
  });

  it('reads a key out of the custom-tag bag as readily as the top level', () => {
    expect(verdictFor([{}, { utm_content: '1202100000009' }], 'utm_content').state).toBe('value');
  });

  it('[GCLID] reports the literal state and leaves ad-level unavailable', () => {
    const verdicts = readiness.clickKeyReadiness([{ gclid: '[GCLID]', utm_source: '[UTM_SOURCE]' }]);
    expect(verdictFor([{ gclid: '[GCLID]' }], 'gclid').state).toBe('macro_literal');
    const head = readiness.clickKeyHeadline(verdicts);
    expect(head.adLevelKeyArrived).toBe(false);
    expect(head.headline.toLowerCase()).toContain('literal');
  });

  it('a receipt with neither reports absent, and says the template never listed it', () => {
    const verdicts = readiness.clickKeyReadiness([{}]);
    expect(verdicts.every((v) => v.state === 'absent')).toBe(true);
    expect(verdictFor([{}], 'gclid').fix).toMatch(/template/i);
    expect(readiness.clickKeyHeadline(verdicts).adLevelKeyArrived).toBe(false);
  });

  it('a value on utm_campaign alone is not an ad-level arrival', () => {
    const verdicts = readiness.clickKeyReadiness([{ utm_campaign: 'Windows_Leads_Calls' }]);
    expect(verdictFor([{ utm_campaign: 'x' }], 'utm_campaign').adLevel).toBe(false);
    expect(readiness.clickKeyHeadline(verdicts).adLevelKeyArrived).toBe(false);
  });

  it('an unexpected key can be marked not_expected rather than failing', () => {
    const verdicts = readiness.clickKeyReadiness([{}], { expected: ['gclid', 'utm_content'] });
    expect(verdictFor([{}], 'gclid').state).toBe('absent');
    expect(verdicts.find((v) => v.key === 'msclkid')!.state).toBe('not_expected');
  });
});

/* ==================================================================
 * §3b — publisher scoping: a recorded decision vs an unanswered question
 * ================================================================== */

describe('publisher scoping (§3b)', () => {
  const call = (publisher: string | null, utm_source: string | null = null) => ({ publisher, utm_source });

  it('stops the pull when scoping is unknown, exactly as an unconfigured publisher list does', () => {
    const gate = engine.publisherScopingGate({ publisher_scoping: null, attributed_publishers: null });
    expect(gate.scoping).toBe('unknown');
    expect(gate.ok).toBe(false);
    expect(gate.error).toMatch(/UNKNOWN/);
    // Silence is never read as "dedicated".
    expect(gate.filterApplies).toBe(true);
  });

  it('stops when publisher filtering is required but no publishers are configured', () => {
    const gate = engine.publisherScopingGate({ publisher_scoping: 'required', attributed_publishers: [] });
    expect(gate.ok).toBe(false);
    expect(gate.error).toMatch(/does not default to all publishers/);
  });

  it('proceeds unfiltered on a recorded dedicated-campaign decision, and names who decided', () => {
    const eco = {
      publisher_scoping: 'not_required_dedicated_campaigns',
      attributed_publishers: null,
      publisher_scoping_verified_by: 'AJ Swamy',
      publisher_scoping_verified_at: '2026-09-14',
    };
    const gate = engine.publisherScopingGate(eco);
    expect(gate.ok).toBe(true);
    expect(gate.filterApplies).toBe(false);
    expect(gate.note).toContain('AJ Swamy');

    const split = engine.partitionForScoping([call('RRM (INTERNAL)'), call(null)], eco);
    expect(split.attributed).toHaveLength(2);
    expect(split.excludedCalls).toBe(0);
  });

  it('still excludes other publishers where scoping is required', () => {
    const eco = { publisher_scoping: 'required', attributed_publishers: ['Connect Paid Media'] };
    const split = engine.partitionForScoping([call('Connect Paid Media'), call('Squeeze Media Group')], eco);
    expect(split.attributed).toHaveLength(1);
    expect(split.excludedCalls).toBe(1);
  });

  it('raises a contradiction when a dedicated campaign shows more than one publisher', () => {
    const eco = { publisher_scoping: 'not_required_dedicated_campaigns' };
    const clean = engine.dedicatedCampaignContradiction(eco, [call('RRM (INTERNAL)'), call('rrm (internal)')]);
    expect(clean.contradicted).toBe(false);

    const dirty = engine.dedicatedCampaignContradiction(eco, [call('RRM (INTERNAL)'), call('Global Ventu')]);
    expect(dirty.contradicted).toBe(true);
    expect(dirty.publishers).toEqual(['Global Ventu', 'RRM (INTERNAL)']);
    expect(dirty.note).toMatch(/CONTRADICTED BY THE DATA/);
  });

  it('makes the dedicated-campaign claim expire: an unverified or old claim is due for re-check', () => {
    const now = new Date('2026-10-31T00:00:00Z');
    const fresh = engine.publisherScopingRecheck(
      { publisher_scoping: 'not_required_dedicated_campaigns', publisher_scoping_verified_at: '2026-10-20' },
      now,
    );
    expect(fresh.due).toBe(false);

    const stale = engine.publisherScopingRecheck(
      { publisher_scoping: 'not_required_dedicated_campaigns', publisher_scoping_verified_at: '2026-09-14' },
      now,
    );
    expect(stale.due).toBe(true);
    expect(stale.note).toMatch(/re-verify/i);

    const never = engine.publisherScopingRecheck({ publisher_scoping: 'not_required_dedicated_campaigns' }, now);
    expect(never.due).toBe(true);
    expect(never.ageDays).toBeNull();
  });
});

/* ==================================================================
 * §3c — platform comes from utm_source and nothing else
 * ================================================================== */

describe('ad platform from utm_source (§3c)', () => {
  it('maps only the confirmed values, case-insensitively', () => {
    expect(engine.platformFromUtmSource('Facebook')).toBe('meta');
    expect(engine.platformFromUtmSource(' fb ')).toBe('meta');
    expect(engine.platformFromUtmSource('META')).toBe('meta');
    expect(engine.platformFromUtmSource('google')).toBe('google');
    expect(engine.platformFromUtmSource('AdWords')).toBe('google');
  });

  it('calls an unrecognised or absent utm_source unclassified, never the likelier platform', () => {
    expect(engine.platformFromUtmSource('bing')).toBe('unclassified');
    expect(engine.platformFromUtmSource('')).toBe('unclassified');
    expect(engine.platformFromUtmSource(null)).toBe('unclassified');
    expect(engine.platformFromUtmSource(undefined)).toBe('unclassified');
  });

  it('always shows unclassified as its own row on the split, even at zero', () => {
    const empty = engine.platformSplit([{ utm_source: 'facebook' }]);
    expect(empty.map((r) => r.platform)).toEqual(['meta', 'google', 'unclassified']);
    expect(empty[2].calls).toBe(0);

    const split = engine.platformSplit([
      { utm_source: 'facebook' },
      { utm_source: 'google' },
      { utm_source: 'bing' },
      { utm_source: null },
    ]);
    expect(split[0].calls).toBe(1);
    expect(split[1].calls).toBe(1);
    const unclassified = split[2];
    expect(unclassified.calls).toBe(2);
    expect(unclassified.sources).toEqual(['bing']);
    expect(unclassified.missingUtmSource).toBe(1);
  });
});
