/**
 * Meta conversion-event discovery.
 *
 * The defect this replaces: the sync named BuyologyIQ's event
 * (`offsite_conversion.fb_pixel_custom.RingbaConversion`) in code, so RRM — which
 * records `lead` 487 times — stored zero conversions against $4,451.81 of spend.
 * A per-client constant masquerading as a general rule.
 *
 * So nothing here names an event. Every `action_type` the account returns is
 * captured with its count and value, per entity, per date, and the choice of
 * which one decides is made later, from the client's instance record.
 */

export interface DiscoveredEvent {
  event_name: string;
  count: number;
  value: number;
  /** Which Insights array it came from — the two apply different attribution. */
  source: "conversions" | "actions";
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function collect(
  into: Map<string, DiscoveredEvent>,
  counts: unknown,
  values: unknown,
  source: DiscoveredEvent["source"],
) {
  const valueByType = new Map<string, number>();
  if (Array.isArray(values)) {
    for (const v of values as any[]) {
      if (v?.action_type) valueByType.set(String(v.action_type), num(v.value));
    }
  }
  if (Array.isArray(counts)) {
    for (const c of counts as any[]) {
      const name = c?.action_type ? String(c.action_type) : null;
      if (!name) continue;
      // `conversions` wins over `actions` for the same name: it is the account's
      // own conversion counting. Recorded either way, never summed together.
      if (into.has(name) && into.get(name)!.source === "conversions") continue;
      into.set(name, {
        event_name: name,
        count: num(c.value),
        value: valueByType.get(name) ?? 0,
        source,
      });
    }
  }
  // A value with no matching count still proves the event exists.
  for (const [name, value] of valueByType) {
    if (!into.has(name)) into.set(name, { event_name: name, count: 0, value, source });
  }
}

/** Every conversion event on one Insights row, with count and value. */
export function extractEventBreakdown(row: any): DiscoveredEvent[] {
  const out = new Map<string, DiscoveredEvent>();
  collect(out, row?.conversions, row?.conversion_values, "conversions");
  collect(out, row?.actions, row?.action_values, "actions");
  return [...out.values()];
}

/**
 * The count that decides, for one row: the single event named on the instance
 * record. No governing event → null (UNKNOWN), never 0 and never a sum.
 */
export function governingCount(
  events: DiscoveredEvent[],
  governingEvent: string | null,
): { count: number | null; value: number | null } {
  if (!governingEvent) return { count: null, value: null };
  const hit = events.find((e) => e.event_name === governingEvent);
  if (!hit) return { count: null, value: null };
  return { count: hit.count, value: hit.value };
}
