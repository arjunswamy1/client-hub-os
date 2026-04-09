import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { useClient } from "@/contexts/ClientContext";
import { useVertical } from "@/contexts/VerticalContext";
import { format, differenceInDays, subDays } from "date-fns";

function useDateStrings() {
  const { dateRange } = useDateRange();
  const fromStr = format(dateRange.from, "yyyy-MM-dd");
  const toStr = format(dateRange.to, "yyyy-MM-dd");
  const days = differenceInDays(dateRange.to, dateRange.from) + 1;
  const prevFrom = format(subDays(dateRange.from, days), "yyyy-MM-dd");
  const prevTo = format(subDays(dateRange.from, 1), "yyyy-MM-dd");
  return { fromStr, toStr, prevFrom, prevTo };
}

function matchesRingbaVertical(
  campaignName: string | null,
  targetName: string | null,
  verticalPatterns: string[],
  exactMatch?: boolean
): boolean {
  if (verticalPatterns.length === 0) return true; // "all" vertical
  const searchText = `${campaignName || ""} ${targetName || ""}`.toLowerCase();
  if (exactMatch) {
    return verticalPatterns.some(
      (p) => (campaignName || "").toLowerCase() === p.toLowerCase() ||
             (targetName || "").toLowerCase() === p.toLowerCase()
    );
  }
  return verticalPatterns.some((p) => searchText.includes(p.toLowerCase()));
}

/** Ringba call revenue aggregated by vertical */
export function useRingbaRevenue() {
  const { fromStr, toStr, prevFrom, prevTo } = useDateStrings();
  const { activeClient } = useClient();
  const { activeVertical } = useVertical();
  const clientId = activeClient?.id;
  const verticalId = activeVertical.id;

  return useQuery({
    queryKey: ["ringba-revenue", fromStr, toStr, clientId, verticalId],
    enabled: !!clientId,
    queryFn: async () => {
      async function fetchCalls(from: string, to: string) {
        const { data, error } = await supabase
          .from("ringba_calls")
          .select("campaign_name, target_name, revenue, payout, connected, converted, duration_seconds, call_date")
          .eq("client_id", clientId!)
          .gte("call_date", `${from}T00:00:00`)
          .lte("call_date", `${to}T23:59:59`);

        if (error) throw error;

        const filtered = (data || []).filter((call) =>
          matchesRingbaVertical(
            call.campaign_name,
            call.target_name,
            activeVertical.ringba.patterns,
            activeVertical.ringba.exactMatch
          )
        );

        let revenue = 0, payout = 0, totalCalls = 0, connectedCalls = 0, convertedCalls = 0, totalDuration = 0;
        for (const call of filtered) {
          revenue += Number(call.revenue);
          payout += Number(call.payout);
          totalCalls++;
          if (call.connected) connectedCalls++;
          if (call.converted) convertedCalls++;
          totalDuration += call.duration_seconds || 0;
        }

        return { revenue: Math.round(revenue * 100) / 100, payout: Math.round(payout * 100) / 100, totalCalls, connectedCalls, convertedCalls, totalDuration };
      }

      const [current, prev] = await Promise.all([
        fetchCalls(fromStr, toStr),
        fetchCalls(prevFrom, prevTo),
      ]);

      const pctChange = (c: number, p: number) => {
        if (p === 0) return c > 0 ? 100 : null;
        return Math.round(((c - p) / p) * 1000) / 10;
      };

      return {
        ...current,
        avgDuration: current.totalCalls > 0 ? Math.round(current.totalDuration / current.totalCalls) : 0,
        connectRate: current.totalCalls > 0 ? Math.round((current.connectedCalls / current.totalCalls) * 100) : 0,
        conversionRate: current.totalCalls > 0 ? Math.round((current.convertedCalls / current.totalCalls) * 100) : 0,
        changes: {
          revenue: pctChange(current.revenue, prev.revenue),
          totalCalls: pctChange(current.totalCalls, prev.totalCalls),
          convertedCalls: pctChange(current.convertedCalls, prev.convertedCalls),
          payout: pctChange(current.payout, prev.payout),
        },
      };
    },
  });
}

/** Daily Ringba revenue for trend charts */
export function useRingbaDailyRevenue() {
  const { fromStr, toStr } = useDateStrings();
  const { activeClient } = useClient();
  const { activeVertical } = useVertical();
  const clientId = activeClient?.id;
  const verticalId = activeVertical.id;

  return useQuery({
    queryKey: ["ringba-daily-revenue", fromStr, toStr, clientId, verticalId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ringba_calls")
        .select("call_date, campaign_name, target_name, revenue, converted")
        .eq("client_id", clientId!)
        .gte("call_date", `${fromStr}T00:00:00`)
        .lte("call_date", `${toStr}T23:59:59`)
        .order("call_date", { ascending: true });

      if (error) throw error;

      const filtered = (data || []).filter((call) =>
        matchesRingbaVertical(
          call.campaign_name,
          call.target_name,
          activeVertical.ringba.patterns,
          activeVertical.ringba.exactMatch
        )
      );

      const byDate = new Map<string, { revenue: number; calls: number }>();
      for (const call of filtered) {
        const dateKey = call.call_date.split("T")[0];
        const existing = byDate.get(dateKey) || { revenue: 0, calls: 0 };
        existing.revenue += Number(call.revenue);
        if (call.converted) existing.calls++;
        byDate.set(dateKey, existing);
      }

      return Array.from(byDate.entries()).map(([date, vals]) => ({
        date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        revenue: Math.round(vals.revenue),
        convertedCalls: vals.calls,
      }));
    },
  });
}
