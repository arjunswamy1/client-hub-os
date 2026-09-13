/**
 * Media Brain — the ONE data pull spec (Operating Procedures §2)
 *
 * "One pull spec... two pulls drift." Daily, weekly and monthly cadences all
 * call `pullWindow`. Every metric comes from `engine.ts` — nothing re-derived.
 *
 * §6: an empty pull is a FAILURE, not a zero. `pullWindow` never returns an
 * empty success.
 */

import { supabase } from '@/integrations/supabase/client';
import * as engine from './engine';
import type { ConfidenceState, PayoutMode } from './engine';
import { getAdapter, mapCalls, type CanonicalCall, type TrackingPlatform } from './adapter';
import {
  joinCallsToMeta,
  type DidMapping,
  type JoinLevel,
  type JoinedEntityRow,
  type MetaAdRow,
  type VerticalRow,
} from './join';

const CALL_TABLES: Record<string, string> = {
  ringba: 'ringba_calls',
  ringba_4js: 'ringba_calls_4js',
  ringfuel: 'ringfuel_calls',
  jacuzzi: 'ringfuel_calls',
  moja: 'moja_calls',
  cannaball: 'cannaball_calls',
};

const CALL_DATE_COLUMN: Record<string, string> = {
  ringba_calls: 'call_date',
  ringba_calls_4js: 'call_start',
  ringfuel_calls: 'call_start',
  moja_calls: 'call_start',
  cannaball_calls: 'call_start',
};

export interface PullRow extends JoinedEntityRow {
  costPerCall: number | null;
  rpc: number | null;
  marginPerCall: number | null;
  profit: number | null;
  marginPct: number | null;
  costPerBillableCall: number | null;
  callRate: number | null;
  connectionRate: number | null;
  billableRate: number | null;
  confidenceState: ConfidenceState;
  marginBand: engine.MarginBandResult | null;
  /** Median call duration in seconds. Null when no durations came back. */
  medianDurationSeconds: number | null;
  /** RTB only — zeros included. Null under static. */
  payoutDistribution: engine.PayoutDistributionResult | null;

}

export interface PullWindowArgs {
  clientId: string;
  /** Inclusive ISO date (YYYY-MM-DD). The window is always stated, never inferred (§2). */
  start: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  end: string;
  timezone: string;
}

export interface PullWindowSuccess {
  ok: true;
  window: { start: string; end: string; timezone: string };
  payoutMode: PayoutMode;
  rows: PullRow[];
  totals: {
    spend: number;
    revenue: number;
    calls: number;
    connectedCalls: number;
    billableCalls: number;
    clicks: number;
    impressions: number;
    costPerCall: number | null;
    rpc: number | null;
    marginPerCall: number | null;
    profit: number | null;
    marginPct: number | null;
    costPerBillableCall: number | null;
    connectionRate: number | null;
    billableRate: number | null;
    callRate: number | null;
    marginBand: engine.MarginBandResult | null;
    payoutDistribution: engine.PayoutDistributionResult | null;
  };
  thresholds: { killThreshold: number | null; minCalls: number | null };
  unjoinedSpend: { entity: string; spend: number }[];
  unjoinedCalls: { call_id: string; did: string | null }[];
  joinLevel: JoinLevel;
  joinNote: string;
  /** Call ids whose billable status is undetermined — surface, never hide. */
  missingBillableDefinition: string[];
  /** Circuit breakers raised by the pull itself (§ Circuit breakers). */
  breakers: string[];
}

export interface PullWindowFailure {
  ok: false;
  error: string;
}

export type PullWindowResult = PullWindowSuccess | PullWindowFailure;

/**
 * The single pull used by every cadence.
 * @see docs/media-brain/03_Operating_Procedures.md §2
 */
