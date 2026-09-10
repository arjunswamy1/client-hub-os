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
        .select("id, call_id, did, caller_number, caller_state, caller_city, call_start, duration_seconds, connected, connection_duration_seconds, payout, campaign_name, creative_name, platform, disposition, recording_url")
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

export interface CannaballBreakdownRow {
  date: string;
  entity: string;
  entity_name: string;
  campaign_name: string | null;
  spend: number;
  impressions: number;
}

/** Roku geo/placement/creative breakdown rows for Cannaball. */
export function useCannaballBreakdowns() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["cannaball-roku-breakdowns", from, to],
    refetchInterval: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roku_daily_metrics")
        .select("date, entity, entity_name, campaign_name, spend, impressions")
        .eq("client_id", CANNABALL_CLIENT_ID)
        .in("entity", ["state", "dma", "placement"])
        .gte("date", from)
        .lte("date", to)
        .limit(20000);
      if (error) throw error;
      return (data || []).map((r: any) => ({
        date: r.date,
        entity: r.entity,
        entity_name: r.entity_name ?? "Unknown",
        campaign_name: r.campaign_name ?? null,
        spend: Number(r.spend || 0),
        impressions: Number(r.impressions || 0),
      })) as CannaballBreakdownRow[];
    },
  });
}

/** Requests fresh state/metro/placement reports from the Roku Ads API. */
export function useSyncCannaballBreakdowns() {
  const qc = useQueryClient();
  return async (days = 45, entities: string[] = ["state", "dma", "placement"]) => {
    const invoke = async () => {
      const { data, error } = await supabase.functions.invoke("sync-roku-dimensions", {
        body: { client_id: CANNABALL_CLIENT_ID, days, entities },
      });
      if (error) throw error;
      return data as { success?: boolean; results?: Record<string, number | string>; error?: string };
    };

    let data = await invoke();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const waiting = Object.values(data?.results ?? {}).some(
        (v) => typeof v === "string" && (v === "queued" || v.startsWith("pending")),
      );
      if (!waiting) break;
      await new Promise((resolve) => window.setTimeout(resolve, 10_000));
      data = await invoke();
    }
    await qc.invalidateQueries({ queryKey: ["cannaball-roku-breakdowns"] });
    return data;
  };
}
