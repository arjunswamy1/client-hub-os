import { describe, expect, it } from 'vitest';
import {
  strictConnected, revenueSettled, summariseCalls, callsPerThousandImpressions,
} from '../../supabase/functions/_shared/ringfuel-call-rules';

const NOW = new Date('2026-10-11T12:00:00Z');

describe('strict connected', () => {
  const excluded = [
    'Target did not answer (SIP: 487)',
    'No answer from any target (call SIP: 487 Request Terminated)',
    'Target was busy (SIP: 486)',
    'Call ended before the target answered — the dial was still in progress (SIP: 180)',
    'Ringing (SIP: 183)',
    'Target dial failed (SIP: 503)',
    'Caller hung up before the call connected',
    'Caller abandoned while ringing',
  ];
  for (const r of excluded) {
    it(`excludes "${r}" even with connected duration`, () => {
      expect(strictConnected({ end_reason: r, connection_duration_seconds: 120 })).toBe(false);
    });
  }
  it('counts a completed call with connected duration', () => {
    expect(strictConnected({ end_reason: 'Target answered, call completed after 40s', connection_duration_seconds: 40 })).toBe(true);
  });
  it('a completed reason with zero connected duration is not connected', () => {
    expect(strictConnected({ end_reason: 'Caller hung up after 2s', connection_duration_seconds: 0 })).toBe(false);
  });
  it('missing end reason is unknown, not false', () => {
    expect(strictConnected({ end_reason: null, connection_duration_seconds: 300 })).toBeNull();
  });
});

describe('revenue settlement', () => {
  it('webhook $0 revenue within 7 days is provisional', () => {
    expect(revenueSettled({ revenue: 0, revenue_reconciled: false, call_start: '2026-10-09T15:00:00Z' }, NOW)).toBe(false);
  });
  it('reconciled call is settled', () => {
    expect(revenueSettled({ revenue: 16, revenue_reconciled: true, call_start: '2026-10-10T15:00:00Z' }, NOW)).toBe(true);
  });
  it('unreconciled call older than 7 days is settled', () => {
    expect(revenueSettled({ revenue: 0, revenue_reconciled: false, call_start: '2026-10-01T15:00:00Z' }, NOW)).toBe(true);
  });
});

describe('call quality summary', () => {
  const rows = [
    { end_reason: 'Target answered, call completed after 60s', connection_duration_seconds: 60, caller_number: 'A', revenue_reconciled: true, call_start: '2026-10-09T00:00:00Z' },
    { end_reason: 'Target answered, call completed', connection_duration_seconds: 700, caller_number: 'B', revenue_reconciled: true, call_start: '2026-10-09T00:00:00Z' },
    { end_reason: 'Target answered, call completed', connection_duration_seconds: 1900, caller_number: 'A', revenue_reconciled: true, call_start: '2026-10-09T00:00:00Z' },
    { end_reason: 'Target was busy (SIP: 486)', connection_duration_seconds: 30, caller_number: 'C', revenue_reconciled: true, call_start: '2026-10-09T00:00:00Z' },
  ];
  it('computes strict connected, ACL, median, buckets and repeat rate', () => {
    const s = summariseCalls(rows, NOW);
    expect(s.strict_connected).toBe(3);
    expect(s.acl_seconds).toBeCloseTo(886.67, 1);
    expect(s.median_seconds).toBe(700);
    expect(s.share_at).toEqual({ s90: 2 / 3, m10: 2 / 3, m20: 1 / 3, m30: 1 / 3 });
    expect(s.unique_callers).toBe(3);
    expect(s.repeat_call_rate).toBeCloseTo(0.25);
    expect(s.revenue_provisional).toBe(false);
  });
  it('withholds everything when end reason and caller are missing', () => {
    const s = summariseCalls([{ connection_duration_seconds: 100, call_start: '2026-10-10T00:00:00Z' }], NOW);
    expect(s.strict_connected).toBeNull();
    expect(s.acl_seconds).toBeNull();
    expect(s.unique_callers).toBeNull();
    expect(s.revenue_provisional).toBe(true);
    expect(s.withheld.length).toBe(3);
  });
});

describe('calls per 1,000 impressions', () => {
  it('withheld on zero-impression days', () => expect(callsPerThousandImpressions(50, 0)).toBeNull());
  it('computed when impressions exist', () => expect(callsPerThousandImpressions(50, 100000)).toBe(0.5));
});
