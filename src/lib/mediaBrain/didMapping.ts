/**
 * Media Brain — DID mapping helpers (the remedy for the join blocker).
 *
 * `client_dids` is empty for every client with live data, so the join's primary
 * path (DID → `client_dids` → `creative_name` → `ad_creatives`) resolves nothing.
 * This module holds the PURE logic behind the mapping screen: which column each
 * call table keeps its tracking number in, coverage counting, suggestion ranking
 * and reuse detection.
 *
 * The call tables and every Meta sync table are READ-ONLY. Nothing here writes.
 * The screen writes only to `client_dids` and `client_did_periods`.
 *
 * @see docs/media-brain/03_Operating_Procedures.md §2
 */

import type { DidMapping, MetaAdRow, VerticalRow } from './join';
import { matchCreativeToAds, matchVertical, resolveDidMapping } from './join';

/* ------------------------------------------------------------------ *
 * Where each call table keeps its DID, and what else is on the row.
 * ------------------------------------------------------------------ */

export interface CallSourceSpec {
  platform: string;
  table: string;
  dateColumn: string;
  /** The column that should hold the TRACKING number (the DID). */
  didColumn: string;
  /** The caller's own number, used to detect a DID column filled with ANIs. */
  callerColumn: string | null;
  payoutColumn: string;
  campaignColumn: string | null;
  creativeColumn: string | null;
  targetColumn: string | null;
  idColumn: string;
}

/** Every call source, keyed by the `tracking_platform` on the economics record. */
export const CALL_SOURCES: Record<string, CallSourceSpec> = {
  ringba: {
    platform: 'ringba',
    table: 'ringba_calls',
    dateColumn: 'call_date',
    didColumn: 'inbound_number',
    callerColumn: 'caller_number',
    payoutColumn: 'payout',
    campaignColumn: 'campaign_name',
    creativeColumn: null,
    targetColumn: 'target_name',
    idColumn: 'call_id',
  },
  ringba_4js: {
    platform: 'ringba_4js',
    table: 'ringba_calls_4js',
    dateColumn: 'call_start',
    didColumn: 'did',
    callerColumn: 'caller_number',
    payoutColumn: 'payout',
    campaignColumn: 'campaign_name',
    creativeColumn: 'creative_name',
    targetColumn: 'target_name',
    idColumn: 'ringba_call_id',
  },
  ringfuel: {
    platform: 'ringfuel',
    table: 'ringfuel_calls',
    dateColumn: 'call_start',
    didColumn: 'did',
    callerColumn: 'caller_number',
    payoutColumn: 'payout',
    campaignColumn: 'campaign_name',
    creativeColumn: 'creative_label',
    targetColumn: 'target_name',
    idColumn: 'call_id',
  },
  moja: {
    platform: 'moja',
    table: 'moja_calls',
    dateColumn: 'call_start',
    didColumn: 'tracking_number',
    callerColumn: 'caller_number',
    payoutColumn: 'payout',
    campaignColumn: 'campaign_name',
    creativeColumn: null,
    targetColumn: 'target_name',
    idColumn: 'call_id',
  },
  cannaball: {
    platform: 'cannaball',
    table: 'cannaball_calls',
    dateColumn: 'call_start',
    didColumn: 'did',
    callerColumn: 'caller_number',
    payoutColumn: 'payout',
    campaignColumn: 'campaign_name',
    creativeColumn: 'creative_name',
    targetColumn: null,
    idColumn: 'call_id',
  },
};

/** `tracking_platform` values that point at a shared table. */
export const PLATFORM_ALIASES: Record<string, string> = { jacuzzi: 'ringfuel' };

export function sourceForPlatform(platform: string | null | undefined): CallSourceSpec | null {
  if (!platform) return null;
  const key = PLATFORM_ALIASES[platform] ?? platform;
  return CALL_SOURCES[key] ?? null;
}

