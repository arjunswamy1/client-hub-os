// Pulls Google Ads Demand Gen campaign spend for the 4JS client and writes
// it into platform_spend_4js with platform='google_demand_gen' so the 4JS
// dashboard surfaces it alongside Roku/Universal.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

const FOURJS_CLIENT_ID = "a9fce72e-87d5-4c45-9d94-03d78be7e42d";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let daysBack = 30;
  try {
    const body = await req.json();
    if (body?.days_back) daysBack = Number(body.days_back);
  } catch { /* */ }

  try {
    const developerToken = Deno.env.get("GOOGLE_DEVELOPER_TOKEN")!;

    // Get the Google connection for the 4JS client
    const { data: conn, error: connErr } = await supabase
      .from("platform_connections")
      .select("user_id, access_token, refresh_token, token_expires_at, customer_id, metadata, client_id")
      .eq("client_id", FOURJS_CLIENT_ID)
      .eq("platform", "google")
      .eq("status", "active")
      .maybeSingle();

    if (connErr) throw connErr;
    if (!conn) {
      return json({ error: "No active Google connection for 4JS client. Connect Google Ads in Settings first." }, 400);
    }
    if (!conn.customer_id) {
      return json({ error: "Google Ads connected but no account mapped. Pick the 4JS account in Settings → Google Ads." }, 400);
    }

    // Refresh token if expired
    let accessToken = conn.access_token as string;
    if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date()) {
      const refreshed = await refreshToken(supabase, conn.user_id, conn.refresh_token, conn.client_id);
      if (!refreshed) return json({ error: "Google authorization expired. Reconnect Google Ads." }, 401);
      accessToken = refreshed;
    }

    // Resolve login customer (handles MCC)
    const customerId = String(conn.customer_id).replace("customers/", "");
    const { mccId } = await resolveLoginCustomer(customerId, accessToken, developerToken);
    const loginCustomerId = mccId || customerId;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const since = fmtDate(startDate);
    const until = fmtDate(endDate);

    // Query Demand Gen ad_group-level daily metrics
    const rows = await queryGAQL(customerId, accessToken, developerToken, loginCustomerId, `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        segments.date,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks
      FROM ad_group
      WHERE segments.date BETWEEN '${since}' AND '${until}'
        AND campaign.advertising_channel_type = 'DEMAND_GEN'
    `);

    console.log(`[sync-google-demand-gen-4js] ${rows.length} ad_group rows`);

    const upsertRows = rows
      .map((r: any) => {
        const spend = (Number(r.metrics?.costMicros || 0)) / 1_000_000;
        return {
          client_id: FOURJS_CLIENT_ID,
          date: r.segments?.date,
          platform: "google_demand_gen",
          campaign_name: r.campaign?.name || null,
          creative_name: r.adGroup?.name || null,
          audience_cluster: null,
          spend,
          impressions: Number(r.metrics?.impressions || 0),
          clicks: Number(r.metrics?.clicks || 0),
          source: "api",
        };
      })
      .filter((r) => r.date);

    // Replace existing api-source rows in the window for clean re-syncs
    await supabase
      .from("platform_spend_4js")
      .delete()
      .eq("client_id", FOURJS_CLIENT_ID)
      .eq("platform", "google_demand_gen")
      .eq("source", "api")
      .gte("date", since)
      .lte("date", until);

    if (upsertRows.length > 0) {
      // Insert in batches of 500
      for (let i = 0; i < upsertRows.length; i += 500) {
        const chunk = upsertRows.slice(i, i + 500);
        const { error } = await supabase.from("platform_spend_4js").insert(chunk);
        if (error) throw error;
      }
    }

    return json({ success: true, records_synced: upsertRows.length, days_back: daysBack });
  } catch (err: any) {
    console.error("[sync-google-demand-gen-4js] error:", err);
    return json({ error: err.message || String(err) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function refreshToken(supabase: any, userId: string, refreshToken: string, clientId: string): Promise<string | null> {
  if (!refreshToken) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) return null;
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
  await supabase
    .from("platform_connections")
    .update({ access_token: data.access_token, token_expires_at: expiresAt })
    .eq("user_id", userId)
    .eq("platform", "google")
    .eq("client_id", clientId);
  return data.access_token;
}

async function resolveLoginCustomer(customerId: string, accessToken: string, developerToken: string): Promise<{ mccId: string | null }> {
  try {
    const res = await fetch(`https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `SELECT customer_client.id, customer_client.manager FROM customer_client WHERE customer_client.level = 0`,
      }),
    });
    const data = await res.json();
    const isManager = data?.results?.[0]?.customerClient?.manager;
    return { mccId: isManager ? customerId : null };
  } catch {
    return { mccId: null };
  }
}

async function queryGAQL(customerId: string, accessToken: string, developerToken: string, loginCustomerId: string, query: string): Promise<any[]> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId.replace("customers/", "");

  const results: any[] = [];
  let pageToken: string | undefined;
  do {
    const res = await fetch(`https://googleads.googleapis.com/v23/customers/${customerId}/googleAds:search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, pageSize: 10000, pageToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Google Ads API error: ${JSON.stringify(data)}`);
    if (data.results) results.push(...data.results);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return results;
}
