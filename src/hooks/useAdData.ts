import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { useClient } from "@/contexts/ClientContext";
import { format, differenceInDays, subDays } from "date-fns";

export interface KPIData {
  totalSpend: number;
  totalRevenue: number;
  blendedROAS: number;
  totalConversions: number;
  clicks: number;
  cpc: number;
  ctr: number;
  cpm: number;
  impressions: number;
}

export interface KPIWithChange extends KPIData {
  changes: {
    spend: number | null;
    revenue: number | null;
    roas: number | null;
    conversions: number | null;
    cpc: number | null;
    ctr: number | null;
    cpm: number | null;
    impressions: number | null;
  };
}

export interface DailyMetric {
  date: string;
  metaSpend: number;
  googleSpend: number;
  revenue: number;
}

export interface ChannelSummary {
  channel: string;
  spend: number;
  revenue: number;
  roas: number;
  conversions: number;
  ctr: number;
  color: "meta" | "google";
}

export interface CampaignRow {
  name: string;
  channel: string;
  platform: string;
  spend: number;
  revenue: number;
  roas: number;
  status: string;
  impressions: number;
  clicks: number;
  conversions: number;
  impressionShare: number | null;
  biddingStrategy: string | null;
  campaignType: string | null;
  dailyBudget: number | null;
}

function calcKPIs(data: any[]): KPIData {
  if (!data || data.length === 0) {
    return { totalSpend: 0, totalRevenue: 0, blendedROAS: 0, totalConversions: 0, clicks: 0, cpc: 0, ctr: 0, cpm: 0, impressions: 0 };
  }
  const totalSpend = data.reduce((s, r) => s + Number(r.spend), 0);
  const totalRevenue = data.reduce((s, r) => s + Number(r.revenue), 0);
  const totalClicks = data.reduce((s, r) => s + Number(r.clicks), 0);
  const totalImpressions = data.reduce((s, r) => s + Number(r.impressions), 0);
  const totalConversions = data.reduce((s, r) => s + Number(r.conversions), 0);

  return {
    totalSpend: Math.round(totalSpend),
    totalRevenue: Math.round(totalRevenue),
    blendedROAS: totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 100) / 100 : 0,
    totalConversions,
    clicks: totalClicks,
    cpc: totalClicks > 0 ? Math.round((totalSpend / totalClicks) * 100) / 100 : 0,
    ctr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 10000) / 100 : 0,
    cpm: totalImpressions > 0 ? Math.round((totalSpend / totalImpressions) * 1000 * 100) / 100 : 0,
    impressions: totalImpressions,
  };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function useDateStrings() {
  const { dateRange } = useDateRange();
  const fromStr = format(dateRange.from, "yyyy-MM-dd");
  const toStr = format(dateRange.to, "yyyy-MM-dd");
  const days = differenceInDays(dateRange.to, dateRange.from) + 1;
  const prevFrom = format(subDays(dateRange.from, days), "yyyy-MM-dd");
  const prevTo = format(subDays(dateRange.from, 1), "yyyy-MM-dd");
  return { fromStr, toStr, prevFrom, prevTo, days };
}

export function useKPIs(platform?: string) {
  const { fromStr, toStr, prevFrom, prevTo } = useDateStrings();
  const { activeClient } = useClient();
  const clientId = activeClient?.id;

  return useQuery({
    queryKey: ["kpis", fromStr, toStr, clientId, platform],
    queryFn: async (): Promise<KPIWithChange> => {
      let currentQuery = supabase.from("ad_daily_metrics")
        .select("spend, revenue, impressions, clicks, conversions")
        .gte("date", fromStr).lte("date", toStr);
      let previousQuery = supabase.from("ad_daily_metrics")
        .select("spend, revenue, impressions, clicks, conversions")
        .gte("date", prevFrom).lte("date", prevTo);

      if (clientId) {
        currentQuery = currentQuery.eq("client_id", clientId);
        previousQuery = previousQuery.eq("client_id", clientId);
      }
      if (platform) {
        currentQuery = currentQuery.eq("platform", platform);
        previousQuery = previousQuery.eq("platform", platform);
      }

      const [{ data: current, error: e1 }, { data: previous }] = await Promise.all([
        currentQuery,
        previousQuery,
      ]);

      if (e1) throw e1;
      const cur = calcKPIs(current || []);
      const prev = calcKPIs(previous || []);

      return {
        ...cur,
        changes: {
          spend: pctChange(cur.totalSpend, prev.totalSpend),
          revenue: pctChange(cur.totalRevenue, prev.totalRevenue),
          roas: pctChange(cur.blendedROAS, prev.blendedROAS),
          conversions: pctChange(cur.totalConversions, prev.totalConversions),
          cpc: pctChange(cur.cpc, prev.cpc),
          ctr: pctChange(cur.ctr, prev.ctr),
          cpm: pctChange(cur.cpm, prev.cpm),
          impressions: pctChange(cur.impressions, prev.impressions),
        },
      };
    },
  });
}

