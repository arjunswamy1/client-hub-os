import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDateRange } from "@/contexts/DateRangeContext";
import { format } from "date-fns";
import { BUYOLOGY_CLIENT_ID, BuyologyCall } from "./useBuyologyData";
import {
  ProductLine,
  classifyCreative,
  classifyName,
  qualityScore,
  QUALIFIED_SECONDS,
  PREMIUM_SECONDS,
} from "@/lib/buyologyProductLines";

const UTM_CONTENT = "tag:User:utm_content";
const CREATIVE_TAG = "tag:User:creative";

const norm = (s?: string | null) => (s || "").trim().toLowerCase();
const isAdId = (s?: string | null) => !!s && /^\d{8,}$/.test(s.trim());

export interface CreativeRow {
  key: string;
  adName: string;
  line: ProductLine;
  campaigns: string[];
  adsets: string[];
  format: string | null;
  thumbnailUrl: string | null;
  status: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  /** calls attributed via utm_content / creative tag */
  total: number;
  connected: number;
  qualified: number;
  premium: number;
  converted: number;
  avgDuration: number;
  qualityScore: number;
  cpl: number; // cost per raw call
  cpqc: number; // cost per qualified call
  cpConv: number;
  matched: boolean;
}

export interface LineTotals {
  line: ProductLine;
  spend: number;
  impressions: number;
  clicks: number;
  total: number;
  connected: number;
  qualified: number;
  premium: number;
  converted: number;
  revenue: number;
  avgDuration: number;
  qualityScore: number;
  cpl: number;
  cpqc: number;
  cpConv: number;
  connectRate: number;
  qualifiedRate: number;
  convertRate: number;
}

export interface CallWithCreative extends BuyologyCall {
  line: ProductLine;
  creativeKey: string | null;
  creativeName: string | null;
}

function emptyLine(line: ProductLine): LineTotals {
  return {
    line, spend: 0, impressions: 0, clicks: 0, total: 0, connected: 0, qualified: 0,
    premium: 0, converted: 0, revenue: 0, avgDuration: 0, qualityScore: 0, cpl: 0,
    cpqc: 0, cpConv: 0, connectRate: 0, qualifiedRate: 0, convertRate: 0,
  };
}

/**
 * Lifetime creative-level analysis for BuyologyIQ.
 * Joins Meta creative spend (lifetime, from the creative sync) with Ringba calls
 * attributed through the utm_content / creative tags captured on each call.
 */
