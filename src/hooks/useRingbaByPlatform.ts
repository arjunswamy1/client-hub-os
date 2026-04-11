import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { useClient } from "@/contexts/ClientContext";
import { useVertical } from "@/contexts/VerticalContext";
import { matchesVertical } from "@/config/billyVerticals";
import { format, differenceInDays, subDays } from "date-fns";

/**
 * Ringba calls attributed to a specific ad platform.
 * Attempts direct attribution (UTM/referrer) first,
 * falls back to spend-proportional split.
 */
export function useRingbaByPlatform(platform: "meta" | "google") {
  const { dateRange } = useDateRange();
  const fromStr = format(dateRange.from, "yyyy-MM-dd");
  const toStr = format(dateRange.to, "yyyy-MM-dd");
  const days = differenceInDays(dateRange.to, dateRange.from) + 1;
  const prevFrom = format(subDays(dateRange.from, days), "yyyy-MM-dd");
  const prevTo = format(subDays(dateRange.from, 1), "yyyy-MM-dd");
  const { activeClient } = useClient();
  const { activeVertical } = useVertical();
  const clientId = activeClient?.id;
  const verticalId = activeVertical.id;

  return useQuery({
    queryKey: ["ringba-by-platform", platform, fromStr, toStr, clientId, verticalId],
    enabled: !!clientId,
    queryFn: async () => {
      // Fetch all Ringba calls for the period
      async function fetchCalls(from: string, to: string) {
        const { data, error } = await supabase
          .from("ringba_calls")
          .select("campaign_name, target_name, revenue, payout, connected, converted, duration_seconds, metadata")
          .eq("client_id", clientId!)
          .gte("call_date", `${from}T00:00:00`)
          .lte("call_date", `${to}T23:59:59`);

        if (error) throw error;

        // Filter by vertical
        const filtered = (data || []).filter((call) =>
          matchesVertical(
            call.campaign_name || "",
            activeVertical,
            "ringba"
          )
        );

        return filtered;
      }

      const [curCalls, prevCalls] = await Promise.all([
        fetchCalls(fromStr, toStr),
        fetchCalls(prevFrom, prevTo),
      ]);

      // Try direct attribution
      function attributeToPlatform(calls: typeof curCalls) {
        const metaPatterns = ["facebook.com", "fb.com", "instagram.com"];
        const metaUtm = ["fb", "facebook", "meta"];
        const googlePatterns = ["google.com", "google.co"];
        const googleUtm = ["google", "gads", "google_ads"];

        let attributed: typeof calls = [];
        let hasAnyAttribution = false;

        for (const call of calls) {
          const meta = call.metadata as Record<string, any> || {};
          const referrer = (meta.referrer || "").toLowerCase();
          const utmSource = (meta.utm_source || "").toLowerCase();

          const isMetaAttr = metaPatterns.some(p => referrer.includes(p)) || metaUtm.includes(utmSource);
          const isGoogleAttr = googlePatterns.some(p => referrer.includes(p)) || googleUtm.includes(utmSource);

          if (isMetaAttr || isGoogleAttr) hasAnyAttribution = true;

          if (platform === "meta" && isMetaAttr) attributed.push(call);
          if (platform === "google" && isGoogleAttr) attributed.push(call);
        }

        return { attributed, hasAnyAttribution };
      }

      const { attributed: curAttributed, hasAnyAttribution } = attributeToPlatform(curCalls);

      let curResult: { totalCalls: number; connectedCalls: number; convertedCalls: number; revenue: number; avgDuration: number };

      if (hasAnyAttribution) {
        // Use direct attribution
        curResult = aggregateCalls(curAttributed);
      } else {
        // Fall back to spend-proportional split
        const { data: spendData } = await supabase
          .from("ad_daily_metrics")
          .select("platform, spend")
          .eq("client_id", clientId!)
          .gte("date", fromStr)
          .lte("date", toStr);

        let metaSpend = 0, googleSpend = 0;
        for (const row of spendData || []) {
          if (row.platform === "meta") metaSpend += Number(row.spend);
          if (row.platform === "google") googleSpend += Number(row.spend);
        }

        const totalSpend = metaSpend + googleSpend;
        const share = totalSpend > 0
          ? (platform === "meta" ? metaSpend / totalSpend : googleSpend / totalSpend)
          : 0.5;

        const totalAgg = aggregateCalls(curCalls);
        curResult = {
          totalCalls: Math.round(totalAgg.totalCalls * share),
          connectedCalls: Math.round(totalAgg.connectedCalls * share),
          convertedCalls: Math.round(totalAgg.convertedCalls * share),
          revenue: Math.round(totalAgg.revenue * share * 100) / 100,
          avgDuration: totalAgg.avgDuration,
        };
      }

      // Previous period (simple proportional for comparison)
      const prevAgg = aggregateCalls(prevCalls);
      const prevShare = 0.5; // simplified for prev period
      const prevResult = {
        totalCalls: Math.round(prevAgg.totalCalls * prevShare),
        convertedCalls: Math.round(prevAgg.convertedCalls * prevShare),
        revenue: Math.round(prevAgg.revenue * prevShare * 100) / 100,
      };

      const pctChange = (c: number, p: number) => {
        if (p === 0) return c > 0 ? 100 : null;
        return Math.round(((c - p) / p) * 1000) / 10;
      };

      return {
        ...curResult,
        connectRate: curResult.totalCalls > 0 ? Math.round((curResult.connectedCalls / curResult.totalCalls) * 100) : 0,
        conversionRate: curResult.totalCalls > 0 ? Math.round((curResult.convertedCalls / curResult.totalCalls) * 100) : 0,
        changes: {
          totalCalls: pctChange(curResult.totalCalls, prevResult.totalCalls),
          convertedCalls: pctChange(curResult.convertedCalls, prevResult.convertedCalls),
          revenue: pctChange(curResult.revenue, prevResult.revenue),
        },
      };
    },
  });
}

function aggregateCalls(calls: any[]) {
  let revenue = 0, totalCalls = 0, connectedCalls = 0, convertedCalls = 0, totalDuration = 0;
  for (const call of calls) {
    totalCalls++;
    if (call.connected && (call.duration_seconds || 0) > 0) connectedCalls++;
    if (call.connected && call.converted) convertedCalls++;
    if (call.connected) revenue += Number(call.revenue);
    totalDuration += call.duration_seconds || 0;
  }
  return {
    totalCalls,
    connectedCalls,
    convertedCalls,
    revenue: Math.round(revenue * 100) / 100,
    avgDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
  };
}