export function useDailyMetrics() {
  const { fromStr, toStr } = useDateStrings();
  const { activeClient } = useClient();
  const clientId = activeClient?.id;

  return useQuery({
    queryKey: ["daily-metrics", fromStr, toStr, clientId],
    queryFn: async (): Promise<DailyMetric[]> => {
      let query = supabase
        .from("ad_daily_metrics")
        .select("date, platform, spend, revenue")
        .gte("date", fromStr).lte("date", toStr)
        .order("date", { ascending: true });

      if (clientId) query = query.eq("client_id", clientId);

      const { data, error } = await query;
      if (error) throw error;
      if (!data) return [];

      const byDate = new Map<string, { metaSpend: number; googleSpend: number; revenue: number }>();
      for (const row of data) {
        const key = row.date;
        const existing = byDate.get(key) || { metaSpend: 0, googleSpend: 0, revenue: 0 };
        if (row.platform === "meta") existing.metaSpend += Number(row.spend);
        else if (row.platform === "google") existing.googleSpend += Number(row.spend);
        existing.revenue += Number(row.revenue);
        byDate.set(key, existing);
      }

      return Array.from(byDate.entries()).map(([date, vals]) => ({
        date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        metaSpend: Math.round(vals.metaSpend),
        googleSpend: Math.round(vals.googleSpend),
        revenue: Math.round(vals.revenue),
      }));
    },
  });
}

export function useChannelBreakdown() {
  const { fromStr, toStr } = useDateStrings();
  const { activeClient } = useClient();
  const clientId = activeClient?.id;

  return useQuery({
    queryKey: ["channel-breakdown", fromStr, toStr, clientId],
    queryFn: async (): Promise<ChannelSummary[]> => {
      let query = supabase
        .from("ad_daily_metrics")
        .select("platform, spend, revenue, clicks, impressions, conversions")
        .gte("date", fromStr).lte("date", toStr);

      if (clientId) query = query.eq("client_id", clientId);

      const { data, error } = await query;
      if (error) throw error;
      if (!data) return [];

      const byPlatform = new Map<string, { spend: number; revenue: number; clicks: number; impressions: number; conversions: number }>();
      for (const row of data) {
        const existing = byPlatform.get(row.platform) || { spend: 0, revenue: 0, clicks: 0, impressions: 0, conversions: 0 };
        existing.spend += Number(row.spend);
        existing.revenue += Number(row.revenue);
        existing.clicks += Number(row.clicks);
        existing.impressions += Number(row.impressions);
        existing.conversions += Number(row.conversions);
        byPlatform.set(row.platform, existing);
      }

      const colorMap: Record<string, "meta" | "google"> = { meta: "meta", google: "google" };
      const nameMap: Record<string, string> = { meta: "Meta Ads", google: "Google Ads" };

      return Array.from(byPlatform.entries()).map(([platform, vals]) => ({
        channel: nameMap[platform] || platform,
        spend: Math.round(vals.spend),
        revenue: Math.round(vals.revenue),
        roas: vals.spend > 0 ? Math.round((vals.revenue / vals.spend) * 100) / 100 : 0,
        conversions: vals.conversions,
        ctr: vals.impressions > 0 ? Math.round((vals.clicks / vals.impressions) * 10000) / 100 : 0,
        color: colorMap[platform] || "meta",
      }));
    },
  });
}

