/**
 * Platform-attributed conversions — the governing-event rule.
 *
 * In-memory only. No network, no database.
 */

import { describe, expect, it } from 'vitest';
import {
  compareAttribution,
  governingConversions,
  platformAttributedAdRead,
  summariseEvents,
  type ConversionBreakdownRow,
} from '@/lib/mediaBrain/platformConversions';
import { extractEventBreakdown, governingCount } from '../../supabase/functions/sync-meta-ads/conversions';

const RINGBA = 'offsite_conversion.fb_pixel_custom.RingbaConversion';

/** BuyologyIQ's shape: the same calls counted by three different event names. */
const biq: ConversionBreakdownRow[] = [
  { platform: 'meta', entity_level: 'ad', entity_ref: 'ad1', date: '2026-09-01', event_name: RINGBA, count: 20, value: 1500 },
  { platform: 'meta', entity_level: 'ad', entity_ref: 'ad2', date: '2026-09-01', event_name: RINGBA, count: 17, value: 1210 },
  { platform: 'meta', entity_level: 'ad', entity_ref: 'ad1', date: '2026-09-01', event_name: 'contact_website', count: 180, value: 4400 },
  { platform: 'meta', entity_level: 'ad', entity_ref: 'ad2', date: '2026-09-01', event_name: 'contact_total', count: 174, value: 4450 },
];

describe('governing conversion event', () => {
  it('counts only the governing event, never the sum of the others', () => {
    const g = governingConversions(biq, RINGBA);
    expect(g.state).toBe('counted');
    expect(g.count).toBe(37);
    expect(g.value).toBe(2710);
    // Not 391 — summing would count the same calls three times over.
    expect(g.count).not.toBe(391);
    expect(g.alternatives.map((a) => a.event_name).sort()).toEqual(['contact_total', 'contact_website']);
  });

  it('reports UNKNOWN and names what it blocks when no governing event is set', () => {
    const g = governingConversions(biq, null);
    expect(g.state).toBe('unknown_event');
    expect(g.count).toBeNull();
    expect(g.value).toBeNull();
    expect(g.blocks).toContain('the fragmentation check');
    expect(g.blocks).toContain('cost per conversion');
    // Never the largest event, never a total.
    expect(g.alternatives).toHaveLength(3);
  });

  it('distinguishes a named-but-absent event from an unset one', () => {
    const g = governingConversions(biq, 'lead');
    expect(g.state).toBe('event_absent');
    expect(g.count).toBeNull();
    expect(g.note).toMatch(/not a zero/);
  });

  it('keeps every event in the breakdown even though only one is counted', () => {
    const all = summariseEvents(biq);
    expect(all.map((e) => e.event_name).sort()).toEqual([
      RINGBA,
      'contact_total',
      'contact_website',
    ].sort());
    expect(all.find((e) => e.event_name === 'contact_website')!.count).toBe(180);
  });
});

describe('platform-attributed ad-level read', () => {
  const ads = [
    { entity_ref: 'ad1', entity_name: 'Tub A', spend: 1695.84 },
    { entity_ref: 'ad2', entity_name: 'Tub B', spend: 800 },
  ];

  it('publishes per-ad conversions and cost per conversion from the governing event only', () => {
    const read = platformAttributedAdRead(ads, biq, RINGBA);
    expect(read.attribution).toBe('platform');
    expect(read.totals.conversions).toBe(37);
    expect(read.rows.find((r) => r.entity_ref === 'ad1')!.conversions).toBe(20);
    expect(read.rows.find((r) => r.entity_ref === 'ad1')!.costPerConversion).toBeCloseTo(1695.84 / 20, 4);
  });

  it('publishes no conversion figure at all when the governing event is unset', () => {
    const read = platformAttributedAdRead(ads, biq, null);
    expect(read.totals.conversions).toBeNull();
    expect(read.totals.costPerConversion).toBeNull();
    for (const r of read.rows) {
      expect(r.conversions).toBeNull();
      expect(r.costPerConversion).toBeNull();
    }
    expect(read.blocks.length).toBeGreaterThan(0);
  });

  it('carries the floor-not-census caveat on every read', () => {
    expect(platformAttributedAdRead(ads, biq, RINGBA).caveat).toMatch(/floor, not a census/);
  });
});

describe('platform-attributed and call-attributed never combine', () => {
  it('reports the gap and offers no blended figure', () => {
    const c = compareAttribution({ event: RINGBA, count: 139, spend: 9756 }, { count: 79, spend: 5425 });
    expect(c.platform.attribution).toBe('platform');
    expect(c.call.attribution).toBe('call');
    expect(c.platform.count).toBe(139);
    expect(c.call.count).toBe(79);
    expect(c.countDelta).toBe(60);
    // No key holds a combined, averaged or reconciled count.
    expect(Object.keys(c)).toEqual(['platform', 'call', 'countDelta', 'pctOfCall', 'statement']);
    expect(c.statement).toMatch(/not reconciled/);
  });

  it('states plainly that nothing can be compared when the platform side is UNKNOWN', () => {
    const c = compareAttribution({ event: null, count: null, spend: 4451.81 }, { count: 40, spend: 3372 });
    expect(c.countDelta).toBeNull();
    expect(c.statement).toMatch(/UNKNOWN/);
  });
});

describe('sync-side event discovery — no event name is assumed', () => {
  const rrmRow = {
    spend: '4451.81',
    clicks: '5746',
    actions: [
      { action_type: 'lead', value: '487' },
      { action_type: 'landing_page_view', value: '5050' },
    ],
    action_values: [{ action_type: 'lead', value: '0' }],
    conversions: null,
    conversion_values: null,
  };

  it('discovers every event the account records, including one no allowlist named', () => {
    const events = extractEventBreakdown(rrmRow);
    expect(events.map((e) => e.event_name).sort()).toEqual(['landing_page_view', 'lead']);
    expect(events.find((e) => e.event_name === 'lead')!.count).toBe(487);
  });

  it('returns UNKNOWN rather than zero when no governing event is named', () => {
    expect(governingCount(extractEventBreakdown(rrmRow), null)).toEqual({ count: null, value: null });
    expect(governingCount(extractEventBreakdown(rrmRow), 'lead')).toEqual({ count: 487, value: 0 });
  });

  it('prefers the conversions array over actions for the same event name', () => {
    const events = extractEventBreakdown({
      conversions: [{ action_type: RINGBA, value: '37' }],
      conversion_values: [{ action_type: RINGBA, value: '2710' }],
      actions: [{ action_type: RINGBA, value: '40' }],
      action_values: [{ action_type: RINGBA, value: '3000' }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ count: 37, value: 2710, source: 'conversions' });
  });
});