export async function pullWindow({ clientId, start, end, timezone }: PullWindowArgs): Promise<PullWindowResult> {
  if (!clientId) return { ok: false, error: 'No client selected — a pull needs an explicit client.' };
  if (!start || !end) return { ok: false, error: 'Date range not stated. Confirm start, end and timezone before pulling.' };

  // Layer 1 + Layer 4: a command run without an Instance record stops. No defaults.
  const { data: economics, error: ecoError } = await supabase
    .from('media_brain_economics')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ecoError) return { ok: false, error: `Economics lookup failed: ${ecoError.message}` };
  if (!economics) return { ok: false, error: 'No Economics record for this client. Run intake first — the framework does not fall back on defaults.' };

  const { data: instance, error: instError } = await supabase
    .from('media_brain_instances')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_stale', false)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (instError) return { ok: false, error: `Instance lookup failed: ${instError.message}` };
  if (!instance) return { ok: false, error: 'No current Instance record for this client. Re-run intake — operating on stale or absent thresholds is not permitted.' };

  const payoutMode = (economics.payout_mode ?? 'static') as PayoutMode;
  const trackingPlatform = economics.tracking_platform as TrackingPlatform;
  const table = CALL_TABLES[trackingPlatform];
  const mapper = getAdapter(trackingPlatform);
  if (!table || !mapper) {
    return { ok: false, error: `No call-data mapping for tracking platform "${trackingPlatform}". The field has no source — it is named as missing, not substituted.` };
  }

  const startTs = `${start}T00:00:00`;
  const endTs = `${end}T23:59:59.999`;
  const dateCol = CALL_DATE_COLUMN[table];

  const [callsRes, adsRes, didsRes, periodsRes, verticalsRes] = await Promise.all([
    supabase.from(table as never).select('*').eq('client_id', clientId).gte(dateCol, startTs).lte(dateCol, endTs),
    supabase.from('ad_creatives').select('*').eq('client_id', clientId).lte('date_from', end).gte('date_to', start),
    supabase.from('client_dids').select('did, did_formatted, creative_name, platform, campaign_name').eq('client_id', clientId),
    supabase.from('client_did_periods').select('did, did_formatted, creative_name, platform, campaign_name, effective_from, effective_to').eq('client_id', clientId),
    supabase.from('client_verticals').select('vertical_id, label, meta_patterns, ringba_patterns').eq('client_id', clientId),
  ]);

  for (const [label, res] of [
    ['calls', callsRes],
    ['Meta creatives', adsRes],
    ['DID mappings', didsRes],
    ['DID periods', periodsRes],
    ['verticals', verticalsRes],
  ] as const) {
    if (res.error) return { ok: false, error: `${label} query failed: ${res.error.message}` };
  }

  const rawCalls = (callsRes.data ?? []) as Record<string, unknown>[];
  const metaAds = (adsRes.data ?? []) as unknown as MetaAdRow[];

  // §6: zero rows is a failure, not a zero. Never an empty success.
  if (rawCalls.length === 0 && metaAds.length === 0) {
    return {
      ok: false,
      error: `The pull returned no rows at all for ${start} to ${end} (${timezone}). That is a data failure, not zero performance — check the sync before reading anything into it.`,
    };
  }
  if (rawCalls.length === 0) {
    return {
      ok: false,
      error: `Meta spend exists for ${start} to ${end} (${timezone}) but no call records came back. Tracking flag: calls are not routing or not syncing. Zero billable calls is a kill trigger, so a failed pull must not be read as performance.`,
    };
  }

  const { calls, missingBillableDefinition } = mapCalls(rawCalls, mapper, {
    billableMinDurationSeconds: economics.billable_min_duration_seconds ?? null,
  });

  const didMappings: DidMapping[] = [
    ...((periodsRes.data ?? []) as DidMapping[]),
    ...((didsRes.data ?? []) as DidMapping[]),
  ];

  const join = joinCallsToMeta({
    calls,
    didMappings,
    metaAds,
    verticals: (verticalsRes.data ?? []) as VerticalRow[],
    window: { start, end },
  });

  const kill = engine.killThreshold(payoutMode, economics.payout, economics.avg_bid);
  const minCallsValue =
    instance.min_calls ?? engine.minCalls(instance.actionable_gap ?? engine.DEFAULTS.actionableGap, payoutMode);

  const rows: PullRow[] = join.rows.map((r) => decorate(r, payoutMode, kill, minCallsValue));

  const totals = {
    spend: sum(join.rows.map((r) => r.spend)),
    revenue: sum(join.rows.map((r) => r.revenue)),
    calls: sum(join.rows.map((r) => r.calls)),
    connectedCalls: sum(join.rows.map((r) => r.connected_calls)),
    billableCalls: sum(join.rows.map((r) => r.billable_calls)),
    clicks: sum(join.rows.map((r) => r.clicks)),
    impressions: sum(join.rows.map((r) => r.impressions)),
  };

  const allPayouts = join.rows.flatMap((r) => r.payouts);

  const breakers: string[] = [];
  if (join.unjoinedSpend.length) {
    breakers.push(
      `Tracking flag: ${join.unjoinedSpend.length} Meta entities spent $${sum(join.unjoinedSpend.map((u) => u.spend)).toFixed(2)} with no joined call records. Treated as a tracking failure, not as zero calls.`,
    );
  }
  if (missingBillableDefinition.length) {
    breakers.push('Billable definition is missing on the Economics record, so no call can be marked billable. Every billable-denominated metric is unavailable until it is supplied.');
  }
  for (const r of rows) {
    if (r.confidenceState === 'decisive_zero') {
      breakers.push(`${r.entity_name}: $${r.spend.toFixed(2)} spent past the kill threshold with zero billable calls.`);
    }
  }

  return {
    ok: true,
    window: { start, end, timezone },
    payoutMode,
    rows,
    totals: {
      ...totals,
      costPerCall: engine.costPerCall(totals.spend, totals.calls),
      rpc: engine.rpc(totals.revenue, totals.calls),
      marginPerCall: engine.marginPerCall(totals.revenue, totals.spend, totals.calls),
      profit: engine.profit(totals.revenue, totals.spend),
      marginPct: engine.marginPct(totals.revenue, totals.spend),
      costPerBillableCall: engine.costPerBillableCall(totals.spend, totals.billableCalls),
      connectionRate: engine.connectionRate(totals.connectedCalls, totals.calls),
      billableRate: engine.billableRate(totals.billableCalls, totals.connectedCalls),
      callRate: engine.callRate(totals.calls, totals.clicks),
      marginBand: engine.marginBand(engine.marginPct(totals.revenue, totals.spend)),
      payoutDistribution: payoutMode === 'rtb' ? engine.payoutDistribution(allPayouts) : null,
    },
    thresholds: { killThreshold: kill, minCalls: minCallsValue },
    unjoinedSpend: join.unjoinedSpend,
    unjoinedCalls: join.unjoinedCalls,
    joinLevel: join.joinLevel,
    joinNote: join.joinNote,
    missingBillableDefinition,
    breakers,
  };
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
}

