import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { uaFetch, pickNum, pickStr } from "../_shared/universal-ads.ts";

const CANNABALL_CLIENT_ID = "a1dabea1-5518-4c7f-a29d-23739cb52f9b";
/** Universal Ads advanced-report dimensions we care about. */
const DIMENSIONS = ["state", "dma", "zip_code"] as const;
type Dim = typeof DIMENSIONS[number];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Rows can arrive inline or behind a signed download URL (JSON or CSV). */
async function extractRows(parsed: any): Promise<any[]> {
  const inline =
    parsed?.data?.rows ?? parsed?.rows ?? parsed?.results ??
    (Array.isArray(parsed?.data) ? parsed.data : null);
  if (Array.isArray(inline)) return inline;

  const url =
    parsed?.download_url ?? parsed?.result_url ?? parsed?.url ??
    parsed?.data?.download_url ?? parsed?.data?.url ?? null;
  if (!url) return [];

  const res = await fetch(url);
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) return j;
    if (Array.isArray(j?.rows)) return j.rows;
    if (Array.isArray(j?.data)) return j.data;
  } catch { /* fall through to CSV */ }

  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines.shift()!.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.map((line) => {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, cols[i]]));
  });
}

function statusOf(parsed: any): string {
  return String(
    parsed?.status ?? parsed?.state ?? parsed?.data?.status ?? parsed?.data?.state ?? "",
  ).toUpperCase();
}

const NAME_KEYS: Record<Dim, string[]> = {
  state: ["state", "state_name", "region", "dimension_value"],
  dma: ["dma", "dma_name", "metro", "dimension_value"],
  zip_code: ["zip_code", "zip", "postal_code", "dimension_value"],
};

