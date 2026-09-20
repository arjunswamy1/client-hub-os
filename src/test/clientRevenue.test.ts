import { describe, expect, it } from 'vitest';
import {
  resolveClientRevenue,
  revenueFieldForEngagement,
  sumClientRevenue,
} from '@/lib/mediaBrain/clientRevenue';

const PERFORMANCE = { engagement_type: 'performance_media' };
const PUBLISHER = { engagement_type: 'pay_per_call' };

describe('resolveClientRevenue', () => {
  it('reads revenue on a performance-media account and ignores payout', () => {
    const r = resolveClientRevenue(PERFORMANCE, { payout: 5, revenue: 16, revenue_captured: true });
    expect(r.field).toBe('revenue');
    expect(r.amount).toBe(16);
    expect(r.captured).toBe(true);
  });

  it('never substitutes payout when revenue was not captured', () => {
    const r = resolveClientRevenue(PERFORMANCE, { payout: 5, revenue: 0, revenue_captured: false });
    expect(r.amount).toBeNull();
    expect(r.captured).toBe(false);
  });

  it('treats a missing revenue value as unknown, not zero', () => {
    const r = resolveClientRevenue(PERFORMANCE, { payout: 5, revenue: null });
    expect(r.amount).toBeNull();
    expect(r.captured).toBe(false);
  });

  it('reads payout on a pay-per-call account', () => {
    const r = resolveClientRevenue(PUBLISHER, { payout: 32, revenue: 0 });
    expect(r.field).toBe('payout');
    expect(r.amount).toBe(32);
  });

  it('records a real zero payout as captured', () => {
    const r = resolveClientRevenue(PUBLISHER, { payout: 0 });
    expect(r.amount).toBe(0);
    expect(r.captured).toBe(true);
  });

  it('names accounts where calls are not the income', () => {
    expect(revenueFieldForEngagement('ecommerce')).toBeNull();
    expect(revenueFieldForEngagement(null)).toBeNull();
    expect(resolveClientRevenue({ engagement_type: null }, { payout: 9, revenue: 9 }).amount).toBeNull();
  });

  it('keeps uncaptured calls visible when summing', () => {
    const sum = sumClientRevenue(PERFORMANCE, [
      { revenue: 16, revenue_captured: true },
      { revenue: 16, revenue_captured: true },
      { payout: 0, revenue: 0, revenue_captured: false },
    ]);
    expect(sum.total).toBe(32);
    expect(sum.capturedCalls).toBe(2);
    expect(sum.uncapturedCalls).toBe(1);
    expect(sum.complete).toBe(false);
  });
});
