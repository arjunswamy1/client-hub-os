/**
 * READING A CANNABALL CALL — one accessor, explicit fallbacks, absence is UNKNOWN.
 *
 * `cannaball_calls.raw_payload` is the CallGrid webhook body verbatim, and it
 * carries far more than the parsed columns: buyer identity, routing outcome,
 * three different durations, caller geography, SHAKEN/STIR attestation and the
 * account's own EST hour. Reading it as `raw_payload->>'x'` scattered through
 * report code is how two callers end up disagreeing about what "connected"
 * means, so every read of a CallGrid field goes through this file.
 *
 * Two rules, both from docs/media-brain/01_Decision_Engine.md §7:
 *  - A key that is ABSENT is unknown, never zero. `null` is returned, and the
 *    caller must say "unavailable" rather than print a 0.
 *  - A fallback chain is named in one place. We never silently slide from one
 *    field to another in the middle of a calculation.
 *
 * REVENUE — the named per-account exception
 * -----------------------------------------
 * Cannaball is `performance_media`, which normally means the call table's
 * `revenue` column is CPM's income. `cannaball_calls` HAS NO `revenue` column.
 * What it has is a column named `payout`, and that column holds CallGrid's
 * `revenue` field:
 *
 *   since 2026-09-15 — payout column $12,150.06 · raw_payload.revenue $11,405.36
 *                    · raw_payload.payout $719.69 (near-empty, not the money)
 *
 * The column is misnamed at the sync boundary. So for THIS account, and only
 * this account, revenue = the `payout` column, recorded as
 * `clients.revenue_field = 'payout'` and asserted here by client id so the
 * exception is visible in code rather than inferred from a database row.
 * Profit = revenue − media spend, floored nowhere (Cannaball has no zero-floor
 * rule; that is Spektrafin's).
 */

export const CANNABALL_CLIENT_ID = 'a1dabea1-5518-4c7f-a29d-23739cb52f9b';

/**
 * Accounts whose money column is not the one their engagement type implies.
 * Named, never a silent fallback. Keep this list tiny and commented.
 */
export const REVENUE_COLUMN_OVERRIDES: Record<string, { column: 'payout'; why: string }> = {
  [CANNABALL_CLIENT_ID]: {
    column: 'payout',
    why:
      "cannaball_calls has no revenue column; the column named payout carries CallGrid's " +
      'revenue field (verified: payout column $12,150.06 vs raw_payload.revenue $11,405.36 ' +
      'vs raw_payload.payout $719.69 since 2026-09-15).',
  },
};

export interface RawCall {
  id?: string;
  call_id?: string | null;
  did?: string | null;
  caller_number?: string | null;
  caller_state?: string | null;
  caller_zip?: string | null;
  caller_city?: string | null;
  call_start?: string | null;
  duration_seconds?: number | null;
  connected?: boolean | null;
  connection_duration_seconds?: number | null;
  payout?: number | string | null;
  platform?: string | null;
  creative_name?: string | null;
  campaign_name?: string | null;
  disposition?: string | null;
  raw_payload?: Record<string, unknown> | null;
}

const P = (c: RawCall) => (c.raw_payload ?? {}) as Record<string, unknown>;

