/**
 * Media Brain — location (ZIP) scoring.
 *
 * In-memory only. Every assertion is about a rule
 * docs/media-brain/05_Location_Scoring.md states, not an implementation detail.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LOCATION_SCORING_CONFIG,
  confidenceOf,
  effectiveWeights,
  locationTableFromCalls,
  parseCsv,
  percentileRank,
  scoreLocations,
  scoredLocationsToCsv,
} from '@/lib/mediaBrain/locationScoring';
import { LOCATION_FIXTURE, LOCATION_FIXTURE_CSV } from './fixtures/locationScoring';

describe('percentile rank (must match pandas rank(pct=True))', () => {
  it('is average rank over n', () => {
    expect(percentileRank([10, 20, 30, 40])).toEqual([0.25, 0.5, 0.75, 1]);
  });
  it('gives ties the average of the ranks they span', () => {
    expect(percentileRank([5, 5, 9, 9])).toEqual([0.375, 0.375, 0.875, 0.875]);
  });
  it('handles an empty set without throwing', () => {
    expect(percentileRank([])).toEqual([]);
  });
});

describe('step 3 — hard excludes happen before scoring', () => {
  const res = scoreLocations(LOCATION_FIXTURE);

  it('excludes a structurally-failing location rather than ranking it low', () => {
    const row = res.all.find((r) => r.id === '00001')!;
    expect(row.excluded).toBe(true);
    expect(row.excludeReason).toBe('hard_fail_rate');
    expect(row.score).toBeNull();
    expect(row.scorePercentile).toBeNull();
    expect(row.tier).toBeNull();
  });

  it('excludes a location whose success rate is below the floor', () => {
    const row = res.all.find((r) => r.id === '00002')!;
    expect(row.excluded).toBe(true);
    expect(row.excludeReason).toBe('success_rate_below_min');
  });

  it('keeps excluded locations out of the percentile scale entirely', () => {
    const scored = res.all.filter((r) => !r.excluded);
    expect(scored).toHaveLength(res.counts.scored);
    expect(res.counts.excluded).toBe(2);
    // A percentile of exactly 1 exists, and it belongs to a surviving row.
    const top = scored.find((r) => r.scorePercentile === 1)!;
    expect(top.excluded).toBe(false);
  });
});

describe('step 4 — the confidence gate', () => {
  it('never lets a 2-event, 100%-success location reach Launch', () => {
    const res = scoreLocations(LOCATION_FIXTURE);
    const fluke = res.all.find((r) => r.id === '99999')!;
    expect(fluke.excluded).toBe(false);
    expect(fluke.confidence).toBe('low');
    expect(fluke.scorePercentile).toBeGreaterThanOrEqual(DEFAULT_LOCATION_SCORING_CONFIG.launchTierPct);
    expect(fluke.tier).not.toBe('Launch');
    expect(fluke.confidenceCapped).toBe(true);
    expect(res.launchList.map((r) => r.id)).not.toContain('99999');
    expect(res.launchList.every((r) => r.confidence !== 'low')).toBe(true);
  });

  it('bands on volume, not on score', () => {
    const cfg = DEFAULT_LOCATION_SCORING_CONFIG;
    expect(confidenceOf(2, cfg)).toBe('low');
    expect(confidenceOf(10, cfg)).toBe('medium');
    expect(confidenceOf(20, cfg)).toBe('high');
  });

  it('is not the decision engine {min_calls}: it counts events, not billable calls', () => {
    // 8 / 0.57^2 = 25 governs ranking two angles on margin per call. This gate is 10.
    expect(DEFAULT_LOCATION_SCORING_CONFIG.confidenceMin).toBe(10);
    expect(DEFAULT_LOCATION_SCORING_CONFIG.confidenceMin).not.toBe(25);
  });
});

describe('step 5 — weights', () => {
  it('redistributes the value weight proportionally when no value column exists', () => {
    const { weights, note } = effectiveWeights(DEFAULT_LOCATION_SCORING_CONFIG, false);
    expect(weights.value).toBe(0);
    expect(weights.success).toBeCloseTo(0.4 / 0.65, 10);
    expect(weights.volume).toBeCloseTo(0.25 / 0.65, 10);
    expect(weights.success + weights.volume).toBeCloseTo(1, 10);
    expect(note).toMatch(/redistributed/);
  });

  it('says so on the result rather than silently zeroing it', () => {
    const noValue = LOCATION_FIXTURE.map(({ value, ...rest }) => rest);
    const res = scoreLocations(noValue);
    expect(res.effectiveWeights.value).toBe(0);
    expect(res.weightRedistributionNote).toBeTruthy();
    // With payout gone, the fluke ZIP loses its only advantage and cannot lead.
    expect(res.launchList.map((r) => r.id)).not.toContain('99999');
  });

  it('keeps the configured weights when a value column exists', () => {
    const res = scoreLocations(LOCATION_FIXTURE);
    expect(res.effectiveWeights).toEqual({ success: 0.4, value: 0.35, volume: 0.25 });
    expect(res.weightRedistributionNote).toBeNull();
  });
});

describe('step 6 — tiering and launch-list sizing', () => {
  it('caps the launch list at the requested size', () => {
    const wide = Array.from({ length: 200 }, (_, i) => ({
      id: `Z${String(i).padStart(4, '0')}`,
      volume: 50 + i,
      success: Math.round((50 + i) * 0.8),
      value: 20 + i / 10,
      hardFail: 0,
    }));
    const res = scoreLocations(wide, { launchSize: 25 });
    expect(res.counts.launchQualifying).toBeGreaterThan(25);
    expect(res.launchList).toHaveLength(25);
    expect(res.launchListSentence).toContain('top 25 to launch with');
  });

  it('reports plainly when the tier holds fewer than the requested size', () => {
    const res = scoreLocations(LOCATION_FIXTURE, { launchSize: 25 });
    expect(res.counts.launchQualifying).toBeLessThan(25);
    expect(res.launchList).toHaveLength(res.counts.launchQualifying);
    expect(res.launchListSentence).toMatch(/fewer than the 25/);
  });

  it('orders the launch list by score, best first', () => {
    const res = scoreLocations(LOCATION_FIXTURE);
    const scores = res.launchList.map((r) => r.score ?? 0);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(res.launchList.every((r) => r.tier === 'Launch' && r.inLaunchList)).toBe(true);
  });

  it('assigns exactly three tiers and nothing else', () => {
    const res = scoreLocations(LOCATION_FIXTURE);
    const tiers = new Set(res.all.filter((r) => !r.excluded).map((r) => r.tier));
    [...tiers].forEach((t) => expect(['Launch', 'Expand', 'Hold']).toContain(t));
  });
});

describe('building the table from live calls', () => {
  it('counts calls as volume, billable as success, average payout as value', () => {
    const { rows, callsWithoutLocation } = locationTableFromCalls([
      { locationId: '33101', billable: true, payout: 40 },
      { locationId: '33101', billable: false, payout: 0 },
      { locationId: '33102', billable: true, payout: 60, structuralFail: false },
      { locationId: null, billable: true, payout: 60 },
      { locationId: '  ', billable: false, payout: 0 },
    ]);
    expect(callsWithoutLocation).toBe(2);
    const a = rows.find((r) => r.id === '33101')!;
    expect(a).toMatchObject({ volume: 2, success: 1, value: 20, hardFail: 0 });
    expect(rows.find((r) => r.id === '33102')).toMatchObject({ volume: 1, success: 1, value: 60 });
  });

  it('counts structural failures separately from quality failures', () => {
    const { rows } = locationTableFromCalls([
      { locationId: '55555', billable: false, payout: 0, structuralFail: true },
      { locationId: '55555', billable: false, payout: 0, structuralFail: false },
    ]);
    expect(rows[0]).toMatchObject({ volume: 2, success: 0, hardFail: 1 });
  });
});

describe('csv round trip', () => {
  it('parses the fixture csv back to the same numbers', () => {
    const { headers, rows } = parseCsv(LOCATION_FIXTURE_CSV);
    expect(headers).toEqual(['zip', 'total_calls', 'accepted', 'avg_payout', 'no_coverage']);
    expect(rows).toHaveLength(LOCATION_FIXTURE.length);
    expect(rows[0]).toMatchObject({ zip: '33101', total_calls: '180', accepted: '150' });
  });

  it('exports every location with its tier and exclusion reason', () => {
    const csv = scoredLocationsToCsv(scoreLocations(LOCATION_FIXTURE).all);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('exclude_reason');
    expect(lines).toHaveLength(LOCATION_FIXTURE.length + 1);
    expect(csv).toContain('hard_fail_rate');
  });
});

describe('margin is deliberately absent', () => {
  it('the config exposes no margin floor or target', () => {
    expect(Object.keys(DEFAULT_LOCATION_SCORING_CONFIG).some((k) => /margin/i.test(k))).toBe(false);
  });
});
