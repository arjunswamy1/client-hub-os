import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { useClient } from "@/contexts/ClientContext";
import { format } from "date-fns";

function useDateStrings() {
  const { dateRange } = useDateRange();
  return {
    fromStr: format(dateRange.from, "yyyy-MM-dd"),
    toStr: format(dateRange.to, "yyyy-MM-dd"),
  };
}

/** Level 2: Ad Sets / Ad Groups for a campaign */
export function useCampaignAdSets(campaignName: string | null, platform: string) {
  const { fromStr, toStr } = useDateStrings();
  const { activeClient } = useClient();
  const clientId = activeClient?.id;

  return useQuery({
    queryKey: ["ad-sets", campaignName, platform, fromStr, toStr, clientId],
    enabled: !!clientId && !!campaignName,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_sets")
        .select("*")
        .eq("client_id", clientId!)
        .eq("campaign_name", campaignName!)
        .eq("platform", platform)
        .gte("date", fromStr)
        .lte("date", toStr);

      if (error) throw error;

      // Aggregate by adset_name
      const map = new Map<string, any>();
      for (const row of data || []) {
        const key = row.adset_name;
        const existing = map.get(key) || {
          adsetName: row.adset_name,
          platformAdsetId: row.platform_adset_id,
          status: row.status,
          spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0,
        };
        existing.spend += Number(row.spend);
        existing.revenue += Number(row.revenue);
        existing.impressions += Number(row.impressions);
        existing.clicks += Number(row.clicks);
        existing.conversions += Number(row.conversions);
        map.set(key, existing);
      }

      return Array.from(map.values())
        .map(v => ({
          ...v,
          spend: Math.round(v.spend),
          cpc: v.clicks > 0 ? Math.round((v.spend / v.clicks) * 100) / 100 : 0,
          ctr: v.impressions > 0 ? Math.round((v.clicks / v.impressions) * 10000) / 100 : 0,
        }))
        .sort((a, b) => b.spend - a.spend);
    },
  });
}

/** Level 3: Keywords for an ad group (Google only) */
export function useAdGroupKeywords(platformAdsetId: string | null) {
  const { activeClient } = useClient();
  const clientId = activeClient?.id;

  return useQuery({
    queryKey: ["keywords", platformAdsetId, clientId],
    enabled: !!clientId && !!platformAdsetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_keywords")
        .select("*")
        .eq("platform_adset_id", platformAdsetId!);

      if (error) throw error;

      return (data || []).map(row => ({
        keyword: row.keyword,
        matchType: row.match_type,
        qualityScore: row.quality_score,
        spend: Number(row.spend || 0),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        conversions: Number(row.conversions || 0),
        cpc: Number(row.cpc || 0),
        ctr: Number(row.ctr || 0),
        cpa: Number(row.cpa || 0),
        isNegative: row.is_negative,
        intent: row.intent,
        platformAdsetId: row.platform_adset_id,
      })).sort((a, b) => b.spend - a.spend);
    },
  });
}

/** Level 4: Search terms (filtered by keyword or all for ad group) */
export function useSearchTerms(platformAdsetId: string | null, keywordText?: string | null) {
  const { fromStr, toStr } = useDateStrings();
  const { activeClient } = useClient();
  const clientId = activeClient?.id;

  return useQuery({
    queryKey: ["search-terms", platformAdsetId, keywordText, fromStr, toStr, clientId],
    enabled: !!clientId && !!platformAdsetId,
    queryFn: async () => {
      let query = supabase
        .from("search_terms")
        .select("*")
        .eq("client_id", clientId!)
        .eq("platform_adset_id", platformAdsetId!)
        .gte("date", fromStr)
        .lte("date", toStr);

      if (keywordText) {
        query = query.eq("keyword_text", keywordText);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Aggregate by search_term
      const map = new Map<string, any>();
      for (const row of data || []) {
        const key = row.search_term;
        const existing = map.get(key) || {
          searchTerm: row.search_term, matchType: row.match_type,
          spend: 0, clicks: 0, impressions: 0, conversions: 0,
        };
        existing.spend += Number(row.spend);
        existing.clicks += Number(row.clicks);
        existing.impressions += Number(row.impressions);
        existing.conversions += Number(row.conversions);
        map.set(key, existing);
      }

      return Array.from(map.values())
        .map(v => ({
          ...v,
          spend: Math.round(v.spend * 100) / 100,
          cpc: v.clicks > 0 ? Math.round((v.spend / v.clicks) * 100) / 100 : 0,
          ctr: v.impressions > 0 ? Math.round((v.clicks / v.impressions) * 10000) / 100 : 0,
          cpa: v.conversions > 0 ? Math.round((v.spend / v.conversions) * 100) / 100 : 0,
        }))
        .sort((a, b) => b.spend - a.spend);
    },
  });
}

/** Ad creatives for an ad set (Meta drill-down) */
export function useAdSetAds(platformAdsetId: string | null) {
  const { activeClient } = useClient();
  const clientId = activeClient?.id;

  return useQuery({
    queryKey: ["adset-ads", platformAdsetId, clientId],
    enabled: !!clientId && !!platformAdsetId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_creatives")
        .select("*")
        .eq("client_id", clientId!)
        .eq("platform_adset_id", platformAdsetId!);

      if (error) throw error;

      return (data || []).map(row => ({
        adName: row.ad_name || "Unnamed",
        platformAdId: row.platform_ad_id,
        spend: Number(row.spend || 0),
        revenue: Number(row.revenue || 0),
        roas: Number(row.roas || 0),
        conversions: Number(row.conversions || 0),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        status: row.status,
        format: row.format || row.creative_type,
        thumbnailUrl: row.creative_thumbnail_url,
        headlines: row.headlines as string[] | null,
        headline: row.headline as string | null,
        descriptions: row.descriptions as string[] | null,
        description: row.description as string | null,
        primaryText: row.primary_text as string | null,
        finalUrl: row.final_url as string | null,
        displayUrl: row.display_url as string | null,
      })).sort((a, b) => b.spend - a.spend);
    },
  });
}