/** First key that is actually present (not undefined/null/''), else undefined. */
function pick(p: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = p[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Tri-state boolean: true / false / null when the flag was never sent. */
export function boolOrNull(v: unknown): boolean | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return null;
}

function strOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export interface CannaballCallView {
  callId: string | null;
  did: string | null;
  platform: string | null;
  creative: string | null;
  campaign: string | null;

  /** CPM's income on this call, or null when CallGrid never sent a figure. */
  revenue: number | null;
  revenueCaptured: boolean;
  /** Telco/media cost CallGrid reports on the call, when present. */
  callCost: number | null;

  vendorId: string | null;
  vendorName: string | null;
  sourceName: string | null;
  sourceNumber: string | null;

  connected: boolean;
  status: string | null;
  noRoute: boolean;
  noAnswer: boolean;
  connectFailed: boolean;
  busy: boolean;
  duplicate: boolean;
  blocked: boolean;
  rejected: boolean | null;
  paid: boolean | null;
  billable: boolean | null;
  converted: boolean | null;

  /** Best available duration, in seconds — connect first, then dial, then inbound. */
  durationSeconds: number | null;
  connectDurationSeconds: number | null;
  revenueDurationSeconds: number | null;

  callerId: string | null;
  anonymous: boolean;
  state: string | null;
  zip: string | null;
  city: string | null;
  carrier: string | null;
  carrierType: string | null;

  /** null = CallGrid sent no attestation at all for this call. */
  stirValidated: boolean | null;
  stirAttestation: string | null;

  estHour: number | null;
  startedAt: string | null;
}

export function readCall(c: RawCall): CannaballCallView {
  const p = P(c);

  // Revenue: the misnamed column first (it is the settled figure the reconciliation
  // matched to the cent), then the payload keys. Never re-derived from duration.
  const columnRevenue = numOrNull(c.payout);
  const payloadRevenue = numOrNull(pick(p, ['RevenueAmount', 'CallRevenue', 'revenue', 'VariableRevenue']));
  const revenue = columnRevenue !== null ? columnRevenue : payloadRevenue;

  const connectDur = numOrNull(pick(p, ['CallDurationFromConnect']));
  const anyDur =
    numOrNull(c.connection_duration_seconds) ??
    connectDur ??
    numOrNull(c.duration_seconds) ??
    numOrNull(pick(p, ['CallDuration', 'callDuration', 'CallDurationFromDial', 'CallDurationFromInbound']));

  const callerId = strOrNull(pick(p, ['CallerId', 'InboundNumber', 'InboundNumberNoPlus'])) ?? strOrNull(c.caller_number);
  const anonymousMarkers = ['anonymous', 'unknown', 'private', 'restricted'];

  const status = strOrNull(pick(p, ['CallStatus', 'callStatus', 'outcome']));
  const noRouteFlag = boolOrNull(pick(p, ['CallNoRoute', 'noRoute']));

  return {
    callId: strOrNull(c.call_id) ?? strOrNull(pick(p, ['CallId', 'id'])),
    did: strOrNull(c.did) ?? strOrNull(pick(p, ['SourceNumber'])),
    platform: strOrNull(c.platform),
    creative: strOrNull(c.creative_name),
    campaign: strOrNull(c.campaign_name) ?? strOrNull(pick(p, ['CampaignName'])),

    revenue,
    revenueCaptured: revenue !== null,
    callCost: numOrNull(pick(p, ['cost'])),

    vendorId: strOrNull(pick(p, ['VendorId'])),
    vendorName: strOrNull(pick(p, ['VendorName'])),
    sourceName: strOrNull(pick(p, ['SourceName'])),
    sourceNumber: strOrNull(pick(p, ['SourceNumber'])),

    connected: c.connected === true || boolOrNull(pick(p, ['CallConnected', 'connected'])) === true,
    status,
    noRoute: noRouteFlag === true || (status ?? '').toUpperCase().includes('NO_ROUTE'),
    noAnswer: boolOrNull(pick(p, ['CallNoAnswer', 'noAnswer'])) === true || (status ?? '').toUpperCase() === 'NO_ANSWER',
    connectFailed: boolOrNull(pick(p, ['CallConnectFailed', 'connectFailed'])) === true,
    busy: boolOrNull(pick(p, ['CallBusy', 'busy'])) === true,
    duplicate: boolOrNull(pick(p, ['duplicate'])) === true,
    blocked: boolOrNull(pick(p, ['blocked'])) === true,
    rejected: boolOrNull(pick(p, ['rejected'])),
    paid: boolOrNull(pick(p, ['CallPaid', 'paid'])),
    billable: boolOrNull(pick(p, ['CallBillable', 'billable'])),
    converted: boolOrNull(pick(p, ['converted'])),

    durationSeconds: anyDur,
    connectDurationSeconds: connectDur ?? numOrNull(c.connection_duration_seconds),
    revenueDurationSeconds: numOrNull(pick(p, ['RevenueDuration', 'PayoutDuration', 'VariableDuration'])),

    callerId,
    anonymous: callerId === null || anonymousMarkers.includes(callerId.toLowerCase()),
    state: strOrNull(c.caller_state) ?? strOrNull(pick(p, ['InboundStateCode', 'InboundState'])),
    zip: strOrNull(c.caller_zip) ?? strOrNull(pick(p, ['InboundZipCode'])),
    city: strOrNull(c.caller_city) ?? strOrNull(pick(p, ['InboundCity'])),
    carrier: strOrNull(pick(p, ['InboundCarrier'])),
    carrierType: strOrNull(pick(p, ['InboundCarrierType'])),

    stirValidated: boolOrNull(pick(p, ['InboundShakenStirValidated'])),
    stirAttestation: strOrNull(pick(p, ['InboundShakenStirAttestation'])),

    estHour: numOrNull(pick(p, ['ESTHour'])),
    startedAt: strOrNull(c.call_start),
  };
}

/** Qualified = a connected call of at least 60s. The one definition. */
export const QUALIFIED_SECONDS = 60;
export const ENGAGED_SECONDS = 10;

export function isQualified(v: CannaballCallView): boolean {
  return (v.durationSeconds ?? 0) >= QUALIFIED_SECONDS;
}
export function isEngaged(v: CannaballCallView): boolean {
  return (v.durationSeconds ?? 0) >= ENGAGED_SECONDS;
}

/**
 * DID → platform, date-ranged. The same DID has served different platforms at
 * different times (8884594216: Roku "Basic Anchor" Jun–Jul, then Universal
 * "$12.20 Bid" in Sept), so a DID alone cannot name a platform. Unmatched is a
 * FINDING, returned as null — never folded into a platform's totals.
 */
export interface DidPeriod {
  did: string;
  platform: string | null;
  creative_name: string | null;
  campaign_name: string | null;
  effective_from: string | null;
  effective_to: string | null;
}

export function resolveDid(periods: DidPeriod[], did: string | null, day: string): DidPeriod | null {
  if (!did) return null;
  const digits = did.replace(/\D/g, '').slice(-10);
  for (const p of periods) {
    if ((p.did || '').replace(/\D/g, '').slice(-10) !== digits) continue;
    const from = p.effective_from ?? '0000-01-01';
    const to = p.effective_to ?? '9999-12-31';
    if (day >= from && day <= to) return p;
  }
  return null;
}
