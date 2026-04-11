import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { useClient } from "@/contexts/ClientContext";
import { useVertical } from "@/contexts/VerticalContext";
import { matchesVertical } from "@/config/billyVerticals";
import { format } from "date-fns";
import { useMemo } from "react";

export interface CreativeData {
  adName: string;
  platformAdId: string | null;
  campaignName: string;
  spend: number;
  revenue: number;
  roas: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpc: number;
  ctr: number;
  cpa: number;
  format: string;
  thumbnailUrl: string | null;
  frequency: number | null;
  videoViews3s: number;
  videoViews25: number;
  videoViews50: number;
  videoViews95: number;
}

/** Fetch all ad creatives for the vertical (Meta) */
export function useCreativePerformance() {
  const { dateRange } = useDateRange();
  const fromStr = format(dateRange.from, "yyyy-MM-dd");
  const toStr = format(dateRange.to, "yyyy-MM-dd");
  const { activeClient } = useClient();
  const { activeVertical } = useVertical();
  const clientId = activeClient?.id;
  const verticalId = activeVertical.id;

  return useQuery({
    queryKey: ["creative-performance", fromStr, toStr, clientId, verticalId],
    enabled: !!clientId,
    queryFn: async (): Promise<CreativeData[]> => {
      const { data, error } = await supabase
        .from("ad_creatives")
        .select("*")
        .eq("client_id", clientId!)
        .eq("platform", "meta");

      if (error) throw error;

      const filtered = verticalId === "all"
        ? (data || [])
        : (data || []).filter(row =>
            matchesVertical(row.campaign_name, activeVertical, "meta")
          );

      return filtered.map(row => {
        const spend = Number(row.spend || 0);
        const clicks = Number(row.clicks || 0);
        const impressions = Number(row.impressions || 0);
        const conversions = Number(row.conversions || 0);
        const revenue = Number(row.revenue || 0);

        return {
          adName: row.ad_name || "Unnamed",
          platformAdId: row.platform_ad_id,
          campaignName: row.campaign_name,
          spend,
          revenue,
          roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
          clicks,
          impressions,
          conversions,
          cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
          ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
          cpa: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : 0,
          format: (row as any).format || row.creative_type || "unknown",
          thumbnailUrl: row.creative_thumbnail_url,
          frequency: (row as any).frequency ? Number((row as any).frequency) : null,
          videoViews3s: Number((row as any).video_views_3s || 0),
          videoViews25: Number((row as any).video_views_25 || 0),
          videoViews50: Number((row as any).video_views_50 || 0),
          videoViews95: Number((row as any).video_views_95 || 0),
        };
      }).sort((a, b) => b.spend - a.spend);
    },
  });
}

/** Aggregate creatives by format */
export function useFormatComparison(creatives: CreativeData[] | undefined) {
  return useMemo(() => {
    if (!creatives || creatives.length === 0) return [];

    const map = new Map<string, { format: string; spend: number; revenue: number; clicks: number; impressions: number; conversions: number; count: number }>();

    for (const c of creatives) {
      const fmt = c.format.toLowerCase();
      const group = fmt.includes("video") ? "Video" : fmt.includes("carousel") ? "Carousel" : "Static";
      const existing = map.get(group) || { format: group, spend: 0, revenue: 0, clicks: 0, impressions: 0, conversions: 0, count: 0 };
      existing.spend += c.spend;
      existing.revenue += c.revenue;
      existing.clicks += c.clicks;
      existing.impressions += c.impressions;
      existing.conversions += c.conversions;
      existing.count++;
      map.set(group, existing);
    }

    return Array.from(map.values()).map(g => ({
      ...g,
      spend: Math.round(g.spend),
      revenue: Math.round(g.revenue),
      roas: g.spend > 0 ? Math.round((g.revenue / g.spend) * 100) / 100 : 0,
      avgCpc: g.clicks > 0 ? Math.round((g.spend / g.clicks) * 100) / 100 : 0,
      ctr: g.impressions > 0 ? Math.round((g.clicks / g.impressions) * 10000) / 100 : 0,
    })).sort((a, b) => b.spend - a.spend);
  }, [creatives]);
}

/** Flag ads with high frequency that may be fatiguing */
export function useFatigueAlerts(creatives: CreativeData[] | undefined) {
  return useMemo(() => {
    if (!creatives) return [];
    return creatives
      .filter(c => c.frequency !== null && c.frequency > 3.0)
      .sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
  }, [creatives]);
}
