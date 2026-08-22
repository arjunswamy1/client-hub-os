// Near-real-time Roku spend/impressions via the SYNCHRONOUS metrics endpoints:
//   GET /developer/metrics/fields  -> available field parameters
//   GET /developer/metrics         -> immediate data (no async report job)
// Async reports (sync-roku-hourly / sync-roku-dimensions) stay in place for hour
// and geo/placement breakdowns, which the synchronous endpoint cannot return.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ROKU_API = "https://api.ads.roku.com/v1";
const JACUZZI_CLIENT_ID = "dc25f274-20f4-4650-b0cc-654073b925f4";
/** Roku caps the synchronous metrics window at 7 days per call. */
const MAX_WINDOW_DAYS = 7;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

async function apiGet(token: string, path: string, params?: Record<string, string>) {
  const url = new URL(`${ROKU_API}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) if (v) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${text.slice(0, 400)}`);
  return JSON.parse(text || "{}");
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

const pick = (obj: Record<string, any>, keys: string[]) => {
  for (const k of keys) {
    const hit = Object.keys(obj).find((o) => o.toLowerCase() === k);
    if (hit !== undefined && obj[hit] !== null && obj[hit] !== undefined) return obj[hit];
  }
  return undefined;
};

const numAt = (v: any, i: number) => {
  const raw = Array.isArray(v) ? v[i] : v;
  const n = Number(typeof raw === "string" ? raw.replace(/[$,%\s]/g, "") : raw);
  return isFinite(n) ? n : 0;
};

/** Jacuzzi station code lives inside the campaign name, e.g. "... CT-14 ...". */
function stationFromCampaign(name: string, fallback = "CT14") {
  const m = (name || "").toUpperCase().match(/CT\s?-?(\d{2})/);
  return m ? `CT${m[1]}` : fallback;
}

interface Flat {
  date: string;
  account_uid: string;
  entity_uid: string;
  entity_name: string;
  spend: number;
  impressions: number;
  fields: Record<string, any>;
}

/** Flatten Roku's parallel-array field shape into one row per entity+date. */
function flatten(body: any, accountUid: string, fallbackDate: string): Flat[] {
  const out: Flat[] = [];
  for (const row of body?.data ?? []) {
    const dims = (row?.dimensions ?? {}) as Record<string, any>;
    const fields = (row?.fields ?? {}) as Record<string, any>;
    const dates = pick(dims, ["date", "dates", "day"]);
    const dateList: string[] = Array.isArray(dates)
      ? dates.map((d: any) => String(d).slice(0, 10))
      : [String(dates ?? fallbackDate).slice(0, 10)];
    const name = String(
      pick(dims, ["campaign_name", "name", "entity_name", "ad_group_name", "creative_name"]) ?? "Unknown",
    );
    const uid = String(
      pick(dims, ["campaign_uid", "entity_uid", "uid", "ad_group_uid", "creative_uid"]) ?? name,
    );
    const spendArr = pick(fields, ["spend", "cost", "total_spend"]);
    const impArr = pick(fields, ["impressions", "impression"]);

    dateList.forEach((date, i) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      out.push({
        date,
        account_uid: accountUid,
        entity_uid: uid,
        entity_name: name,
        spend: numAt(spendArr, i),
        impressions: Math.round(numAt(impArr, i)),
        fields: Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, Array.isArray(v) ? v[i] ?? null : v]),
        ),
      });
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const clientId: string = body.client_id || JACUZZI_CLIENT_ID;
    const days = Math.min(Math.max(Number(body.days) || 2, 1), MAX_WINDOW_DAYS);
    const entity: string = body.entity || "campaign";

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

    // Field discovery — also handy on its own for verifying what Roku exposes.
    let available: string[] = [];
    try {
      const f = await apiGet(token, "/developer/metrics/fields");
      const raw = f?.data ?? f?.fields ?? [];
      available = (Array.isArray(raw) ? raw : [])
        .map((x: any) => (typeof x === "string" ? x : x?.name ?? x?.uid ?? x?.attributes?.name))
        .filter(Boolean);
    } catch (e) {
      console.warn("metrics/fields failed:", (e as Error).message);
    }
    if (body.fields_only) {
      const raw = await apiGet(token, "/developer/metrics/fields").catch((e) => ({ error: (e as Error).message }));
      return json({ success: true, available_fields: available, raw });
    }

    const wanted = ["impressions", "spend"].filter((f) => !available.length || available.includes(f));
    const fields = (wanted.length ? wanted : ["impressions", "spend"]).join(",");

    // Accounts: prefer explicit uid, else every account cached at connect time.
    const accountUids: string[] = body.account_uid
      ? [String(body.account_uid)]
      : (meta.accounts ?? []).map((a: any) => a?.uid).filter(Boolean);
    if (!accountUids.length) {
      return json({ error: "No Roku account uid on this connection — reconnect Roku." }, 400);
    }

    const entityNames = new Map<string, Map<string, string>>();
    const end = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const start_date = ymd(start);
    const end_date = ymd(end);

    const flat: Flat[] = [];
    const perAccount: Record<string, number | string> = {};
    for (const accountUid of accountUids) {
      try {
        // Synchronous metrics require explicit entity uids, so enumerate first.
        const names = new Map<string, string>();
        let uids: string[] = [];
        if (entity === "account") {
          uids = [accountUid];
        } else {
          for (let offset = 0; offset < 500; offset += 100) {
            const list = await apiGet(token, "/developer/campaigns", {
              account_uid: accountUid,
              limit: "100",
              offset: String(offset),
            });
            const items = list?.data ?? [];
            for (const c of items) {
              const uid = c?.uid ?? c?.attributes?.uid;
              if (!uid) continue;
              uids.push(uid);
              names.set(uid, c?.attributes?.name ?? uid);
            }
            if (items.length < 100) break;
          }
        }
        if (!uids.length) { perAccount[accountUid] = "no campaigns"; continue; }
        entityNames.set(accountUid, names);

        let cursor: string | undefined;
        let pages = 0;
        do {
          const res = await apiGet(token, "/developer/metrics", {
            account_uid: accountUid,
            entity,
            entity_uids: uids.slice(0, 200).join(","),
            ...(cursor ? { cursor, limit: "1000" } : {
              start_date, end_date, granularity: "day", fields, limit: "1000",
            }),
          });
          const rows = flatten(res, accountUid, end_date).map((r) => ({
            ...r,
            entity_name: r.entity_name === "Unknown"
              ? entityNames.get(accountUid)?.get(r.entity_uid) ?? r.entity_uid
              : r.entity_name,
          }));
          flat.push(...rows);
          cursor = res?.meta?.pagination?.has_more ? res?.meta?.pagination?.next_cursor : undefined;
          pages++;
        } while (cursor && pages < 10);
        perAccount[accountUid] = flat.filter((r) => r.account_uid === accountUid).length;
      } catch (e) {
        perAccount[accountUid] = `error: ${(e as Error).message}`;
      }
    }

    if (body.dry_run) {
      return json({ success: true, available_fields: available, per_account: perAccount, sample: flat.slice(0, 10) });
    }

    // 1) Entity-level rows for drill-downs.
    const dedupe = new Map<string, any>();
    for (const r of flat) {
      const key = `${r.account_uid}|${r.entity_uid}|${r.date}`;
      const cur = dedupe.get(key);
      if (cur) {
        cur.spend += r.spend;
        cur.impressions += r.impressions;
      } else {
        dedupe.set(key, {
          client_id: clientId,
          account_uid: r.account_uid,
          date: r.date,
          entity,
          entity_uid: r.entity_uid,
          entity_name: r.entity_name,
          campaign_name: entity === "campaign" ? r.entity_name : null,
          spend: r.spend,
          impressions: r.impressions,
          fields: r.fields,
        });
      }
    }
    const metricRows = Array.from(dedupe.values());
    if (metricRows.length) {
      const { error } = await admin
        .from("roku_daily_metrics")
        .upsert(metricRows, { onConflict: "client_id,account_uid,entity,entity_uid,date" });
      if (error) throw error;
    }

    // 2) Daily delivery roll-up by station — never clobber client-sheet rows.
    let dailyWritten = 0;
    if (clientId === JACUZZI_CLIENT_ID && entity === "campaign" && metricRows.length) {
      const dailyMap = new Map<string, any>();
      for (const r of metricRows) {
        const station = stationFromCampaign(r.entity_name);
        const key = `${r.date}|${station}`;
        const cur = dailyMap.get(key) ?? {
          client_id: clientId, date: r.date, station_code: station,
          impressions: 0, spend: 0, cpm: 0, source: "roku_api",
        };
        cur.impressions += r.impressions;
        cur.spend += Number(r.spend);
        dailyMap.set(key, cur);
      }
      const dates = Array.from(new Set(metricRows.map((r) => r.date)));
      const { data: existing } = await admin
        .from("jacuzzi_delivery")
        .select("date, station_code, source")
        .eq("client_id", clientId)
        .in("date", dates);
      const sheetKeys = new Set(
        (existing ?? []).filter((e: any) => e.source === "sheet").map((e: any) => `${e.date}|${e.station_code}`),
      );
      const dailyRows = Array.from(dailyMap.entries())
        .filter(([k]) => !sheetKeys.has(k))
        .map(([, v]) => ({ ...v, cpm: v.impressions > 0 ? (v.spend / v.impressions) * 1000 : 0 }));
      if (dailyRows.length) {
        const { error } = await admin
          .from("jacuzzi_delivery")
          .upsert(dailyRows, { onConflict: "client_id,date,station_code" });
        if (error) throw error;
        dailyWritten = dailyRows.length;
      }
    }

    await admin
      .from("platform_connections")
      .update({
        metadata: { ...meta, live_synced_at: new Date().toISOString() },
        last_synced_at: new Date().toISOString(),
        sync_error: null,
        status: "active",
      })
      .eq("id", conn.id);

    return json({
      success: true,
      range: { start_date, end_date },
      entity,
      per_account: perAccount,
      metric_rows: metricRows.length,
      daily_rows: dailyWritten,
      synced_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("sync-roku-live error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
