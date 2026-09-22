import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { format } from "date-fns";
import { CALLGRID_REPORTING_TZ, zonedTimeToUtcISO } from "@/lib/reportingDay";
import { fetchAllRows } from "@/lib/fetchAllRows";


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
  caller_zip: string | null;
  caller_area_code: string | null;
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
    queryFn: async () =>
      fetchAllRows<CannaballCall>((offset, size) =>
        supabase
          .from("cannaball_calls" as any)
          .select("id, call_id, did, caller_number, caller_state, caller_city, caller_zip, caller_area_code, call_start, duration_seconds, connected, connection_duration_seconds, payout, campaign_name, creative_name, platform, disposition, recording_url")
          .eq("client_id", CANNABALL_CLIENT_ID)
          // CallGrid reports this account in US/Eastern, so the day is cut there, not at UTC midnight.
          .gte("call_start", zonedTimeToUtcISO(from, "00:00:00", CALLGRID_REPORTING_TZ))
          .lte("call_start", zonedTimeToUtcISO(to, "23:59:59", CALLGRID_REPORTING_TZ))
          .order("call_start", { ascending: false })
          .range(offset, offset + size - 1) as any,
      ),
  });
}

export function useCannaballSpend() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["cannaball-spend", from, to],
    queryFn: async () =>
      fetchAllRows<CannaballSpend>((offset, size) =>
        supabase
          .from("cannaball_spend" as any)
          .select("date, platform, campaign_name, creative_name, spend, impressions, clicks")
          .eq("client_id", CANNABALL_CLIENT_ID)
          .gte("date", from)
          .lte("date", to)
          .order("date", { ascending: true })
          .range(offset, offset + size - 1) as any,
      ),
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
      const rows = await fetchAllRows<any>((offset, size) =>
        supabase
          .from("roku_daily_metrics")
          .select("date, entity, entity_name, campaign_name, spend, impressions")
          .eq("client_id", CANNABALL_CLIENT_ID)
          .in("entity", ["state", "dma", "placement"])
          .gte("date", from)
          .lte("date", to)
          .order("date", { ascending: true })
          .range(offset, offset + size - 1) as any,
      );
      return rows.map((r: any) => ({
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

export interface UniversalGeoRow {
  date: string;
  entity: "state" | "dma" | "zip_code";
  entity_name: string;
  campaign_name: string | null;
  creative_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
}

/** Universal Ads state/DMA/ZIP spend rows for Cannaball. */
export function useCannaballUniversalGeo() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["cannaball-universal-geo", from, to],
    refetchInterval: 10 * 60 * 1000,
    queryFn: async () => {
      const rows = await fetchAllRows<any>((offset, size) =>
        supabase
          .from("universal_ads_geo_metrics" as any)
          .select("date, entity, entity_name, campaign_name, creative_name, spend, impressions, clicks")
          .eq("client_id", CANNABALL_CLIENT_ID)
          .gte("date", from)
          .lte("date", to)
          .order("date", { ascending: true })
          .range(offset, offset + size - 1) as any,
      );
      return rows.map((r: any) => ({
        date: r.date,
        entity: r.entity,
        entity_name: r.entity_name ?? "Unknown",
        campaign_name: r.campaign_name ?? null,
        creative_name: r.creative_name ?? null,
        spend: Number(r.spend || 0),
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
      })) as UniversalGeoRow[];
    },

  });
}

/** Requests fresh state/DMA/ZIP reports from the Universal Ads API. */
export function useSyncCannaballUniversalGeo() {
  const qc = useQueryClient();
  return async (days = 45) => {
    const { data, error } = await supabase.functions.invoke("sync-universal-ads-geo", {
      body: { client_id: CANNABALL_CLIENT_ID, days },
    });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["cannaball-universal-geo"] });
    return data as { success?: boolean; results?: Record<string, number | string>; error?: string };
  };
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
