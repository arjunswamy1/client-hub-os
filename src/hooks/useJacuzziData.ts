import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { format } from "date-fns";

export const JACUZZI_CLIENT_ID = "dc25f274-20f4-4650-b0cc-654073b925f4";

/** Stations we get paid against. CT14 is the live Roku campaign. */
export const JACUZZI_STATIONS = ["CT14", "CT13", "CT12", "CT26"] as const;

export const STATION_NOTES: Record<string, string> = {
  CT14: "Main Roku campaign",
  CT13: "Affiliate station (unused) — QR scans re-attributed to CT14",
  CT12: "Legacy AI Digital flight",
  CT26: "Bonus calls — residual media",
};

export interface JacuzziLead {
  id: string;
  transaction_id: string;
  transaction_date: string;
  transaction_time: string | null;
  lead_type: string; // 'call' | 'qr'
  station_code: string | null;
  attributed_station: string | null;
  toll_free_number: string | null;
  caller_ani: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  call_status: string | null;
  payout_rate: number;
  source: string;
}

export interface JacuzziDelivery {
  date: string;
  station_code: string;
  campaign_name: string | null;
  impressions: number;
  spend: number;
  cpm: number;
}

export interface JacuzziHourly {
  date: string;
  hour: number;
  station_code: string;
  impressions: number;
  spend: number;
}

export interface JacuzziRate {
  effective_from: string;
  rate: number;
}

function useDates() {
  const { dateRange } = useDateRange();
  return {
    from: format(dateRange.from, "yyyy-MM-dd"),
    to: format(dateRange.to, "yyyy-MM-dd"),
  };
}

export function useJacuzziLeads() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["jacuzzi-leads", from, to],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jacuzzi_leads")
        .select(
          "id, transaction_id, transaction_date, transaction_time, lead_type, station_code, attributed_station, toll_free_number, caller_ani, billing_city, billing_state, billing_zip, call_status, payout_rate, source"
        )
        .eq("client_id", JACUZZI_CLIENT_ID)
        .gte("transaction_date", from)
        .lte("transaction_date", to)
        .order("transaction_date", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data || []) as JacuzziLead[];
    },
  });
}

export function useJacuzziDelivery() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["jacuzzi-delivery", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jacuzzi_delivery")
        .select("date, station_code, campaign_name, impressions, spend, cpm")
        .eq("client_id", JACUZZI_CLIENT_ID)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data || []) as JacuzziDelivery[];
    },
  });
}

export function useJacuzziHourly() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["jacuzzi-hourly", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jacuzzi_hourly_delivery")
        .select("date, hour, station_code, impressions, spend")
        .eq("client_id", JACUZZI_CLIENT_ID)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true })
        .limit(10000);
      if (error) throw error;
      return (data || []) as JacuzziHourly[];
    },
  });
}

/** Roku connection state for Jacuzzi — powers the hourly sync status/button. */
export function useRokuHourlyStatus() {
  return useQuery({
    queryKey: ["jacuzzi-roku-connection"],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_connections")
        .select("id, status, last_synced_at, sync_error, metadata")
        .eq("platform", "roku")
        .eq("client_id", JACUZZI_CLIENT_ID)
        .maybeSingle();
      if (error) throw error;
      return data as {
        id: string; status: string | null; last_synced_at: string | null;
        sync_error: string | null; metadata: Record<string, any> | null;
      } | null;
    },
  });
}

/** Kicks the Roku hourly delivery sync (also runs automatically every 15 min). */
export function useSyncRokuHourly() {
  const qc = useQueryClient();
  return async (days = 3) => {
    const { data, error } = await supabase.functions.invoke("sync-roku-hourly", {
      body: { client_id: JACUZZI_CLIENT_ID, days },
    });
    if (error) throw error;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["jacuzzi-hourly"] }),
      qc.invalidateQueries({ queryKey: ["jacuzzi-delivery"] }),
      qc.invalidateQueries({ queryKey: ["jacuzzi-roku-connection"] }),
    ]);
    return data as { success?: boolean; pending?: boolean; status?: string; hourly?: number; daily?: number; error?: string };
  };
}

export function useJacuzziRates() {

  return useQuery({
    queryKey: ["jacuzzi-rates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jacuzzi_payout_rates")
        .select("effective_from, rate")
        .eq("client_id", JACUZZI_CLIENT_ID)
        .order("effective_from", { ascending: true });
      if (error) throw error;
      return (data || []) as JacuzziRate[];
    },
  });
}

