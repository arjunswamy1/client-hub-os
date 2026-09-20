/**
 * Media Brain — the join (Operating Procedures §2, Decision Engine §3)
 *
 * §2 of Operating Procedures says to join on `ad_id`. **In this codebase the
 * call tables carry no Meta ad_id column.** It is never fabricated. There are
 * three real paths, tried in order of how precisely they identify an ad:
 *
 *   1. UTM tags on the call itself (`utm_ad`)
 *      a. `creative_id` (Ringba `tag:User:creative`) → `ad_creatives.platform_ad_id`
 *      b. `utm_content` → `platform_ad_id`, else → `ad_name`
 *   2. DID → creative → ad (`did_ad`)
 *      `client_dids` / `client_did_periods` → `creative_name` → `ad_creatives`
 *   3. `utm_campaign` → `platform_campaign_id`, else → `campaign_name`
 *      (`utm_campaign`) — CAMPAIGN level only. A call resolved here is NOT
 *      resolved at ad level and is excluded from ad-level verdicts.
 *   4. Fallback: campaign-name patterns (`client_verticals`) — vertical level ONLY
 *
 * Tier 1 comes before tier 2 because a UTM names the ad directly, while the DID
 * path names it through two lookups. Tier 2 still beats tier 3: ad-level
 * resolution of any kind beats campaign-level resolution.
 *
 * Coverage is reported PER TIER. Conflating a campaign-level resolution with an
 * ad-level one would overstate readiness for the ad-level decisions the Decision
 * Engine makes.
 *
 * Meta spend that does not join to call data is a TRACKING FLAG, not a zero.
 * It never renders as an entity with 0 calls and a terrible margin.
 *
 * @see docs/media-brain/03_Operating_Procedures.md §2
 */

import type { CanonicalCall } from './adapter';
import * as engine from './engine';
import type { RevenueEconomics, ResolvedRevenue } from './engine';

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
  /**
   * DELIBERATELY ABSENT: the raw `conversions` column on `ad_creatives`,
   * `ad_sets` and `ad_campaigns`. It holds whatever the sync happened to write,
   * across several event names at once, and no Media Brain figure may read it.
   * Platform conversions reach the read only as the single governing event from
   * `media_brain_platform_conversions`. @see verticalRead.GovernedConversions
   */
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

/**
 * How a single call resolved. Reported separately per tier — a `utm_campaign`
 * resolution is campaign level and cannot carry an ad-level decision.
 */
export type ResolutionTier = 'utm_ad' | 'utm_campaign' | 'did_ad' | 'vertical' | 'none';

export const RESOLUTION_TIERS: ResolutionTier[] = ['utm_ad', 'did_ad', 'utm_campaign', 'vertical', 'none'];

/** Only these two tiers identify a single ad, so only they support ad-level verdicts. */
export const isAdLevelTier = (tier: ResolutionTier): boolean => tier === 'utm_ad' || tier === 'did_ad';

export interface JoinedEntityRow {
  level: JoinLevel;
  /** Stable key: platform ad id where known, otherwise the name we grouped on. */
  entity_ref: string;
  entity_name: string;
  /** The tier that first resolved a call into this row. @see ResolutionTier */
  resolution: ResolutionTier;
  /**
   * True only for `utm_ad` / `did_ad` rows. Campaign-level and vertical-level
   * rows are excluded from ad-level verdicts, graduation gates and angle
   * comparisons — the Decision Engine's ad-level rules need one ad per row.
   */
  adLevelEligible: boolean;
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
  /**
   * Calls that earned anything at all (`payout_amount > 0`). Under RTB this is
   * what "zero billable" means for the kill rule (§6.3) — payout is continuous
   * there, so there is no clean billable line.
   */
  paid_calls: number;
  /**
   * Paid but NOT billable. Under static this should be ~0; a non-trivial count
   * means the billable definition disagrees with what the buyer is paying for.
   */
  paid_not_billable_calls: number;
  /**
   * Revenue. When the join is given a `revenue` economics record this is
   * `engine.resolveRevenue`'s answer — sub-threshold telco payouts excluded, or
   * `payout × billable calls` where the platform's payouts are not visible.
   * Without one it is the raw payout sum.
   */
  revenue: number;
  /** How `revenue` was arrived at. Null when no revenue economics were supplied. */
  revenueResolution: ResolvedRevenue | null;
  /** Per-call payout/duration/billable triples — the input to `resolveRevenue`. */
  revenueRows: {
    payout_amount: number;
    duration_seconds: number | null;
    billable: boolean;
    /** False where the source delivered no revenue figure — unknown, not zero. */
    revenue_captured: boolean;
  }[];
  /** Calls in this row whose revenue the source never delivered. */
  uncaptured_revenue_calls: number;
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
  /**
   * Revenue rules for this client. Supplied, revenue is resolved through
   * `engine.resolveRevenue` instead of summing the raw payout field.
   */
  revenue?: RevenueEconomics;
}

