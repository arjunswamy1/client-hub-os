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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ensure the connection has a usable access token, refreshing when close to expiry. */
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
  if (!res.ok) {
    await admin
      .from("platform_connections")
      .update({
        status: res.status === 400 || res.status === 401 ? "needs_reauth" : "active",
        sync_error: `Token refresh failed (${res.status}): ${text.slice(0, 300)}`,
      })
      .eq("id", conn.id);
    throw new Error(`Roku token refresh failed (${res.status})`);
  }
  const tokens = JSON.parse(text);
  const newExpiry = new Date(Date.now() + (Number(tokens.expires_in) || 86400) * 1000).toISOString();
  await admin
    .from("platform_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? conn.refresh_token,
      token_expires_at: newExpiry,
      status: "active",
      sync_error: null,
    })
    .eq("id", conn.id);
  return tokens.access_token as string;
}

/** Minimal CSV parser (handles quoted fields). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
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

/** Roku hour dimension is 1-24; we store 0-23. */
function normHour(v: string): number | null {
  const m = (v || "").match(/\d+/);
  if (!m) return null;
  const h = Number(m[0]);
  if (!isFinite(h)) return null;
  if (h >= 1 && h <= 24) return h === 24 ? 0 : h - 1;
  return h >= 0 && h <= 23 ? h : null;
}

/**
 * Roku reports hours in its account clock (US/Pacific). The dashboard is read in
 * Eastern time, so shift each date+hour into America/New_York before storing.
 */
const ROKU_REPORT_TZ = "America/Los_Angeles";
const DISPLAY_TZ = "America/New_York";

function tzParts(tz: string, instant: Date) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24 };
}

/** Wall-clock date+hour in `tz` -> UTC instant. */
function zonedToUtc(date: string, hour: number, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const wall = tzParts(tz, new Date(guess));
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour);
  return new Date(guess - (asUtc - guess));
}

function toDisplayHour(date: string, hour: number): { date: string; hour: number } {
  const instant = zonedToUtc(date, hour, ROKU_REPORT_TZ);
  const p = tzParts(DISPLAY_TZ, instant);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, hour: p.hour };
}

function stationFromCampaign(name: string, fallback: string): string {
  const m = (name || "").toUpperCase().match(/CT\s?-?(\d{2})/);
  return m ? `CT${m[1]}` : fallback;
}

const num = (v: string) => {
  const n = Number((v || "").replace(/[$,%\s]/g, ""));
  return isFinite(n) ? n : 0;
};

