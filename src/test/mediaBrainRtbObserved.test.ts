import { describe, expect, it } from 'vitest';
import {
  measureRtbTerms,
  rtbCallSource,
  rtbProvenanceNote,
  rtbSufficiency,
} from '@/lib/mediaBrain/rtbObserved';

const call = (payout: number | null, duration: number | null) => ({
  payout,
  duration_seconds: duration,
});

describe('measureRtbTerms', () => {
  it('uses TOTAL calls for RPC and PAID calls for the average winning bid', () => {
    const t = measureRtbTerms([call(20, 120), call(0, 15), call(30, 200), call(null, 8)]);
    expect(t.totalCalls).toBe(4);
    expect(t.paidCalls).toBe(2);
    expect(t.revenue).toBe(50);
    // No-bid losses stay visible: 50 / 4, not 50 / 2.
    expect(t.observedRpc).toBe(12.5);
    expect(t.avgWinningBid).toBe(25);
    expect(t.paidRate).toBe(0.5);
  });

  it('reads floor, ceiling and the paid duration range off observed payouts', () => {
    const t = measureRtbTerms([call(12, 45), call(38, 310), call(25, 90), call(0, 5)]);
    expect(t.bidFloor).toBe(12);
    expect(t.bidCeiling).toBe(38);
    expect(t.paidDurationMinSeconds).toBe(45);
    expect(t.paidDurationMaxSeconds).toBe(310);
    expect(t.minDurationWithPayout).toBe(45);
  });

  it('returns nulls rather than estimates for an empty window', () => {
    const t = measureRtbTerms([]);
    expect(t.totalCalls).toBe(0);
    expect(t.observedRpc).toBeNull();
    expect(t.avgWinningBid).toBeNull();
    expect(t.bidFloor).toBeNull();
    expect(t.minDurationWithPayout).toBeNull();
  });

  it('counts rows with neither payout nor duration as unusable instead of as zero-payout calls', () => {
    const t = measureRtbTerms([call(null, null), call(10, 60)]);
    expect(t.unusableRows).toBe(1);
    expect(t.totalCalls).toBe(1);
    expect(t.observedRpc).toBe(10);
  });

  it('treats a zero payout as a real no-bid call in the denominator', () => {
    const t = measureRtbTerms([call(0, 30), call(0, 40), call(20, 120)]);
    expect(t.totalCalls).toBe(3);
    expect(t.paidCalls).toBe(1);
    expect(t.observedRpc).toBeCloseTo(6.67, 2);
  });
});

describe('rtbSufficiency', () => {
  it('gates on {min_calls} at the RTB setting', () => {
    const s = rtbSufficiency(40, 0.57);
    expect(s.required).toBe(35);
    expect(s.sufficient).toBe(true);
  });

  it('labels a thin window provisional rather than hiding it', () => {
    const s = rtbSufficiency(12, 0.57);
    expect(s.sufficient).toBe(false);
    expect(s.note).toContain('provisional');
  });

  it('cannot judge sufficiency without a stated actionable gap', () => {
    const s = rtbSufficiency(500, null);
    expect(s.required).toBeNull();
    expect(s.sufficient).toBe(false);
  });
});

describe('rtbCallSource', () => {
  it('maps CallGrid and Ringba to their stored call tables', () => {
    expect(rtbCallSource('cannaball')?.table).toBe('cannaball_calls');
    expect(rtbCallSource('ringba')?.table).toBe('ringba_calls');
    expect(rtbCallSource('other')).toBeUndefined();
  });
});

describe('rtbProvenanceNote', () => {
  it('records source, window and both denominators', () => {
    const terms = measureRtbTerms([call(20, 120), call(0, 15)]);
    const note = rtbProvenanceNote('CallGrid', '2026-08-18', '2026-09-16', terms, rtbSufficiency(2, 0.57));
    expect(note).toContain('CallGrid');
    expect(note).toContain('2026-08-18');
    expect(note).toContain('TOTAL calls');
    expect(note).toContain('paid calls only');
  });
});
