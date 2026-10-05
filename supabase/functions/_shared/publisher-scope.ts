// PUBLISHER SCOPE — we are ONE publisher on most of these accounts.
//
// A Ringba / CallGrid / Moja / RingFuel tracking campaign receives calls from
// every publisher pointed at it. The client's own internal traffic and a dozen
// affiliates land in the same feed as ours, carrying the same payout column. So
// the campaign's total and OUR attributable total are DIFFERENT NUMBERS, and
// both are true. Crediting the campaign total against our media spend is the
// same class of error as mixing denominators: it manufactures margin out of
// somebody else's traffic.
//
// Which publisher name is ours is a RECORDED FACT per account
// (media_brain_economics.attributed_publishers), never inferred from a name that
// looks like us. "You", "CPM", "BIQ", "RRM (INTERNAL)" all appear in real feeds
// and only the client can say which is our buying. An UNANSWERED question is
// never read as "it's all ours": scoping 'unknown' blocks every money figure.
//
// @see docs/media-brain/01_Decision_Engine.md §3, §3b
// @see src/lib/mediaBrain/engine.ts — partitionByPublisher / publisherScopingGate

export type PublisherScoping =
  | 'attributed_publishers'
  | 'not_required_dedicated_campaigns'
  | 'unknown';

/** Where each call feed records the publisher. Read, never guessed. */
const PUBLISHER_READ: Record<string, { column?: string; json?: string; keys: string[] }> = {
  ringba_calls: {
    json: 'metadata',
    keys: ['publisher', 'publisher_name', 'Publisher', 'publisherName', 'tag:InboundNumber:Publisher', 'tag:Publisher:Name'],
  },
  ringba_calls_4js: { column: 'publisher_name', keys: [] },
  moja_calls: { column: 'publisher_name', keys: [] },
  ringfuel_calls: {
    json: 'raw_payload',
    keys: ['Publisher', 'publisher_name', 'publisher', 'publisherName'],
  },
  cannaball_calls: {
    json: 'raw_payload',
    keys: ['publisher', 'publisher_name', 'Publisher'],
  },
};

export const PUBLISHER_NOT_RECORDED = '(publisher not recorded on the call)';

/**
 * Feeds whose raw payload is large: read only the publisher keys out of it
 * (aliased `pub_<i>`), never the whole blob — Spektrafin's 28-day window is
 * ~25k rows and pulling every raw_payload made the run too slow to finish.
 */
const ALIASED_JSON = new Set(['ringfuel_calls', 'cannaball_calls']);

/** Extra columns a call query must select to read the publisher on this feed. */
export function publisherColumns(table: string): string[] {
  const spec = PUBLISHER_READ[table];
  if (!spec) return [];
  if (spec.json && ALIASED_JSON.has(table)) return spec.keys.map((k, i) => `pub_${i}:${spec.json}->>${k}`);
  return [spec.column || spec.json!].filter(Boolean) as string[];
}

