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

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    if (!ROKU_CLIENT_ID || !ROKU_CLIENT_SECRET) {
      return json({ error: "Roku app credentials are not configured" }, 400);
    }

    // Refresh anything expiring within the next 12 hours (cron runs hourly).
    const threshold = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const force = body?.force === true;

    let query = admin
      .from("platform_connections")
      .select("id, client_id, refresh_token, token_expires_at, metadata")
      .eq("platform", "roku")
      .not("refresh_token", "is", null);
    if (!force) query = query.or(`token_expires_at.is.null,token_expires_at.lte.${threshold}`);

    const { data: conns, error } = await query;
    if (error) throw error;

    const results: Array<Record<string, unknown>> = [];

    for (const conn of conns ?? []) {
      try {
        const res = await fetch(`${ROKU_API}/developer/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: ROKU_CLIENT_ID,
            client_secret: ROKU_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: conn.refresh_token,
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          console.error(`Roku refresh failed for ${conn.id} [${res.status}]: ${text}`);
          await admin
            .from("platform_connections")
            .update({
              status: res.status === 400 || res.status === 401 ? "needs_reauth" : "active",
              sync_error: `Token refresh failed (${res.status}): ${text.slice(0, 300)}`,
            })
            .eq("id", conn.id);
          results.push({ id: conn.id, ok: false, status: res.status });
          continue;
        }

        const tokens = JSON.parse(text);
        const expiresAt = new Date(
          Date.now() + (Number(tokens.expires_in) || 86400) * 1000,
        ).toISOString();

        await admin
          .from("platform_connections")
          .update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token ?? conn.refresh_token,
            token_expires_at: expiresAt,
            status: "active",
            sync_error: null,
          })
          .eq("id", conn.id);

        results.push({ id: conn.id, ok: true, token_expires_at: expiresAt });
      } catch (e) {
        console.error(`Roku refresh error for ${conn.id}:`, e);
        await admin
          .from("platform_connections")
          .update({ sync_error: `Token refresh error: ${(e as Error).message}` })
          .eq("id", conn.id);
        results.push({ id: conn.id, ok: false, error: (e as Error).message });
      }
    }

    return json({ success: true, checked: conns?.length ?? 0, results });
  } catch (e) {
    console.error("roku-token-refresh error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
