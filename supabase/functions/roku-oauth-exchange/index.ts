import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROKU_API = "https://api.ads.roku.com/v1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ROKU_CLIENT_ID = Deno.env.get("ROKU_CLIENT_ID");
    const ROKU_CLIENT_SECRET = Deno.env.get("ROKU_CLIENT_SECRET");
    const ROKU_REDIRECT_URI = Deno.env.get("ROKU_REDIRECT_URI");

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // --- Verify caller is a signed-in admin ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Not authenticated" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
    const { data: isAdmin } = await admin.rpc("is_admin", { check_user_id: userData.user.id });
    if (!isAdmin) return json({ error: "Admin access required" }, 403);

    if (!ROKU_CLIENT_ID || !ROKU_CLIENT_SECRET) {
      return json({ error: "Roku app credentials are not configured yet (ROKU_CLIENT_ID / ROKU_CLIENT_SECRET)." }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const clientId = typeof body.client_id === "string" ? body.client_id : "";
    const redirectUri =
      (typeof body.redirect_uri === "string" && body.redirect_uri) || ROKU_REDIRECT_URI || "";

    if (!code) return json({ error: "Missing authorization code" }, 400);
    if (!clientId) return json({ error: "Missing client_id" }, 400);
    if (!redirectUri) return json({ error: "Missing redirect_uri (set ROKU_REDIRECT_URI)" }, 400);

    // --- Exchange the authorization code for tokens ---
    const tokenRes = await fetch(`${ROKU_API}/developer/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: ROKU_CLIENT_ID,
        client_secret: ROKU_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenText = await tokenRes.text();
    if (!tokenRes.ok) {
      console.error(`Roku token exchange failed [${tokenRes.status}]: ${tokenText}`);
      return json({ error: "Roku token exchange failed", status: tokenRes.status, details: tokenText }, tokenRes.status);
    }
    const tokens = JSON.parse(tokenText);

    // --- Look up the accounts this app now has access to ---
    let accounts: unknown[] = [];
    const acctRes = await fetch(`${ROKU_API}/developer/accounts`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const acctText = await acctRes.text();
    if (acctRes.ok) {
      try {
        const parsed = JSON.parse(acctText);
        accounts = parsed.data ?? parsed.accounts ?? [];
      } catch { /* ignore */ }
    } else {
      console.error(`Roku accounts lookup failed [${acctRes.status}]: ${acctText}`);
    }

    const expiresAt = new Date(Date.now() + (Number(tokens.expires_in) || 86400) * 1000).toISOString();

    const record = {
      client_id: clientId,
      platform: "roku",
      status: "active",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_expires_at: expiresAt,
      user_id: userData.user.id,
      metadata: { accounts, redirect_uri: redirectUri },
      sync_error: null,
    };

    // One Roku connection per client: update the existing row instead of inserting a duplicate.
    const { data: existing, error: findErr } = await admin
      .from("platform_connections")
      .select("id")
      .eq("platform", "roku")
      .eq("client_id", clientId)
      .maybeSingle();
    if (findErr) throw findErr;

    if (existing?.id) {
      const { error: updErr } = await admin
        .from("platform_connections")
        .update(record)
        .eq("id", existing.id);
      if (updErr) throw updErr;
    } else {
      const { error: insErr } = await admin.from("platform_connections").insert(record);
      if (insErr) throw insErr;
    }

    return json({ success: true, accounts });
  } catch (e) {
    console.error("roku-oauth-exchange error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