/** Attach every computed column via engine.ts. Nothing re-derived here. */
function decorate(
  r: JoinedEntityRow,
  payoutMode: PayoutMode,
  kill: number | null,
  minCallsValue: number | null,
): PullRow {
  return {
    ...r,
    costPerCall: engine.costPerCall(r.spend, r.calls),
    rpc: engine.rpc(r.revenue, r.calls),
    marginPerCall: engine.marginPerCall(r.revenue, r.spend, r.calls),
    profit: engine.profit(r.revenue, r.spend),
    marginPct: engine.marginPct(r.revenue, r.spend),
    costPerBillableCall: engine.costPerBillableCall(r.spend, r.billable_calls),
    callRate: engine.callRate(r.calls, r.clicks),
    connectionRate: engine.connectionRate(r.connected_calls, r.calls),
    billableRate: engine.billableRate(r.billable_calls, r.connected_calls),
    confidenceState: engine.confidenceState(r.billable_calls, minCallsValue, r.spend, kill),
    marginBand: engine.marginBand(engine.marginPct(r.revenue, r.spend)),
    medianDurationSeconds: engine.median(r.durations),

    payoutDistribution: payoutMode === 'rtb' ? engine.payoutDistribution(r.payouts) : null,
  };
}

export type { CanonicalCall };
