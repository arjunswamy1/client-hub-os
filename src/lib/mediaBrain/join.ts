/**
 * Media Brain — the join (Operating Procedures §2, Decision Engine §3)
 *
 * §2 of Operating Procedures says to join on `ad_id`. **In this codebase the
 * call tables carry no Meta ad_id.** It is never fabricated. The real path:
 *
 *   1. DID → creative   (`client_dids`, `client_did_periods` for history)
 *   2. creative_name → Meta ad (`ad_creatives.ad_name` / `.creative_name`)
 *   3. Fallback: campaign-name patterns (`client_verticals`) — vertical level ONLY
 *
 * Meta spend that does not join to call data is a TRACKING FLAG, not a zero.
 * It never renders as an entity with 0 calls and a terrible margin.
 *
 * @see docs/media-brain/03_Operating_Procedures.md §2
 */

import type { CanonicalCall } from './adapter';

export interface DidMapping {
  did: string | null;
  did_formatted?: string | null;
  creative_name: string | null;
  platform: string | null;
  campaign_name: string | null;
  /** Present on `client_did_periods` rows; absent on current `client_dids` rows. */
  effective_from?: string | null;
  effective_to?: string | null;
}

export interface MetaAdRow {
  platform_ad_id: string | null;
  platform_adset_id: string | null;
  platform_campaign_id: string | null;
  ad_name: string | null;
  creative_name?: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  platform: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  date_from?: string | null;
  date_to?: string | null;
}

export interface VerticalRow {
  vertical_id: string;
  label: string | null;
  meta_patterns: string[] | null;
  ringba_patterns: string[] | null;
}

export type JoinLevel = 'ad' | 'adset' | 'campaign' | 'vertical' | 'none';

export interface JoinedEntityRow {
  level: JoinLevel;
  /** Stable key: platform ad id where known, otherwise the name we grouped on. */
  entity_ref: string;
  entity_name: string;
  campaign_name: string | null;
  adset_name: string | null;
  platform_ad_id: string | null;
  platform_adset_id: string | null;
  platform_campaign_id: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  /** TOTAL calls — the RTB denominator. Never silently swapped for billable. */
  calls: number;
  connected_calls: number;
  billable_calls: number;
  revenue: number;
  /** Payouts of every call, zeros INCLUDED — needed for the RTB median. */
  payouts: number[];
  /** Call durations in seconds, nulls dropped — needed for median duration. */
  durations: number[];
  call_ids: string[];

}

export interface JoinInput {
  calls: CanonicalCall[];
  didMappings: DidMapping[];
  metaAds: MetaAdRow[];
  verticals: VerticalRow[];
  window: { start: string; end: string };
}

export interface JoinResult {
  rows: JoinedEntityRow[];
  /** Meta spend with no call records — a tracking flag, never a zero-call row. */
  unjoinedSpend: { entity: string; spend: number }[];
  unjoinedCalls: { call_id: string; did: string | null }[];
  joinLevel: JoinLevel;
  joinNote: string;
}

