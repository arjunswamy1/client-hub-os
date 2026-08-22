import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROKU_API = "https://api.ads.roku.com/v1";
const JACUZZI_CLIENT_ID = "dc25f274-20f4-4650-b0cc-654073b925f4";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Candidate report dimensions we want to know Roku supports. */
const CANDIDATES = [
  "genre_probe_only",
  "genre", "content_genre", "app_genre", "category", "content_category",
  "app_name", "publisher", "channel_name", "content_type",
  "state", "region", "dma", "dma_name", "geo", "country", "zip", "city",
  "device_type", "platform", "ad_placement", "placement", "daypart",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const clientId: string = body.client_id || JACUZZI_CLIENT_ID;

    const { data: conn } = await admin
      .from("platform_connections")
      .select("id, access_token, refresh_token, token_expires_at, metadata, account_id")
      .eq("platform", "roku")
      .eq("client_id", clientId)
      .maybeSingle();
    if (!conn) return json({ error: "No Roku connection for this client" }, 400);

    const token = conn.access_token as string;
    const meta = (conn.metadata ?? {}) as Record<string, any>;
    const accountUid = meta.account_uid || conn.account_id || undefined;

    const end = new Date();
    const start = new Date(end.getTime() - 7 * 86400000);
    const startAt = `${start.toISOString().slice(0, 10)}T00:00:00Z`;
    const endAt = end.toISOString().slice(0, 19) + "Z";

    const results: Record<string, string> = {};
    for (const dim of CANDIDATES) {
      const attributes: Record<string, unknown> = {
        name: `probe-${dim}-${Date.now()}`,
        description: "dimension probe",
        metrics: ["impressions", "spend"],
        dimensions: ["date", dim],
        start_at: startAt,
        end_at: endAt,
      };
      if (accountUid) attributes.filters = [{ metric: "account_uid", value: accountUid }];
      const res = await fetch(`${ROKU_API}/developer/reports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ data: [{ type: "report", attributes }] }),
      });
      const text = await res.text();
      results[dim] = res.ok ? "accepted" : `${res.status}: ${text.slice(0, 4000)}`;
    }

    return json({ supported: Object.entries(results).filter(([, v]) => v === "accepted").map(([k]) => k), results });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
