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
  /**
   * Did RingFuel actually deliver a revenue figure for this call? The live webhook
   * template sends only state/payout/call_id/duration, so revenue on those rows is
   * UNKNOWN — never treat it as zero earnings.
   */
  revenue_captured: boolean | null;
  conversion_captured: boolean | null;
  payload_shape: string | null;
}

/** The server caps every response at 1,000 rows — page through the full window. */
const PAGE_SIZE = 1000;

/** RingFuel is the source of truth for Spektrafin calls and payouts. */
export function useSpektrafinCalls() {
  const { startTs, endTs } = useDates();
  return useQuery({
    queryKey: ["spektrafin-calls", startTs, endTs],

    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const rows: SpektrafinCall[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("ringfuel_calls")
          .select(
            "id, call_id, did, caller_number, caller_state, caller_city, creative_label, campaign_name, call_start, duration_seconds, connection_duration_seconds, connected, converted, payout, revenue, disposition, buyer_name, target_name, recording_url, revenue_captured, conversion_captured, payload_shape",
          )
          .eq("client_id", SPEKTRAFIN_CLIENT_ID)
          // Flagged test deliveries never count as real calls.
          .eq("is_test", false)
          .gte("call_start", startTs)
          .lte("call_start", endTs)
          .order("call_start", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;
        rows.push(...((data || []) as unknown as SpektrafinCall[]));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return rows;
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
      const raw: any[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("roku_daily_metrics")
          .select("date, entity_uid, entity_name, campaign_name, spend, impressions, video_completions")
          .eq("client_id", SPEKTRAFIN_CLIENT_ID)
          .eq("entity", "campaign")
          .gte("date", from)
          .lte("date", to)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        raw.push(...(data || []));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return raw.map((r) => ({
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

export interface RingFuelBreakdownRow {
  dimension: "did" | "campaign" | "publisher";
  key: string;
  calls: number;
  connected: number;
  converted: number;
  revenue_known: number;
  revenue: number;
  duration_seconds: number;
}

/**
 * Revenue by tracking number, RingFuel campaign and publisher. Rolled up in the
 * database rather than the browser because the publisher only exists inside each
 * call's stored payload, and pulling ten thousand payloads to the client to read
 * one field each would be wasteful. Test deliveries are excluded server-side, and
 * revenue counts ONLY calls RingFuel actually reported a figure for.
 */
export function useSpektrafinBreakdowns() {
  const { startTs, endTs } = useDates();
  return useQuery({
    queryKey: ["spektrafin-breakdowns", startTs, endTs],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ringfuel_breakdown", {
        p_client_id: SPEKTRAFIN_CLIENT_ID,
        p_start: startTs,
        p_end: endTs,
      });
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        dimension: r.dimension,
        key: r.key,
        calls: Number(r.calls || 0),
        connected: Number(r.connected || 0),
        converted: Number(r.converted || 0),
        revenue_known: Number(r.revenue_known || 0),
        revenue: Number(r.revenue || 0),
        duration_seconds: Number(r.duration_seconds || 0),
      })) as RingFuelBreakdownRow[];
    },
  });
}


/**
 * When Roku spend was last pulled. Distinct from the browser's own query time —
 * Roku revises same-day spend upward through the day, so freshness of the pull
 * is what tells you whether today's cost per call can be trusted.
 */
export function useSpektrafinRokuFreshness() {
  return useQuery({
    queryKey: ["spektrafin-roku-freshness"],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_connections_safe")
        .select("last_synced_at, status, sync_error")
        .eq("platform", "roku")
        .eq("client_id", SPEKTRAFIN_CLIENT_ID)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { last_synced_at: string | null; status: string | null; sync_error: string | null } | null;
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

export interface SpektrafinHourlyRow {
  date: string;
  hour: number;
  campaign_uid: string;
  campaign_name: string | null;
  impressions: number;
  spend: number;
  video_completions: number;
}

/**
 * Roku hourly delivery per campaign. Roku reports the hour in the ad account's
 * own clock, which is the clock the campaign daypart was set in — stored as sent,
 * never shifted, so "6-6 EST" can be checked against what actually delivered.
 */
export function useSpektrafinHourly() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["spektrafin-roku-hourly", from, to],
    refetchInterval: 10 * 60 * 1000,
    queryFn: async () => {
      const rows: SpektrafinHourlyRow[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("roku_hourly_metrics")
          .select("date, hour, campaign_uid, campaign_name, impressions, spend, video_completions")
          .eq("client_id", SPEKTRAFIN_CLIENT_ID)
          .gte("date", from)
          .lte("date", to)
          .order("date", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(
          ...((data || []) as any[]).map((r) => ({
            date: r.date as string,
            hour: Number(r.hour || 0),
            campaign_uid: r.campaign_uid as string,
            campaign_name: (r.campaign_name ?? null) as string | null,
            impressions: Number(r.impressions || 0),
            spend: Number(r.spend || 0),
            video_completions: Number(r.video_completions || 0),
          })),
        );
        if (!data || data.length < PAGE_SIZE) break;
      }
      return rows;
    },
  });
}

/** When the hourly Roku report last landed — distinct from the daily spend pull. */
export function useSpektrafinHourlyFreshness() {
  return useQuery({
    queryKey: ["spektrafin-roku-hourly-freshness"],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_connections")
        .select("metadata, sync_error")
        .eq("platform", "roku")
        .eq("client_id", SPEKTRAFIN_CLIENT_ID)
        .maybeSingle();
      if (error) throw error;
      const meta = ((data?.metadata ?? {}) as Record<string, any>) || {};
      return {
        hourly_synced_at: (meta.hourly_synced_at ?? null) as string | null,
        pending: Boolean(meta.pending_report_uid),
        sync_error: (data?.sync_error ?? null) as string | null,
      };
    },
  });
}

/** Kicks the asynchronous Roku hourly report for Spektrafin. */
export function useSyncSpektrafinHourly() {
  const qc = useQueryClient();
  return async (days = 7) => {
    const { data, error } = await supabase.functions.invoke("sync-roku-hourly", {
      body: { client_id: SPEKTRAFIN_CLIENT_ID, days },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["spektrafin-roku-hourly"] }),
      qc.invalidateQueries({ queryKey: ["spektrafin-roku-hourly-freshness"] }),
    ]);
    return data as { success?: boolean; pending?: boolean; status?: string; campaign_hours?: number };
  };
}

