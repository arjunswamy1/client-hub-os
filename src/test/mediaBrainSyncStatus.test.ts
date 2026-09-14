/**
 * Delivery-health breakers. In-memory only — no DB, no network.
 *
 * The point under test: "never delivered" and "stopped delivering" must never collapse
 * into one state, because their remedies are different.
 */

import { describe, expect, it } from 'vitest';
import { REVIEW_WINDOW_HOURS, syncBreakers, type SyncStatusRow } from '@/hooks/useMediaBrainSyncStatus';

const row = (over: Partial<SyncStatusRow>): SyncStatusRow => ({
  id: crypto.randomUUID(),
  source: 'moja',
  client_id: 'client-1',
  last_attempted_at: null,
  last_succeeded_at: null,
  rows_written: 0,
  status: 'ok',
  error: null,
  token_status: null,
  detail: {},
  updated_at: new Date().toISOString(),
  ...over,
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('delivery-health circuit breakers', () => {
  it('never_run reads as "never delivered" and recommends registering the endpoint', () => {
    const [b] = syncBreakers([row({ status: 'never_run', error: 'Never delivered.' })]);
    expect(b.state).toBe('never_run');
    expect(b.evidence).toMatch(/NEVER delivered/);
    expect(b.action).toMatch(/never connected/);
    // Must NOT be described as having stopped — that would send someone debugging a feed
    // that was never turned on.
    expect(b.evidence).not.toMatch(/stopped/i);
  });

  it('a source that delivered before but not inside the review window reads as stopped, not never', () => {
    const [b] = syncBreakers([
      row({ source: 'ringba', status: 'ok', last_succeeded_at: hoursAgo(REVIEW_WINDOW_HOURS + 5) }),
    ]);
    expect(b.state).toBe('stale');
    expect(b.evidence).toMatch(/STOPPED delivering/);
    expect(b.evidence).not.toMatch(/NEVER/);
  });

  it('a fresh success fires no breaker', () => {
    expect(syncBreakers([row({ source: 'meta', status: 'ok', last_succeeded_at: hoursAgo(2) })])).toHaveLength(0);
  });

  it('an expired token fires with a reconnect action even when the status claims otherwise', () => {
    const [b] = syncBreakers([
      row({
        source: 'google',
        status: 'error',
        token_status: 'expired',
        error: 'Google authorization expired.',
        last_attempted_at: hoursAgo(1),
      }),
    ]);
    expect(b.state).toBe('error');
    expect(b.action).toMatch(/Reconnect Google Ads/);
    expect(b.evidence).toMatch(/last success never/);
  });

  it('every breaker carries a timestamp, a reason and a recommended action', () => {
    const breakers = syncBreakers([
      row({ status: 'never_run', error: 'Never delivered.' }),
      row({ source: 'meta', status: 'error', error: 'Token invalid', last_attempted_at: hoursAgo(1) }),
      row({ source: 'ringba', status: 'ok', last_succeeded_at: hoursAgo(200) }),
    ]);
    expect(breakers).toHaveLength(3);
    for (const b of breakers) {
      expect(b.evidence.length).toBeGreaterThan(20);
      expect(b.action.length).toBeGreaterThan(20);
    }
  });
});
