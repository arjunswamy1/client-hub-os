import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROKU_API = "https://api.ads.roku.com/v1";
const JACUZZI_CLIENT_ID = "dc25f274-20f4-4650-b0cc-654073b925f4";

/**
 * Roku's report API only accepts a fixed dimension list (no content genre).
 * These are the breakdowns useful for optimization: geo + placement + creative.
 */
const BREAKDOWNS: { entity: string; dimension: string }[] = [
  { entity: "state", dimension: "state_territory" },
  { entity: "dma", dimension: "metro_market" },
  { entity: "placement", dimension: "placement" },
  { entity: "creative", dimension: "creative_name" },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureToken(admin: any, conn: any): Promise<string> {
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  if (expiresAt - Date.now() > 10 * 60 * 1000) return conn.access_token;

  const clientId = Deno.env.get("ROKU_CLIENT_ID");
  const clientSecret = Deno.env.get("ROKU_CLIENT_SECRET");
  if (!clientId || !clientSecret || !conn.refresh_token) return conn.access_token;

  const res = await fetch(`${ROKU_API}/developer/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Roku token refresh failed (${res.status}): ${text.slice(0, 200)}`);
  const tokens = JSON.parse(text);
  await admin
    .from("platform_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? conn.refresh_token,
      token_expires_at: new Date(Date.now() + (Number(tokens.expires_in) || 86400) * 1000).toISOString(),
      status: "active",
      sync_error: null,
    })
    .eq("id", conn.id);
  return tokens.access_token as string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; continue; }
      if (c === '"') { inQuotes = false; continue; }
      field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (c === "\r") continue;
    field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

function normDate(v: string): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!m) return null;
  const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yr}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

const num = (v: string) => {
  const n = Number((v || "").replace(/[$,%\s]/g, ""));
  return isFinite(n) ? n : 0;
};

/** Creates a report, retrying once when Roku rate-limits us. */
async function createReport(token: string, dimension: string, startAt: string, endAt: string, accountUid?: string) {
  const attributes: Record<string, unknown> = {
    name: `dim-${dimension}-${Date.now()}`,
    description: "CPM hub dimension sync",
    metrics: ["impressions", "spend"],
    dimensions: ["date", dimension],
    start_at: startAt,
    end_at: endAt,
  };
  if (accountUid) attributes.filters = [{ metric: "account_uid", value: accountUid }];

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${ROKU_API}/developer/reports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: [{ type: "report", attributes }] }),
    });
    const text = await res.text();
    if (res.ok) {
      const uid = JSON.parse(text)?.data?.[0]?.uid;
      if (!uid) throw new Error(`No report uid for ${dimension}`);
      return uid as string;
    }
    if (res.status === 429) {
      const wait = Number(text.match(/Retry after (\d+)/)?.[1] ?? 30);
      await sleep(Math.min(wait + 2, 65) * 1000);
      continue;
    }
    throw new Error(`Report create failed for ${dimension} (${res.status}): ${text.slice(0, 200)}`);
  }
  throw new Error(`Rate limited creating ${dimension} report`);
}

async function getReport(token: string, uid: string) {
  const res = await fetch(`${ROKU_API}/developer/reports/${uid}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Report fetch failed (${res.status})`);
  const attrs = JSON.parse(text)?.data?.[0]?.attributes ?? JSON.parse(text)?.data?.attributes ?? {};
  return { status: attrs.status as string, downloadUrl: attrs.download_url as string | null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const clientId: string = body.client_id || JACUZZI_CLIENT_ID;
    const days = Math.min(Math.max(Number(body.days) || 30, 1), 180);
    const only: string[] | null = Array.isArray(body.entities) && body.entities.length ? body.entities : null;

    const { data: conn } = await admin
      .from("platform_connections")
      .select("id, access_token, refresh_token, token_expires_at, metadata, account_id")
      .eq("platform", "roku")
      .eq("client_id", clientId)
      .maybeSingle();
    if (!conn) return json({ error: "No Roku connection for this client" }, 400);

    const token = await ensureToken(admin, conn);
    const meta = (conn.metadata ?? {}) as Record<string, any>;
    const accountUid = meta.account_uid || conn.account_id || null;

    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const startAt = `${start.toISOString().slice(0, 10)}T00:00:00Z`;
    const endAt = end.toISOString().slice(0, 19) + "Z";

    const results: Record<string, number | string> = {};
    // Reports are async and the gateway cuts long invocations, so each call
    // either kicks off a report or picks up one that finished since last time.
    const pending: Record<string, string> = { ...(meta.dim_pending ?? {}) };

    for (const bd of BREAKDOWNS) {
      if (only && !only.includes(bd.entity)) continue;
      try {
        let uid = pending[bd.entity];
        if (!uid) {
          uid = await createReport(token, bd.dimension, startAt, endAt, accountUid ?? undefined);
          pending[bd.entity] = uid;
          results[bd.entity] = "queued";
          continue;
        }

        const r = await getReport(token, uid);
        if (r.status === "error") { delete pending[bd.entity]; results[bd.entity] = "report error"; continue; }
        if (r.status !== "done" || !r.downloadUrl) { results[bd.entity] = `pending (${r.status || "running"})`; continue; }

        const csvRes = await fetch(r.downloadUrl);
        if (!csvRes.ok) throw new Error(`download ${csvRes.status}`);
        const rows = parseCsv(await csvRes.text());
        delete pending[bd.entity];
        if (!rows.length) { results[bd.entity] = 0; continue; }

        const header = rows[0].map((h) => h.trim().toLowerCase());
        const iDate = header.findIndex((h) => h === "date" || h.includes("date"));
        const iDim = header.findIndex((h) => h.includes(bd.dimension) || h === bd.dimension);
        const iImp = header.findIndex((h) => h.includes("impression"));
        const iSpend = header.findIndex((h) => h.includes("spend"));
        if (iDate < 0 || iDim < 0) { results[bd.entity] = `bad header: ${header.join("|")}`; continue; }

        const map = new Map<string, any>();
        for (const row of rows.slice(1)) {
          const date = normDate(row[iDate] ?? "");
          const name = (row[iDim] ?? "").trim() || "Unknown";
          if (!date) continue;
          const key = `${date}|${name}`;
          const cur = map.get(key) ?? {
            client_id: clientId,
            account_uid: accountUid,
            date,
            entity: bd.entity,
            entity_uid: name,
            entity_name: name,
            spend: 0,
            impressions: 0,
          };
          cur.impressions += iImp >= 0 ? Math.round(num(row[iImp] ?? "")) : 0;
          cur.spend += iSpend >= 0 ? num(row[iSpend] ?? "") : 0;
          map.set(key, cur);
        }
        const payload = Array.from(map.values());
        if (payload.length) {
          const { error } = await admin
            .from("roku_daily_metrics")
            .upsert(payload, { onConflict: "client_id,account_uid,entity,entity_uid,date" });
          if (error) throw error;
        }
        results[bd.entity] = payload.length;
      } catch (e) {
        results[bd.entity] = `error: ${(e as Error).message}`;
      }
    }


    await admin
      .from("platform_connections")
      .update({ metadata: { ...meta, dimensions_synced_at: new Date().toISOString() } })
      .eq("id", conn.id);

    return json({ success: true, range: { startAt, endAt }, results });
  } catch (e) {
    console.error("sync-roku-dimensions error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