/** Payout in effect on a given date (YYYY-MM-DD). */
export function rateForDate(rates: JacuzziRate[], date: string): number {
  let rate = 0;
  for (const r of rates) {
    if (date >= r.effective_from) rate = Number(r.rate);
  }
  return rate;
}

export interface ParsedLead {
  transaction_id: string;
  transaction_date: string;
  transaction_time: string | null;
  lead_type: string;
  station_code: string | null;
  attributed_station: string | null;
  toll_free_number: string | null;
  caller_ani: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  call_status: string | null;
}

function normDate(v: string): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : format(d, "yyyy-MM-dd");
}

/**
 * Parses a pasted copy of the client's TM recognized-lead sheet (tab or comma
 * separated, header row required). QR rows carry the station in Script Version;
 * CT13 QR scans are re-attributed to CT14 (wrong QR code on a CT14 creative).
 */
export function parseTmSheet(text: string): ParsedLead[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase().replace(/"/g, ""));
  const idx = (name: string) => header.findIndex((h) => h === name);
  const cols = {
    tid: idx("transaction id"),
    date: idx("transaction date"),
    time: idx("transaction time"),
    detail: idx("record detail"),
    status: idx("calls status"),
    tfn: idx("toll free number"),
    station: idx("station code"),
    script: idx("script version"),
    ani: idx("caller ani"),
    city: idx("billing city"),
    state: idx("billing state"),
    zip: idx("billing zip code"),
  };
  const out: ParsedLead[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(delim).map((v) => v.trim().replace(/^"|"$/g, ""));
    const get = (i: number) => (i >= 0 && c[i] ? c[i] : "");
    const tid = get(cols.tid);
    const date = normDate(get(cols.date));
    if (!tid || !date) continue;
    const station = get(cols.station).toUpperCase();
    const script = get(cols.script).toUpperCase();
    const isQr = get(cols.detail).toUpperCase() === "QR" || station === "QR";
    const rawStation = isQr ? (script.startsWith("CT") ? script : station) : station;
    const attributed = isQr && (rawStation === "CT13" || rawStation === "CT14") ? "CT14" : rawStation;
    const timeRaw = get(cols.time);
    out.push({
      transaction_id: tid,
      transaction_date: date,
      transaction_time: /\d{1,2}:\d{2}/.test(timeRaw) ? timeRaw.split(" ").pop()!.slice(0, 8) : null,
      lead_type: isQr ? "qr" : "call",
      station_code: rawStation || null,
      attributed_station: attributed || null,
      toll_free_number: get(cols.tfn) || null,
      caller_ani: get(cols.ani) || null,
      billing_city: get(cols.city) || null,
      billing_state: get(cols.state) || null,
      billing_zip: get(cols.zip) || null,
      call_status: get(cols.status) || null,
    });
  }
  return out;
}

export function useImportLeads() {
  const qc = useQueryClient();
  return async (rows: ParsedLead[], rates: JacuzziRate[]) => {
    const payload = rows.map((r) => ({
      ...r,
      client_id: JACUZZI_CLIENT_ID,
      payout_rate: rateForDate(rates, r.transaction_date),
      source: "client_sheet",
    }));
    const { error } = await supabase
      .from("jacuzzi_leads")
      .upsert(payload, { onConflict: "client_id,transaction_id" });
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["jacuzzi-leads"] });
    return payload.length;
  };
}

/* ------------------------------------------------------------------ *
 * Daily reconciliation: RingFuel tracked calls vs. recognized leads
 * ------------------------------------------------------------------ */

export interface ReconDaily {
  date: string;
  applied_rate: number;
  rate_effective_from: string | null;
  leads_total: number;
  call_leads: number;
  qr_leads: number;
  ringfuel_calls: number;
  matched_count: number;
  unmatched_leads: number;
  unmatched_calls: number;
  station_mismatches: number;
  rate_mismatches: number;
  expected_revenue: number;
  by_station: Record<string, { leads: number; calls: number; qr: number; matched: number; station_mismatches: number; revenue: number }>;
  generated_at: string;
}

export interface ReconMatch {
  id: string;
  date: string;
  status: string;
  match_method: string | null;
  transaction_id: string | null;
  lead_type: string | null;
  lead_station: string | null;
  ringfuel_call_id: string | null;
  ringfuel_did: string | null;
  ringfuel_station: string | null;
  caller_number: string | null;
  station_agrees: boolean | null;
  lead_payout_rate: number | null;
  expected_rate: number | null;
  rate_agrees: boolean | null;
  notes: string | null;
}

