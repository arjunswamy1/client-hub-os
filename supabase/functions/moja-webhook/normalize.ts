// Pure normalisation for Moja webhook payloads. No Deno, no network, no DB —
// so it can be unit-tested directly. index.ts owns transport, auth and persistence.
//
// Two shapes are accepted:
//   flat   — every field at the top level (Moja's actual delivery, 2026-09-14)
//   nested — { call: {...}, tags: {...} } (the shape the original receiver assumed)
// Detection is the presence of a top-level `call` OBJECT.
//
// The heart of this module: an unsubstituted macro like "[TRACKING_NUMBER]" is NOT data.
// It becomes null and its field name is recorded, because that list is how we learn what
// Moja can actually substitute on a real call.

/** Moja test fires leave unreplaced macros: [TO], [GCLID], [PUBLISHER_PAID_OUT]. */
export const TAG_LITERAL_RE = /^\[[A-Z0-9_]+\]$/;

export const isTagLiteral = (v: unknown): boolean =>
  typeof v === 'string' && TAG_LITERAL_RE.test(v.trim());

/** Empty string, null, undefined and tag literals all collapse to null. */
export function nullify(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '' || TAG_LITERAL_RE.test(t)) return null;
    return t;
  }
  return v;
}

export function toNumOrNull(v: unknown): number | null {
  const c = nullify(v);
  if (c === null) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

export function toIntOrNull(v: unknown): number | null {
  const n = toNumOrNull(v);
  return n === null ? null : Math.round(n);
}

export function toBoolOrNull(v: unknown): boolean | null {
  const c = nullify(v);
  if (c === null) return null;
  if (typeof c === 'boolean') return c;
  const s = String(c).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'converted', 'answered'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return null;
}

/**
 * ISO string, or null. `event_timestamp` and friends are treated as UTC unless the value
 * carries its own offset — a bare "2026-09-14 15:04:11" is read as UTC, not local.
 */
export function toIsoOrNull(v: unknown): string | null {
  const c = nullify(v);
  if (c === null) return null;
  const s = String(c);
  const n = Number(s);
  if (Number.isFinite(n) && n > 1_000_000_000) {
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s.trim());
  const normalized = hasOffset ? s.trim() : `${s.trim().replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Field NAMES only, recursively, shallow. Never values. */
export function fieldNames(obj: unknown, prefix = '', depth = 0): string[] {
  if (depth > 2 || obj === null || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) return obj.length ? fieldNames(obj[0], `${prefix}[]`, depth + 1) : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push(path);
    if (v && typeof v === 'object') out.push(...fieldNames(v, path, depth + 1));
  }
  return out;
}

/** Names of every field whose value came through as an unreplaced macro. */
export function unreplacedTagFields(obj: unknown, prefix = '', depth = 0): string[] {
  if (depth > 2 || obj === null || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isTagLiteral(v)) out.push(path);
    else if (v && typeof v === 'object') out.push(...unreplacedTagFields(v, path, depth + 1));
  }
  return out;
}

/**
 * The ten keys the landing-page capture requirement covers. A receipt records each one's
 * RAW delivered value — literal `[GCLID]` included — because the operator's test needs to
 * tell "referenced but unresolved" apart from "never referenced".
 */
export const CLICK_READINESS_KEYS = [
  'gclid',
  'wbraid',
  'gbraid',
  'fbclid',
  'msclkid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

/** Keys capable of naming a SINGLE AD. `utm_campaign` names a campaign, so it is not here. */
export const AD_LEVEL_CLICK_KEYS = ['gclid', 'wbraid', 'gbraid', 'fbclid', 'msclkid', 'utm_content'];

/** Raw values for those keys, from the first bag that carries each. Macros preserved. */
export function clickKeyRawValues(bags: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CLICK_READINESS_KEYS) {
    for (const bag of bags) {
      if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
      const b = bag as Record<string, unknown>;
      if (!(key in b)) continue;
      const v = b[key];
      const s = v === null || v === undefined ? '' : String(v).trim();
      if (!s) continue;
      out[key] = s;
      break;
    }
  }
  return out;
}

/** An ad-level key with a REAL value on this delivery, or null. A `[MACRO]` is not one. */
export function adLevelClickKeyArrived(values: Record<string, string>): string | null {
  for (const k of AD_LEVEL_CLICK_KEYS) {
    const v = values[k];
    if (v && !isTagLiteral(v)) return k;
  }
  return null;
}


export type Shape = 'flat' | 'nested';

export function detectShape(payload: Record<string, any>): Shape {
  const c = payload?.call;
  return c && typeof c === 'object' && !Array.isArray(c) ? 'nested' : 'flat';
}

function pick(sources: Record<string, any>[], keys: string[]): unknown {
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    for (const k of keys) {
      const v = nullify(src[k]);
      if (v !== null) return v;
    }
  }
  return null;
}

/**
 * Infer the RRM service line from free-text campaign / publisher labels.
 *
 * PLATFORM IS NOT DECIDED HERE. It used to be, from the same free text, with
 * windows defaulting to Meta and plumbing to Google — a guess that would be
 * quietly right often enough never to be questioned. Platform now has exactly one
 * rule and one source: `utm_source`. @see platformFromUtmSource
 */
export function classify(text: string): { service_line: string } {
  const t = text.toLowerCase();
  let service_line = 'unassigned';
  if (/window|glass|door/.test(t)) service_line = 'windows';
  else if (/plumb|drain|sewer|water heater|leak/.test(t)) service_line = 'plumbing';
  return { service_line };
}

/**
 * The ad platform, from `utm_source` and nothing else. Case-insensitive, trimmed.
 * `[UTM_SOURCE]` is the one UTM macro Moja confirmed, so this is the only platform
 * signal that will ever arrive — which makes its absence a gap worth showing.
 * Anything unrecognised or absent is `unclassified`: never the dialed number, never
 * the campaign name, never the likelier of the two platforms.
 */
export function platformFromUtmSource(utmSource: string | null | undefined): string {
  const key = (utmSource ?? '').trim().toLowerCase();
  if (key === 'facebook' || key === 'fb' || key === 'meta') return 'meta';
  if (key === 'google' || key === 'adwords') return 'google';
  return 'unclassified';
}

/**
 * Every key this module reads into a real column. Anything else Moja sends is kept in
 * `custom_tags` rather than dropped — Moja confirmed there is NO gclid/fbclid macro, so a
 * click key can only ever arrive as a custom tag, and it must survive without a code change.
 */
export const MAPPED_FIELDS = new Set<string>([
  'call', 'data', 'tags', 'custom_tags', 'custom', 'custom_fields', 'extra', 'variables',
  'call_id', 'callId', 'call_sid', 'inbound_call_id', 'uuid', 'id',
  'event', 'event_type', 'type', 'delivery_id', 'webhook_id', 'event_id', 'request_id',
  'campaign', 'campaign_name', 'campaignName', 'campaign_id', 'campaignId', 'campaign_utm',
  'publisher', 'publisher_name', 'target', 'target_name', 'buyer', 'buyer_name',
  'utm_source', 'source', 'utm_campaign', 'utm_medium', 'medium', 'utm_term', 'term',
  'keyword', 'utm_content', 'content', 'creative',
  'tracking_number', 'did', 'dialed_number', 'publisher_number', 'to',
  'duration', 'call_duration', 'duration_seconds', 'inbound_duration', 'inbound_duration_seconds',
  'answered', 'connected', 'converted', 'conversion', 'is_converted',
  'call_converted_at', 'converted_at', 'call_start', 'start_time', 'started_at',
  'event_timestamp', 'timestamp',
  'caller_id', 'caller', 'from', 'caller_number', 'ani',
  'caller_state', 'state', 'original_state', 'caller_zip', 'zip_code', 'zip', 'original_zip_code',
  'revenue', 'revenue_paid_out', 'buyer_revenue',
  'payout', 'publisher_paid_out', 'publisher_payout', 'target_payout',
  'no_payout_reason', 'hangup_cause', 'number_pool', 'number_pool_name',
  'disposition', 'status', 'result', 'call_termination_by',
  'recording_url', 'recording', 'audio_url',
  'gclid', 'fbclid', 'wbraid', 'gbraid', 'msclkid', 'ms_clkid',
]);

/**
 * Everything delivered that we do not map to a column. Tag literals are still nulled —
 * an unsubstituted macro is not data wherever it appears. Nested objects are kept whole.
 */
export function collectCustomTags(...bags: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const bag of bags) {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
    for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
      if (MAPPED_FIELDS.has(k)) continue;
      const cleaned = v && typeof v === 'object' ? v : nullify(v);
      if (cleaned === null) continue;
      out[k] = cleaned;
    }
  }
  return out;
}

export interface MojaCallRow {
  client_id: string;
  call_id: string;
  event_type: string | null;
  service_line: string;
  platform: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  publisher_name: string | null;
  target_name: string | null;
  buyer_name: string | null;
  tracking_number: string | null;
  forwarded_number: string | null;
  caller_number: string | null;
  caller_state: string | null;
  caller_zip: string | null;
  call_start: string | null;
  converted_at: string | null;
  /**
   * Moja's `[DURATION]`, stored exactly as delivered. Moja DESCRIBES this as the
   * CONNECTED duration; that is unconfirmed, so the name records the source field
   * and nothing is re-interpreted here.
   */
  reported_duration_seconds: number | null;
  /** Moja's `[INBOUND_DURATION]`, as delivered. May include ring time; unconfirmed. */
  reported_inbound_duration_seconds: number | null;
  /**
   * Which reported duration governs the billable definition. `unknown` until a human
   * has Moja's answer — and an UNKNOWN here blocks billable count, cost per billable
   * call, billable rate and every threshold derived from them.
   */
  duration_semantics: 'unknown' | 'duration' | 'inbound_duration';
  /** Legacy column names, kept populated with the same delivered values. */
  duration_seconds: number;
  inbound_duration_seconds: number;
  /**
   * NULL means the connection state was NOT reported. Never derived from a duration:
   * if inbound duration includes ring time, `duration > 0` would mark every unanswered
   * call connected and inflate connection rate — corrupting Step 1 of the diagnostic
   * tree, which is where every read starts.
   */
  connected: boolean | null;
  connected_source: string;
  /** Named reason `connected` is null. An unknown state must read as unknown. */
  connected_unknown_reason: string | null;
  answered: boolean | null;
  converted: boolean;
  revenue: number;
  payout: number;
  no_payout_reason: string | null;
  hangup_cause: string | null;
  number_pool: string | null;
  disposition: string | null;
  recording_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  msclkid: string | null;
  /**
   * Every delivered field we do not map to a column, kept intact. Moja has no gclid
   * or fbclid macro — those must arrive as custom tags, so the bag is the path by
   * which a click key can start flowing without another code change.
   */
  custom_tags: Record<string, unknown>;
  raw_payload: unknown;
}

export interface NormalizeResult {
  shape: Shape;
  fields: string[];
  unreplaced: string[];
  deliveryId: string | null;
  eventType: string | null;
  callId: string | null;
  /** Named reason the call row was refused; the receipt is still recorded. */
  reject: string | null;
  row: MojaCallRow | null;
  isConversionEvent: boolean;
}

export interface NormalizeOptions {
  clientId: string;
  forcedServiceLine?: string | null;
  forcedPlatform?: string | null;
}

export function normalizeDelivery(
  payload: Record<string, any>,
  opts: NormalizeOptions,
): NormalizeResult {
  const shape = detectShape(payload);
  const call = shape === 'nested' ? payload.call : payload;
  const tags = (shape === 'nested' ? payload.call?.tags ?? payload.tags : payload.tags) ?? {};
  // Anything unmapped becomes a custom tag, and custom tags are then a first-class source
  // for the click IDs and UTMs — whichever mechanism Moja ends up using, it lands.
  const nestedTagBags = ['custom_tags', 'custom', 'custom_fields', 'extra', 'variables'].map((k) => {
    const a = (call as Record<string, unknown>)?.[k];
    const b = (payload as Record<string, unknown>)?.[k];
    return [a, b];
  }).flat();
  const custom_tags = collectCustomTags(call, tags, payload, ...nestedTagBags);
  // The nested tag containers are read directly too: a click ID or utm_content arriving
  // inside `custom_tags` is a mapped field, so it must be picked, not bagged.
  const src = [call, tags, payload, custom_tags, ...nestedTagBags.filter(
    (b): b is Record<string, unknown> => !!b && typeof b === 'object' && !Array.isArray(b),
  )];

  const fields = fieldNames(payload);
  const unreplaced = unreplacedTagFields(payload);

  const eventType = (pick([payload, call], ['event', 'event_type', 'type']) as string | null) ?? null;
  const callIdRaw = pick(src, ['call_id', 'callId', 'call_sid', 'inbound_call_id', 'uuid', 'id']);
  const callId = callIdRaw === null ? null : String(callIdRaw);
  const deliveryId =
    (pick([payload], ['delivery_id', 'webhook_id', 'event_id', 'request_id']) as string | null) ??
    callId;

  const isConversionEvent =
    (eventType ?? '').toLowerCase().includes('convert') ||
    toBoolOrNull(pick(src, ['converted', 'conversion', 'is_converted'])) === true;

  const base = {
    shape,
    fields,
    unreplaced,
    deliveryId,
    eventType,
    callId,
    isConversionEvent,
  };

  // No call id → the row could never be deduplicated. Refuse it by name rather than
  // accumulating unmergeable duplicates on every retry.
  if (!callId) {
    return { ...base, reject: 'missing_call_id', row: null };
  }

  const campaign_name = (pick(src, ['campaign_name', 'campaign', 'campaignName']) as string | null) ?? null;
  const publisher_name = (pick(src, ['publisher_name', 'publisher']) as string | null) ?? null;
  const utm_source = (pick(src, ['utm_source', 'source']) as string | null) ?? null;
  const utm_campaign = (pick(src, ['utm_campaign', 'campaign_utm']) as string | null) ?? null;
  const utm_medium = (pick(src, ['utm_medium', 'medium']) as string | null) ?? null;
  const utm_term = (pick(src, ['utm_term', 'term', 'keyword']) as string | null) ?? null;
  const utm_content = (pick(src, ['utm_content', 'content', 'creative']) as string | null) ?? null;

  const inferred = classify(
    [campaign_name, publisher_name, utm_campaign, utm_source].filter(Boolean).join(' '),
  );
  const service_line = opts.forcedServiceLine || inferred.service_line;
  // Platform comes from utm_source alone (an explicit ?platform= override still wins,
  // because that is a human stating it rather than the code guessing).
  const platform = opts.forcedPlatform || platformFromUtmSource(utm_source);

  // `to` is the dialled number UNLESS an explicit tracking_number is present, in which case
  // `to` is where the call was forwarded on to.
  const explicitTracking = pick(src, ['tracking_number', 'did', 'dialed_number', 'publisher_number']) as
    | string
    | null;
  const to = pick(src, ['to']) as string | null;
  const tracking_number = explicitTracking ?? to;
  const forwarded_number = explicitTracking ? to : null;

  // Both durations are stored faithfully and separately. Moja calls [DURATION] the
  // CONNECTED duration and [INBOUND_DURATION] the inbound one — the reverse of the reading
  // this code once assumed. Rather than flip one guess for another, neither is interpreted:
  // `duration_semantics` stays 'unknown' until Moja answers which one the buyer's billable
  // threshold applies to.
  const reported_duration_seconds = toIntOrNull(pick(src, ['duration', 'call_duration', 'duration_seconds']));
  const reported_inbound_duration_seconds =
    toIntOrNull(pick(src, ['inbound_duration', 'inbound_duration_seconds']));
  const duration_seconds = reported_duration_seconds ?? 0;
  const inbound_duration_seconds = reported_inbound_duration_seconds ?? 0;

  // `connected` comes from the answered field ALONE. If inbound duration includes ring
  // time, a positive duration would mark every unanswered call connected — inflating
  // connection rate and corrupting Step 1 of the diagnostic tree. Unknown reads as unknown.
  const answered = toBoolOrNull(pick(src, ['answered', 'connected']));
  const connected = answered;
  const connected_source = answered !== null ? 'answered_field' : 'unknown';
  const connected_unknown_reason =
    answered === null
      ? 'answered_field_absent — connection state not reported by Moja; no duration is used as a proxy because which duration includes ring time is unconfirmed'
      : null;

  const converted = toBoolOrNull(pick(src, ['converted', 'conversion', 'is_converted'])) ?? false;
  const converted_at = converted
    ? toIsoOrNull(pick(src, ['call_converted_at', 'converted_at']))
    : null;

  // call_start: the tag if present; else event_timestamp minus the LONGEST reported
  // duration on a completed event — the earliest the call can have begun, which is the only
  // claim that holds while the two durations' meanings are unconfirmed. Else NULL. Never
  // now() — a fabricated timestamp lands a call in the wrong review window without saying so.
  const startTag = toIsoOrNull(pick(src, ['call_start', 'start_time', 'started_at']));
  const eventTs = toIsoOrNull(pick([payload, call], ['event_timestamp', 'timestamp']));
  let call_start: string | null = startTag;
  if (!call_start && eventTs && (eventType ?? '').toLowerCase().includes('complet')) {
    const longest = Math.max(duration_seconds, inbound_duration_seconds);
    call_start = new Date(new Date(eventTs).getTime() - longest * 1000).toISOString();
  }

  const row: MojaCallRow = {
    client_id: opts.clientId,
    call_id: callId,
    event_type: eventType,
    service_line,
    platform,
    campaign_id: (pick(src, ['campaign_id', 'campaignId']) as string | null) ?? null,
    campaign_name,
    publisher_name,
    target_name: (pick(src, ['target_name', 'target']) as string | null) ?? null,
    buyer_name: (pick(src, ['buyer_name', 'buyer']) as string | null) ?? null,
    tracking_number,
    forwarded_number,
    caller_number: (pick(src, ['caller_id', 'caller', 'from', 'caller_number', 'ani']) as string | null) ?? null,
    caller_state: (pick(src, ['caller_state', 'state', 'original_state']) as string | null) ?? null,
    caller_zip: (pick(src, ['caller_zip', 'zip_code', 'zip', 'original_zip_code']) as string | null) ?? null,
    call_start,
    converted_at,
    reported_duration_seconds,
    reported_inbound_duration_seconds,
    duration_semantics: 'unknown',
    duration_seconds,
    inbound_duration_seconds,
    connected,
    connected_source,
    connected_unknown_reason,
    answered,
    converted,
    // payout is publisher-paid = CPM revenue. revenue is buyer-paid, informational only.
    // They are kept strictly distinct; conflating them repeats the Ringba defect inverted.
    revenue: toNumOrNull(pick(src, ['revenue', 'revenue_paid_out', 'buyer_revenue'])) ?? 0,
    payout: toNumOrNull(pick(src, ['payout', 'publisher_paid_out', 'publisher_payout', 'target_payout'])) ?? 0,
    no_payout_reason: (pick(src, ['no_payout_reason']) as string | null) ?? null,
    hangup_cause: (pick(src, ['hangup_cause']) as string | null) ?? null,
    number_pool: (pick(src, ['number_pool', 'number_pool_name']) as string | null) ?? null,
    disposition: (pick(src, ['disposition', 'status', 'result', 'call_termination_by']) as string | null) ?? null,
    recording_url: (pick(src, ['recording_url', 'recording', 'audio_url']) as string | null) ?? null,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    // Kept strictly separate — a wbraid is not a gclid, and the join key differs.
    gclid: (pick(src, ['gclid']) as string | null) ?? null,
    fbclid: (pick(src, ['fbclid']) as string | null) ?? null,
    wbraid: (pick(src, ['wbraid']) as string | null) ?? null,
    gbraid: (pick(src, ['gbraid']) as string | null) ?? null,
    msclkid: (pick(src, ['msclkid', 'ms_clkid']) as string | null) ?? null,
    custom_tags,
    raw_payload: payload,
  };

  return { ...base, reject: null, row };
}

/**
 * Merge an incoming delivery onto a row that already exists.
 *
 * A conversion event updates only the conversion facts. A late `call.completed` arriving
 * AFTER a conversion must never zero them back out — late completes are normal, and that
 * ordering bug would silently erase revenue.
 */
export function mergeExisting(
  existing: { converted: boolean; revenue: number; payout: number; converted_at: string | null },
  incoming: MojaCallRow,
): Partial<MojaCallRow> {
  if (incoming.converted) {
    return {
      converted: true,
      revenue: incoming.revenue,
      payout: incoming.payout,
      converted_at: incoming.converted_at,
      event_type: incoming.event_type,
      raw_payload: incoming.raw_payload,
    };
  }

  const { converted, revenue, payout, converted_at, ...rest } = incoming;
  if (existing.converted) {
    // Keep every conversion fact from the earlier converted event.
    return rest;
  }
  return { ...rest, converted, revenue, payout, converted_at };
}
