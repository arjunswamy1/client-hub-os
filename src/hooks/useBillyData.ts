import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { useClient } from "@/contexts/ClientContext";
import { useVertical } from "@/contexts/VerticalContext";
import { matchesVertical } from "@/config/billyVerticals";
import { format, differenceInDays, subDays } from "date-fns";
import type { CampaignRow } from "@/hooks/useAdData";

function useDateStrings() {
  const { dateRange } = useDateRange();
  const fromStr = format(dateRange.from, "yyyy-MM-dd");
  const toStr = format(dateRange.to, "yyyy-MM-dd");
  const days = differenceInDays(dateRange.to, dateRange.from) + 1;
  const prevFrom = format(subDays(dateRange.from, days), "yyyy-MM-dd");
  const prevTo = format(subDays(dateRange.from, 1), "yyyy-MM-dd");
  return { fromStr, toStr, prevFrom, prevTo };
}

/** Fetch campaigns filtered by the active vertical's patterns */
export function useVerticalCampaigns(platform?: "meta" | "google") {
  const { fromStr, toStr } = useDateStrings();
  const { activeClient } = useClient();
  const { activeVertical } = useVertical();
  const clientId = activeClient?.id;
  const verticalId = activeVertical.id;

  return useQuery({
    queryKey: ["billy-campaigns", fromStr, toStr, clientId, platform, verticalId],
    enabled: !!clientId,
    queryFn: async (): Promise<CampaignRow[]> => {
      let query = supabase
        .from("ad_campaigns")
        .select("campaign_name, platform, spend, revenue, roas, status, impressions, clicks, conversions, impression_share, bidding_strategy_type, campaign_type, daily_budget")
        .eq("client_id", clientId!)
        .gte("date", fromStr)
        .lte("date", toStr);

      if (platform) query = query.eq("platform", platform);

      const { data, error } = await query;
      if (error) throw error;
      if (!data) return [];

      // Filter by vertical patterns client-side
      const filtered = verticalId === "all"
        ? data
        : data.filter((row) => {
            const p = (row.platform as "meta" | "google") || "meta";
            return matchesVertical(row.campaign_name, activeVertical, p);
          });

      // Only show active campaigns for Billy
      const activeCampaigns = filtered.filter(
        (row) => row.status === "active" || row.status === "enabled"
      );

      // Aggregate by campaign name
      const byCampaign = new Map<string, any>();
      for (const row of activeCampaigns) {
        const existing = byCampaign.get(row.campaign_name) || {
          platform: row.platform, spend: 0, revenue: 0, status: row.status || "unknown",
          impressions: 0, clicks: 0, conversions: 0,
          impressionShareSum: 0, impressionShareCount: 0,
          biddingStrategy: row.bidding_strategy_type, campaignType: row.campaign_type,
          dailyBudget: row.daily_budget != null ? Number(row.daily_budget) : null,
        };
        existing.spend += Number(row.spend);
        existing.revenue += Number(row.revenue);
        existing.impressions += Number(row.impressions);
        existing.clicks += Number(row.clicks);
        existing.conversions += Number(row.conversions);
        if (row.impression_share != null) {
          existing.impressionShareSum += Number(row.impression_share);
          existing.impressionShareCount++;
        }
        byCampaign.set(row.campaign_name, existing);
      }

      const channelMap: Record<string, string> = { meta: "Meta", google: "Google" };

      return Array.from(byCampaign.entries())
        .map(([name, vals]) => ({
          name,
          channel: channelMap[vals.platform] || vals.platform,
          platform: vals.platform,
          spend: Math.round(vals.spend),
          revenue: Math.round(vals.revenue),
          roas: vals.spend > 0 ? Math.round((vals.revenue / vals.spend) * 100) / 100 : 0,
          status: vals.status,
          impressions: vals.impressions,
          clicks: vals.clicks,
          conversions: vals.conversions,
          impressionShare: vals.impressionShareCount > 0 ? vals.impressionShareSum / vals.impressionShareCount : null,
          biddingStrategy: vals.biddingStrategy,
          campaignType: vals.campaignType,
          dailyBudget: vals.dailyBudget,
        }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 20);
    },
  });
}

/** KPIs filtered by vertical (aggregates from campaign-level data) */
export function useVerticalKPIs(platform?: "meta" | "google") {
  const { fromStr, toStr, prevFrom, prevTo } = useDateStrings();
  const { activeClient } = useClient();
  const { activeVertical } = useVertical();
  const clientId = activeClient?.id;
  const verticalId = activeVertical.id;

  return useQuery({
    queryKey: ["billy-kpis", fromStr, toStr, clientId, platform, verticalId],
    enabled: !!clientId,
    queryFn: async () => {
      async function fetchFiltered(from: string, to: string) {
        let query = supabase
          .from("ad_campaigns")
          .select("campaign_name, platform, spend, revenue, impressions, clicks, conversions")
          .eq("client_id", clientId!)
          .gte("date", from)
          .lte("date", to);

        if (platform) query = query.eq("platform", platform);

        const { data, error } = await query;
        if (error) throw error;

        const filtered = verticalId === "all"
          ? (data || [])
          : (data || []).filter((row) => {
              const p = (row.platform as "meta" | "google") || "meta";
              return matchesVertical(row.campaign_name, activeVertical, p);
            });

        let spend = 0, revenue = 0, clicks = 0, impressions = 0, conversions = 0;
        for (const row of filtered) {
          spend += Number(row.spend);
          revenue += Number(row.revenue);
          clicks += Number(row.clicks);
          impressions += Number(row.impressions);
          conversions += Number(row.conversions);
        }

        return { spend: Math.round(spend), revenue: Math.round(revenue), clicks, impressions, conversions };
      }

      const [cur, prev] = await Promise.all([
        fetchFiltered(fromStr, toStr),
        fetchFiltered(prevFrom, prevTo),
      ]);

      const pctChange = (c: number, p: number) => {
        if (p === 0) return c > 0 ? 100 : null;
        return Math.round(((c - p) / p) * 1000) / 10;
      };

      const curCAC = cur.conversions > 0 ? Math.round((cur.spend / cur.conversions) * 100) / 100 : 0;
      const prevCAC = prev.conversions > 0 ? Math.round((prev.spend / prev.conversions) * 100) / 100 : 0;
      const curCPC = cur.clicks > 0 ? Math.round((cur.spend / cur.clicks) * 100) / 100 : 0;
      const prevCPC = prev.clicks > 0 ? Math.round((prev.spend / prev.clicks) * 100) / 100 : 0;
      const curCTR = cur.impressions > 0 ? Math.round((cur.clicks / cur.impressions) * 10000) / 100 : 0;
      const prevCTR = prev.impressions > 0 ? Math.round((prev.clicks / prev.impressions) * 10000) / 100 : 0;

      return {
        spend: cur.spend,
        revenue: cur.revenue,
        conversions: cur.conversions,
        clicks: cur.clicks,
        impressions: cur.impressions,
        cac: curCAC,
        cpc: curCPC,
        ctr: curCTR,
        roas: cur.spend > 0 ? Math.round((cur.revenue / cur.spend) * 100) / 100 : 0,
        changes: {
          spend: pctChange(cur.spend, prev.spend),
          revenue: pctChange(cur.revenue, prev.revenue),
          conversions: pctChange(cur.conversions, prev.conversions),
          cac: pctChange(curCAC, prevCAC),
          cpc: pctChange(curCPC, prevCPC),
          ctr: pctChange(curCTR, prevCTR),
        },
      };
    },
  });
}

/** Daily spend vs revenue for the active vertical */
export function useVerticalDailyTrends() {
  const { fromStr, toStr } = useDateStrings();
  const { activeClient } = useClient();
  const { activeVertical } = useVertical();
  const clientId = activeClient?.id;
  const verticalId = activeVertical.id;

  return useQuery({
    queryKey: ["billy-daily-trends", fromStr, toStr, clientId, verticalId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_campaigns")
        .select("date, campaign_name, platform, spend, revenue, conversions")
        .eq("client_id", clientId!)
        .gte("date", fromStr)
        .lte("date", toStr)
        .order("date", { ascending: true });

      if (error) throw error;

      const filtered = verticalId === "all"
        ? (data || [])
        : (data || []).filter((row) => {
            const p = (row.platform as "meta" | "google") || "meta";
            return matchesVertical(row.campaign_name, activeVertical, p);
          });

      const byDate = new Map<string, { spend: number; revenue: number; conversions: number }>();
      for (const row of filtered) {
        const existing = byDate.get(row.date) || { spend: 0, revenue: 0, conversions: 0 };
        existing.spend += Number(row.spend);
        existing.revenue += Number(row.revenue);
        existing.conversions += Number(row.conversions);
        byDate.set(row.date, existing);
      }

      return Array.from(byDate.entries()).map(([date, vals]) => ({
        date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        spend: Math.round(vals.spend),
        revenue: Math.round(vals.revenue),
        conversions: vals.conversions,
      }));
    },
  });
}