export function mapRows(clientId: string, dim: Dim, fallbackDate: string, rows: any[]) {
  const out = rows.map((r) => {
    const date = (pickStr(r, ["date", "day", "report_date", "start_date", "datetime", "timestamp"]) ?? fallbackDate).slice(0, 10);
    const spend = pickNum(r, ["spend", "cost", "amount_spent", "total_spend", "spend_usd"]);
    const micros = pickNum(r, ["spend_micros", "cost_micros"]);
    return {
      client_id: clientId,
      date,
      entity: dim,
      entity_name: pickStr(r, NAME_KEYS[dim]) ?? "Unknown",
      campaign_name: pickStr(r, ["campaign_name", "campaign", "campaign_id"]),
      creative_name: pickStr(r, ["ad_name", "ad", "creative_name", "ad_id"]),
      spend: spend || micros / 1_000_000,
      impressions: Math.round(pickNum(r, ["impressions", "impression", "total_impressions"])),
      clicks: Math.round(pickNum(r, ["clicks", "click", "total_clicks"])),
      raw: r,
    };
  }).filter((r) => r.spend > 0 || r.impressions > 0);

  // Collapse duplicate keys before upserting.
  const merged = new Map<string, typeof out[number]>();
  for (const row of out) {
    const key = `${row.date}|${row.entity}|${row.entity_name}|${row.campaign_name}|${row.creative_name}`;
    const hit = merged.get(key);
    if (hit) {
      hit.spend += row.spend;
      hit.impressions += row.impressions;
      hit.clicks += row.clicks;
    } else merged.set(key, row);
  }
  return [...merged.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const API_KEY = Deno.env.get("UNIVERSAL_ADS_APP_KEY");
    const PRIVATE_KEY = Deno.env.get("UNIVERSAL_ADS_PRIVATE_KEY");
    if (!API_KEY || !PRIVATE_KEY) return json({ error: "Universal Ads credentials are not configured" }, 400);

    const isCron = req.headers.get("Lovable-Context") === "cron";
    if (!isCron) {
      const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
      if (!token) return json({ error: "Not authenticated" }, 401);
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
      const { data: isAdmin } = await admin.rpc("is_admin", { check_user_id: userData.user.id });
      if (!isAdmin) return json({ error: "Admin access required" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const clientId: string = body.client_id || CANNABALL_CLIENT_ID;
    const days = Math.min(Math.max(Number(body.days ?? 45), 1), 120);
    const dims: Dim[] = Array.isArray(body.dimensions) && body.dimensions.length
      ? body.dimensions.filter((d: string) => (DIMENSIONS as readonly string[]).includes(d))
      : [...DIMENSIONS];

    const { data: conn } = await admin
      .from("platform_connections")
      .select("account_id")
      .eq("client_id", clientId)
      .eq("platform", "universal_ads")
      .maybeSingle();
    const adaccountId: string | null = body.adaccount_id || conn?.account_id || null;
    if (!adaccountId) return json({ error: "No Universal Ads ad account saved for this client" }, 400);

    const end = body.end_date ? new Date(`${body.end_date}T00:00:00Z`) : new Date();
    const start = body.start_date
      ? new Date(`${body.start_date}T00:00:00Z`)
      : new Date(end.getTime() - (days - 1) * 86400000);

    const results: Record<string, string | number> = {};

    /** Reads a finished report and stores its rows. */
    const collect = async (jobId: string, reportId: string, dim: Dim) => {
      const res = await uaFetch(API_KEY, PRIVATE_KEY, "GET", `/report/advanced_report/${reportId}`);
      if (res.status >= 400) {
        await admin.from("universal_ads_report_jobs")
          .update({ status: "failed", last_error: (res.text || "").slice(0, 500) })
          .eq("id", jobId);
        return `failed (${res.status})`;
      }
      const state = statusOf(res.parsed);
      if (state && !["COMPLETE", "COMPLETED", "SUCCESS", "SUCCEEDED", "READY", "DONE"].includes(state)) {
        return `pending (${state.toLowerCase()})`;
      }
      const rows = await extractRows(res.parsed);
      const mapped = mapRows(clientId, dim, ymd(end), rows);
      if (mapped.length) {
        const { error } = await admin.from("universal_ads_geo_metrics").upsert(mapped, {
          onConflict: "client_id,date,entity,entity_name,campaign_name,creative_name",
        });
        if (error) throw error;
      }
      await admin.from("universal_ads_report_jobs")
        .update({ status: "complete", rows_written: mapped.length })
        .eq("id", jobId);
      return mapped.length;
    };

    // Finish any reports still pending from an earlier run.
    const { data: pending = [] } = await admin
      .from("universal_ads_report_jobs")
      .select("id, scheduled_report_id, dimension")
      .eq("client_id", clientId)
      .eq("status", "pending");
    for (const job of pending ?? []) {
      try {
        results[`${job.dimension} (previous)`] = await collect(job.id, job.scheduled_report_id, job.dimension as Dim);
      } catch (e) {
        results[`${job.dimension} (previous)`] = `error: ${(e as Error).message}`;
      }
    }

    for (const dim of dims) {
      const sched = await uaFetch(API_KEY, PRIVATE_KEY, "POST", "/report/advanced_report", {}, {
        start_date: `${ymd(start)}T00:00:00`,
        end_date: `${ymd(end)}T23:59:59`,
        entity_level: "ad",
        adaccount_ids: [adaccountId],
        dimensions: [dim],
        time_aggregation: "day",
        limit: 100000,
      });
      if (sched.status >= 400) {
        results[dim] = `schedule failed (${sched.status})`;
        continue;
      }
      const reportId =
        sched.parsed?.scheduled_report_id ?? sched.parsed?.id ??
        sched.parsed?.data?.scheduled_report_id ?? sched.parsed?.data?.id;
      if (!reportId) {
        results[dim] = "no report id returned";
        continue;
      }

      const { data: job } = await admin.from("universal_ads_report_jobs").insert({
        client_id: clientId,
        scheduled_report_id: String(reportId),
        dimension: dim,
        start_date: ymd(start),
        end_date: ymd(end),
      }).select("id").single();

      // Universal builds these asynchronously — poll briefly, otherwise leave it pending.
      let outcome: string | number = "queued";
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await new Promise((r) => setTimeout(r, 5000));
        outcome = await collect(job!.id, String(reportId), dim);
        if (typeof outcome === "number" || !String(outcome).startsWith("pending")) break;
      }
      results[dim] = outcome;
    }

    return json({
      success: true,
      adaccount_id: adaccountId,
      range: { start: ymd(start), end: ymd(end) },
      results,
    });
  } catch (e) {
    console.error("sync-universal-ads-geo error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
