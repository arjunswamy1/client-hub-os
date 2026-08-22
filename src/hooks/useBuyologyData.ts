import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { format } from "date-fns";

export const BUYOLOGY_CLIENT_ID = "b3d600f5-5d6b-4378-aa96-b395c05e9297";

export interface BuyologyCall {
  call_id: string;
  call_date: string;
  campaign_name: string | null;
  target_name: string | null;
  caller_number: string | null;
  inbound_number: string | null;
  duration_seconds: number | null;
  connected: boolean | null;
  converted: boolean | null;
  revenue: number;
  payout: number;
  metadata: any;
}

/** Ringba calls for BuyologyIQ within the active date range */
export function useBuyologyCalls() {
  const { dateRange } = useDateRange();
  const from = format(dateRange.from, "yyyy-MM-dd");
  const to = format(dateRange.to, "yyyy-MM-dd");

  return useQuery({
    queryKey: ["buyology-calls", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ringba_calls")
        .select(
          "call_id, call_date, campaign_name, target_name, caller_number, inbound_number, duration_seconds, connected, converted, revenue, payout, metadata"
        )
        .eq("client_id", BUYOLOGY_CLIENT_ID)
        .gte("call_date", `${from}T00:00:00`)
        .lte("call_date", `${to}T23:59:59`)
        .order("call_date", { ascending: true })
        .limit(20000);
      if (error) throw error;
      return (data || []) as BuyologyCall[];
    },
  });
}

/** Meta ad spend for BuyologyIQ within the active date range */
export function useBuyologySpend() {
  const { dateRange } = useDateRange();
  const from = format(dateRange.from, "yyyy-MM-dd");
  const to = format(dateRange.to, "yyyy-MM-dd");

  return useQuery({
    queryKey: ["buyology-spend", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_daily_metrics")
        .select("date, platform, spend, impressions, clicks")
        .eq("client_id", BUYOLOGY_CLIENT_ID)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data || []).filter((r) => {
        const p = (r.platform || "").toLowerCase();
        return p === "meta" || p === "facebook";
      });
    },
  });
}