const norm = (v: string | null | undefined) =>
  (v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

function emptyRow(base: Partial<JoinedEntityRow> & { level: JoinLevel; entity_ref: string; entity_name: string }): JoinedEntityRow {
  return {
    campaign_name: null,
    adset_name: null,
    platform_ad_id: null,
    platform_adset_id: null,
    platform_campaign_id: null,
    spend: 0,
    impressions: 0,
    clicks: 0,
    calls: 0,
    connected_calls: 0,
    billable_calls: 0,
    revenue: 0,
    payouts: [],
    durations: [],
    call_ids: [],
    ...base,

  };
}

/**
 * Resolve a call's DID to a creative, honouring historical DID periods.
 * `client_did_periods` rows win when their window contains the call timestamp;
 * current `client_dids` rows are the fallback.
 * @see 03_Operating_Procedures.md §2
 */
export function resolveDidMapping(
  call: CanonicalCall,
  didMappings: DidMapping[],
): DidMapping | null {
  const d = digits(call.did);
  if (!d) return null;
  const candidates = didMappings.filter(
    (m) => digits(m.did) === d || digits(m.did_formatted) === d,
  );
  if (!candidates.length) return null;
  const t = new Date(call.timestamp).getTime();
  const dated = candidates.filter((m) => m.effective_from || m.effective_to);
  const inWindow = dated.find((m) => {
    const from = m.effective_from ? new Date(m.effective_from).getTime() : -Infinity;
    const to = m.effective_to ? new Date(m.effective_to).getTime() + 86_400_000 : Infinity;
    return t >= from && t < to;
  });
  return inWindow ?? candidates.find((m) => !m.effective_from && !m.effective_to) ?? candidates[0];
}

/** creative_name → Meta ad, by `ad_name` or `creative_name`. @see §2 step 2 */
export function matchCreativeToAd(creativeName: string | null, metaAds: MetaAdRow[]): MetaAdRow | null {
  const key = norm(creativeName);
  if (!key) return null;
  return (
    metaAds.find((a) => norm(a.ad_name) === key || norm(a.creative_name) === key) ??
    metaAds.find((a) => {
      const an = norm(a.ad_name);
      const cn = norm(a.creative_name);
      return (an && (an.includes(key) || key.includes(an))) || (cn && (cn.includes(key) || key.includes(cn)));
    }) ??
    null
  );
}

/** Fallback: campaign-name pattern → vertical. Grouping is vertical level ONLY. @see §2 step 3 */
export function matchVertical(call: CanonicalCall, verticals: VerticalRow[]): VerticalRow | null {
  const name = norm(call.campaign_name);
  if (!name) return null;
  return (
    verticals.find((v) =>
      [...(v.ringba_patterns ?? []), ...(v.meta_patterns ?? [])].some((p) => {
        const np = norm(p);
        return np && name.includes(np);
      }),
    ) ?? null
  );
}

/**
 * Join calls to Meta entities through DID → creative → ad, with a vertical-level
 * fallback. Never invents angle or audience groupings from unparseable names.
 * @see docs/media-brain/03_Operating_Procedures.md §2
 */
export function joinCallsToMeta({ calls, didMappings, metaAds, verticals, window }: JoinInput): JoinResult {
  const rows = new Map<string, JoinedEntityRow>();
  const unjoinedCalls: { call_id: string; did: string | null }[] = [];
  const touchedAdRefs = new Set<string>();

  let adLevelJoins = 0;
  let verticalJoins = 0;

  const adRef = (a: MetaAdRow) => a.platform_ad_id ?? norm(a.ad_name) ?? '';

  for (const call of calls) {
    const mapping = resolveDidMapping(call, didMappings);
    const creativeName = mapping?.creative_name ?? call.creative_name;
    const ad = creativeName ? matchCreativeToAd(creativeName, metaAds) : null;

    let key: string;
    let row: JoinedEntityRow;

    if (ad) {
      key = `ad:${adRef(ad)}`;
      touchedAdRefs.add(adRef(ad));
      row =
        rows.get(key) ??
        emptyRow({
          level: 'ad',
          entity_ref: adRef(ad),
          entity_name: ad.ad_name ?? creativeName ?? 'Unnamed ad',
          campaign_name: ad.campaign_name,
          adset_name: ad.adset_name,
          platform_ad_id: ad.platform_ad_id,
          platform_adset_id: ad.platform_adset_id,
          platform_campaign_id: ad.platform_campaign_id,
          spend: Number(ad.spend ?? 0),
          impressions: Number(ad.impressions ?? 0),
          clicks: Number(ad.clicks ?? 0),
        });
      adLevelJoins++;
    } else {
      const vertical = matchVertical(call, verticals);
      if (!vertical) {
        unjoinedCalls.push({ call_id: call.call_id, did: call.did });
        continue;
      }
      key = `vertical:${vertical.vertical_id}`;
      row =
        rows.get(key) ??
        emptyRow({
          level: 'vertical',
          entity_ref: vertical.vertical_id,
          entity_name: vertical.label ?? vertical.vertical_id,
          campaign_name: call.campaign_name,
        });
      verticalJoins++;
    }

    row.calls += 1;
    if (call.connected) row.connected_calls += 1;
    if (call.billable) row.billable_calls += 1;
    row.revenue += call.payout_amount;
    // Zeros are included deliberately: a no-bid is real data under RTB.
    row.payouts.push(call.payout_amount);
    row.call_ids.push(call.call_id);
    rows.set(key, row);
  }

  // Vertical-level rows accumulate spend from every Meta campaign matching the
  // vertical's patterns, so cost per call is comparable to the calls in the row.
  for (const row of rows.values()) {
    if (row.level !== 'vertical') continue;
    const vertical = verticals.find((v) => v.vertical_id === row.entity_ref);
    if (!vertical) continue;
    for (const ad of metaAds) {
      const name = norm(ad.campaign_name);
      const hit = (vertical.meta_patterns ?? []).some((p) => {
        const np = norm(p);
        return np && name.includes(np);
      });
      if (!hit) continue;
      touchedAdRefs.add(adRef(ad));
      row.spend += Number(ad.spend ?? 0);
      row.impressions += Number(ad.impressions ?? 0);
      row.clicks += Number(ad.clicks ?? 0);
    }
  }

  // Meta spend with no call records: a tracking flag, not a zero. These rows are
  // deliberately NOT emitted as entities with 0 calls.
  const unjoinedSpend = metaAds
    .filter((a) => !touchedAdRefs.has(adRef(a)) && Number(a.spend ?? 0) > 0)
    .map((a) => ({ entity: a.ad_name ?? a.campaign_name ?? 'Unnamed Meta entity', spend: Number(a.spend ?? 0) }));

  let joinLevel: JoinLevel = 'none';
  if (adLevelJoins > 0) joinLevel = 'ad';
  else if (verticalJoins > 0) joinLevel = 'vertical';

  const noteParts: string[] = [];
  if (joinLevel === 'ad') {
    noteParts.push(
      `${adLevelJoins} calls matched a Meta ad through their tracking number and creative name. Reporting is at ad level only — the account's names carry no reliable angle or audience structure, so no angle groupings are inferred.`,
    );
  }
  if (verticalJoins > 0) {
    noteParts.push(
      `${verticalJoins} calls had no tracking-number mapping and were grouped at vertical level from campaign-name patterns. Vertical level is as fine as those names support.`,
    );
  }
  if (joinLevel === 'none') {
    noteParts.push('No calls could be matched to a Meta entity in this window.');
  }
  if (unjoinedSpend.length) {
    const total = unjoinedSpend.reduce((s, u) => s + u.spend, 0);
    noteParts.push(
      `${unjoinedSpend.length} Meta entities spent ${total.toFixed(2)} with no call records at all — a tracking flag, not zero performance.`,
    );
  }
  if (unjoinedCalls.length) {
    noteParts.push(`${unjoinedCalls.length} calls could not be attributed to any Meta entity.`);
  }
  noteParts.push(`Window ${window.start} to ${window.end}.`);

  return { rows: [...rows.values()], unjoinedSpend, unjoinedCalls, joinLevel, joinNote: noteParts.join(' ') };
}
