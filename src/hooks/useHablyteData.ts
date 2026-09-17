import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { format } from "date-fns";

export const HABLYTE_CLIENT_ID = "04e9139b-5ea9-4fc4-b911-5c0ee8a540af";

/**
 * Hablyte runs Meta click-to-call ads: the ad dials the tracking number, there is
 * no landing page, so no UTM tags can ever exist on a call. Attribution therefore
 * resolves at campaign/vertical level only — never per ad. The bridge between the
 * two sides is the campaign name, mapped to the same vertical on each platform.
 */
export type HablyteVertical =
  | "Home Insurance"
  | "Auto Insurance"
  | "Pest Control"
  | "Final Expense"
  | "Unclassified";

export const HABLYTE_VERTICALS: HablyteVertical[] = [
  "Home Insurance",
  "Auto Insurance",
  "Pest Control",
  "Final Expense",
];

/** Campaign name → vertical. Applied identically to Meta campaigns and Ringba campaigns. */
export function verticalForCampaign(name: string | null | undefined): HablyteVertical {
  const n = (name || "").toLowerCase();
  if (n.includes("home insurance") || n.includes("home ins")) return "Home Insurance";
  if (n.includes("auto insurance") || n.includes("auto ins") || n.includes("auto rtb") || n.includes("auto ")) {
    return "Auto Insurance";
  }
  if (n.includes("pest")) return "Pest Control";
  if (n.includes("final expense")) return "Final Expense";
  return "Unclassified";
}

export interface HablyteCall {
  call_id: string;
  call_date: string;
  campaign_name: string | null;
  target_name: string | null;
  caller_number: string | null;
  did: string | null;
  duration_seconds: number | null;
  connected: boolean | null;
  converted: boolean | null;
  revenue: number;
  payout: number;
  metadata: Record<string, unknown> | null;
}

export interface HablyteSpendRow {
  date: string;
  campaign_name: string | null;
  platform: string | null;
  spend: number;
  impressions: number;
  clicks: number;
}

function useWindow() {
  const { dateRange } = useDateRange();
  return {
    from: format(dateRange.from, "yyyy-MM-dd"),
    to: format(dateRange.to, "yyyy-MM-dd"),
  };
}

/**
 * Publishers attributed to CPM's buying, read from the client's economics records.
 * Hablyte's Ringba account carries 24 publishers; only their own traffic belongs in
 * a spend-vs-revenue read. Read, never defaulted — an unconfigured record returns an
 * empty list and no calls, rather than everyone's traffic.
 */
async function fetchAttributedPublishers(): Promise<string[]> {
  const { data, error } = await supabase
    .from("media_brain_economics")
    .select("attributed_publishers")
    .eq("client_id", HABLYTE_CLIENT_ID);
  if (error) throw error;
  const set = new Set<string>();
  for (const row of data || []) {
    for (const p of ((row.attributed_publishers as string[] | null) || [])) {
      if (p) set.add(p);
    }
  }
  return [...set];
}

export function useHablytePublishers() {
  return useQuery({
    queryKey: ["hablyte-publishers"],
    queryFn: fetchAttributedPublishers,
  });
}

const PAGE_SIZE = 1000;

/** Ringba calls for Hablyte, scoped to the attributed publishers, fully paged. */
export function useHablyteCalls() {
  const { from, to } = useWindow();
  return useQuery({
    queryKey: ["hablyte-calls", from, to],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const publishers = await fetchAttributedPublishers();
      if (publishers.length === 0) return [] as HablyteCall[];
      const filter = publishers.map((p) => `metadata->>publisher.eq.${p}`).join(",");
      const rows: HablyteCall[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("ringba_calls")
          .select(
            "call_id, call_date, campaign_name, target_name, caller_number, did, duration_seconds, connected, converted, revenue, payout, metadata",
          )
          .eq("client_id", HABLYTE_CLIENT_ID)
          .or(filter)
          .gte("call_date", `${from}T00:00:00`)
          .lte("call_date", `${to}T23:59:59`)
          .order("call_date", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...((data || []) as unknown as HablyteCall[]));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return rows;
    },
  });
}

/** Meta spend per campaign per day — the campaign name carries the vertical. */
export function useHablyteMetaSpend() {
  const { from, to } = useWindow();
  return useQuery({
    queryKey: ["hablyte-meta-spend", from, to],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_campaigns")
        .select("date, campaign_name, platform, spend, impressions, clicks")
        .eq("client_id", HABLYTE_CLIENT_ID)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true })
        .limit(20000);
      if (error) throw error;
      return (data || []).filter((r) => {
        const p = (r.platform || "").toLowerCase();
        return p === "meta" || p === "facebook";
      }) as HablyteSpendRow[];
    },
  });
}

/** When Meta spend was last pulled for this client. */
export function useHablyteMetaFreshness() {
  return useQuery({
    queryKey: ["hablyte-meta-freshness"],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_connections")
        .select("account_name, selected_ad_account, last_synced_at, sync_error")
        .eq("client_id", HABLYTE_CLIENT_ID)
        .eq("platform", "meta")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/** US state name (Meta's `region`) → two-letter code (Ringba's caller state). */
const STATE_CODES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY",
  Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA",
  "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "Puerto Rico": "PR",
};

export function stateCode(region: string | null | undefined): string {
  if (!region) return "Unknown";
  return STATE_CODES[region] ?? region;
}

export interface HablyteGeoSpendRow {
  date: string;
  region: string;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
}

/**
 * Meta spend per state. This is delivery geography — where the impression served —
 * which is a different measurement from the caller's state on a call. They are shown
 * side by side, never treated as one field.
 */
export function useHablyteGeoSpend() {
  const { from, to } = useWindow();
  return useQuery({
    queryKey: ["hablyte-geo-spend", from, to],
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const rows: HablyteGeoSpendRow[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("meta_geo_metrics")
          .select("date, region, campaign_name, spend, impressions, clicks")
          .eq("client_id", HABLYTE_CLIENT_ID)
          .gte("date", from)
          .lte("date", to)
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...((data || []) as unknown as HablyteGeoSpendRow[]));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return rows;
    },
  });
}
