import { recordSpendObservations } from "../_shared/metric-revision-log.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { uaFetch, pickNum, pickStr } from "../_shared/universal-ads.ts";

const CANNABALL_CLIENT_ID = "a1dabea1-5518-4c7f-a29d-23739cb52f9b";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
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
    const days = Math.min(Math.max(Number(body.days ?? 30), 1), 120);

    const { data: conn } = await admin
      .from("platform_connections")
      .select("id, account_id")
      .eq("client_id", clientId)
      .eq("platform", "universal_ads")
      .maybeSingle();

    const adaccountId: string | null = body.adaccount_id || conn?.account_id || null;
    if (!adaccountId) return json({ error: "No Universal Ads ad account saved for this client" }, 400);

    const end = body.end_date ? new Date(`${body.end_date}T00:00:00Z`) : new Date();
    const start = body.start_date
      ? new Date(`${body.start_date}T00:00:00Z`)
      : new Date(end.getTime() - (days - 1) * 86400000);

    // Ad-level daily report (falls back to campaign level if ad level is unavailable).
    const PAGE = 20; // Universal Ads caps report page size at 20 rows.
    const baseQuery = {
      adaccount_id: adaccountId,
      start_date: `${ymd(start)}T00:00:00`,
      end_date: `${ymd(end)}T23:59:59`,
      date_aggregation: "DAY",
    };

    const fetchPage = (endpoint: string, offset: number) =>
      uaFetch(API_KEY, PRIVATE_KEY, "GET", endpoint, {
        ...baseQuery,
        limit: String(PAGE),
        offset: String(offset),
      });

    let level = "ad";
    let endpoint = "/report/ad";
    let first = await fetchPage(endpoint, 0);
    if (first.status >= 400) {
      level = "campaign";
      endpoint = "/report/campaign";
      first = await fetchPage(endpoint, 0);
    }
    if (first.status >= 400) {
      return json({ error: "Universal Ads report failed", status: first.status, details: first.parsed ?? first.text }, first.status);
    }

    const extract = (parsed: any): any[] =>
      parsed?.data ?? parsed?.rows ?? (Array.isArray(parsed) ? parsed : []);

    const rows: any[] = extract(first.parsed);
    for (let offset = PAGE; offset < 20000; offset += PAGE) {
      const page = await fetchPage(endpoint, offset);
      if (page.status >= 400) break;
      const pageRows = extract(page.parsed);
      rows.push(...pageRows);
      if (pageRows.length < PAGE) break;
    }

    // Campaign id → name map (ad-level rows only carry the campaign's id).
    const campaignNames = new Map<string, string>();
    const camps = await uaFetch(API_KEY, PRIVATE_KEY, "GET", "/campaign", { adaccount_id: adaccountId, limit: "100" });
    for (const c of camps.parsed?.data ?? []) {
      if (c?.id && c?.name) campaignNames.set(String(c.id), String(c.name));
    }

    // Ad set id → name map (best effort; ad-level rows carry only the ad set id).
    const adsetNames = new Map<string, string>();
    const adsets = await uaFetch(API_KEY, PRIVATE_KEY, "GET", "/adset", { adaccount_id: adaccountId, limit: "100" });
    for (const a of adsets.parsed?.data ?? []) {
      if (a?.id && a?.name) adsetNames.set(String(a.id), String(a.name));
    }

    // One row per date + ad set id + ad id; names never merge two ad sets.
    const finalRows = mapUniversalRows(rows, {
      clientId, level: level as "ad" | "campaign", fallbackDate: ymd(end), campaignNames, adsetNames,
    });

    let legacyRowsReplaced = 0;
    if (finalRows.length) {
      const { error } = await admin
        .from("cannaball_spend")
        .upsert(finalRows, { onConflict: "client_id,date,platform,campaign_name,creative_name,platform_adset_id,platform_ad_id" });
      if (error) throw error;
      // Legacy name-keyed rows (no ad set id) for re-pulled days are superseded by the ad-set rows.
      const keyed = [...new Set(finalRows.filter((r) => r.platform_adset_id).map((r) => r.date))];
      if (keyed.length) {
        const { data: gone, error: delErr } = await admin.from("cannaball_spend").delete()
          .eq("client_id", clientId).eq("platform", "universal_ads").eq("platform_adset_id", "").in("date", keyed).select("id");
        if (delErr) throw delErr;
        legacyRowsReplaced = gone?.length ?? 0;
      }
      await recordSpendObservations(admin, clientId, "cannaball_spend", finalRows.map((r: any) => r.date));
    }

    return json({
      success: true,
      level,
      adaccount_id: adaccountId,
      range: { start: ymd(start), end: ymd(end) },
      rows_returned: rows.length,
      rows_written: finalRows.length,
      total_spend: finalRows.reduce((s, r) => s + r.spend, 0),
      total_impressions: finalRows.reduce((s, r) => s + r.impressions, 0),
    });
  } catch (e) {
    console.error("sync-universal-ads error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
