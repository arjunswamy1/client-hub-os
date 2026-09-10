import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { format } from "date-fns";

export const CANNABALL_CLIENT_ID = "a1dabea1-5518-4c7f-a29d-23739cb52f9b";

function useDates() {
  const { dateRange } = useDateRange();
  return {
    from: format(dateRange.from, "yyyy-MM-dd"),
    to: format(dateRange.to, "yyyy-MM-dd"),
  };
}

export interface CannaballCall {
  id: string;
  call_id: string;
  did: string | null;
  caller_number: string | null;
  caller_state: string | null;
  caller_city: string | null;
  call_start: string;
  duration_seconds: number;
  connected: boolean;
  connection_duration_seconds: number;
  payout: number;
  campaign_name: string | null;
  creative_name: string | null;
  platform: string | null;
  disposition: string | null;
  recording_url: string | null;
}

export interface CannaballSpend {
  date: string;
  platform: string;
  campaign_name: string | null;
  creative_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
}

export function useCannaballCalls() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["cannaball-calls", from, to],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cannaball_calls" as any)
        .select("id, call_id, did, caller_number, caller_state, call_start, duration_seconds, connected, connection_duration_seconds, payout, campaign_name, creative_name, platform, disposition, recording_url")
        .eq("client_id", CANNABALL_CLIENT_ID)
        .gte("call_start", `${from}T00:00:00Z`)
        .lte("call_start", `${to}T23:59:59Z`)
        .order("call_start", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data || []) as unknown as CannaballCall[];
    },
  });
}

export function useCannaballSpend() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["cannaball-spend", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cannaball_spend" as any)
        .select("date, platform, campaign_name, creative_name, spend, impressions, clicks")
        .eq("client_id", CANNABALL_CLIENT_ID)
        .gte("date", from)
        .lte("date", to);
      if (error) throw error;
      return (data || []) as unknown as CannaballSpend[];
    },
  });
}
