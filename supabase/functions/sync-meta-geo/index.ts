import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Meta spend broken out by US state (Graph's `region` breakdown), per campaign per
 * day. Written to meta_geo_metrics only — never to ad_campaigns or ad_daily_metrics,
 * so the account-level spend read stays the single source it already is.
 *
 * Regions are Meta's own delivery geography (where the impression served), which is
 * not the same thing as the caller's state on a call. The two are compared as two
 * separate measurements; nothing is joined as if they were one field.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let clientId: string | null = null;
    let daysBack = 30;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        clientId = body?.client_id ?? null;
        daysBack = Math.min(Math.max(Number(body?.days_back ?? 30) || 30, 1), 180);
      } catch { /* defaults */ }
    }

    let q = supabase
      .from("platform_connections")
      .select("client_id, access_token, metadata, selected_ad_account")
      .eq("platform", "meta");
    if (clientId) q = q.eq("client_id", clientId);
    const { data: connections, error: connErr } = await q;
    if (connErr) throw connErr;
    if (!connections?.length) {
      return new Response(JSON.stringify({ success: false, error: "No Meta connection found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
    const until = new Date().toISOString().slice(0, 10);
    const results: Record<string, unknown>[] = [];

    for (const conn of connections) {
      const syncAccounts = (conn.metadata as Record<string, unknown> | null)?.sync_ad_accounts as
        | Array<{ id: string; name?: string }>
        | undefined;
      const selected = conn.selected_ad_account as { id?: string; name?: string } | null;
      const accounts = Array.isArray(syncAccounts) && syncAccounts.length
        ? syncAccounts
        : (selected?.id ? [selected as { id: string; name?: string }] : []);
      if (!accounts.length) {
        results.push({ client_id: conn.client_id, skipped: "no ad account selected" });
        continue;
      }

      for (const acct of accounts) {
        const rows: Record<string, unknown>[] = [];
        let url =
          `https://graph.facebook.com/v21.0/${acct.id}/insights` +
          `?level=campaign&breakdowns=region&time_increment=1&limit=500` +
          `&fields=campaign_id,campaign_name,spend,impressions,clicks,region,country` +
          `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
          `&access_token=${conn.access_token}`;

        let pages = 0;
        let apiError: string | null = null;
        while (url && pages < 40) {
          pages++;
          const res = await fetch(url);
          const json = await res.json();
          if (json?.error) {
            apiError = String(json.error.message || "Meta API error");
            break;
          }
          for (const r of json?.data ?? []) {
            if (!r.region) continue;
            rows.push({
              client_id: conn.client_id,
              date: r.date_start,
              platform_campaign_id: r.campaign_id ?? null,
              campaign_name: r.campaign_name ?? null,
              region: r.region,
              country: r.country ?? null,
              spend: Number(r.spend || 0),
              impressions: Number(r.impressions || 0),
              clicks: Number(r.clicks || 0),
              raw: r,
            });
          }
          url = json?.paging?.next ?? "";
        }

        let written = 0;
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const { error } = await supabase
            .from("meta_geo_metrics")
            .upsert(chunk, { onConflict: "client_id,date,platform_campaign_id,region" });
          if (error) {
            results.push({ client_id: conn.client_id, ad_account: acct.id, upsert_error: error.message });
            break;
          }
          written += chunk.length;
        }

        results.push({
          client_id: conn.client_id,
          ad_account: acct.id,
          ad_account_name: acct.name ?? null,
          window: { since, until },
          rows_fetched: rows.length,
          rows_written: written,
          api_error: apiError,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("sync-meta-geo error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
