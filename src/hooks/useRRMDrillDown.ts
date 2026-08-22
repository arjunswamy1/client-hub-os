import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { RRM_CLIENT_ID, MojaCall, RRMLine, callLine } from "@/hooks/useRRMData";

function useDateStrings() {
  const { dateRange } = useDateRange();
  return {
    fromStr: format(dateRange.from, "yyyy-MM-dd"),
    toStr: format(dateRange.to, "yyyy-MM-dd"),
  };
}

export interface DrillRow {
  key: string;
  name: string;
  platformAdsetId?: string | null;
  status?: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  extra?: Record<string, any>;
}

function agg(rows: any[], nameOf: (r: any) => string, extraOf?: (r: any) => Record<string, any>): DrillRow[] {
  const map = new Map<string, DrillRow>();
  for (const r of rows) {
    const name = nameOf(r) || "—";
    const cur =
      map.get(name) ||
      ({
        key: name,
        name,
        platformAdsetId: r.platform_adset_id ?? null,
        status: r.status ?? null,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        extra: extraOf ? extraOf(r) : undefined,
      } as DrillRow);
    cur.spend += Number(r.spend || 0);
    cur.impressions += Number(r.impressions || 0);
    cur.clicks += Number(r.clicks || 0);
    cur.conversions += Number(r.conversions || 0);
    map.set(name, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
}

/** Level 2 — ad groups (Google) / ad sets (Meta) inside a campaign */
export function useRRMAdSets(campaignName: string | null, platform: "google" | "meta") {
  const { fromStr, toStr } = useDateStrings();
  return useQuery({
    queryKey: ["rrm-adsets", campaignName, platform, fromStr, toStr],
    enabled: !!campaignName,
    queryFn: async (): Promise<DrillRow[]> => {
      const { data, error } = await supabase
        .from("ad_sets")
        .select("adset_name, platform_adset_id, status, spend, impressions, clicks, conversions")
        .eq("client_id", RRM_CLIENT_ID)
        .eq("platform", platform)
        .eq("campaign_name", campaignName!)
        .gte("date", fromStr)
        .lte("date", toStr);
      if (error) throw error;
      return agg(data || [], (r) => r.adset_name);
    },
  });
}

/** Level 3 — keywords in a Google ad group */
export function useRRMKeywords(platformAdsetId: string | null) {
  const { fromStr, toStr } = useDateStrings();
  return useQuery({
    queryKey: ["rrm-keywords", platformAdsetId, fromStr, toStr],
    enabled: !!platformAdsetId,
    queryFn: async (): Promise<DrillRow[]> => {
      const { data, error } = await supabase
        .from("campaign_keywords")
        .select("keyword, match_type, quality_score, platform_adset_id, spend, impressions, clicks, conversions, date, is_negative")
        .eq("platform_adset_id", platformAdsetId!)
        .or(`date.is.null,and(date.gte.${fromStr},date.lte.${toStr})`);
      if (error) throw error;
      const rows = (data || []).filter((r: any) => !r.is_negative);
      return agg(rows, (r) => r.keyword, (r) => ({
        matchType: r.match_type,
        qualityScore: r.quality_score,
      }));
    },
  });
}

/** Level 4 — search terms for an ad group (optionally one keyword) */
export function useRRMSearchTerms(platformAdsetId: string | null, keyword?: string | null) {
  const { fromStr, toStr } = useDateStrings();
  return useQuery({
    queryKey: ["rrm-search-terms", platformAdsetId, keyword, fromStr, toStr],
    enabled: !!platformAdsetId,
    queryFn: async (): Promise<DrillRow[]> => {
      let q = supabase
        .from("search_terms")
        .select("search_term, keyword_text, match_type, spend, impressions, clicks, conversions")
        .eq("client_id", RRM_CLIENT_ID)
        .eq("platform_adset_id", platformAdsetId!)
        .gte("date", fromStr)
        .lte("date", toStr);
      if (keyword) q = q.eq("keyword_text", keyword);
      const { data, error } = await q;
      if (error) throw error;
      return agg(data || [], (r) => r.search_term, (r) => ({ matchType: r.match_type }));
    },
  });
}

/** Level 3 — creatives (ads) inside a Meta ad set */
export function useRRMCreatives(platformAdsetId: string | null) {
  return useQuery({
    queryKey: ["rrm-creatives", platformAdsetId],
    enabled: !!platformAdsetId,
    queryFn: async (): Promise<DrillRow[]> => {
      const { data, error } = await supabase
        .from("ad_creatives")
        .select("ad_name, platform_ad_id, platform_adset_id, status, creative_thumbnail_url, creative_type, headline, primary_text, spend, impressions, clicks, conversions")
        .eq("client_id", RRM_CLIENT_ID)
        .eq("platform", "meta")
        .eq("platform_adset_id", platformAdsetId!);
      if (error) throw error;
      return agg(data || [], (r) => r.ad_name || "Unnamed ad", (r) => ({
        platformAdId: r.platform_ad_id,
        thumbnailUrl: r.creative_thumbnail_url,
        format: r.creative_type,
        headline: r.headline,
        primaryText: r.primary_text,
      }));
    },
  });
}

export interface RRMAdAccount {
  id?: string | null;
  name?: string | null;
  account_id?: string | null;
}

export interface RRMConnection {
  id: string;
  platform: string;
  status: string;
  account_name: string | null;
  account_id: string | null;
  last_synced_at: string | null;
  last_sync_records: number | null;
  sync_error: string | null;
  selected_ad_account: RRMAdAccount | null;
  metadata: { ad_accounts?: RRMAdAccount[] } | null;
}

/** Google + Meta connection health for RRM */
export function useRRMConnections() {
  return useQuery({
    queryKey: ["rrm-connections"],
    queryFn: async (): Promise<RRMConnection[]> => {
      const { data, error } = await supabase
        .from("platform_connections")
        .select(
          "id, platform, status, account_name, account_id, last_synced_at, last_sync_records, sync_error, selected_ad_account, metadata"
        )
        .eq("client_id", RRM_CLIENT_ID)
        .in("platform", ["google", "meta"]);
      if (error) throw error;
      return (data || []) as unknown as RRMConnection[];
    },
    refetchInterval: 60 * 1000,
  });
}


/* ============================================================
   Exact call attribution via Moja UTMs
   Google: utm_term = keyword text,        utm_content = criterion/ad id
   Meta:   utm_term = ad id (unreliable),  utm_content = ad / creative name
   ============================================================ */

export const normKey = (s: string | null | undefined) =>
  (s || "")
    .toLowerCase()
    .replace(/^[+"[\]]+|[+"[\]]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

interface AdRef {
  campaign: string;
  adset: string | null;
}

export interface RRMAttributionIndex {
  /** Maps loaded — until then everything reads as unattributed. */
  ready: boolean;
  campaignCalls: (campaignName: string) => MojaCall[];
  adsetCalls: (platformAdsetId?: string | null) => MojaCall[];
  keywordCalls: (keyword: string) => MojaCall[];
  creativeCalls: (adId?: string | null, adName?: string | null) => MojaCall[];
  /** Calls in this line that carried no usable keyword/creative UTM. */
  unattributed: (line: RRMLine) => MojaCall[];
  attributedCount: number;
  totalCount: number;
}

/**
 * Indexes Moja calls onto Google keywords and Meta creatives using the UTMs Moja
 * records, then rolls those exact matches up to ad group / ad set / campaign.
 *
 * Moja's own `campaign_name` ("RRM INTERNAL - Plumbing") never equals the ad
 * platform campaign name, so campaign-level call counts are resolved through the
 * keyword/creative maps instead of a name match.
 */
export function useRRMCallAttribution(calls: MojaCall[]): RRMAttributionIndex {
  const { data: maps } = useQuery({
    queryKey: ["rrm-attribution-maps"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const byKeyword = new Map<string, AdRef>();
      const byAdName = new Map<string, AdRef>();
      const byAdId = new Map<string, AdRef>();

      const [kw, ads] = await Promise.all([
        supabase
          .from("campaign_keywords")
          .select("keyword, platform_adset_id, campaign_name")
          .eq("client_id", RRM_CLIENT_ID),
        supabase
          .from("ad_creatives")
          .select("ad_name, platform_ad_id, platform_adset_id, campaign_name")
          .eq("client_id", RRM_CLIENT_ID)
          .eq("platform", "meta"),
      ]);

      for (const r of kw.data || []) {
        if (!r.keyword || !r.campaign_name) continue;
        byKeyword.set(normKey(r.keyword), { campaign: r.campaign_name, adset: r.platform_adset_id ?? null });
      }
      for (const r of ads.data || []) {
        if (!r.campaign_name) continue;
        const ref: AdRef = { campaign: r.campaign_name, adset: r.platform_adset_id ?? null };
        if (r.ad_name) byAdName.set(normKey(r.ad_name), ref);
        if (r.platform_ad_id) byAdId.set(normKey(r.platform_ad_id), ref);
      }
      return { byKeyword, byAdName, byAdId };
    },
  });

  const ready = !!maps;

  const callsByKeyword = new Map<string, MojaCall[]>();
  const callsByAdName = new Map<string, MojaCall[]>();
  const callsByAdId = new Map<string, MojaCall[]>();
  const callsByAdset = new Map<string, MojaCall[]>();
  const callsByCampaign = new Map<string, MojaCall[]>();
  const loose: Record<RRMLine, MojaCall[]> = { windows: [], plumbing: [] };
  let attributedCount = 0;

  const push = (m: Map<string, MojaCall[]>, k: string | null | undefined, c: MojaCall) => {
    if (!k) return;
    const arr = m.get(k);
    if (arr) arr.push(c);
    else m.set(k, [c]);
  };

  for (const c of calls) {
    const line = callLine(c);
    const term = normKey(c.utm_term);
    const content = normKey(c.utm_content);
    // Channel follows the service line: Plumbing = Google, Windows = Meta.
    const isGoogle = platformOfLine(line) === "google";

    let ref: AdRef | undefined;
    if (ready) {
      if (isGoogle) {
        ref = maps!.byKeyword.get(term);
        if (ref) push(callsByKeyword, term, c);
      } else {
        // Meta ad ids in the landing URL don't always survive the macro, so the
        // ad name from utm_content is the reliable join.
        ref = maps!.byAdName.get(content) || maps!.byAdId.get(term);
        if (maps!.byAdName.has(content)) push(callsByAdName, content, c);
        if (maps!.byAdId.has(term)) push(callsByAdId, term, c);
      }
    }

    if (ref) {
      attributedCount++;
      push(callsByCampaign, normKey(ref.campaign), c);
      if (ref.adset) push(callsByAdset, ref.adset, c);
    } else {
      loose[line].push(c);
    }
  }

  return {
    ready,
    attributedCount,
    totalCount: calls.length,
    campaignCalls: (name) => callsByCampaign.get(normKey(name)) || [],
    adsetCalls: (id) => (id ? callsByAdset.get(id) || [] : []),
    keywordCalls: (keyword) => callsByKeyword.get(normKey(keyword)) || [],
    creativeCalls: (adId, adName) =>
      callsByAdName.get(normKey(adName)) || callsByAdId.get(normKey(adId)) || [],
    unattributed: (line) => loose[line],
  };
}

