import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { format, differenceInDays, subDays } from "date-fns";

const FOURJS_CLIENT_ID = "a9fce72e-87d5-4c45-9d94-03d78be7e42d";

function useDates() {
  const { dateRange } = useDateRange();
  const from = format(dateRange.from, "yyyy-MM-dd");
  const to = format(dateRange.to, "yyyy-MM-dd");
  const days = differenceInDays(dateRange.to, dateRange.from) + 1;
  const prevFrom = format(subDays(dateRange.from, days), "yyyy-MM-dd");
  const prevTo = format(subDays(dateRange.from, 1), "yyyy-MM-dd");
  return { from, to, prevFrom, prevTo };
}

export interface FourJsCall {
  id: string;
  ringba_call_id: string;
  did: string;
  caller_state: string | null;
  call_start: string;
  call_duration_seconds: number;
  connected: boolean;
  connection_duration_seconds: number;
  payout: number;
  platform: string | null;
  creative_name: string | null;
  audience_cluster: string | null;
  campaign_name: string | null;
}

export interface FourJsSpend {
  date: string;
  platform: string;
  campaign_name: string | null;
  creative_name: string | null;
  audience_cluster: string | null;
  spend: number;
  impressions: number;
}

export function useFourJsCalls() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["fourjs-calls", from, to],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ringba_calls_4js")
        .select("id, ringba_call_id, did, caller_state, call_start, call_duration_seconds, connected, connection_duration_seconds, payout, platform, creative_name, audience_cluster, campaign_name")
        .eq("client_id", FOURJS_CLIENT_ID)
        .gte("call_start", `${from}T00:00:00Z`)
        .lte("call_start", `${to}T23:59:59Z`)
        .order("call_start", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data || []) as FourJsCall[];
    },
  });
}

export function useFourJsSpend() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["fourjs-spend", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_spend_4js")
        .select("date, platform, campaign_name, creative_name, audience_cluster, spend, impressions")
        .eq("client_id", FOURJS_CLIENT_ID)
        .gte("date", from)
        .lte("date", to);
      if (error) throw error;
      return (data || []) as FourJsSpend[];
    },
  });
}

export function triggerFourJsSync(daysBack = 7) {
  return supabase.functions.invoke("sync-ringba-calls-4js", {
    body: { days_back: daysBack },
  });
}
