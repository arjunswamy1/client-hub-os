/**
 * Media Brain — PLATFORM-ATTRIBUTED conversions (pure logic layer)
 *
 * Two rules govern this file, and they are the whole reason it exists.
 *
 * 1. **Never sum event names.** An ad account records many events for the same
 *    call: BuyologyIQ fires `offsite_conversion.fb_pixel_custom.RingbaConversion`
 *    *and* `contact_website` / `contact_total`. Adding them triple-counts one
 *    call. The decision-time count is the SINGLE event named on the client's
 *    instance record (`media_brain_instances.meta_conversion_event`), read out of
 *    the stored breakdown. Where that field is unset the count is **UNKNOWN** —
 *    not zero, not a sum, not the largest event.
 * 2. **Never blend platform-attributed with call-attributed.** They have
 *    different denominators and different attribution: the platform applies its
 *    own window, modelling and offline-upload match rate; our call-attributed
 *    read counts call records we hold. They are reported side by side with the
 *    discrepancy stated, and never averaged or reconciled into one figure.
 *
 * @see docs/media-brain/01_Decision_Engine.md §2
 * @see docs/media-brain/sync-field-audit.md
 */

type Num = number | null | undefined;

function ok(v: Num): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function divide(a: Num, b: Num): number | null {
  if (!ok(a) || !ok(b) || b === 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}

export type EntityLevel = 'account' | 'campaign' | 'adset' | 'ad';

/** One stored row of `media_brain_platform_conversions`. */
export interface ConversionBreakdownRow {
  platform: string;
  entity_level: EntityLevel | string;
  entity_ref: string;
  entity_name?: string | null;
  date?: string | null;
  event_name: string;
  count: number | null;
  value: number | null;
}

/** One event name rolled up over the window. */
export interface EventTotal {
  event_name: string;
  count: number;
  value: number;
}

/**
 * Roll the breakdown up by event name, keeping every event. Nothing here is a
 * decision — it is the menu an operator chooses the governing event from, and it
 * is shown wherever the governing count appears. A hidden alternative is how the
 * wrong event gets picked and never noticed.
 */
export function summariseEvents(rows: ConversionBreakdownRow[]): EventTotal[] {
  const by = new Map<string, EventTotal>();
  for (const r of rows) {
    const e = by.get(r.event_name) ?? { event_name: r.event_name, count: 0, value: 0 };
    e.count += ok(r.count) ? r.count : 0;
    e.value += ok(r.value) ? r.value : 0;
    by.set(r.event_name, e);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.event_name.localeCompare(b.event_name));
}

/**
 * `counted` — the governing event is named and present in the breakdown.
 * `event_absent` — it is named but the account recorded none of it in this window.
 * `unknown_event` — no governing event is recorded on the instance. UNKNOWN.
 */
export type GoverningState = 'counted' | 'event_absent' | 'unknown_event';

/** What an UNKNOWN governing event blocks (§1 — an UNKNOWN names what it blocks). */
export const CONVERSION_BLOCKED_OUTPUTS = [
  'the fragmentation check',
  'cost per conversion',
  'any conversion-based read of this account',
] as const;

export interface GoverningConversions {
  state: GoverningState;
  /** The event named on the instance record, or null when unset. */
  event: string | null;
  /** Null whenever the state is not `counted` — never 0 standing in for UNKNOWN. */
  count: number | null;
  value: number | null;
  /** Every other event the account recorded, so a different choice is visible. */
  alternatives: EventTotal[];
  /** Named outputs this UNKNOWN blocks. Empty when the count is usable. */
  blocks: readonly string[];
  /** Plain sentence for the screen. */
  note: string | null;
}

/**
 * The decision-time conversion count: the one named event, read from the
 * breakdown. Summing is not an option this function offers.
 */
export function governingConversions(
  rows: ConversionBreakdownRow[],
  governingEvent: string | null | undefined,
): GoverningConversions {
  const all = summariseEvents(rows);
  const event = governingEvent?.trim() || null;

  if (!event) {
    return {
      state: 'unknown_event',
      event: null,
      count: null,
      value: null,
      alternatives: all,
      blocks: CONVERSION_BLOCKED_OUTPUTS,
      note:
        'UNKNOWN — no governing conversion event is recorded on this client’s instance record. ' +
        'The events below all exist on the account; summing them would count the same call more than once, ' +
        'so no conversion count is published until one is named.',
    };
  }

  const hit = all.find((e) => e.event_name === event) ?? null;
  if (!hit) {
    return {
      state: 'event_absent',
      event,
      count: null,
      value: null,
      alternatives: all,
      blocks: CONVERSION_BLOCKED_OUTPUTS,
      note: `The governing event "${event}" is recorded on the instance but the account reported none of it in this window. That is a zero-evidence state, not a zero: either the event name is wrong or it stopped firing.`,
    };
  }

  return {
    state: 'counted',
    event,
    count: hit.count,
    value: hit.value,
    alternatives: all.filter((e) => e.event_name !== event),
    blocks: [],
    note: null,
  };
}

/* ------------------------------------------------------------------ *
 * Platform-attributed ad-level read
 * ------------------------------------------------------------------ */

/** Ad-level spend, from the ad tables. Conversions come from the breakdown. */
export interface PlatformAdSpendRow {
  entity_ref: string;
  entity_name: string | null;
  spend: number | null;
}

export interface PlatformAttributedAdRow {
  entity_ref: string;
  entity_name: string | null;
  spend: number;
  /** Null when the governing event is UNKNOWN or absent — never 0 in its place. */
  conversions: number | null;
  value: number | null;
  costPerConversion: number | null;
  valuePerConversion: number | null;
}

export interface PlatformAttributedRead {
  /** 'platform' — stated on every row so it is never mistaken for our call read. */
  attribution: 'platform';
  state: GoverningState;
  event: string | null;
  rows: PlatformAttributedAdRow[];
  totals: {
    spend: number;
    conversions: number | null;
    value: number | null;
    costPerConversion: number | null;
  };
  alternatives: EventTotal[];
  blocks: readonly string[];
  note: string | null;
  caveat: string;
}

/**
 * Offline uploads match well short of 100%, so a platform-reported count is a
 * floor, not a census. This belongs on the screen, not in a doc nobody opens.
 */
export const PLATFORM_ATTRIBUTION_CAVEAT =
  'Platform-attributed: counted by the ad platform, in its own attribution window and modelling, and — where conversions arrive by offline upload — only for the calls the upload matched. Match rates run well short of 100%, so these counts are a floor, not a census. An implausibly high cost per conversion usually means most uploads are not matching, not that the ads are that bad.';

export function platformAttributedAdRead(
  ads: PlatformAdSpendRow[],
  breakdown: ConversionBreakdownRow[],
  governingEvent: string | null | undefined,
): PlatformAttributedRead {
  const governing = governingConversions(breakdown, governingEvent);
  const usable = governing.state === 'counted';

  const perEntity = new Map<string, { count: number; value: number }>();
  if (usable) {
    for (const r of breakdown) {
      if (r.event_name !== governing.event) continue;
      const e = perEntity.get(r.entity_ref) ?? { count: 0, value: 0 };
      e.count += ok(r.count) ? r.count : 0;
      e.value += ok(r.value) ? r.value : 0;
      perEntity.set(r.entity_ref, e);
    }
  }

  const rows: PlatformAttributedAdRow[] = ads.map((a) => {
    const spend = ok(a.spend) ? a.spend : 0;
    const hit = usable ? perEntity.get(a.entity_ref) ?? { count: 0, value: 0 } : null;
    return {
      entity_ref: a.entity_ref,
      entity_name: a.entity_name,
      spend,
      conversions: hit ? hit.count : null,
      value: hit ? hit.value : null,
      costPerConversion: hit ? divide(spend, hit.count) : null,
      valuePerConversion: hit ? divide(hit.value, hit.count) : null,
    };
  });
  rows.sort((a, b) => b.spend - a.spend);

  const totalSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totalConv = usable ? rows.reduce((s, r) => s + (r.conversions ?? 0), 0) : null;
  const totalValue = usable ? rows.reduce((s, r) => s + (r.value ?? 0), 0) : null;

  return {
    attribution: 'platform',
    state: governing.state,
    event: governing.event,
    rows,
    totals: {
      spend: totalSpend,
      conversions: totalConv,
      value: totalValue,
      costPerConversion: divide(totalSpend, totalConv),
    },
    alternatives: governing.alternatives,
    blocks: governing.blocks,
    note: governing.note,
    caveat: PLATFORM_ATTRIBUTION_CAVEAT,
  };
}

/* ------------------------------------------------------------------ *
 * The two reads, side by side — never blended
 * ------------------------------------------------------------------ */

export interface AttributionSideBySide {
  platform: { attribution: 'platform'; label: string; event: string | null; count: number | null; spend: number };
  call: { attribution: 'call'; label: string; count: number | null; spend: number };
  /** platform count − call count. Null when either side is UNKNOWN. */
  countDelta: number | null;
  /** Delta as a share of the call-attributed count. */
  pctOfCall: number | null;
  /** Stated, never reconciled. */
  statement: string;
}

/**
 * Reports the gap between the platform's count and ours. It deliberately returns
 * no combined or averaged figure: there is no denominator both counts share.
 */
export function compareAttribution(
  platform: { event: string | null; count: number | null; spend: Num },
  call: { count: number | null; spend: Num },
): AttributionSideBySide {
  const pCount = ok(platform.count) ? platform.count : null;
  const cCount = ok(call.count) ? call.count : null;
  const delta = pCount !== null && cCount !== null ? pCount - cCount : null;
  const pct = divide(delta, cCount);

  const statement =
    pCount === null
      ? 'No platform-attributed count is published — the governing conversion event is UNKNOWN, so there is nothing to compare.'
      : cCount === null
        ? 'No call-attributed count is available for this window, so the platform figure stands alone and cannot be checked against our own records.'
        : delta === 0
          ? `Both reads land on ${pCount}. They still measure different things — the agreement is worth noting, not merging.`
          : `The platform reports ${pCount} against our ${cCount} call-attributed ${cCount === 1 ? 'call' : 'calls'} — a gap of ${delta > 0 ? '+' : ''}${delta}. The gap is the finding; it is reported, not reconciled, because the two counts use different attribution and different denominators.`;

  return {
    platform: {
      attribution: 'platform',
      label: platform.event ? `Platform-attributed — "${platform.event}"` : 'Platform-attributed — event UNKNOWN',
      event: platform.event,
      count: pCount,
      spend: ok(platform.spend) ? platform.spend : 0,
    },
    call: {
      attribution: 'call',
      label: 'Call-attributed — our call records',
      count: cCount,
      spend: ok(call.spend) ? call.spend : 0,
    },
    countDelta: delta,
    pctOfCall: pct,
    statement,
  };
}
