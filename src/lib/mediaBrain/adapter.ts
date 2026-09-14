/**
 * Media Brain — call tracking data adapter (Layer 2 §3)
 *
 * The rules read CANONICAL field names. Each tracking platform gets a small
 * mapping. Change platforms, change only the mapping — never the rules.
 *
 * @see docs/media-brain/01_Decision_Engine.md §3
 */

/** Canonical call shape every rule in the framework reads. @see 01_Decision_Engine.md §3 */
export interface CanonicalCall {
  call_id: string;
  /** ISO timestamp. */
  timestamp: string;
  /**
   * Meta ad id. Usually NULL in this codebase — the call tables carry no Meta
   * ad_id, so the join runs DID → creative → ad (see join.ts). Never fabricated.
   */
  ad_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  creative_name: string | null;
  did: string | null;
  duration_seconds: number | null;
  connected: boolean | null;
  /**
   * Duration threshold met AND payout > 0 (plus the source's `converted` flag
   * where it has one). Under STATIC this is the clean line the payout contract
   * draws. Under RTB there is no clean billable line — use `paid` (§2, §6.3).
   */
  billable: boolean;
  /**
   * Did this call earn anything at all — `payout_amount > 0`, independent of
   * duration and of `converted`.
   *
   * A DIFFERENT question from `billable`, kept separately visible: under RTB
   * "zero billable" is defined as zero PAID calls (§6.3), and under static the
   * gap between paid and billable is the signal that the billable definition on
   * the Economics record disagrees with what the buyer actually pays for.
   */
  paid: boolean;
  /** 0 for a no-bid, never null — under RTB a zero must stay in the denominator. */
  payout_amount: number;
  buyer_id: string | null;
  state: string | null;
  no_bid_reason: string | null;
}

export type TrackingPlatform =
  | 'ringba'
  | 'ringba_4js'
  | 'ringfuel'
  | 'moja'
  | 'cannaball'
  | 'jacuzzi'
  | 'other';

/** Raw row from any supported call table. */
export type RawCallRow = Record<string, unknown>;

export interface MapOptions {
  /**
   * Client's billable duration threshold. When null the billable definition is
   * MISSING — calls come back `billable: false` and are named in
   * `missingBillableDefinition`. §3: fields with no source get named as missing,
   * not substituted.
   */
  billableMinDurationSeconds: number | null;
}

export type CallMapper = (row: RawCallRow, opts: MapOptions) => CanonicalCall;

/* ---------------- helpers ---------------- */

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  return Boolean(v);
}

