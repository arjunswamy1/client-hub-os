import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { RRM_CLIENT_ID } from "@/hooks/useRRMData";

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
        thumbnailUrl: r.creative_thumbnail_url,
        format: r.creative_type,
        headline: r.headline,
        primaryText: r.primary_text,
      }));
    },
  });
}

export interface RRMConnection {
  platform: string;
  status: string;
  account_name: string | null;
  account_id: string | null;
  last_synced_at: string | null;
  last_sync_records: number | null;
  sync_error: string | null;
}

/** Google + Meta connection health for RRM */
export function useRRMConnections() {
  return useQuery({
    queryKey: ["rrm-connections"],
    queryFn: async (): Promise<RRMConnection[]> => {
      const { data, error } = await supabase
        .from("platform_connections")
        .select("platform, status, account_name, account_id, last_synced_at, last_sync_records, sync_error")
        .eq("client_id", RRM_CLIENT_ID)
        .in("platform", ["google", "meta"]);
      if (error) throw error;
      return (data || []) as RRMConnection[];
    },
    refetchInterval: 60 * 1000,
  });
}