/** The publisher on one raw row of one feed, or null when the feed records none. */
export function readPublisher(table: string, row: Record<string, unknown>): string | null {
  const spec = PUBLISHER_READ[table];
  if (!spec) return null;
  if (spec.column) {
    const v = row[spec.column];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  for (let i = 0; i < spec.keys.length; i++) {
    const v = row[`pub_${i}`];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const blob = row[spec.json!];
  if (!blob || typeof blob !== 'object') return null;
  for (const k of spec.keys) {
    const v = (blob as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export interface PublisherScope {
  scoping: PublisherScoping;
  attributed: string[];
  verifiedBy: string | null;
  verifiedAt: string | null;
  recordedNote: string | null;
  /** TRUE when calls must be filtered down to ours. FALSE only for a dedicated feed. */
  filterApplies: boolean;
  /** TRUE when no revenue, profit or margin may be published at this scope. */
  moneyBlocked: boolean;
  /** Always rendered: what was decided about publisher scoping, and by whom. */
  gateNote: string;
}

function normalise(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase();
}

/**
 * The account's recorded scoping decision, turned into a gate.
 * A client-default row (vertical_id IS NULL) governs; a vertical row may narrow it.
 */
export function resolvePublisherScope(
  eco: {
    publisher_scoping?: string | null;
    attributed_publishers?: (string | null)[] | null;
    publisher_scoping_verified_by?: string | null;
    publisher_scoping_verified_at?: string | null;
    publisher_scoping_note?: string | null;
  } | null,
  clientName: string,
): PublisherScope {
  const attributed = (eco?.attributed_publishers || []).filter((p): p is string => !!p && !!p.trim());
  const raw = normalise(eco?.publisher_scoping);
  const verifiedBy = eco?.publisher_scoping_verified_by?.trim() || null;
  const verifiedAt = eco?.publisher_scoping_verified_at?.slice(0, 10) || null;
  const recordedNote = eco?.publisher_scoping_note?.trim() || null;

  if (raw === 'not_required_dedicated_campaigns') {
    return {
      scoping: 'not_required_dedicated_campaigns',
      attributed,
      verifiedBy,
      verifiedAt,
      recordedNote,
      filterApplies: false,
      moneyBlocked: false,
      gateNote:
        `Publisher filtering is OFF for ${clientName} by a recorded decision that this feed receives only CPM's traffic` +
        `${verifiedBy ? `, confirmed by ${verifiedBy}` : ''}${verifiedAt ? ` on ${verifiedAt}` : ''}. ` +
        `Every call in the feed counts as ours. If more than one publisher appears on it, that decision is contradicted by the data and is reported below.`,
    };
  }

  // 'required' is the value the economics table's own CHECK constraint allows and
  // means the same thing: filtering to our own publisher name is required here.
  if ((raw === 'attributed_publishers' || raw === 'required') && attributed.length > 0) {
    return {
      scoping: 'attributed_publishers',
      attributed,
      verifiedBy,
      verifiedAt,
      recordedNote,
      filterApplies: true,
      moneyBlocked: false,
      gateNote:
        `${clientName} works with several publishers; CPM's traffic is the call(s) published as ${attributed.map((a) => `"${a}"`).join(' or ')}` +
        `${verifiedBy ? ` (confirmed by ${verifiedBy}${verifiedAt ? ` on ${verifiedAt}` : ''})` : ''}. ` +
        `Every figure below counts ONLY those calls. Other publishers' calls are excluded and reported separately — the campaign total and our total are different numbers and both are true.`,
    };
  }

  // Everything else — no record, an empty list, or the question left open.
  return {
    scoping: 'unknown',
    attributed,
    verifiedBy,
    verifiedAt,
    recordedNote,
    filterApplies: true,
    moneyBlocked: true,
    gateNote:
      `PUBLISHER SCOPING IS UNKNOWN for ${clientName}. CPM is one publisher among several on this feed, and which publisher name is ours has not been recorded` +
      `${attributed.length ? ` (the record suggests ${attributed.map((a) => `"${a}"`).join(' or ')} but the decision is not confirmed)` : ''}. ` +
      `Calls and spend are measured and may be stated, but revenue, profit and margin CANNOT be stated at all: the feed's payouts include other publishers' traffic, and claiming them as ours would credit CPM for calls it did not deliver. This is answered at intake, not by guessing.`,
  };
}

/** Load the account-level scope and any per-vertical overrides in one read. */
export async function loadPublisherScopes(
  supabase: any,
  clientId: string,
  clientName: string,
): Promise<{ account: PublisherScope; byVertical: Map<string, PublisherScope> }> {
  const { data } = await supabase
    .from('media_brain_economics')
    .select('vertical_id, publisher_scoping, attributed_publishers, publisher_scoping_verified_by, publisher_scoping_verified_at, publisher_scoping_note')
    .eq('client_id', clientId);
  const rows = (data || []) as any[];
  const accountRow = rows.find((r) => !r.vertical_id) || null;
  const byVertical = new Map<string, PublisherScope>();
  for (const r of rows) {
    if (r.vertical_id) byVertical.set(r.vertical_id, resolvePublisherScope(r, clientName));
  }
  return { account: resolvePublisherScope(accountRow, clientName), byVertical };
}

export interface PublisherFilterSummary {
  /** Calls dropped because another publisher delivered them. */
  excludedCalls: number;
  /** Every publisher seen in the window, ours included, with volume. */
  inventory: { publisher: string; calls: number; kept: boolean }[];
  /** TRUE when no revenue/profit/margin may be published. */
  moneyBlocked: boolean;
  /** Why money is blocked, or null. */
  blockReason: string | null;
  notes: string[];
}

/**
 * Applies the gate row by row. Counts everything it sees, so the answer can say
 * how large the other publishers are instead of silently dropping them.
 */
export function createPublisherFilter(scope: PublisherScope, clientName: string) {
  const counts = new Map<string, { calls: number; kept: boolean }>();
  const attributedLower = new Set(scope.attributed.map((a) => normalise(a)));
  let excluded = 0;

  const isOurs = (publisher: string | null): boolean => {
    if (!scope.filterApplies) return true;            // dedicated feed
    if (scope.scoping === 'unknown') return true;     // cannot filter; money is blocked instead
    if (!publisher) return false;                     // unnamed is never assumed ours
    return attributedLower.has(normalise(publisher));
  };

  return {
    /** Record the row and say whether it counts towards our figures. */
    keep(publisher: string | null): boolean {
      const key = publisher || PUBLISHER_NOT_RECORDED;
      const kept = isOurs(publisher);
      const seen = counts.get(key) || { calls: 0, kept };
      seen.calls++;
      seen.kept = kept;
      counts.set(key, seen);
      if (!kept) excluded++;
      return kept;
    },

    summary(): PublisherFilterSummary {
      const inventory = [...counts.entries()]
        .map(([publisher, v]) => ({ publisher, calls: v.calls, kept: v.kept }))
        .sort((a, b) => b.calls - a.calls);
      const named = inventory.filter((i) => i.publisher !== PUBLISHER_NOT_RECORDED);
      const notes: string[] = [scope.gateNote];
      if (scope.recordedNote) notes.push(scope.recordedNote);

      let moneyBlocked = scope.moneyBlocked;
      let blockReason: string | null = moneyBlocked
        ? `publisher scoping is unknown for ${clientName}, so the feed's payouts cannot be separated into ours and other publishers'.`
        : null;

      if (scope.scoping === 'not_required_dedicated_campaigns' && named.length > 1) {
        moneyBlocked = true;
        blockReason = `this feed is recorded as dedicated to CPM's traffic, but ${named.length} different publishers appear on it in this window (${named.slice(0, 6).map((i) => `${i.publisher} ${i.calls}`).join(', ')}). The recorded decision is contradicted by the data, so no revenue, profit or margin is published until it is revisited.`;
        notes.push(`CONTRADICTION: ${blockReason}`);
      }

      if (scope.scoping === 'attributed_publishers') {
        const ours = inventory.filter((i) => i.kept);
        notes.push(
          excluded === 0
            ? `All ${inventory.reduce((s, i) => s + i.calls, 0)} calls in the window came from CPM's own publisher record.`
            : `${excluded} of ${inventory.reduce((s, i) => s + i.calls, 0)} calls on this feed came from publishers that are NOT ours and are excluded from every figure above (${inventory.filter((i) => !i.kept).slice(0, 8).map((i) => `${i.publisher} ${i.calls}`).join(', ')}). Ours: ${ours.map((i) => `${i.publisher} ${i.calls}`).join(', ') || 'none in this window'}.`,
        );
        if (ours.length === 0 && excluded > 0) {
          notes.push(`Not one call in this window is published under CPM's name. Before reporting that as zero delivery, check the publisher name on the account record still matches what the platform sends.`);
        }
      }

      if (scope.scoping === 'unknown' && named.length) {
        notes.push(
          `Publishers seen in this window: ${named.slice(0, 10).map((i) => `${i.publisher} ${i.calls} calls`).join(', ')}. ` +
          `Volume and cost are ours to state; the money on these calls is not, until the attributed publisher is recorded.`,
        );
      }

      return { excludedCalls: excluded, inventory, moneyBlocked, blockReason, notes };
    },
  };
}
