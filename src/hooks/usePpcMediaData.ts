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
