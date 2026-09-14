/**
 * Moja webhook payload normalisation. Pure module, no DB and no network — the receiver's
 * transport layer is not under test here, the mapping rules are.
 *
 * Scenarios mirror Phase 1's requirements exactly: flat shape, nested shape, tag literals
 * nulled, conversion ordering in both directions, and a null call_id refused by name.
 */
import { describe, expect, it } from 'vitest';
import {
  mergeExisting,
  normalizeDelivery,
  type MojaCallRow,
} from '../../supabase/functions/moja-webhook/normalize';

const CLIENT = '4b2434db-6d47-4653-be34-313976790f9d';
const norm = (p: Record<string, unknown>) => normalizeDelivery(p, { clientId: CLIENT });

/** Moja's actual test fire, 2026-09-14 12:39:24 UTC, verbatim. */
const TEST_FIRE = {
  to: '[TO]',
  event: 'call.completed',
  gclid: '[GCLID]',
  fbclid: '[FBCLID]',
  payout: '[PUBLISHER_PAID_OUT]',
  call_id: '[CALL_ID]',
  revenue: '[REVENUE_PAID_OUT]',
  answered: '[ANSWERED]',
  duration: '120',
  utm_term: '[UTM_TERM]',
  zip_code: '12345',
  caller_id: '+16067270011',
  converted: '[CONVERTED]',
  buyer_name: 'Test Buyer',
  call_start: '[CALL_START]',
  utm_medium: '[UTM_MEDIUM]',
  utm_source: '[UTM_SOURCE]',
  campaign_id: 'campaign_test_123',
  number_pool: '[NUMBER_POOL]',
  target_name: 'Test Target',
  utm_content: '[UTM_CONTENT]',
  caller_state: '[CALLER_STATE]',
  hangup_cause: '[HANGUP_CAUSE]',
  utm_campaign: '[UTM_CAMPAIGN]',
  campaign_name: 'Test Campaign',
  publisher_name: 'Test Publisher',
  event_timestamp: '[EVENT_TIMESTAMP]',
  tracking_number: '[TRACKING_NUMBER]',
  inbound_duration: '[INBOUND_DURATION]',
  no_payout_reason: '[NO_PAYOUT_REASON]',
  call_converted_at: '[CALL_CONVERTED_AT]',
};

describe('moja normalize — payload shapes', () => {
  it('accepts the flat shape and maps every substituted field', () => {
    const r = norm({
      ...TEST_FIRE,
      call_id: 'MOJA-1',
      to: '+15055550142',
      answered: 'true',
      converted: 'false',
      payout: '95.00',
      revenue: '145.00',
      inbound_duration: '431',
      utm_campaign: '120210000000000001',
      utm_content: '120210000000000009',
      fbclid: 'IwAR-abc',
      event_timestamp: '2026-09-14T15:04:11Z',
      caller_state: 'NM',
      campaign_name: 'RRM - Windows - Meta - Prospecting',
    });
    expect(r.shape).toBe('flat');
    expect(r.reject).toBeNull();
    const row = r.row as MojaCallRow;
    expect(row.call_id).toBe('MOJA-1');
    expect(row.tracking_number).toBe('+15055550142');
    expect(row.forwarded_number).toBeNull();
    expect(row.caller_number).toBe('+16067270011');
    expect(row.duration_seconds).toBe(120);
    expect(row.inbound_duration_seconds).toBe(431);
    // payout is publisher-paid = CPM revenue; revenue is buyer-paid and informational.
    expect(row.payout).toBe(95);
    expect(row.revenue).toBe(145);
    expect(row.connected).toBe(true);
    expect(row.connected_source).toBe('answered_field');
    expect(row.service_line).toBe('windows');
    expect(row.platform).toBe('meta');
    expect(row.fbclid).toBe('IwAR-abc');
    expect(row.utm_content).toBe('120210000000000009');
  });

  it('accepts the nested call/tags shape', () => {
    const r = norm({
      event: 'call.completed',
      delivery_id: 'd-1',
      call: {
        call_id: 'MOJA-2',
        duration: 412,
        inbound_duration: 431,
        answered: true,
        payout: 95,
        revenue: 145,
        tracking_number: '+15055550142',
        to: '+15055559000',
        caller_id: '+15055559987',
        campaign_name: 'RRM - Plumbing - Google',
        tags: { source: 'facebook', content: 'ad-9', campaign: 'c-1' },
      },
    });
    expect(r.shape).toBe('nested');
    const row = r.row as MojaCallRow;
    expect(row.call_id).toBe('MOJA-2');
    // Explicit tracking_number wins; `to` becomes the forwarded number.
    expect(row.tracking_number).toBe('+15055550142');
    expect(row.forwarded_number).toBe('+15055559000');
    expect(row.utm_source).toBe('facebook');
    expect(row.utm_content).toBe('ad-9');
    expect(row.service_line).toBe('plumbing');
    expect(r.deliveryId).toBe('d-1');
  });

  it('derives connected from inbound_duration when answered is absent, and records which rule fired', () => {
    const withDuration = norm({ event: 'call.completed', call_id: 'A', inbound_duration: '61' }).row!;
    expect(withDuration.connected).toBe(true);
    expect(withDuration.connected_source).toBe('inbound_duration');

    const withNeither = norm({ event: 'call.completed', call_id: 'B' }).row!;
    expect(withNeither.connected).toBe(false);
    expect(withNeither.connected_source).toBe('unknown');
  });

  it('derives call_start from event_timestamp minus connected duration, treating a bare timestamp as UTC', () => {
    const row = norm({
      event: 'call.completed',
      call_id: 'C',
      inbound_duration: '60',
      event_timestamp: '2026-09-14 15:04:11',
    }).row!;
    expect(row.call_start).toBe('2026-09-14T15:03:11.000Z');
  });

  it('leaves call_start null rather than fabricating now()', () => {
    expect(norm({ event: 'call.completed', call_id: 'D' }).row!.call_start).toBeNull();
  });
});

