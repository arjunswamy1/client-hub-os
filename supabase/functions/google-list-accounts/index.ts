import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { client_id } = await req.json();
    if (!client_id) {
      return json({ error: "client_id required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: conn, error: connErr } = await supabase
      .from("platform_connections")
      .select("id, user_id, access_token, refresh_token, token_expires_at, metadata")
      .eq("client_id", client_id)
      .eq("platform", "google")
      .eq("status", "active")
      .maybeSingle();

    if (connErr || !conn) {
      return json({ error: "No active Google connection for this client" }, 404);
    }

    let accessToken = conn.access_token;
    if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date()) {
      accessToken = await refreshToken(supabase, conn.id, conn.refresh_token);
      if (!accessToken) return json({ error: "Token refresh failed — please reconnect Google" }, 401);
    }

    const developerToken = Deno.env.get("GOOGLE_DEVELOPER_TOKEN");
    if (!developerToken) return json({ error: "GOOGLE_DEVELOPER_TOKEN not configured" }, 500);

    // 1) List top-level accessible customers
    const topRes = await fetch(
      "https://googleads.googleapis.com/v23/customers:listAccessibleCustomers",
      { headers: { Authorization: `Bearer ${accessToken}`, "developer-token": developerToken } },
    );
    const topData = await topRes.json();
    if (topData.error) {
      return json({ error: `Google API: ${topData.error.message || JSON.stringify(topData.error)}` }, 502);
    }
    const topCustomers: string[] = (topData.resourceNames || []).map((r: string) => r.replace("customers/", ""));

    // 2) For each, walk children if MCC. Collect non-manager (operating) accounts.
    const accountMap = new Map<string, { id: string; name: string; manager: boolean; parentMcc?: string }>();

    for (const cid of topCustomers) {
      const children = await listChildren(cid, accessToken, developerToken);
      if (children.length === 0) {
        // Standalone account — include itself
        accountMap.set(cid, { id: cid, name: `Customer ${cid}`, manager: false });
      } else {
        for (const ch of children) {
          if (!accountMap.has(ch.id)) accountMap.set(ch.id, { ...ch, parentMcc: cid });
        }
      }
    }

    const accounts = Array.from(accountMap.values())
      .filter((a) => !a.manager) // Only operating accounts can serve metrics
      .sort((a, b) => a.name.localeCompare(b.name));

    // 3) Persist refreshed list to metadata so the picker has it
    await supabase
      .from("platform_connections")
      .update({
        metadata: {
          ...(conn.metadata || {}),
          customers: topCustomers.map((c) => `customers/${c}`),
          accounts, // [{ id, name, manager, parentMcc }]
          accounts_refreshed_at: new Date().toISOString(),
        },
      })
      .eq("id", conn.id);

    return json({ success: true, accounts, top_level: topCustomers });
  } catch (err: any) {
    console.error("[google-list-accounts] error:", err);
    return json({ error: err?.message || "Unknown error" }, 500);
  }
});

async function listChildren(mccId: string, accessToken: string, developerToken: string) {
  try {
    const res = await fetch(
      `https://googleads.googleapis.com/v23/customers/${mccId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": developerToken,
          "login-customer-id": mccId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `
            SELECT
              customer_client.id,
              customer_client.descriptive_name,
              customer_client.manager,
              customer_client.status,
              customer_client.hidden,
              customer_client.level
            FROM customer_client
            WHERE customer_client.status = 'ENABLED' AND customer_client.hidden = false
          `,
        }),
      },
    );
    const data = await res.json();
    if (data.error) {
      console.warn(`[listChildren] ${mccId} error:`, data.error.message);
      return [];
    }
    const rows: any[] = [];
    if (Array.isArray(data)) {
      for (const batch of data) if (batch.results) rows.push(...batch.results);
    }
    return rows
      .map((r: any) => ({
        id: String(r.customerClient?.id),
        name: r.customerClient?.descriptiveName || `Customer ${r.customerClient?.id}`,
        manager: !!r.customerClient?.manager,
      }))
      .filter((c) => c.id && c.id !== mccId);
  } catch (err) {
    console.warn(`[listChildren] ${mccId} threw:`, err);
    return [];
  }
}

async function refreshToken(supabase: any, connId: string, refreshToken: string): Promise<string | null> {
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
    .eq("id", connId);
  return data.access_token;
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