export function useBuyologyCreativeAnalysis() {
  return useQuery({
    queryKey: ["buyology-creative-analysis"],
    queryFn: async () => {
      // Only publishers attributed to CPM on the economics records count as our
      // traffic; the Ringba campaigns carry many publishers' calls.
      const { data: ecoRows, error: ecoError } = await supabase
        .from("media_brain_economics")
        .select("attributed_publishers")
        .eq("client_id", BUYOLOGY_CLIENT_ID);
      if (ecoError) throw ecoError;
      const publishers = [
        ...new Set(
          (ecoRows || []).flatMap((r) => (r.attributed_publishers as string[] | null) || []).filter(Boolean)
        ),
      ];

      const [creativesRes, callsRes] = await Promise.all([
        supabase
          .from("ad_creatives")
          .select(
            "ad_name, adset_name, campaign_name, platform_ad_id, spend, impressions, clicks, status, format, creative_type, creative_thumbnail_url"
          )
          .eq("client_id", BUYOLOGY_CLIENT_ID),
        publishers.length === 0
          ? Promise.resolve({ data: [], error: null })
          : supabase
              .from("ringba_calls")
              .select(
                "call_id, call_date, campaign_name, target_name, caller_number, inbound_number, duration_seconds, connected, converted, revenue, payout, metadata"
              )
              .eq("client_id", BUYOLOGY_CLIENT_ID)
              .or(publishers.map((p) => `metadata->>publisher.eq.${p}`).join(","))
              .limit(50000),
      ]);
      if (creativesRes.error) throw creativesRes.error;
      if (callsRes.error) throw callsRes.error;

      const creatives = creativesRes.data || [];
      const calls = (callsRes.data || []) as BuyologyCall[];

      // ---- Build creative groups keyed by normalized ad name ----
      const rows = new Map<string, CreativeRow>();
      const byAdId = new Map<string, string>(); // platform_ad_id -> group key
      const byName = new Map<string, string>(); // normalized ad name -> group key

      for (const c of creatives) {
        const adName = c.ad_name || "Unnamed creative";
        const key = norm(adName) || "unnamed";
        let row = rows.get(key);
        if (!row) {
          row = {
            key,
            adName,
            line: classifyCreative(c.campaign_name, adName),
            campaigns: [],
            adsets: [],
            format: c.format || c.creative_type || null,
            thumbnailUrl: c.creative_thumbnail_url || null,
            status: c.status || null,
            spend: 0, impressions: 0, clicks: 0, ctr: 0, cpm: 0,
            total: 0, connected: 0, qualified: 0, premium: 0, converted: 0,
            avgDuration: 0, qualityScore: 0, cpl: 0, cpqc: 0, cpConv: 0, matched: true,
          };
          rows.set(key, row);
        }
        row.spend += Number(c.spend || 0);
        row.impressions += Number(c.impressions || 0);
        row.clicks += Number(c.clicks || 0);
        if (c.campaign_name && !row.campaigns.includes(c.campaign_name)) row.campaigns.push(c.campaign_name);
        if (c.adset_name && !row.adsets.includes(c.adset_name)) row.adsets.push(c.adset_name);
        if (!row.thumbnailUrl && c.creative_thumbnail_url) row.thumbnailUrl = c.creative_thumbnail_url;
        if (c.status === "active") row.status = "active";
        if (c.platform_ad_id) byAdId.set(c.platform_ad_id, key);
        byName.set(key, key);
      }

      // ---- Attribute calls ----
      const durations = new Map<string, number[]>();
      const lines: Record<ProductLine, LineTotals> = {
        tubs: emptyLine("tubs"),
        bath: emptyLine("bath"),
        other: emptyLine("other"),
      };
      const lineDurations: Record<ProductLine, number[]> = { tubs: [], bath: [], other: [] };

      const unattributed = new Map<ProductLine, CreativeRow>();
      const enriched: CallWithCreative[] = [];

      for (const call of calls) {
        const meta = (call.metadata || {}) as Record<string, string>;
        const uc = meta[UTM_CONTENT];
        const tag = meta[CREATIVE_TAG];

        let key: string | undefined;
        if (uc && !isAdId(uc)) key = byName.get(norm(uc));
        if (!key && isAdId(uc)) key = byAdId.get(String(uc).trim());
        if (!key && isAdId(tag)) key = byAdId.get(String(tag).trim());
        if (!key && uc) key = byName.get(norm(uc));

        const dur = Number(call.duration_seconds || 0);
        const line: ProductLine = key
          ? rows.get(key)!.line
          : classifyName(call.campaign_name) !== "other"
            ? classifyName(call.campaign_name)
            : "other";

        let row: CreativeRow;
        if (key) {
          row = rows.get(key)!;
        } else {
          let u = unattributed.get(line);
          if (!u) {
            u = {
              key: `unattributed-${line}`,
              adName: "Unattributed calls",
              line,
              campaigns: [], adsets: [], format: null, thumbnailUrl: null, status: null,
              spend: 0, impressions: 0, clicks: 0, ctr: 0, cpm: 0,
              total: 0, connected: 0, qualified: 0, premium: 0, converted: 0,
              avgDuration: 0, qualityScore: 0, cpl: 0, cpqc: 0, cpConv: 0, matched: false,
            };
            unattributed.set(line, u);
            rows.set(u.key, u);
          }
          row = u;
        }

        row.total++;
        if (call.connected) row.connected++;
        if (dur >= QUALIFIED_SECONDS) row.qualified++;
        if (dur >= PREMIUM_SECONDS) row.premium++;
        if (call.converted) row.converted++;
        if (!durations.has(row.key)) durations.set(row.key, []);
        durations.get(row.key)!.push(dur);

        const lt = lines[line];
        lt.total++;
        if (call.connected) lt.connected++;
        if (dur >= QUALIFIED_SECONDS) lt.qualified++;
        if (dur >= PREMIUM_SECONDS) lt.premium++;
        if (call.converted) lt.converted++;
        lt.revenue += Number(call.revenue || 0);
        lineDurations[line].push(dur);

        enriched.push({
          ...call,
          line,
          creativeKey: key || null,
          creativeName: key ? rows.get(key)!.adName : null,
        });
      }

      // ---- Finalize creative rows ----
      const creativeRows = [...rows.values()].map((r) => {
        const d = durations.get(r.key) || [];
        r.avgDuration = d.length ? d.reduce((s, x) => s + x, 0) / d.length : 0;
        r.ctr = r.impressions ? (r.clicks / r.impressions) * 100 : 0;
        r.cpm = r.impressions ? (r.spend / r.impressions) * 1000 : 0;
        r.qualityScore = qualityScore(r);
        r.cpl = r.total ? r.spend / r.total : 0;
        r.cpqc = r.qualified ? r.spend / r.qualified : 0;
        r.cpConv = r.converted ? r.spend / r.converted : 0;
        return r;
      });

      // ---- Line totals: spend from creative rows of that line ----
      for (const r of creativeRows) {
        const lt = lines[r.line];
        lt.spend += r.spend;
        lt.impressions += r.impressions;
        lt.clicks += r.clicks;
      }
      for (const line of ["tubs", "bath", "other"] as ProductLine[]) {
        const lt = lines[line];
        const d = lineDurations[line];
        lt.avgDuration = d.length ? d.reduce((s, x) => s + x, 0) / d.length : 0;
        lt.qualityScore = qualityScore(lt);
        lt.cpl = lt.total ? lt.spend / lt.total : 0;
        lt.cpqc = lt.qualified ? lt.spend / lt.qualified : 0;
        lt.cpConv = lt.converted ? lt.spend / lt.converted : 0;
        lt.connectRate = lt.total ? lt.connected / lt.total : 0;
        lt.qualifiedRate = lt.total ? lt.qualified / lt.total : 0;
        lt.convertRate = lt.total ? lt.converted / lt.total : 0;
      }

      const attributedCalls = enriched.filter((c) => c.creativeKey).length;

      return {
        creativeRows,
        lines,
        calls: enriched,
        attributionRate: calls.length ? attributedCalls / calls.length : 0,
        totalCalls: calls.length,
      };
    },
  });
}