export interface JoinResult {
  rows: JoinedEntityRow[];
  /** Meta spend with no call records — a tracking flag, never a zero-call row. */
  unjoinedSpend: { entity: string; spend: number }[];
  unjoinedCalls: { call_id: string; did: string | null }[];
  joinLevel: JoinLevel;
  joinNote: string;
  /** Calls counted per resolution tier. Never summed into a single "resolved". */
  resolutionCounts: Record<ResolutionTier, number>;
  /** Calls resolved at ad level (`utm_ad` + `did_ad`) — the only ad-level-decidable set. */
  adLevelCalls: number;
}

/**
 * Normalise a name for comparison. Returns NULL for an empty result — an
 * unidentifiable row must never share a key with another unidentifiable row.
 */
const norm = (v: string | null | undefined): string | null => {
  const n = (v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return n === '' ? null : n;
};

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

function emptyRow(
  base: Partial<JoinedEntityRow> & {
    level: JoinLevel;
    entity_ref: string;
    entity_name: string;
    resolution: ResolutionTier;
  },
): JoinedEntityRow {
  return {
    campaign_name: null,
    adset_name: null,
    platform_ad_id: null,
    platform_adset_id: null,
    platform_campaign_id: null,
    adLevelEligible: isAdLevelTier(base.resolution),
    spend: 0,
    impressions: 0,
    clicks: 0,
    calls: 0,
    connected_calls: 0,
    billable_calls: 0,
    paid_calls: 0,
    paid_not_billable_calls: 0,
    revenue: 0,
    revenueResolution: null,
    revenueRows: [],
    uncaptured_revenue_calls: 0,
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

/**
 * creative_name → EVERY Meta row for that ad inside the window.
 *
 * `ad_creatives` rows are period-scoped and `ad_sets` / `ad_campaigns` are
 * per-date, so one ad routinely has several rows overlapping a review window.
 * Returning a single row would silently drop the rest of its spend, understating
 * cost and overstating margin. Exact-name matches win outright; only when there
 * are none do we fall back to substring matches.
 * @see §2 step 2
 */
export function matchCreativeToAds(creativeName: string | null, metaAds: MetaAdRow[]): MetaAdRow[] {
  const key = norm(creativeName);
  if (!key) return [];
  const exact = metaAds.filter((a) => norm(a.ad_name) === key || norm(a.creative_name) === key);
  if (exact.length) return exact;
  return metaAds.filter((a) => {
    const an = norm(a.ad_name);
    const cn = norm(a.creative_name);
    return (!!an && (an.includes(key) || key.includes(an))) || (!!cn && (cn.includes(key) || key.includes(cn)));
  });
}

/** Convenience single-row form. Prefer `matchCreativeToAds` — spend must be summed. */
export function matchCreativeToAd(creativeName: string | null, metaAds: MetaAdRow[]): MetaAdRow | null {
  return matchCreativeToAds(creativeName, metaAds)[0] ?? null;
}

/** Every Meta row for one `platform_ad_id`. An id match is exact by construction. */
export function matchAdsById(adId: string | null, metaAds: MetaAdRow[]): MetaAdRow[] {
  const id = (adId ?? '').trim();
  if (!id) return [];
  return metaAds.filter((a) => (a.platform_ad_id ?? '').trim() === id);
}

/** Every Meta row for one campaign, by `platform_campaign_id` first, then name. */
export function matchCampaign(
  utmCampaign: string | null,
  metaAds: MetaAdRow[],
): { ads: MetaAdRow[]; ref: string; via: 'platform_campaign_id' | 'campaign_name' } | null {
  const raw = (utmCampaign ?? '').trim();
  if (!raw) return null;
  const byId = metaAds.filter((a) => (a.platform_campaign_id ?? '').trim() === raw);
  if (byId.length) return { ads: byId, ref: raw, via: 'platform_campaign_id' };
  const key = norm(raw);
  if (!key) return null;
  const byName = metaAds.filter((a) => norm(a.campaign_name) === key);
  if (byName.length) return { ads: byName, ref: key, via: 'campaign_name' };
  return null;
}

/** Fallback: campaign-name pattern → vertical. Grouping is vertical level ONLY. @see §2 step 3 */
export function matchVertical(call: CanonicalCall, verticals: VerticalRow[]): VerticalRow | null {
  const name = norm(call.campaign_name);
  if (!name) return null;
  return (
    verticals.find((v) =>
      [...(v.ringba_patterns ?? []), ...(v.meta_patterns ?? [])].some((p) => {
        const np = norm(p);
        return !!np && name.includes(np);
      }),
    ) ?? null
  );
}

/** What one call resolved to, and by which tier. */
export interface CallResolution {
  tier: ResolutionTier;
  /** Meta rows for the resolved AD — `utm_ad` and `did_ad` only. */
  ads: MetaAdRow[];
  /** Meta rows for the resolved CAMPAIGN — `utm_campaign` only. */
  campaignAds: MetaAdRow[];
  campaignRef: string | null;
  vertical: VerticalRow | null;
  mapping: DidMapping | null;
  /** Which key did the work, named for the join note. */
  via: string | null;
}

/** A row must carry a platform ad id or a usable name, or it cannot be an entity. */
const adRef = (a: MetaAdRow): string | null => a.platform_ad_id ?? norm(a.ad_name);

/**
 * Resolve ONE call through the tiers, in order. This is the single place the
 * tier order lives — the join and the coverage meter both call it, so coverage
 * can never drift from what the join actually did.
 */
export function resolveCall(
  call: CanonicalCall,
  didMappings: DidMapping[],
  metaAds: MetaAdRow[],
  verticals: VerticalRow[],
): CallResolution {
  const base = { ads: [] as MetaAdRow[], campaignAds: [] as MetaAdRow[], campaignRef: null, vertical: null, mapping: null };

  // Tier 1a — the Meta ad id captured on the call.
  const byCreativeId = matchAdsById(call.creative_id, metaAds).filter((a) => adRef(a) !== null);
  if (byCreativeId.length) return { ...base, tier: 'utm_ad', ads: byCreativeId, via: 'creative_id → platform_ad_id' };

  // Tier 1b — utm_content, as an ad id first (Meta passes numeric ids), then a name.
  if (call.utm_content) {
    const byId = matchAdsById(call.utm_content, metaAds).filter((a) => adRef(a) !== null);
    if (byId.length) return { ...base, tier: 'utm_ad', ads: byId, via: 'utm_content → platform_ad_id' };
    const byName = matchCreativeToAds(call.utm_content, metaAds).filter((a) => adRef(a) !== null);
    if (byName.length) return { ...base, tier: 'utm_ad', ads: byName, via: 'utm_content → ad_name' };
  }

  // Tier 2 — the DID path. Still ad level, so it beats any campaign-level tier.
  const mapping = resolveDidMapping(call, didMappings);
  const creativeName = mapping?.creative_name ?? call.creative_name;
  if (creativeName) {
    const byCreative = matchCreativeToAds(creativeName, metaAds).filter((a) => adRef(a) !== null);
    if (byCreative.length && mapping) {
      return { ...base, tier: 'did_ad', ads: byCreative, mapping, via: 'DID → creative_name → ad' };
    }
    if (byCreative.length) {
      // A creative name on the call itself, with no DID mapping behind it. Same
      // precision as the DID path, so it is reported in the same tier.
      return { ...base, tier: 'did_ad', ads: byCreative, via: 'call creative_name → ad' };
    }
  }

  // Tier 3 — utm_campaign. CAMPAIGN level. Not an ad-level resolution.
  const campaign = matchCampaign(call.utm_campaign, metaAds);
  if (campaign) {
    return {
      ...base,
      tier: 'utm_campaign',
      campaignAds: campaign.ads,
      campaignRef: campaign.ref,
      mapping,
      via: `utm_campaign → ${campaign.via}`,
    };
  }

  // Tier 4 — vertical patterns.
  const vertical = matchVertical(call, verticals);
  if (vertical) return { ...base, tier: 'vertical', vertical, mapping, via: 'campaign-name pattern → vertical' };

  return { ...base, tier: 'none', mapping, via: null };
}

/**
 * Join calls to Meta entities: UTM tier, then DID → creative → ad, then
 * campaign-level UTM, then a vertical fallback. Never invents angle or audience
 * groupings from unparseable names.
 * @see docs/media-brain/03_Operating_Procedures.md §2
 */
export function joinCallsToMeta({ calls, didMappings, metaAds, verticals, window, revenue }: JoinInput): JoinResult {
  const rows = new Map<string, JoinedEntityRow>();
  const unjoinedCalls: { call_id: string; did: string | null }[] = [];
  /**
   * Every Meta row actually consumed by a joined entity, tracked by row identity
   * rather than by ad ref. Keying on the ref would suppress sibling period rows
   * of the same ad from `unjoinedSpend` even when their spend was dropped.
   */
  const consumedRows = new Set<MetaAdRow>();

  const resolutionCounts: Record<ResolutionTier, number> = {
    utm_ad: 0,
    did_ad: 0,
    utm_campaign: 0,
    vertical: 0,
    none: 0,
  };
  const viaSeen = new Set<string>();

  for (const call of calls) {
    const res = resolveCall(call, didMappings, metaAds, verticals);
    resolutionCounts[res.tier] += 1;
    if (res.via) viaSeen.add(res.via);

    let key: string;
    let row: JoinedEntityRow;

    if (res.tier === 'utm_ad' || res.tier === 'did_ad') {
      const primary = res.ads[0];
      const ref = adRef(primary)!;
      key = `ad:${ref}`;
      const existing = rows.get(key);
      if (existing) {
        row = existing;
      } else {
        // Sum spend, impressions and clicks across every row of this ad in the
        // window. CTR and frequency are derived downstream from these totals,
        // never by averaging per-row values.
        const siblings = res.ads.filter((a) => adRef(a) === ref);
        row = emptyRow({
          level: 'ad',
          resolution: res.tier,
          entity_ref: ref,
          entity_name: primary.ad_name ?? ref,
          campaign_name: primary.campaign_name,
          adset_name: primary.adset_name,
          platform_ad_id: primary.platform_ad_id,
          platform_adset_id: primary.platform_adset_id,
          platform_campaign_id: primary.platform_campaign_id,
          spend: siblings.reduce((s, a) => s + Number(a.spend ?? 0), 0),
          impressions: siblings.reduce((s, a) => s + Number(a.impressions ?? 0), 0),
          clicks: siblings.reduce((s, a) => s + Number(a.clicks ?? 0), 0),
        });
        for (const a of siblings) consumedRows.add(a);
      }
    } else if (res.tier === 'utm_campaign') {
      key = `campaign:${res.campaignRef}`;
      const existing = rows.get(key);
      if (existing) {
        row = existing;
      } else {
        const first = res.campaignAds[0];
        row = emptyRow({
          level: 'campaign',
          resolution: 'utm_campaign',
          entity_ref: res.campaignRef!,
          entity_name: first?.campaign_name ?? res.campaignRef!,
          campaign_name: first?.campaign_name ?? null,
          platform_campaign_id: first?.platform_campaign_id ?? null,
          spend: res.campaignAds.reduce((s, a) => s + Number(a.spend ?? 0), 0),
          impressions: res.campaignAds.reduce((s, a) => s + Number(a.impressions ?? 0), 0),
          clicks: res.campaignAds.reduce((s, a) => s + Number(a.clicks ?? 0), 0),
        });
        for (const a of res.campaignAds) consumedRows.add(a);
      }
    } else if (res.tier === 'vertical') {
      const vertical = res.vertical!;
      key = `vertical:${vertical.vertical_id}`;
      row =
        rows.get(key) ??
        emptyRow({
          level: 'vertical',
          resolution: 'vertical',
          entity_ref: vertical.vertical_id,
          entity_name: vertical.label ?? vertical.vertical_id,
          campaign_name: call.campaign_name,
        });
    } else {
      unjoinedCalls.push({ call_id: call.call_id, did: call.did });
      continue;
    }

    row.calls += 1;
    if (call.connected) row.connected_calls += 1;
    if (call.billable) row.billable_calls += 1;
    if (call.paid) row.paid_calls += 1;
    if (call.paid && !call.billable) row.paid_not_billable_calls += 1;
    row.revenue += call.payout_amount;
    row.revenueRows.push({
      payout_amount: call.payout_amount,
      duration_seconds: call.duration_seconds,
      billable: call.billable,
    });
    // Zeros are included deliberately: a no-bid is real data under RTB.
    row.payouts.push(call.payout_amount);
    if (typeof call.duration_seconds === 'number') row.durations.push(call.duration_seconds);
    row.call_ids.push(call.call_id);

    rows.set(key, row);
  }

  // Revenue is decided in the engine, once, per row — never by summing a payout
  // field that may carry telco cost, and never by believing a zero in a payout
  // field the platform does not expose to us.
  if (revenue) {
    for (const row of rows.values()) {
      const resolved = engine.resolveRevenue(revenue, row.revenueRows);
      row.revenueResolution = resolved;
      row.revenue = resolved.revenue ?? 0;
    }
  }

  // Vertical-level rows accumulate spend from every Meta campaign matching the
  // vertical's patterns, so cost per call is comparable to the calls in the row.
  for (const row of rows.values()) {
    if (row.level !== 'vertical') continue;
    const vertical = verticals.find((v) => v.vertical_id === row.entity_ref);
    if (!vertical) continue;
    for (const ad of metaAds) {
      if (consumedRows.has(ad)) continue;
      const name = norm(ad.campaign_name);
      const hit =
        !!name &&
        (vertical.meta_patterns ?? []).some((p) => {
          const np = norm(p);
          return !!np && name.includes(np);
        });
      if (!hit) continue;
      consumedRows.add(ad);
      row.spend += Number(ad.spend ?? 0);
      row.impressions += Number(ad.impressions ?? 0);
      row.clicks += Number(ad.clicks ?? 0);
    }
  }

  // Meta spend with no call records: a tracking flag, not a zero. These rows are
  // deliberately NOT emitted as entities with 0 calls. Rows are checked by
  // identity, so a sibling period row of a joined ad still surfaces here if its
  // spend was not consumed — and so does a row with no usable identifier.
  const unjoinedSpend = metaAds
    .filter((a) => !consumedRows.has(a) && Number(a.spend ?? 0) > 0)
    .map((a) => ({ entity: a.ad_name ?? a.campaign_name ?? 'Unnamed Meta entity', spend: Number(a.spend ?? 0) }));

  const adLevelCalls = resolutionCounts.utm_ad + resolutionCounts.did_ad;

  let joinLevel: JoinLevel = 'none';
  if (adLevelCalls > 0) joinLevel = 'ad';
  else if (resolutionCounts.utm_campaign > 0) joinLevel = 'campaign';
  else if (resolutionCounts.vertical > 0) joinLevel = 'vertical';

  const noteParts: string[] = [];
  if (resolutionCounts.utm_ad > 0) {
    noteParts.push(
      `${resolutionCounts.utm_ad} calls matched a Meta ad from the UTM tags on the call itself (utm_ad tier).`,
    );
  }
  if (resolutionCounts.did_ad > 0) {
    noteParts.push(
      `${resolutionCounts.did_ad} calls matched a Meta ad through their tracking number and creative name (did_ad tier).`,
    );
  }
  if (adLevelCalls > 0) {
    noteParts.push(
      'Reporting is at ad level for those calls only — the account\'s names carry no reliable angle or audience structure, so no angle groupings are inferred.',
    );
  }
  if (resolutionCounts.utm_campaign > 0) {
    noteParts.push(
      `${resolutionCounts.utm_campaign} calls resolved only to a Meta CAMPAIGN via utm_campaign. Those rows are campaign level and are excluded from ad-level verdicts — a campaign-level resolution is not an ad-level one.`,
    );
  }
  if (resolutionCounts.vertical > 0) {
    noteParts.push(
      `${resolutionCounts.vertical} calls had no ad-level or campaign-level key and were grouped at vertical level from campaign-name patterns. Vertical level is as fine as those names support.`,
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
  if (viaSeen.size) noteParts.push(`Keys used: ${[...viaSeen].join('; ')}.`);
  noteParts.push(`Window ${window.start} to ${window.end}.`);

  return {
    rows: [...rows.values()],
    unjoinedSpend,
    unjoinedCalls,
    joinLevel,
    joinNote: noteParts.join(' '),
    resolutionCounts,
    adLevelCalls,
  };
}
