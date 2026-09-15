import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { format } from "date-fns";

export const SPEKTRAFIN_CLIENT_ID = "6386d309-519a-415d-9480-70c9c6d64436";

/** Spektrafin (and RingFuel reporting) runs on America/Puerto_Rico, a fixed UTC-4 with no DST. */
export const SPEKTRAFIN_TZ_OFFSET = "-04:00";

function useDates() {
  const { dateRange } = useDateRange();
  const from = format(dateRange.from, "yyyy-MM-dd");
  const to = format(dateRange.to, "yyyy-MM-dd");
  return {
    from,
    to,
    // Local-day boundaries so counts line up with RingFuel's own reporting
    startTs: `${from}T00:00:00${SPEKTRAFIN_TZ_OFFSET}`,
    endTs: `${to}T23:59:59${SPEKTRAFIN_TZ_OFFSET}`,
  };
}


export interface SpektrafinCall {
  id: string;
  call_id: string;
  did: string | null;
  caller_number: string | null;
  caller_state: string | null;
  caller_city: string | null;
  creative_label: string | null;
  campaign_name: string | null;
  call_start: string;
  duration_seconds: number;
  connection_duration_seconds: number;
  connected: boolean | null;
  converted: boolean | null;
  payout: number;
  revenue: number;
  disposition: string | null;
  buyer_name: string | null;
  target_name: string | null;
  recording_url: string | null;
}

/** RingFuel is the source of truth for Spektrafin calls and payouts. */
export function useSpektrafinCalls() {
  const { startTs, endTs } = useDates();
  return useQuery({
    queryKey: ["spektrafin-calls", startTs, endTs],

    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ringfuel_calls")
        .select(
          "id, call_id, did, caller_number, caller_state, caller_city, creative_label, campaign_name, call_start, duration_seconds, connection_duration_seconds, connected, converted, payout, revenue, disposition, buyer_name, target_name, recording_url",
        )
        .eq("client_id", SPEKTRAFIN_CLIENT_ID)
        .gte("call_start", startTs)
        .lte("call_start", endTs)
        .order("call_start", { ascending: false })
        .limit(20000);

      if (error) throw error;
      return (data || []) as unknown as SpektrafinCall[];
    },
  });
}

export interface SpektrafinSpendRow {
  date: string;
  entity_uid: string;
  entity_name: string | null;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  video_completions: number;
}

/** Roku campaign spend — the only media source for this client. */
export function useSpektrafinRokuSpend() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["spektrafin-roku-spend", from, to],
    refetchInterval: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roku_daily_metrics")
        .select("date, entity_uid, entity_name, campaign_name, spend, impressions, video_completions")
        .eq("client_id", SPEKTRAFIN_CLIENT_ID)
        .eq("entity", "campaign")
        .gte("date", from)
        .lte("date", to)
        .limit(20000);
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        date: r.date,
        entity_uid: r.entity_uid,
        entity_name: r.entity_name ?? null,
        campaign_name: r.campaign_name ?? null,
        spend: Number(r.spend || 0),
        impressions: Number(r.impressions || 0),
        video_completions: Number(r.video_completions || 0),
      })) as SpektrafinSpendRow[];
    },
  });
}

/** Tracking numbers minted for Spektrafin, one per creative. */
export function useSpektrafinNumbers() {
  return useQuery({
    queryKey: ["spektrafin-ringfuel-numbers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ringfuel_numbers")
        .select("id, phone_number, creative_label, campaign_label, ringfuel_campaign_id, status, created_at")
        .eq("client_id", SPEKTRAFIN_CLIENT_ID)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useSyncSpektrafinRoku() {
  const qc = useQueryClient();
  return async (days = 7) => {
    const { data, error } = await supabase.functions.invoke("sync-roku-live", {
      body: { client_id: SPEKTRAFIN_CLIENT_ID, days, entity: "campaign" },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    await qc.invalidateQueries({ queryKey: ["spektrafin-roku-spend"] });
    return data as { metric_rows?: number };
  };
}
