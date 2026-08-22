import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";

export const RRM_CLIENT_ID = "4b2434db-6d47-4653-be34-313976790f9d";

export type ServiceLine = "windows" | "plumbing" | "unassigned";

export interface MojaCall {
  id: string;
  call_id: string;
  service_line: ServiceLine | string;
  platform: string | null;
  campaign_name: string | null;
  publisher_name: string | null;
  buyer_name: string | null;
  target_name: string | null;
  tracking_number: string | null;
  caller_number: string | null;
  caller_state: string | null;
  caller_zip: string | null;
  call_start: string;
  duration_seconds: number;
  connected: boolean;
  converted: boolean;
  revenue: number;
  payout: number;
  disposition: string | null;
  recording_url: string | null;
  utm_source?: string | null;
  utm_campaign?: string | null;

}

export interface RRMCampaignRow {
  date: string;
  campaign_name: string;
  platform: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

/** Moja calls for RRM inside the active date range. */
export function useMojaCalls() {
  const { dateRange } = useDateRange();
  const from = format(dateRange.from, "yyyy-MM-dd");
  const to = format(dateRange.to, "yyyy-MM-dd");

  return useQuery({
    queryKey: ["moja-calls", RRM_CLIENT_ID, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("moja_calls" as any)
        .select("*")
        .eq("client_id", RRM_CLIENT_ID)
        .gte("call_start", `${from}T00:00:00`)
        .lte("call_start", `${to}T23:59:59`)
        .order("call_start", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as MojaCall[];
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

/** Meta + Google campaign spend for RRM inside the active date range. */
export function useRRMSpend() {
  const { dateRange } = useDateRange();
  const from = format(dateRange.from, "yyyy-MM-dd");
  const to = format(dateRange.to, "yyyy-MM-dd");

  return useQuery({
    queryKey: ["rrm-spend", RRM_CLIENT_ID, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_campaigns")
        .select("date, campaign_name, platform, spend, impressions, clicks, conversions")
        .eq("client_id", RRM_CLIENT_ID)
        .gte("date", from)
        .lte("date", to);
      if (error) throw error;
      return (data || []) as RRMCampaignRow[];
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

/** Map a campaign name to an RRM service line. */
export function serviceLineOf(text: string | null | undefined): ServiceLine {
  const t = (text || "").toLowerCase();
  if (/window|glass|door/.test(t)) return "windows";
  if (/plumb|drain|sewer|water heater|leak/.test(t)) return "plumbing";
  return "unassigned";
}
