import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { RRM_CLIENT_ID, MojaCall } from "@/hooks/useRRMData";

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
   Google: utm_term = keyword text, utm_content = ad id
   Meta:   utm_term = ad id,        utm_content = ad/creative name
   ============================================================ */

export const normKey = (s: string | null | undefined) =>
  (s || "")
    .toLowerCase()
    .replace(/^[+"[\]]+|[+"[\]]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

export interface RRMAttribution {
  /** Calls exactly attributed to a Google keyword (null = no UTM coverage) */
  keywordCalls: (keyword: string) => MojaCall[] | null;
  /** Calls exactly attributed to a Meta creative by ad id or ad name */
  creativeCalls: (adId?: string | null, adName?: string | null) => MojaCall[] | null;
  /** Calls exactly attributed to an ad group / ad set, resolved from keyword & ad maps */
  adsetCalls: (platformAdsetId?: string | null) => MojaCall[] | null;
  /** Whether any call in range carries keyword/creative UTMs at all */
  hasUtmCoverage: boolean;
  /** Whether this campaign's calls carry UTMs (false => sub-rows should stay estimated) */
  campaignHasUtm: (campaignName: string) => boolean;
}

/** Builds keyword→ad group and ad id/name→ad set maps, then indexes Moja calls onto them. */
export function useRRMAttribution(platform: "google" | "meta", calls: MojaCall[]): RRMAttribution {
  const { fromStr, toStr } = useDateStrings();

  const { data: maps } = useQuery({
    queryKey: ["rrm-attribution-maps", platform, fromStr, toStr],
    queryFn: async () => {
      const keywordToAdset = new Map<string, string>();
      const adIdToAdset = new Map<string, string>();
      const adNameToAdset = new Map<string, string>();

      if (platform === "google") {
        const { data } = await supabase
          .from("campaign_keywords")
          .select("keyword, platform_adset_id")
          .eq("client_id", RRM_CLIENT_ID);
        for (const r of data || []) {
          if (r.keyword && r.platform_adset_id) keywordToAdset.set(normKey(r.keyword), r.platform_adset_id);
        }
      } else {
        const { data } = await supabase
          .from("ad_creatives")
          .select("ad_name, platform_ad_id, platform_adset_id")
          .eq("client_id", RRM_CLIENT_ID)
          .eq("platform", "meta");
        for (const r of data || []) {
          if (!r.platform_adset_id) continue;
          if (r.platform_ad_id) adIdToAdset.set(normKey(r.platform_ad_id), r.platform_adset_id);
          if (r.ad_name) adNameToAdset.set(normKey(r.ad_name), r.platform_adset_id);
        }
      }
      return { keywordToAdset, adIdToAdset, adNameToAdset };
    },
  });

  const byKeyword = new Map<string, MojaCall[]>();
  const byAdId = new Map<string, MojaCall[]>();
  const byAdName = new Map<string, MojaCall[]>();
  const byAdset = new Map<string, MojaCall[]>();
  const utmCampaigns = new Set<string>();
  let coverage = 0;

  const push = (m: Map<string, MojaCall[]>, k: string, c: MojaCall) => {
    if (!k) return;
    const arr = m.get(k);
    if (arr) arr.push(c);
    else m.set(k, [c]);
  };

  for (const c of calls) {
    const term = normKey(c.utm_term);
    const content = normKey(c.utm_content);
    if (!term && !content) continue;
    coverage++;
    utmCampaigns.add(normKey(c.campaign_name));
    utmCampaigns.add(normKey(c.utm_campaign));

    if (platform === "google") {
      push(byKeyword, term, c);
      push(byAdId, content, c);
      const adset = maps?.keywordToAdset.get(term);
      if (adset) push(byAdset, adset, c);
    } else {
      push(byAdId, term, c);
      push(byAdName, content, c);
      const adset = maps?.adIdToAdset.get(term) || maps?.adNameToAdset.get(content);
      if (adset) push(byAdset, adset, c);
    }
  }

  const hasUtmCoverage = coverage > 0;

  return {
    hasUtmCoverage,
    campaignHasUtm: (campaignName: string) => utmCampaigns.has(normKey(campaignName)),
    keywordCalls: (keyword) => (hasUtmCoverage ? byKeyword.get(normKey(keyword)) || [] : null),
    creativeCalls: (adId, adName) =>
      hasUtmCoverage ? byAdId.get(normKey(adId)) || byAdName.get(normKey(adName)) || [] : null,
    adsetCalls: (platformAdsetId) => {
      if (!hasUtmCoverage || !platformAdsetId) return null;
      return byAdset.get(platformAdsetId) || [];
    },
  };
}
