import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { useClient } from "@/contexts/ClientContext";
import { useVertical } from "@/contexts/VerticalContext";
import { matchesVertical } from "@/config/billyVerticals";
import { format, eachDayOfInterval } from "date-fns";

export interface DailyFunnelRow {
  date: string;
  dateLabel: string;
  // Step 1 — Traffic
  spend: number;
  clicks: number;
  impressions: number;
  cpc: number;
  ctr: number;
  cpm: number;
  // Step 2 — Landing Page
  visitors: number;
  ctaClicks: number;
  lpCvr: number;
  rpv: number;
  // Step 3 — Call Processing
  totalCalls: number;
  connectedCalls: number;
  connectRate: number;
  convertedCalls: number;
  conversionRate: number;
  avgDuration: number;
  // Step 4 — Monetization
  callRevenue: number;
  revenuePerCall: number;
  costPerCall: number;
  callROAS: number;
  profit: number;
  // Deltas (day-over-day %)
  deltas: Record<string, number | null>;
  alertCount: number;
}

export function useBillyDailyTrends() {
  const { dateRange } = useDateRange();
  const fromStr = format(dateRange.from, "yyyy-MM-dd");
  const toStr = format(dateRange.to, "yyyy-MM-dd");
  const { activeClient } = useClient();
  const { activeVertical } = useVertical();
  const clientId = activeClient?.id;
  const verticalId = activeVertical.id;

  return useQuery({
    queryKey: ["billy-daily-funnel", fromStr, toStr, clientId, verticalId],
    enabled: !!clientId,
    queryFn: async () => {
      // Fetch campaigns and ringba calls for the full range
      const [campaignRes, ringbaRes] = await Promise.all([
        supabase
          .from("ad_campaigns")
          .select("date, campaign_name, platform, spend, revenue, impressions, clicks, conversions")
          .eq("client_id", clientId!)
          .gte("date", fromStr)
          .lte("date", toStr),
        supabase
          .from("ringba_calls")
          .select("call_date, campaign_name, target_name, revenue, connected, converted, duration_seconds")
          .eq("client_id", clientId!)
          .gte("call_date", `${fromStr}T00:00:00`)
          .lte("call_date", `${toStr}T23:59:59`),
      ]);

      if (campaignRes.error) throw campaignRes.error;
      if (ringbaRes.error) throw ringbaRes.error;

      const campaigns = (campaignRes.data || []).filter((row) => {
        if (verticalId === "all") return true;
        const p = (row.platform as "meta" | "google") || "meta";
        return matchesVertical(row.campaign_name, activeVertical, p);
      });

      const ringbaCalls = (ringbaRes.data || []).filter((call) =>
        matchesVertical(call.campaign_name || "", activeVertical, "ringba")
      );

      // Group by date
      const days = eachDayOfInterval({ start: dateRange.from, end: dateRange.to });
      const adByDate = new Map<string, { spend: number; clicks: number; impressions: number; conversions: number }>();
      for (const row of campaigns) {
        const d = row.date;
        const existing = adByDate.get(d) || { spend: 0, clicks: 0, impressions: 0, conversions: 0 };
        existing.spend += Number(row.spend);
        existing.clicks += Number(row.clicks);
        existing.impressions += Number(row.impressions);
        existing.conversions += Number(row.conversions);
        adByDate.set(d, existing);
      }

      const callsByDate = new Map<string, { totalCalls: number; connected: number; converted: number; revenue: number; duration: number }>();
      for (const call of ringbaCalls) {
        const d = call.call_date.split("T")[0];
        const existing = callsByDate.get(d) || { totalCalls: 0, connected: 0, converted: 0, revenue: 0, duration: 0 };
        existing.totalCalls++;
        if (call.connected && (call.duration_seconds || 0) > 0) existing.connected++;
        if (call.connected && call.converted) existing.converted++;
        if (call.connected) existing.revenue += Number(call.revenue);
        existing.duration += call.duration_seconds || 0;
        callsByDate.set(d, existing);
      }

      // Build rows
      const rows: DailyFunnelRow[] = days.map((day) => {
        const dateKey = format(day, "yyyy-MM-dd");
        const ad = adByDate.get(dateKey) || { spend: 0, clicks: 0, impressions: 0, conversions: 0 };
        const calls = callsByDate.get(dateKey) || { totalCalls: 0, connected: 0, converted: 0, revenue: 0, duration: 0 };

        const spend = ad.spend;
        const clicks = ad.clicks;
        const impressions = ad.impressions;
        const cpc = clicks > 0 ? spend / clicks : 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;

        const visitors = clicks;
        const totalCalls = calls.totalCalls;
        const lpCvr = visitors > 0 ? (totalCalls / visitors) * 100 : 0;
        const rpv = visitors > 0 ? calls.revenue / visitors : 0;

        const connectedCalls = calls.connected;
        const convertedCalls = calls.converted;
        const connectRate = totalCalls > 0 ? (connectedCalls / totalCalls) * 100 : 0;
        const conversionRate = totalCalls > 0 ? (convertedCalls / totalCalls) * 100 : 0;
        const avgDuration = totalCalls > 0 ? calls.duration / totalCalls : 0;

        const callRevenue = calls.revenue;
        const revenuePerCall = connectedCalls > 0 ? callRevenue / connectedCalls : 0;
        const costPerCall = totalCalls > 0 ? spend / totalCalls : 0;
        const callROAS = spend > 0 ? callRevenue / spend : 0;
        const profit = callRevenue - spend;

        return {
          date: dateKey,
          dateLabel: new Date(dateKey).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          spend: Math.round(spend),
          clicks,
          impressions,
          cpc: Math.round(cpc * 1000) / 1000,
          ctr: Math.round(ctr * 100) / 100,
          cpm: Math.round(cpm * 100) / 100,
          visitors,
          ctaClicks: totalCalls,
          lpCvr: Math.round(lpCvr * 10) / 10,
          rpv: Math.round(rpv * 100) / 100,
          totalCalls,
          connectedCalls,
          connectRate: Math.round(connectRate),
          convertedCalls,
          conversionRate: Math.round(conversionRate),
          avgDuration: Math.round(avgDuration),
          callRevenue: Math.round(callRevenue * 100) / 100,
          revenuePerCall: Math.round(revenuePerCall * 100) / 100,
          costPerCall: Math.round(costPerCall * 100) / 100,
          callROAS: Math.round(callROAS * 100) / 100,
          profit: Math.round(profit),
          deltas: {},
          alertCount: 0,
        };
      });

      // Calculate day-over-day deltas
      const deltaKeys = [
        "spend", "clicks", "cpc", "ctr", "lpCvr", "rpv",
        "totalCalls", "connectRate", "conversionRate",
        "callRevenue", "callROAS", "profit",
      ] as const;

      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const cur = rows[i];
        const deltas: Record<string, number | null> = {};
        let alertCount = 0;

        for (const key of deltaKeys) {
          const pv = prev[key] as number;
          const cv = cur[key] as number;
          if (pv === 0) {
            deltas[key] = cv > 0 ? 100 : null;
          } else {
            deltas[key] = Math.round(((cv - pv) / Math.abs(pv)) * 1000) / 10;
          }
          if (deltas[key] !== null && Math.abs(deltas[key]!) > 10) alertCount++;
        }

        cur.deltas = deltas;
        cur.alertCount = alertCount;
      }

      return rows;
    },
  });
}