export function useTopCampaigns(platform?: string) {
  const { fromStr, toStr } = useDateStrings();
  const { activeClient } = useClient();
  const clientId = activeClient?.id;

  return useQuery({
    queryKey: ["top-campaigns", fromStr, toStr, clientId, platform],
    queryFn: async (): Promise<CampaignRow[]> => {
      let query = supabase
        .from("ad_campaigns")
        .select("campaign_name, platform, spend, revenue, roas, status, impressions, clicks, conversions, impression_share, bidding_strategy_type, campaign_type, daily_budget")
        .gte("date", fromStr).lte("date", toStr);

      if (clientId) query = query.eq("client_id", clientId);
      if (platform) query = query.eq("platform", platform);

      const { data, error } = await query;
      if (error) throw error;
      if (!data) return [];

      const byCampaign = new Map<string, any>();
      for (const row of data) {
        const existing = byCampaign.get(row.campaign_name) || {
          platform: row.platform, spend: 0, revenue: 0, status: row.status || "unknown",
          impressions: 0, clicks: 0, conversions: 0, impressionShareSum: 0, impressionShareCount: 0,
          biddingStrategy: row.bidding_strategy_type || null, campaignType: row.campaign_type || null,
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
        if (row.status === "active") existing.status = "active";
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
        .slice(0, 15);
    },
  });
}

export function useCrossChannelKPIs() {
  const { fromStr, toStr, prevFrom, prevTo } = useDateStrings();
  const { activeClient } = useClient();
  const clientId = activeClient?.id;

  return useQuery({
    queryKey: ["cross-channel-kpis", fromStr, toStr, clientId],
    enabled: !!clientId,
    queryFn: async () => {
      if (!clientId) throw new Error("No client");

      async function fetchSpend(from: string, to: string) {
        const { data, error } = await supabase
          .from("ad_daily_metrics")
          .select("platform, spend, revenue, conversions")
          .eq("client_id", clientId!)
          .gte("date", from).lte("date", to);
        if (error) throw error;

        let googleSpend = 0, metaSpend = 0, totalRevenue = 0, totalConversions = 0;
        for (const row of data || []) {
          const spend = Number(row.spend);
          if (row.platform === "google") googleSpend += spend;
          else if (row.platform === "meta") metaSpend += spend;
          totalRevenue += Number(row.revenue);
          totalConversions += Number(row.conversions);
        }
        return {
          googleSpend: Math.round(googleSpend),
          metaSpend: Math.round(metaSpend),
          totalSpend: Math.round(googleSpend + metaSpend),
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalConversions,
        };
      }

      const [current, prev] = await Promise.all([
        fetchSpend(fromStr, toStr),
        fetchSpend(prevFrom, prevTo),
      ]);

      const currentCAC = current.totalConversions > 0 ? Math.round((current.totalSpend / current.totalConversions) * 100) / 100 : 0;
      const prevCAC = prev.totalConversions > 0 ? Math.round((prev.totalSpend / prev.totalConversions) * 100) / 100 : 0;
      const currentROAS = current.totalSpend > 0 ? Math.round((current.totalRevenue / current.totalSpend) * 100) / 100 : 0;
      const prevROAS = prev.totalSpend > 0 ? Math.round((prev.totalRevenue / prev.totalSpend) * 100) / 100 : 0;

      return {
        totalSpend: current.totalSpend,
        googleSpend: current.googleSpend,
        metaSpend: current.metaSpend,
        totalConversions: current.totalConversions,
        totalCAC: currentCAC,
        totalRevenue: current.totalRevenue,
        blendedROAS: currentROAS,
        changes: {
          totalSpend: pctChange(current.totalSpend, prev.totalSpend),
          googleSpend: pctChange(current.googleSpend, prev.googleSpend),
          metaSpend: pctChange(current.metaSpend, prev.metaSpend),
          totalConversions: pctChange(current.totalConversions, prev.totalConversions),
          totalCAC: pctChange(currentCAC, prevCAC),
          totalRevenue: pctChange(current.totalRevenue, prev.totalRevenue),
          blendedROAS: pctChange(currentROAS, prevROAS),
        },
      };
    },
  });
}
