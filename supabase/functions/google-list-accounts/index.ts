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
    console.log("[google-list-accounts] listAccessibleCustomers status:", topRes.status, "body:", JSON.stringify(topData).slice(0, 500));

    if (topData.error) {
      const msg = topData.error.message || JSON.stringify(topData.error);
      const status = topData.error.status || "";
      // RESOURCE_EXHAUSTED on listAccessibleCustomers almost always = developer token not approved
      // for the OAuth user's accounts (Test Access restriction), or token/account mismatch.
      let hint = "";
      if (status === "RESOURCE_EXHAUSTED" || /exhausted|quota/i.test(msg)) {
        hint =
          " — This usually means your Google Ads developer token is in Test Access mode and the connected Google account's customer IDs are not on the test-account allowlist. " +
          "Either (a) apply for Basic/Standard access for your developer token in the Google Ads API Center, or " +
          "(b) add the specific Google Ads customer IDs to the developer token's test accounts list, or " +
          "(c) reconnect using a Google account that has access to a customer on an approved developer token.";
      } else if (status === "PERMISSION_DENIED" || /permission|developer token/i.test(msg)) {
        hint = " — Verify GOOGLE_DEVELOPER_TOKEN matches the manager account that owns API access, and that the OAuth user has access to that manager.";
      }
      await supabase
        .from("platform_connections")
        .update({ sync_error: `listAccessibleCustomers: ${msg}${hint}` })
        .eq("id", conn.id);
      return json({ error: `Google API: ${msg}${hint}`, status }, 502);
    }
    const topCustomers: string[] = (topData.resourceNames || []).map((r: string) => r.replace("customers/", ""));

    if (topCustomers.length === 0) {
      const errMsg =
        "listAccessibleCustomers returned 0 accounts. The Google account you connected has no Google Ads customers visible to this developer token. Reconnect with a Google user who has access to your Ads accounts, or check the developer token's allowlist.";
      await supabase.from("platform_connections").update({ sync_error: errMsg }).eq("id", conn.id);
      return json({ error: errMsg, accounts: [] }, 200);
    }

    // 2) For each, walk children if MCC. Collect non-manager (operating) accounts.
    const accountMap = new Map<string, { id: string; name: string; manager: boolean; parentMcc?: string }>();

    for (const cid of topCustomers) {
      const children = await listChildren(cid, accessToken, developerToken);
      if (children.length === 0) {
        // Standalone account — fetch its real descriptive name
        const self = await getCustomerInfo(cid, accessToken, developerToken);
        accountMap.set(cid, {
          id: cid,
          name: self?.name || `Customer ${cid}`,
          manager: !!self?.manager,
        });
      } else {
        for (const ch of children) {
          if (!accountMap.has(ch.id)) accountMap.set(ch.id, { ...ch, parentMcc: cid });
        }
        // Also include the MCC itself (as manager) so users can identify it,
        // even though it's filtered out of the operating-accounts list.
        const self = await getCustomerInfo(cid, accessToken, developerToken);
        if (self && !accountMap.has(cid)) {
          accountMap.set(cid, { id: cid, name: self.name, manager: true });
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

async function getCustomerInfo(
  cid: string,
  accessToken: string,
  developerToken: string,
): Promise<{ name: string; manager: boolean } | null> {
  try {
    const res = await fetch(
      `https://googleads.googleapis.com/v23/customers/${cid}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": developerToken,
          "login-customer-id": cid,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `SELECT customer.id, customer.descriptive_name, customer.manager FROM customer LIMIT 1`,
        }),
      },
    );
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    for (const batch of data) {
      const row = batch.results?.[0]?.customer;
      if (row) {
        return {
          name: row.descriptiveName || `Customer ${cid}`,
          manager: !!row.manager,
        };
      }
    }
    return null;
  } catch (err) {
    console.warn(`[getCustomerInfo] ${cid} threw:`, err);
    return null;
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