describe('moja normalize — tag literals', () => {
  it('never stores a literal tag, and names every field that arrived unreplaced', () => {
    const r = norm({ ...TEST_FIRE, call_id: 'MOJA-TEST' });
    const row = r.row as MojaCallRow;

    for (const v of Object.values(row)) {
      expect(typeof v === 'string' && /^\[[A-Z0-9_]+\]$/.test(v)).toBe(false);
    }
    expect(row.tracking_number).toBeNull();
    expect(row.forwarded_number).toBeNull();
    expect(row.caller_state).toBeNull();
    expect(row.utm_campaign).toBeNull();
    expect(row.gclid).toBeNull();
    expect(row.fbclid).toBeNull();
    expect(row.no_payout_reason).toBeNull();
    expect(row.call_start).toBeNull();
    expect(row.answered).toBeNull();
    expect(row.payout).toBe(0);
    expect(row.revenue).toBe(0);
    // Substituted values survive.
    expect(row.duration_seconds).toBe(120);
    expect(row.caller_zip).toBe('12345');
    expect(row.publisher_name).toBe('Test Publisher');

    // The list that tells us Moja's real capability.
    expect(r.unreplaced).toContain('tracking_number');
    expect(r.unreplaced).toContain('gclid');
    expect(r.unreplaced).toContain('event_timestamp');
    expect(r.unreplaced).not.toContain('duration');
    expect(r.unreplaced).not.toContain('campaign_name');
    expect(r.unreplaced.length).toBe(22);
  });

  it('refuses a call row with no usable call_id, by name, and still reports the fields', () => {
    const r = norm(TEST_FIRE);
    expect(r.callId).toBeNull();
    expect(r.reject).toBe('missing_call_id');
    expect(r.row).toBeNull();
    expect(r.fields).toContain('call_id');
    expect(r.unreplaced).toContain('call_id');
  });
});

describe('moja normalize — conversion ordering', () => {
  const completed = norm({
    event: 'call.completed',
    call_id: 'X',
    inbound_duration: '200',
    payout: '0',
    revenue: '0',
  }).row!;
  const convertedRow = norm({
    event: 'call.converted',
    call_id: 'X',
    converted: 'true',
    payout: '95',
    revenue: '145',
    call_converted_at: '2026-09-14T15:06:38Z',
    inbound_duration: '200',
  }).row!;

  it('a conversion event updates the conversion facts on the existing row', () => {
    const patch = mergeExisting(
      { converted: false, revenue: 0, payout: 0, converted_at: null },
      convertedRow,
    );
    expect(patch.converted).toBe(true);
    expect(patch.payout).toBe(95);
    expect(patch.revenue).toBe(145);
    expect(patch.converted_at).toBe('2026-09-14T15:06:38.000Z');
  });

  it('a late completed event does NOT zero out an already-converted row', () => {
    const patch = mergeExisting(
      { converted: true, revenue: 145, payout: 95, converted_at: '2026-09-14T15:06:38.000Z' },
      completed,
    );
    expect(patch.converted).toBeUndefined();
    expect(patch.payout).toBeUndefined();
    expect(patch.revenue).toBeUndefined();
    expect(patch.converted_at).toBeUndefined();
    // Non-conversion facts still refresh.
    expect(patch.inbound_duration_seconds).toBe(200);
  });

  it('a completed event on a not-yet-converted row still writes its zeros', () => {
    const patch = mergeExisting(
      { converted: false, revenue: 0, payout: 0, converted_at: null },
      completed,
    );
    expect(patch.converted).toBe(false);
    expect(patch.payout).toBe(0);
  });
});
