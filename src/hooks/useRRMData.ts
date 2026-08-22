import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";

export const RRM_CLIENT_ID = "4b2434db-6d47-4653-be34-313976790f9d";

export type ServiceLine = "windows" | "plumbing" | "unassigned";
/** The two live RRM service lines. */
export type RRMLine = "windows" | "plumbing";

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
  utm_term?: string | null;
  utm_content?: string | null;
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
  if (/plumb|drain|sewer|water heater|water line|pipe|leak/.test(t)) return "plumbing";
  return "unassigned";
}

/**
 * Classify an ad-platform campaign into an RRM service line.
 *
 * The connected Google account also carries non-RRM campaigns (e.g. the
 * "CPM_Final Expense_*" builds). Those must be excluded rather than silently
 * counted as Plumbing spend, otherwise every Plumbing cost metric inflates.
 */
export function classifyCampaign(
  campaignName: string | null | undefined,
  platform: string | null | undefined,
): RRMLine | "excluded" {
  const line = serviceLineOf(campaignName);
  if (line === "windows" || line === "plumbing") return line;
  // The Meta ad account is RRM Windows only, so unnamed Meta campaigns belong there.
  if ((platform || "").toLowerCase() === "meta") return "windows";
  return "excluded";
}

/** Which service line a Moja call belongs to (falls back to the source platform). */
export function callLine(c: MojaCall): RRMLine {
  const sl = (c.service_line || "").toLowerCase();
  if (sl === "windows" || sl === "plumbing") return sl;
  return (c.platform || "").toLowerCase() === "meta" ? "windows" : "plumbing";
}

export interface CallMetrics {
  raw: number;
  connected: number;
  converted: number;
  connectRate: number;
  convRate: number;
  revenue: number;
  spend: number;
  profit: number;
  roas: number;
  /** Spend ÷ every call that rang, connected or not */
  costPerRawCall: number;
  /** Spend ÷ calls that actually connected to a buyer */
  costPerConnectedCall: number;
  /** Spend ÷ converted (billable) calls */
  costPerConvertedCall: number;
  /** Buyer payout ÷ raw calls */
  revenuePerRawCall: number;
  revenuePerConnectedCall: number;
  avgTalk: number;
  margin: number;
}

/** Single source of truth for every RRM call/cost metric. */
export function callMetrics(calls: MojaCall[], spend: number): CallMetrics {
  const raw = calls.length;
  const connected = calls.filter((c) => c.connected).length;
  const converted = calls.filter((c) => c.converted).length;
  const revenue = calls.reduce((s, c) => s + Number(c.revenue || 0), 0);
  const talk = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0);
  const div = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    raw,
    connected,
    converted,
    connectRate: div(connected, raw),
    convRate: div(converted, raw),
    revenue,
    spend,
    profit: revenue - spend,
    roas: div(revenue, spend),
    costPerRawCall: div(spend, raw),
    costPerConnectedCall: div(spend, connected),
    costPerConvertedCall: div(spend, converted),
    revenuePerRawCall: div(revenue, raw),
    revenuePerConnectedCall: div(revenue, connected),
    avgTalk: div(talk, connected),
    margin: div(revenue - spend, revenue),
  };
}
