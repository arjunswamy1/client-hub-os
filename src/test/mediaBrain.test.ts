/**
 * Media Brain — Phase 2: prove the engine decides correctly.
 *
 * Runs entirely against in-memory fixtures. No database, no network, no clock.
 * The real call tables and Meta sync tables are read-only and are never touched.
 */

import { describe, expect, it } from 'vitest';

import * as engine from '@/lib/mediaBrain/engine';
import * as decisions from '@/lib/mediaBrain/decisions';
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
  if (!res.ok) throw new Error(`expected a successful pull, got: ${res.error}`);
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
    if (!res.ok) expect(res.error).toMatch(/no Meta rows|sync/i);
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
});