export function useJacuzziRecon() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["jacuzzi-recon-daily", from, to],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jacuzzi_reconciliation_daily")
        .select("date, applied_rate, rate_effective_from, leads_total, call_leads, qr_leads, ringfuel_calls, matched_count, unmatched_leads, unmatched_calls, station_mismatches, rate_mismatches, expected_revenue, by_station, generated_at")
        .eq("client_id", JACUZZI_CLIENT_ID)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ReconDaily[];
    },
  });
}

export function useJacuzziReconMatches(onlyExceptions = true) {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["jacuzzi-recon-matches", from, to, onlyExceptions],
    queryFn: async () => {
      let q = supabase
        .from("jacuzzi_reconciliation_matches")
        .select("id, date, status, match_method, transaction_id, lead_type, lead_station, ringfuel_call_id, ringfuel_did, ringfuel_station, caller_number, station_agrees, lead_payout_rate, expected_rate, rate_agrees, notes")
        .eq("client_id", JACUZZI_CLIENT_ID)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: false })
        .limit(2000);
      if (onlyExceptions) q = q.neq("status", "matched");
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as ReconMatch[];
    },
  });
}

/** Re-runs reconciliation for the trailing window (also runs daily on its own). */
export function useRunRecon() {
  const qc = useQueryClient();
  return async (days = 30) => {
    const { data, error } = await supabase.functions.invoke("jacuzzi-reconcile", {
      body: { client_id: JACUZZI_CLIENT_ID, days },
    });
    if (error) throw error;
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["jacuzzi-recon-daily"] }),
      qc.invalidateQueries({ queryKey: ["jacuzzi-recon-matches"] }),
    ]);
    return data as { success?: boolean; days?: number; matched?: number; unmatched_leads?: number; unmatched_calls?: number; station_mismatches?: number; rate_mismatches?: number; error?: string };
  };
}

/* ------------------------------------------------------------------ *
 * Roku breakdowns (geo / DMA / placement / creative)
 * ------------------------------------------------------------------ */

export interface RokuBreakdownRow {
  date: string;
  entity: string;
  entity_name: string;
  spend: number;
  impressions: number;
}

/** Roku spend broken out by state, metro market, placement and creative. */
export function useRokuBreakdowns() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["jacuzzi-roku-breakdowns", from, to],
    refetchInterval: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roku_daily_metrics")
        .select("date, entity, entity_name, spend, impressions")
        .eq("client_id", JACUZZI_CLIENT_ID)
        .gte("date", from)
        .lte("date", to)
        .limit(20000);
      if (error) throw error;
      return (data || []).map((r: any) => ({
        date: r.date,
        entity: r.entity,
        entity_name: r.entity_name ?? "Unknown",
        spend: Number(r.spend || 0),
        impressions: Number(r.impressions || 0),
      })) as RokuBreakdownRow[];
    },
  });
}

/** Pulls fresh geo/placement/creative reports from the Roku Ads API. */
export function useSyncRokuBreakdowns() {
  const qc = useQueryClient();
  return async (days = 90, entities?: string[]) => {
    const invoke = async () => {
      const { data, error } = await supabase.functions.invoke("sync-roku-dimensions", {
        body: { client_id: JACUZZI_CLIENT_ID, days, ...(entities ? { entities } : {}) },
      });
      if (error) throw error;
      return data as { success?: boolean; results?: Record<string, number | string>; error?: string };
    };

    let data = await invoke();
    // Roku builds dimension reports asynchronously. Keep collecting completed
    // reports in the same user action instead of requiring repeated button clicks.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const values = Object.values(data?.results ?? {});
      const waiting = values.some((value) =>
        typeof value === "string" && (value === "queued" || value.startsWith("pending")),
      );
      if (!waiting) break;
      await new Promise((resolve) => window.setTimeout(resolve, 10_000));
      data = await invoke();
    }
    await qc.invalidateQueries({ queryKey: ["jacuzzi-roku-breakdowns"] });
    return data;
  };
}

/** RingFuel tracked calls with caller geo — raw call volume by state. */
export function useJacuzziRingfuelGeo() {
  const { from, to } = useDates();
  return useQuery({
    queryKey: ["jacuzzi-ringfuel-geo", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ringfuel_calls")
        .select("call_start, caller_state, caller_city, connected, duration_seconds")
        .eq("client_id", JACUZZI_CLIENT_ID)
        .gte("call_start", `${from}T00:00:00`)
        .lte("call_start", `${to}T23:59:59`)
        .limit(10000);
      if (error) throw error;
      return (data || []) as {
        call_start: string; caller_state: string | null; caller_city: string | null;
        connected: boolean | null; duration_seconds: number | null;
      }[];
    },
  });
}
