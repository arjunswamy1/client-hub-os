import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const META_REDIRECT_URI = "https://hub.connectpaidmedia.com/meta/callback";

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "You must be signed in to connect Meta Ads" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const appId = Deno.env.get("META_APP_ID");
    const appSecret = Deno.env.get("META_APP_SECRET");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !appId || !appSecret) {
      return json({ error: "Meta connection is not configured" }, 500);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) return json({ error: "Your session has expired. Please sign in again." }, 401);

    const body = await req.json();
    const code = typeof body?.code === "string" ? body.code : "";
    const stateParam = typeof body?.state === "string" ? body.state : "";
    const redirectUri = typeof body?.redirect_uri === "string" ? body.redirect_uri : "";
    if (!code || !stateParam) return json({ error: "Missing authorization details" }, 400);
    if (redirectUri !== META_REDIRECT_URI) return json({ error: "Invalid Meta redirect URI" }, 400);

    let state: { user_id: string; client_id?: string | null };
    try {
      state = JSON.parse(atob(stateParam));
    } catch {
      return json({ error: "Invalid authorization state" }, 400);
    }
    if (state.user_id !== user.id) return json({ error: "Authorization state does not match your session" }, 403);

    // Exchange code for short-lived token
    const tokenUrl =
      `https://graph.facebook.com/v21.0/oauth/access_token` +
      `?client_id=${appId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&client_secret=${appSecret}` +
      `&code=${code}`;

    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      return json({ error: tokenData.error.message || "Meta rejected the authorization code" }, 400);
    }

    // Exchange for long-lived token
    const longLivedUrl =
      `https://graph.facebook.com/v21.0/oauth/access_token` +
      `?grant_type=fb_exchange_token` +
      `&client_id=${appId}` +
      `&client_secret=${appSecret}` +
      `&fb_exchange_token=${tokenData.access_token}`;

    const longRes = await fetch(longLivedUrl);
    const longData = await longRes.json();

    const accessToken = longData.access_token || tokenData.access_token;
    const expiresIn = longData.expires_in || tokenData.expires_in;

    // Get user info
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${accessToken}`
    );
    const meData = await meRes.json();

    // Get ad accounts
    const adAccountsRes = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_id&access_token=${accessToken}`
    );
    const adAccountsData = await adAccountsRes.json();

    // Store connection
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const adAccounts: Array<{ id?: string; name?: string; account_id?: string }> =
      adAccountsData.data || [];
    const keyOf = (a: { id?: string; account_id?: string } | null | undefined) =>
      a?.id || a?.account_id || null;

    // Preserve the previously chosen reporting account across reconnects
    let existingQuery = supabase
      .from("platform_connections")
      .select("selected_ad_account")
      .eq("user_id", state.user_id)
      .eq("platform", "meta");
    existingQuery = state.client_id
      ? existingQuery.eq("client_id", state.client_id)
      : existingQuery.is("client_id", null);
    const { data: existing } = await existingQuery.maybeSingle();

    const previous = existing?.selected_ad_account as
      | { id?: string; name?: string; account_id?: string }
      | null;
    const stillAvailable = previous
      ? adAccounts.find((a) => keyOf(a) === keyOf(previous))
      : null;

    const selectedAdAccount =
      stillAvailable || previous || (adAccounts.length === 1 ? adAccounts[0] : null);

    const { error: upsertError } = await supabase
      .from("platform_connections")
      .upsert(
        {
          user_id: state.user_id,
          platform: "meta",
          access_token: accessToken,
          account_id: meData.id,
          account_name: meData.name,
          token_expires_at: tokenExpiresAt,
          client_id: state.client_id || null,
          status: "active",
          selected_ad_account: selectedAdAccount,
          metadata: {
            ad_accounts: adAccounts,
          },
        },
        { onConflict: "user_id,platform,client_id" }
      );


    if (upsertError) {
      console.error("Upsert error:", upsertError);
      return json({ error: "Could not save the Meta connection" }, 500);
    }

    return json({ success: true, account_name: meData.name || null });
  } catch (err) {
    console.error("Callback error:", err);
    return json({ error: err instanceof Error ? err.message : "Could not complete Meta authorization" }, 500);
  }
});