/* ------------------------------------------------------------------ *
 * Normalisation — identical rules to the join, so coverage cannot drift.
 * ------------------------------------------------------------------ */

export const normName = (v: string | null | undefined): string | null => {
  const n = (v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return n === '' ? null : n;
};

export const digitsOnly = (v: string | null | undefined) =>
  (v ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

/** A call reduced to only what the DID screen and the join need. */
export interface MappingCall {
  call_id: string;
  timestamp: string;
  did: string | null;
  caller_number: string | null;
  campaign_name: string | null;
  creative_name: string | null;
  target_name: string | null;
  payout_amount: number;
}

/** Read raw rows from a call table into the shape this screen works in. */
export function toMappingCalls(rows: Record<string, unknown>[], spec: CallSourceSpec): MappingCall[] {
  const s = (v: unknown) => {
    if (v === null || v === undefined) return null;
    const t = String(v).trim();
    return t.length ? t : null;
  };
  return rows.map((r, i) => ({
    call_id: s(r[spec.idColumn]) ?? `${spec.table}-${i}`,
    timestamp: s(r[spec.dateColumn]) ?? new Date(0).toISOString(),
    did: s(r[spec.didColumn]),
    caller_number: spec.callerColumn ? s(r[spec.callerColumn]) : null,
    campaign_name: spec.campaignColumn ? s(r[spec.campaignColumn]) : null,
    creative_name: spec.creativeColumn ? s(r[spec.creativeColumn]) : null,
    target_name: spec.targetColumn ? s(r[spec.targetColumn]) : null,
    payout_amount: Number(r[spec.payoutColumn] ?? 0) || 0,
  }));
}

/* ------------------------------------------------------------------ *
 * Coverage — the point of the screen.
 * ------------------------------------------------------------------ */

export type CoverageBucket = 'real_path' | 'vertical_fallback' | 'unresolved';

export interface CoverageResult {
  totalCalls: number;
  realPath: number;
  verticalFallback: number;
  unresolved: number;
  realPathPct: number | null;
  verticalFallbackPct: number | null;
  unresolvedPct: number | null;
  /** §Pilot readiness: the real path must carry at least this share. */
  threshold: number;
  ready: boolean;
  perCall: Record<string, CoverageBucket>;
}

export const COVERAGE_THRESHOLD = 0.8;

/**
 * Count calls by how they resolve, using the SAME functions the join uses:
 * `resolveDidMapping` → `matchCreativeToAds` is the real path; `matchVertical`
 * is the fallback; anything else is unresolved. An empty pull is not coverage —
 * `totalCalls` 0 leaves every percentage null rather than reading as 0%.
 */
export function computeCoverage(
  calls: MappingCall[],
  didMappings: DidMapping[],
  metaAds: MetaAdRow[],
  verticals: VerticalRow[],
): CoverageResult {
  const perCall: Record<string, CoverageBucket> = {};
  let realPath = 0;
  let verticalFallback = 0;
  let unresolved = 0;

  for (const call of calls) {
    // resolveDidMapping / matchVertical read only did, timestamp, campaign_name.
    const asCanonical = call as unknown as Parameters<typeof resolveDidMapping>[0];
    const mapping = resolveDidMapping(asCanonical, didMappings);
    const creativeName = mapping?.creative_name ?? call.creative_name;
    const matched = creativeName ? matchCreativeToAds(creativeName, metaAds) : [];
    const identified = matched.filter((a) => a.platform_ad_id ?? normName(a.ad_name));

    let bucket: CoverageBucket;
    if (mapping && identified.length > 0) bucket = 'real_path';
    else if (matchVertical(asCanonical, verticals)) bucket = 'vertical_fallback';
    else bucket = 'unresolved';

    perCall[call.call_id] = bucket;
    if (bucket === 'real_path') realPath++;
    else if (bucket === 'vertical_fallback') verticalFallback++;
    else unresolved++;
  }

  const total = calls.length;
  const pct = (n: number) => (total === 0 ? null : n / total);
  const realPct = pct(realPath);
  return {
    totalCalls: total,
    realPath,
    verticalFallback,
    unresolved,
    realPathPct: realPct,
    verticalFallbackPct: pct(verticalFallback),
    unresolvedPct: pct(unresolved),
    threshold: COVERAGE_THRESHOLD,
    ready: realPct !== null && realPct >= COVERAGE_THRESHOLD,
    perCall,
  };
}

/* ------------------------------------------------------------------ *
 * The unmapped-DID list, ordered by what fixing it buys.
 * ------------------------------------------------------------------ */

export interface DidStat {
  did: string;
  digits: string;
  calls: number;
  paidCalls: number;
  firstCall: string;
  lastCall: string;
  campaigns: string[];
  creatives: string[];
  targets: string[];
  mapped: boolean;
  /** True when this DID's value equals the caller's number on most of its calls. */
  looksLikeCallerNumber: boolean;
}

export function aggregateDids(calls: MappingCall[], didMappings: DidMapping[]): DidStat[] {
  const mappedDigits = new Set(
    didMappings.flatMap((m) => [digitsOnly(m.did), digitsOnly(m.did_formatted)]).filter(Boolean),
  );
  const byDid = new Map<string, MappingCall[]>();
  for (const c of calls) {
    const d = digitsOnly(c.did);
    if (!d) continue;
    const list = byDid.get(d);
    if (list) list.push(c);
    else byDid.set(d, [c]);
  }
  const out: DidStat[] = [];
  for (const [d, list] of byDid) {
    const uniq = (vals: (string | null)[]) => Array.from(new Set(vals.filter((v): v is string => !!v)));
    const sameAsCaller = list.filter((c) => digitsOnly(c.caller_number) === d).length;
    out.push({
      did: list[0].did ?? d,
      digits: d,
      calls: list.length,
      paidCalls: list.filter((c) => c.payout_amount > 0).length,
      firstCall: list.reduce((a, c) => (c.timestamp < a ? c.timestamp : a), list[0].timestamp),
      lastCall: list.reduce((a, c) => (c.timestamp > a ? c.timestamp : a), list[0].timestamp),
      campaigns: uniq(list.map((c) => c.campaign_name)),
      creatives: uniq(list.map((c) => c.creative_name)),
      targets: uniq(list.map((c) => c.target_name)),
      mapped: mappedDigits.has(d),
      looksLikeCallerNumber: list.length > 0 && sameAsCaller / list.length >= 0.9,
    });
  }
  return out.sort((a, b) => b.calls - a.calls || b.paidCalls - a.paidCalls);
}

/**
 * When a DID column holds the CALLER's number rather than the tracking number,
 * no mapping can fix the join — the DID is simply not in the data. Named, not
 * substituted (§3).
 */
export function callerNumberDiagnosis(stats: DidStat[]): { affected: number; share: number | null } {
  const totalCalls = stats.reduce((a, s) => a + s.calls, 0);
  const affected = stats.filter((s) => s.looksLikeCallerNumber).reduce((a, s) => a + s.calls, 0);
  return { affected, share: totalCalls === 0 ? null : affected / totalCalls };
}

/* ------------------------------------------------------------------ *
 * Suggestions — proposals with a visible confidence, never auto-applied.
 * ------------------------------------------------------------------ */

export type MatchQuality = 'exact' | 'strong' | 'loose';

export interface Suggestion {
  creativeName: string;
  adName: string | null;
  platformAdId: string | null;
  campaignName: string | null;
  quality: MatchQuality;
  /** What on the call matched, in plain words. */
  matchedOn: string;
  score: number;
}

/**
 * Rank candidate creatives for one DID by matching the campaign/creative/target
 * strings seen on its calls against `ad_creatives`.
 *
 *  exact  — a creative string on the call equals a Meta ad name outright
 *  strong — one contains the other, and the call's campaign also matches the ad's
 *  loose  — a bare substring overlap, or a campaign-name-only match
 *
 * A wrong mapping silently misattributes every call on the number, so `loose`
 * is never bulk-acceptable and must render differently from `exact`.
 */
export function suggestCreatives(stat: DidStat, metaAds: MetaAdRow[], limit = 4): Suggestion[] {
  const out = new Map<string, Suggestion>();
  const callStrings = [
    ...stat.creatives.map((v) => ({ v, label: 'creative name on the call' })),
    ...stat.campaigns.map((v) => ({ v, label: 'campaign name on the call' })),
    ...stat.targets.map((v) => ({ v, label: 'buyer/target name on the call' })),
  ];
  const campaignKeys = stat.campaigns.map(normName).filter((v): v is string => !!v);

  for (const ad of metaAds) {
    const adName = ad.ad_name ?? ad.creative_name ?? null;
    const adKey = normName(adName);
    if (!adKey || !adName) continue;
    const adCampaignKey = normName(ad.campaign_name);
    const campaignAgrees = !!adCampaignKey && campaignKeys.some((k) => adCampaignKey.includes(k) || k.includes(adCampaignKey));

    let best: Suggestion | null = null;
    for (const { v, label } of callStrings) {
      const key = normName(v);
      if (!key) continue;
      let quality: MatchQuality | null = null;
      if (key === adKey) quality = 'exact';
      else if (adKey.includes(key) || key.includes(adKey)) quality = campaignAgrees ? 'strong' : 'loose';
      else if (campaignAgrees) quality = 'loose';
      if (!quality) continue;
      const score = quality === 'exact' ? 100 : quality === 'strong' ? 60 : 25;
      if (!best || score > best.score) {
        best = {
          creativeName: adName,
          adName,
          platformAdId: ad.platform_ad_id ?? null,
          campaignName: ad.campaign_name ?? null,
          quality,
          matchedOn: quality === 'loose' && key !== adKey && !adKey.includes(key) && !key.includes(adKey)
            ? 'campaign name only — no creative-name overlap'
            : `${label}: "${v}"`,
          score,
        };
      }
    }
    if (!best) continue;
    const prior = out.get(best.creativeName);
    if (!prior || best.score > prior.score) out.set(best.creativeName, best);
  }

  return Array.from(out.values())
    .sort((a, b) => b.score - a.score || a.creativeName.localeCompare(b.creativeName))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ *
 * Reverse view — Meta ads no DID maps to, plus naming-convention misses.
 * ------------------------------------------------------------------ */

export interface UnmappedAd {
  adName: string;
  platformAdId: string | null;
  campaignName: string | null;
  adsetName: string | null;
  spend: number;
  matchesNamingConvention: boolean | null;
}

/**
 * Meta ads that no `client_dids` / `client_did_periods` row resolves to. These are
 * the same population that surfaces in `unjoinedSpend` as a tracking flag.
 * `matchesNamingConvention` is null when no convention is recorded — an unknown
 * blocks the check rather than passing it.
 */
export function unmappedMetaAds(
  metaAds: MetaAdRow[],
  didMappings: DidMapping[],
  namingConvention: string | null,
): UnmappedAd[] {
  const mappedAdKeys = new Set<string>();
  for (const m of didMappings) {
    for (const ad of matchCreativeToAds(m.creative_name, metaAds)) {
      const k = ad.platform_ad_id ?? normName(ad.ad_name);
      if (k) mappedAdKeys.add(k);
    }
  }
  const byAd = new Map<string, UnmappedAd>();
  for (const ad of metaAds) {
    const adName = ad.ad_name ?? ad.creative_name;
    const key = ad.platform_ad_id ?? normName(adName);
    if (!key || !adName) continue;
    if (mappedAdKeys.has(key)) continue;
    const prior = byAd.get(key);
    if (prior) {
      prior.spend += ad.spend ?? 0;
      continue;
    }
    byAd.set(key, {
      adName,
      platformAdId: ad.platform_ad_id ?? null,
      campaignName: ad.campaign_name ?? null,
      adsetName: ad.adset_name ?? null,
      spend: ad.spend ?? 0,
      matchesNamingConvention: matchesConvention(adName, namingConvention),
    });
  }
  return Array.from(byAd.values()).sort((a, b) => b.spend - a.spend);
}

/**
 * Test a name against the parsing rule stored on
 * `media_brain_instances.naming_convention`. The convention is written with
 * `{token}` placeholders separated by a literal delimiter, e.g.
 * `{angle} | {audience} | {length}`. Returns null when no convention is stored —
 * an unrecorded rule cannot pass or fail anything.
 */
export function matchesConvention(name: string, convention: string | null | undefined): boolean | null {
  const c = (convention ?? '').trim();
  if (!c) return null;
  const tokens = c.match(/\{[^}]+\}/g) ?? [];
  if (tokens.length < 2) return null;
  const delimiter = c.includes('|') ? '|' : c.includes('_') ? '_' : c.includes('-') ? '-' : null;
  if (!delimiter) return null;
  return name.split(delimiter).filter((p) => p.trim().length > 0).length >= tokens.length;
}

/* ------------------------------------------------------------------ *
 * Historical reuse — one `client_dids` row would be wrong.
 * ------------------------------------------------------------------ */

export interface ReuseSegment {
  label: string;
  firstCall: string;
  lastCall: string;
  calls: number;
}

export interface ReuseFinding {
  did: string;
  digits: string;
  /** 'creative_name' or 'campaign_name' — which field changed over time. */
  field: 'creative_name' | 'campaign_name';
  segments: ReuseSegment[];
  /** True when the segments barely overlap in time — a clean split. */
  cleanSplit: boolean;
}

/**
 * Detect a DID reused across creatives over time. Boundaries are NEVER guessed:
 * this returns the timeline only, and the user sets the dates on the
 * `client_did_periods` rows.
 */
export function detectReuse(calls: MappingCall[]): ReuseFinding[] {
  const byDid = new Map<string, MappingCall[]>();
  for (const c of calls) {
    const d = digitsOnly(c.did);
    if (!d) continue;
    (byDid.get(d) ?? byDid.set(d, []).get(d)!).push(c);
  }

  const findings: ReuseFinding[] = [];
  for (const [d, list] of byDid) {
    for (const field of ['creative_name', 'campaign_name'] as const) {
      const groups = new Map<string, MappingCall[]>();
      for (const c of list) {
        const v = field === 'creative_name' ? c.creative_name : c.campaign_name;
        if (!v) continue;
        (groups.get(v) ?? groups.set(v, []).get(v)!).push(c);
      }
      if (groups.size < 2) continue;
      const segments: ReuseSegment[] = Array.from(groups.entries())
        .map(([label, rows]) => ({
          label,
          calls: rows.length,
          firstCall: rows.reduce((a, r) => (r.timestamp < a ? r.timestamp : a), rows[0].timestamp),
          lastCall: rows.reduce((a, r) => (r.timestamp > a ? r.timestamp : a), rows[0].timestamp),
        }))
        .sort((a, b) => a.firstCall.localeCompare(b.firstCall));

      // "Clean split" = each segment starts after the previous one ended.
      const cleanSplit = segments.every((s, i) => i === 0 || s.firstCall >= segments[i - 1].lastCall);
      findings.push({ did: list[0].did ?? d, digits: d, field, segments, cleanSplit });
      break; // one finding per DID; creative_name is the more specific signal
    }
  }
  return findings.sort(
    (a, b) =>
      Number(b.cleanSplit) - Number(a.cleanSplit) ||
      b.segments.reduce((x, s) => x + s.calls, 0) - a.segments.reduce((x, s) => x + s.calls, 0),
  );
}
