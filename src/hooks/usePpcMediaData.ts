import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { format } from "date-fns";

export const PPC_MEDIA_CLIENT_ID = "eb8b053a-321f-4747-933c-74cab7613a13";

/**
 * PPC Media runs four owned-and-operated insurance campaigns on Meta click-to-call,
 * tracked in CallGrid. The buyer bids per call (RTB), so both RPC and cost per call
 * use TOTAL calls — that keeps no-bid losses visible instead of hiding them behind
 * the paid calls only. Payout comes from CallGrid; nothing is assumed.
 *
 * The bridge between the Meta side and the CallGrid side is the campaign name:
 *   "PPC O&O | Meta | CoverageMatch | Home | EN"
 * Product (Home/Auto) and language (EN/ES) are read out of that name, identically on
 * both platforms, so a vertical's spend and its calls always come from one key.
 */
export type PpcVertical =
  | "Home — English"
  | "Home — Spanish"
  | "Auto — English"
  | "Auto — Spanish"
  | "Unclassified";

export const PPC_VERTICALS: PpcVertical[] = [
  "Home — English",
  "Home — Spanish",
  "Auto — English",
  "Auto — Spanish",
];

/** Campaign name → vertical. Applied identically to Meta campaigns and CallGrid calls. */
export function ppcVerticalForCampaign(name: string | null | undefined): PpcVertical {
  const n = (name || "").toLowerCase();
  const spanish = /\bes\b|spanish|espa/.test(n);
  const home = /\bhome\b|\bhoi\b|homeowner/.test(n);
  const auto = /\bauto\b|\bvehicle\b|\bcar\b/.test(n);
  if (home) return spanish ? "Home — Spanish" : "Home — English";
  if (auto) return spanish ? "Auto — Spanish" : "Auto — English";
  return "Unclassified";
}

export interface PpcCall {
  call_id: string;
  call_start: string;
  campaign_name: string | null;
  creative_name: string | null;
  caller_number: string | null;
  caller_state: string | null;
  caller_zip: string | null;
  did: string | null;
  duration_seconds: number | null;
  connection_duration_seconds: number | null;
  connected: boolean | null;
  payout: number;
  disposition: string | null;
}

export interface PpcSpendRow {
  date: string;
  campaign_name: string | null;
  platform: string | null;
  spend: number;
  impressions: number;
  clicks: number;
}

const PAGE_SIZE = 1000;

function useWindow() {
  const { dateRange } = useDateRange();
  return {
    from: format(dateRange.from, "yyyy-MM-dd"),
    to: format(dateRange.to, "yyyy-MM-dd"),
  };
}

/** CallGrid calls for PPC Media, fully paged. */
export function usePpcCalls() {
  const { from, to } = useWindow();
  return useQuery({
    queryKey: ["ppc-calls", from, to],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const rows: PpcCall[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("cannaball_calls")
          .select(
            "call_id, call_start, campaign_name, creative_name, caller_number, caller_state, caller_zip, did, duration_seconds, connection_duration_seconds, connected, payout, disposition",
          )
          .eq("client_id", PPC_MEDIA_CLIENT_ID)
          .gte("call_start", `${from}T00:00:00`)
          .lte("call_start", `${to}T23:59:59`)
          .order("call_start", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...((data || []) as unknown as PpcCall[]));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return rows;
    },
  });
}

/** Meta spend per campaign per day — the campaign name carries product and language. */
export function usePpcMetaSpend() {
  const { from, to } = useWindow();
  return useQuery({
    queryKey: ["ppc-meta-spend", from, to],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_campaigns")
        .select("date, campaign_name, platform, spend, impressions, clicks")
        .eq("client_id", PPC_MEDIA_CLIENT_ID)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true })
        .limit(20000);
      if (error) throw error;
      return (data || []).filter((r) => {
        const p = (r.platform || "").toLowerCase();
        return p === "meta" || p === "facebook";
      }) as PpcSpendRow[];
    },
  });
}

export interface PpcCampaignConfigRow extends PpcSpendRow {
  status: string | null;
  objective: string | null;
  bid_strategy: string | null;
  bidding_strategy_type: string | null;
  campaign_type: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  conversions: number | null;
}

export interface PpcAdSetRow {
  date: string;
  campaign_name: string | null;
  adset_name: string | null;
  platform_adset_id: string | null;
  status: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  reach: number | null;
  frequency: number | null;
  bid_strategy: string | null;
  bid_amount: number | null;
  billing_event: string | null;
  optimization_goal: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  audience_summary: string | null;
  targeting: Record<string, unknown> | null;
}

export interface PpcAdRow {
  ad_name: string | null;
  platform_ad_id: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  status: string | null;
  creative_type: string | null;
  headline: string | null;
  primary_text: string | null;
  cta: string | null;
  creative_thumbnail_url: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  date_from: string | null;
  date_to: string | null;
}

/** Campaign rows with their settings — bid strategy, objective and budget. */
export function usePpcCampaignConfigs() {
  const { from, to } = useWindow();
  return useQuery({
    queryKey: ["ppc-campaign-configs", from, to],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_campaigns")
        .select(
          "date, campaign_name, platform, spend, impressions, clicks, conversions, status, objective, bid_strategy, bidding_strategy_type, campaign_type, daily_budget, lifetime_budget",
        )
        .eq("client_id", PPC_MEDIA_CLIENT_ID)
        .gte("date", from)
        .lte("date", to)
        .limit(20000);
      if (error) throw error;
      return (data || []).filter((r) => {
        const p = (r.platform || "").toLowerCase();
        return p === "meta" || p === "facebook";
      }) as unknown as PpcCampaignConfigRow[];
    },
  });
}

/** Ad sets with their audience and optimisation settings. */
export function usePpcAdSets() {
  const { from, to } = useWindow();
  return useQuery({
    queryKey: ["ppc-ad-sets", from, to],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_sets")
        .select(
          "date, campaign_name, adset_name, platform_adset_id, status, spend, impressions, clicks, conversions, reach, frequency, bid_strategy, bid_amount, billing_event, optimization_goal, daily_budget, lifetime_budget, audience_summary, targeting",
        )
        .eq("client_id", PPC_MEDIA_CLIENT_ID)
        .eq("platform", "meta")
        .gte("date", from)
        .lte("date", to)
        .limit(20000);
      if (error) throw error;
      return (data || []) as unknown as PpcAdSetRow[];
    },
  });
}

/**
 * Ads with their creative. These are Meta's own snapshot rows (date_from/date_to),
 * not a daily series, so they are never summed with the daily spend above — they rank
 * creatives against each other inside the snapshot window Meta returned.
 */
export function usePpcAds() {
  return useQuery({
    queryKey: ["ppc-ads"],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_creatives")
        .select(
          "ad_name, platform_ad_id, adset_name, campaign_name, status, creative_type, headline, primary_text, cta, creative_thumbnail_url, spend, impressions, clicks, conversions, date_from, date_to",
        )
        .eq("client_id", PPC_MEDIA_CLIENT_ID)
        .eq("platform", "meta")
        .limit(5000);
      if (error) throw error;
      return (data || []) as unknown as PpcAdRow[];
    },
  });
}

/** Whether Meta spend is actually flowing yet, and when it last arrived. */
export function usePpcMetaConnection() {
  return useQuery({
    queryKey: ["ppc-meta-connection"],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_connections")
        .select("account_name, selected_ad_account, status, last_synced_at, sync_error")
        .eq("client_id", PPC_MEDIA_CLIENT_ID)
        .eq("platform", "meta")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