async function createReport(token: string, startAt: string, endAt: string, accountUid?: string) {
  const attributes: Record<string, unknown> = {
    name: `hourly-delivery-${startAt.slice(0, 10)}-${endAt.slice(0, 10)}-${Date.now()}`,
    description: "CPM hub hourly delivery sync",
    metrics: ["impressions", "spend"],
    dimensions: ["date", "hour", "campaign_name"],
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
  if (!res.ok) throw new Error(`Report create failed (${res.status}): ${text.slice(0, 400)}`);
  const body = JSON.parse(text);
  const uid = body?.data?.[0]?.uid;
  if (!uid) throw new Error(`Report create returned no uid: ${text.slice(0, 300)}`);
  return uid as string;
}

async function getReport(token: string, uid: string) {
  const res = await fetch(`${ROKU_API}/developer/reports/${uid}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Report fetch failed (${res.status}): ${text.slice(0, 300)}`);
  const attrs = JSON.parse(text)?.data?.[0]?.attributes ?? JSON.parse(text)?.data?.attributes ?? {};
  return { status: attrs.status as string, downloadUrl: attrs.download_url as string | null };
}

/** Store hourly rows, then roll spend/impressions up into the daily table. */
async function persist(admin: any, clientId: string, rows: string[][]) {
  if (!rows.length) return { hourly: 0, daily: 0 };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const iDate = col("date");
  const iHour = col("hour");
  const iCamp = col("campaign_name", "campaign");
  const iImp = col("impressions");
  const iSpend = col("spend");
  if (iDate < 0 || iHour < 0) throw new Error(`Report CSV missing date/hour columns: ${header.join(",")}`);

  const hourlyMap = new Map<string, any>();
  for (const r of rows.slice(1)) {
    const rawDate = normDate(r[iDate] ?? "");
    const rawHour = normHour(r[iHour] ?? "");
    if (!rawDate || rawHour === null) continue;
    const { date, hour } = toDisplayHour(rawDate, rawHour);
    const station = stationFromCampaign(iCamp >= 0 ? r[iCamp] ?? "" : "", "CT14");
    const key = `${date}|${hour}|${station}`;
    const cur = hourlyMap.get(key) ?? {
      client_id: clientId, date, hour, station_code: station,
      impressions: 0, spend: 0, source: "roku_api",
    };
    cur.impressions += iImp >= 0 ? Math.round(num(r[iImp] ?? "")) : 0;
    cur.spend += iSpend >= 0 ? num(r[iSpend] ?? "") : 0;
    hourlyMap.set(key, cur);
  }

  const hourlyRows = Array.from(hourlyMap.values());
  if (hourlyRows.length) {
    const { error } = await admin
      .from("jacuzzi_hourly_delivery")
      .upsert(hourlyRows, { onConflict: "client_id,date,hour,station_code" });
    if (error) throw error;
  }

  // Daily roll-up — never overwrite rows the client sheet provided.
  const dailyMap = new Map<string, any>();
  for (const h of hourlyRows) {
    const key = `${h.date}|${h.station_code}`;
    const cur = dailyMap.get(key) ?? {
      client_id: clientId, date: h.date, station_code: h.station_code,
      impressions: 0, spend: 0, cpm: 0, source: "roku_api",
    };
    cur.impressions += h.impressions;
    cur.spend += h.spend;
    dailyMap.set(key, cur);
  }
  const dates = Array.from(new Set(hourlyRows.map((h) => h.date)));
  const { data: existing } = await admin
    .from("jacuzzi_delivery")
    .select("date, station_code, source")
    .eq("client_id", clientId)
    .in("date", dates);
  const sheetKeys = new Set(
    (existing ?? []).filter((e: any) => e.source === "sheet").map((e: any) => `${e.date}|${e.station_code}`),
  );
  const dailyRows = Array.from(dailyMap.entries())
    .filter(([key]) => !sheetKeys.has(key))
    .map(([, v]) => ({ ...v, cpm: v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0 }));
  if (dailyRows.length) {
    const { error } = await admin
      .from("jacuzzi_delivery")
      .upsert(dailyRows, { onConflict: "client_id,date,station_code" });
    if (error) throw error;
  }

  return { hourly: hourlyRows.length, daily: dailyRows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const clientId: string = body.client_id || JACUZZI_CLIENT_ID;
    const days = Math.min(Math.max(Number(body.days) || 3, 1), 90);

    const { data: conn, error: connErr } = await admin
      .from("platform_connections")
      .select("id, client_id, access_token, refresh_token, token_expires_at, metadata, account_id")
      .eq("platform", "roku")
      .eq("client_id", clientId)
      .maybeSingle();
    if (connErr) throw connErr;
    if (!conn) return json({ error: "No Roku connection for this client" }, 400);

    const token = await ensureToken(admin, conn);
    const meta = (conn.metadata ?? {}) as Record<string, any>;
    const accountUid = meta.account_uid || conn.account_id || undefined;

    // A report is created asynchronously; if a previous run left one pending we
    // pick it up here so hourly cron runs make forward progress every time.
    let uid: string | null = meta.pending_report_uid ?? null;
    let startAt = meta.pending_report_start as string | undefined;
    let endAt = meta.pending_report_end as string | undefined;

    if (!uid) {
      const end = new Date();
      const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
      startAt = `${start.toISOString().slice(0, 10)}T00:00:00Z`;
      endAt = end.toISOString().slice(0, 19) + "Z";
      uid = await createReport(token, startAt, endAt, accountUid);
      await admin
        .from("platform_connections")
        .update({
          metadata: { ...meta, pending_report_uid: uid, pending_report_start: startAt, pending_report_end: endAt },
        })
        .eq("id", conn.id);
    }

    // Poll briefly; if it's still running we keep the uid and finish next run.
    let status = "";
    let downloadUrl: string | null = null;
    for (let i = 0; i < 10; i++) {
      const r = await getReport(token, uid!);
      status = r.status;
      downloadUrl = r.downloadUrl;
      if (status === "done" || status === "error") break;
      await sleep(5000);
    }

    if (status === "error") {
      await admin
        .from("platform_connections")
        .update({
          metadata: { ...meta, pending_report_uid: null },
          sync_error: "Roku hourly report returned an error",
        })
        .eq("id", conn.id);
      return json({ success: false, status, report_uid: uid }, 200);
    }

    if (status !== "done" || !downloadUrl) {
      return json({ success: true, status: status || "pending", report_uid: uid, pending: true });
    }

    const csvRes = await fetch(downloadUrl);
    if (!csvRes.ok) throw new Error(`Report download failed (${csvRes.status})`);
    const csv = await csvRes.text();
    const counts = await persist(admin, clientId, parseCsv(csv));

    await admin
      .from("platform_connections")
      .update({
        metadata: { ...meta, pending_report_uid: null, hourly_synced_at: new Date().toISOString() },
        last_synced_at: new Date().toISOString(),
        sync_error: null,
        status: "active",
      })
      .eq("id", conn.id);

    return json({ success: true, status, report_uid: uid, range: { startAt, endAt }, ...counts });
  } catch (e) {
    console.error("sync-roku-hourly error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