/** Meta campaign spend split by product line for the active date range */
export function useBuyologyLineSpend() {
  const { dateRange } = useDateRange();
  const from = format(dateRange.from, "yyyy-MM-dd");
  const to = format(dateRange.to, "yyyy-MM-dd");

  return useQuery({
    queryKey: ["buyology-line-spend", from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_campaigns")
        .select("date, campaign_name, spend, impressions, clicks")
        .eq("client_id", BUYOLOGY_CLIENT_ID)
        .gte("date", from)
        .lte("date", to);
      if (error) throw error;

      const totals: Record<ProductLine, { spend: number; impressions: number; clicks: number }> = {
        tubs: { spend: 0, impressions: 0, clicks: 0 },
        bath: { spend: 0, impressions: 0, clicks: 0 },
        other: { spend: 0, impressions: 0, clicks: 0 },
      };
      const campaigns = new Map<string, { name: string; line: ProductLine; spend: number; impressions: number; clicks: number }>();
      /** `${date}|${line}` -> spend */
      const daily = new Map<string, number>();

      for (const r of data || []) {
        const line = classifyName(r.campaign_name);
        totals[line].spend += Number(r.spend || 0);
        totals[line].impressions += Number(r.impressions || 0);
        totals[line].clicks += Number(r.clicks || 0);
        const dKey = `${String(r.date).slice(0, 10)}|${line}`;
        daily.set(dKey, (daily.get(dKey) || 0) + Number(r.spend || 0));
        const c = campaigns.get(r.campaign_name) || {
          name: r.campaign_name, line, spend: 0, impressions: 0, clicks: 0,
        };
        c.spend += Number(r.spend || 0);
        c.impressions += Number(r.impressions || 0);
        c.clicks += Number(r.clicks || 0);
        campaigns.set(r.campaign_name, c);
      }

      return {
        totals,
        daily,
        campaigns: [...campaigns.values()].sort((a, b) => b.spend - a.spend),
      };

    },
  });
}