function iso(v: unknown): string {
  const s = str(v);
  if (!s) return new Date(0).toISOString();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/** Payout coalesced to 0 — a no-bid is a real zero, never a null. @see §2, §5 */
function payoutAmount(...candidates: unknown[]): number {
  for (const c of candidates) {
    const n = num(c);
    if (n !== null) return n;
  }
  return 0;
}

/**
 * Derive `billable`: duration >= threshold AND payout > 0, plus the source's
 * explicit `converted` flag where the table has one.
 * Returns false when the threshold is unknown — never guessed.
 * @see docs/media-brain/01_Decision_Engine.md §3
 */
function deriveBillable(
  durationSeconds: number | null,
  payout: number,
  minDuration: number | null,
  converted?: boolean | null,
): boolean {
  if (minDuration === null || minDuration === undefined) return false;
  if (durationSeconds === null) return false;
  if (payout <= 0) return false;
  if (converted === false) return false;
  return durationSeconds >= minDuration;
}

/* ---------------- mappings, one per call table ---------------- */

/** `ringba_calls` → canonical. @see §3 */
export const fromRingba: CallMapper = (row, opts) => {
  const duration = num(row.duration_seconds);
  const payout = payoutAmount(row.payout, row.revenue);
  const converted = bool(row.converted);
  return {
    call_id: str(row.call_id) ?? str(row.id) ?? '',
    timestamp: iso(row.call_date),
    ad_id: null,
    adset_id: null,
    campaign_id: null,
    campaign_name: str(row.campaign_name),
    creative_name: null,
    did: str(row.inbound_number),
    duration_seconds: duration,
    connected: bool(row.connected),
    billable: deriveBillable(duration, payout, opts.billableMinDurationSeconds, converted),
    paid: payout > 0,
    payout_amount: payout,
    buyer_id: str(row.target_name),
    state: null,
    no_bid_reason: payout === 0 ? 'no_payout' : null,
  };
};

/** `ringba_calls_4js` → canonical. @see §3 */
export const fromRingba4js: CallMapper = (row, opts) => {
  const duration = num(row.call_duration_seconds);
  const payout = payoutAmount(row.payout);
  return {
    call_id: str(row.ringba_call_id) ?? str(row.id) ?? '',
    timestamp: iso(row.call_start),
    ad_id: null,
    adset_id: null,
    campaign_id: null,
    campaign_name: str(row.campaign_name),
    creative_name: str(row.creative_name),
    did: str(row.did),
    duration_seconds: duration,
    connected: bool(row.connected),
    billable: deriveBillable(duration, payout, opts.billableMinDurationSeconds),
    paid: payout > 0,
    payout_amount: payout,
    buyer_id: str(row.buyer_name),
    state: str(row.caller_state),
    no_bid_reason: payout === 0 ? (str(row.disposition) ?? 'no_payout') : null,
  };
};

/** `ringfuel_calls` → canonical. @see §3 */
export const fromRingfuel: CallMapper = (row, opts) => {
  const duration = num(row.duration_seconds);
  const payout = payoutAmount(row.payout, row.revenue);
  const converted = bool(row.converted);
  return {
    call_id: str(row.call_id) ?? str(row.id) ?? '',
    timestamp: iso(row.call_start),
    ad_id: null,
    adset_id: null,
    campaign_id: str(row.campaign_id),
    campaign_name: str(row.campaign_name),
    creative_name: str(row.creative_label),
    did: str(row.did),
    duration_seconds: duration,
    connected: bool(row.connected),
    billable: deriveBillable(duration, payout, opts.billableMinDurationSeconds, converted),
    paid: payout > 0,
    payout_amount: payout,
    buyer_id: str(row.buyer_name),
    state: str(row.caller_state),
    no_bid_reason: payout === 0 ? (str(row.disposition) ?? 'no_payout') : null,
  };
};

/** `moja_calls` → canonical. @see §3 */
export const fromMoja: CallMapper = (row, opts) => {
  const duration = num(row.duration_seconds);
  const payout = payoutAmount(row.payout, row.revenue);
  const converted = bool(row.converted);
  return {
    call_id: str(row.call_id) ?? str(row.id) ?? '',
    timestamp: iso(row.call_start),
    ad_id: null,
    adset_id: null,
    campaign_id: str(row.campaign_id),
    campaign_name: str(row.campaign_name),
    creative_name: str(row.utm_content),
    did: str(row.tracking_number),
    duration_seconds: duration,
    connected: bool(row.connected),
    billable: deriveBillable(duration, payout, opts.billableMinDurationSeconds, converted),
    paid: payout > 0,
    payout_amount: payout,
    buyer_id: str(row.buyer_name),
    state: str(row.caller_state),
    no_bid_reason: payout === 0 ? (str(row.disposition) ?? 'no_payout') : null,
  };
};

/** `cannaball_calls` → canonical. @see §3 */
export const fromCannaball: CallMapper = (row, opts) => {
  const duration = num(row.duration_seconds);
  const payout = payoutAmount(row.payout);
  return {
    call_id: str(row.call_id) ?? str(row.id) ?? '',
    timestamp: iso(row.call_start),
    ad_id: null,
    adset_id: null,
    campaign_id: null,
    campaign_name: str(row.campaign_name),
    creative_name: str(row.creative_name),
    did: str(row.did),
    duration_seconds: duration,
    connected: bool(row.connected),
    billable: deriveBillable(duration, payout, opts.billableMinDurationSeconds),
    paid: payout > 0,
    payout_amount: payout,
    buyer_id: null,
    state: str(row.caller_state),
    no_bid_reason: payout === 0 ? (str(row.disposition) ?? 'no_payout') : null,
  };
};

const ADAPTERS: Partial<Record<TrackingPlatform, CallMapper>> = {
  ringba: fromRingba,
  ringba_4js: fromRingba4js,
  ringfuel: fromRingfuel,
  // Jacuzzi delivery runs on RingFuel call records.
  jacuzzi: fromRingfuel,
  moja: fromMoja,
  cannaball: fromCannaball,
};

/**
 * Which mapping loads for a client, from `{tracking_platform}` captured at intake.
 * Returns null for an unmapped platform — a missing adapter is named, not guessed.
 * @see docs/media-brain/01_Decision_Engine.md §3
 */
export function getAdapter(trackingPlatform: TrackingPlatform | string | null | undefined): CallMapper | null {
  if (!trackingPlatform) return null;
  return ADAPTERS[trackingPlatform as TrackingPlatform] ?? null;
}

export interface MapCallsResult {
  calls: CanonicalCall[];
  /**
   * Call ids whose billable status could not be determined because the client's
   * `billable_min_duration_seconds` is missing. The caller MUST surface this —
   * §3: fields with no source get named as missing, not substituted.
   */
  missingBillableDefinition: string[];
}

/**
 * Map a batch of raw rows through a platform mapping.
 * @see docs/media-brain/01_Decision_Engine.md §3
 */
export function mapCalls(rows: RawCallRow[], mapper: CallMapper, opts: MapOptions): MapCallsResult {
  const calls = rows.map((r) => mapper(r, opts));
  const missingBillableDefinition =
    opts.billableMinDurationSeconds === null || opts.billableMinDurationSeconds === undefined
      ? calls.map((c) => c.call_id)
      : [];
  return { calls, missingBillableDefinition };
}
