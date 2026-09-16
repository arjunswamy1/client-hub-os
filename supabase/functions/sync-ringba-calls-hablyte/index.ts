import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { logIntegrationCall } from "../_shared/cost-tracking.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const HABLYTE_CLIENT_ID = "04e9139b-5ea9-4fc4-b911-5c0ee8a540af";

/** Hablyte's own dedicated Ringba account — every campaign on it belongs to
 * the client, so no campaign allowlist. Vertical separation (Home Insurance /
 * Auto Insurance) happens downstream via campaign-name rules in Media Brain,
 * never by dropping calls here. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseRingbaDate(dt: any): string {
  if (!dt) return new Date().toISOString();
  if (typeof dt === "number") return new Date(dt).toISOString();
  if (typeof dt === "string") {
    if (dt.includes("T") || dt.match(/^\d{4}-/)) {
      const d = new Date(dt);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    const d2 = new Date(dt);
    if (!isNaN(d2.getTime())) return d2.toISOString();
  }
  return new Date().toISOString();
}

const VALUE_COLUMNS = [
  "inboundCallId", "callDt", "campaignName", "targetName", "buyer",
  "inboundPhoneNumber", "callLengthInSeconds", "connectedCallLengthInSeconds",
  "hasConnected", "hasConverted", "conversionAmount", "payoutAmount", "totalCost",
  "publisherName", "callerStateProvince", "callerCity", "endCallSource", "recordingUrl",
  "number", "numberId", "numberPoolName", "numberPoolId", "isFromNumberPool",
  "hasPayout", "noPayoutReason",
  "tag:User:utm_content", "tag:User:utm_source", "tag:User:utm_medium",
  "tag:User:utm_campaign", "tag:User:utm_term", "tag:User:creative",
];

function collectTags(call: Record<string, any>): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(call)) {
    if (k.startsWith("tag:") && v !== null && v !== undefined && String(v).trim() !== "") {
      tags[k] = String(v).trim();
    }
  }
  const nested = (call as any).tags;
  if (nested && typeof nested === "object") {
    if (Array.isArray(nested)) {
      for (const t of nested) {
        const key = t?.name || t?.key;
        const val = t?.value;
        if (key && val) tags[String(key).startsWith("tag:") ? String(key) : `tag:User:${key}`] = String(val);
      }
    } else {
      for (const [k, v] of Object.entries(nested as Record<string, any>)) {
        if (v !== null && v !== undefined && String(v).trim() !== "") {
          tags[k.startsWith("tag:") ? k : `tag:User:${k}`] = String(v).trim();
        }
      }
    }
  }
  return tags;
}

function mapCallToRow(call: any) {
  const callerNumber = call["tag:InboundNumber:Number"] || call["tag:InboundNumber:NumberE164"] ||
    call["tag:InboundNumber:Number-NoPlus"] || call.callerId || call.callerNumber || null;
  const state = call["tag:Geo:SubDivisionCode"] || call["tag:Geo:SubDivision"] ||
    call["tag:InboundNumber:State"] || call.callerStateProvince || call.callerState || null;
  const city = call["tag:Geo:City"] || call.callerCity || null;

  const dialedNumber = call["tag:DialedNumber:Number"] || call["tag:DialedNumber:NumberE164"] ||
    call.number || null;

  const callId = call.inboundCallId || call.callId || `${call.callDt}-${callerNumber || "unknown"}`;
  const duration = Number(call.callLengthInSeconds || call.connectedCallLengthInSeconds || 0);
  const connected = call.hasConnected ?? (duration > 0 && !call.wasBlocked);
  const converted = !!(connected && call.hasConverted);
  const revenue = converted ? Number(call.conversionAmount || call.revenue || 0) : 0;
  // Revenue only — `totalCost` is telco cost and must never become revenue.
  const payout = Number(call.payoutAmount ?? call.payout ?? 0);

  return {
    client_id: HABLYTE_CLIENT_ID,
    call_id: String(callId),
    call_date: parseRingbaDate(call.callDt),
    campaign_name: call.campaignName || null,
    target_name: call.targetName || call.buyer || null,
    caller_number: callerNumber,
    inbound_number: call.inboundPhoneNumber || null,
    did: dialedNumber ? String(dialedNumber) : null,
    did_pool_name: call.numberPoolName ? String(call.numberPoolName) : null,
    is_from_number_pool: call.isFromNumberPool === undefined || call.isFromNumberPool === null
      ? null
      : !!call.isFromNumberPool,
    has_payout: call.hasPayout === undefined || call.hasPayout === null ? null : !!call.hasPayout,
    no_payout_reason: call.noPayoutReason ? String(call.noPayoutReason) : null,
    duration_seconds: duration,
    connected: !!connected,
    converted,
    revenue,
    payout,
    metadata: {
      source: "ringba_api",
      publisher: call.publisherName || null,
      state,
      city,
      disposition: call.endCallSource || null,
      recording_url: call.recordingUrl || null,
      connected_seconds: Number(call.connectedCallLengthInSeconds || 0),
      total_cost: Number(call.totalCost || 0),
      ...collectTags(call),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const RINGBA_API_TOKEN = Deno.env.get("RINGBA_API_TOKEN_HABLYTE");
    const RINGBA_ACCOUNT_ID = Deno.env.get("RINGBA_ACCOUNT_ID_HABLYTE");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!RINGBA_API_TOKEN) throw new Error("RINGBA_API_TOKEN_HABLYTE is not configured");
    if (!RINGBA_ACCOUNT_ID) throw new Error("RINGBA_ACCOUNT_ID_HABLYTE is not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Read-only diagnostic: full column + tag menu for this account.
    if (new URL(req.url).searchParams.get("diagnose") === "1") {
      const auth = { Authorization: `Token ${RINGBA_API_TOKEN}`, Accept: "application/json" };
      const out: Record<string, unknown> = { diagnostic: true, wrote_nothing: true };

      const colRes = await fetch(`https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs/columns`, { headers: auth });
      out.columns_status = colRes.status;
      if (colRes.ok) {
        const colJson = await colRes.json();
        const raw = colJson?.columns ?? colJson?.report?.columns ?? colJson;
        const columns = Array.isArray(raw)
          ? raw.map((c: Record<string, unknown> | string) =>
              typeof c === "string"
                ? { id: c }
                : { id: c?.id ?? c?.name, title: c?.title ?? c?.displayName ?? null, type: c?.type ?? null, group: c?.group ?? c?.groupName ?? null },
            )
          : [];
        out.column_count = columns.length;
        out.columns = columns;
      } else {
        out.columns_error = (await colRes.text()).substring(0, 400);
      }

      const tagRes = await fetch(`https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/tags`, { headers: auth });
      out.tags_status = tagRes.status;
      if (tagRes.ok) {
        const tags = await tagRes.json();
        const list = Array.isArray(tags) ? tags : (tags?.tags ?? []);
        out.tag_count = Array.isArray(list) ? list.length : 0;
        out.tags = Array.isArray(list) ? list.map((t: Record<string, unknown>) => ({ tagType: t?.tagType, tagName: t?.tagName })) : list;
      } else {
        out.tags_error = (await tagRes.text()).substring(0, 400);
      }

      return new Response(JSON.stringify(out, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let daysBack = 7;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        daysBack = Number(body.days_back ?? body.daysBack ?? 7) || 7;
      } catch { /* default */ }
    }
    daysBack = Math.min(Math.max(daysBack, 1), 120);

    const ringbaUrl = `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`;

    // Column + tag discovery — Ringba 422s the whole request on an unknown column.
    let requestColumns: string[] = [...VALUE_COLUMNS];
    try {
      const colRes = await fetch(`https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs/columns`, {
        headers: { Authorization: `Token ${RINGBA_API_TOKEN}`, Accept: "application/json" },
      });
      if (colRes.ok) {
        const colJson = await colRes.json();
        const raw = colJson?.columns ?? colJson?.report?.columns ?? colJson;
        const ids = new Set<string>();
        if (Array.isArray(raw)) {
          for (const c of raw) {
            const id = typeof c === "string" ? c : (c?.id || c?.name);
            if (id) ids.add(String(id));
          }
        }
        if (ids.size > 0) {
          requestColumns = VALUE_COLUMNS.filter((c) => c.startsWith("tag:") || ids.has(c));
        }
      }
    } catch (e) {
      console.warn(`Column discovery error: ${e instanceof Error ? e.message : e}`);
    }

    try {
      const tagRes = await fetch(`https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/tags`, {
        headers: { Authorization: `Token ${RINGBA_API_TOKEN}`, Accept: "application/json" },
      });
      if (tagRes.ok) {
        const tags = await tagRes.json();
        if (Array.isArray(tags)) {
          for (const t of tags) {
            const type = t?.tagType, name = t?.tagName;
            if (!type || !name) continue;
            if (["InboundNumber", "Geo", "User", "DialedNumber"].includes(String(type))) {
              requestColumns.push(`tag:${type}:${name}`);
            }
          }
        }
      }
    } catch (e) {
      console.warn(`Tag discovery error: ${e instanceof Error ? e.message : e}`);
    }
    requestColumns = [...new Set(requestColumns)];
    console.log(`Requesting ${requestColumns.length} Ringba columns`);

    let useValueColumns = requestColumns.length > 0;
    let droppedColumns: string[] = [];

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - daysBack);

    const chunkDays = 7;
    const chunks: Array<{ start: Date; end: Date }> = [];
    let cursor = new Date(endDate);
    while (cursor > startDate) {
      const cs = new Date(cursor);
      cs.setDate(cs.getDate() - chunkDays);
      if (cs < startDate) cs.setTime(startDate.getTime());
      chunks.push({ start: new Date(cs), end: new Date(cursor) });
      cursor = new Date(cs);
    }

    let totalFetched = 0, totalUpserted = 0, apiCalls = 0, httpErrors = 0;
    let taggedCalls = 0;
    const campaignsSeen = new Set<string>();
    const publishersSeen = new Set<string>();
    const startTime = Date.now();
    const MAX_MS = 110_000;

    for (const chunk of chunks) {
      if (Date.now() - startTime > MAX_MS) break;
      let offset = 0;
      const pageSize = 1000;

      while (Date.now() - startTime < MAX_MS) {
        apiCalls++;
        const payload: Record<string, unknown> = {
          reportStart: chunk.start.toISOString(),
          reportEnd: chunk.end.toISOString(),
          size: pageSize,
          offset,
        };
        if (useValueColumns) payload.valueColumns = requestColumns.map((c) => ({ column: c }));

        let res: Response;
        try {
          res = await fetch(ringbaUrl, {
            method: "POST",
            headers: {
              Authorization: `Token ${RINGBA_API_TOKEN}`,
              "Content-Type": "application/json;charset=UTF-8",
              Accept: "application/json, text/plain, */*",
            },
            body: JSON.stringify(payload),
          });
        } catch (e) {
          httpErrors++;
          console.error(`Network error: ${e instanceof Error ? e.message : e}`);
          if (httpErrors >= 3) break;
          await sleep(2_000);
          continue;
        }

        if (res.status === 429) { await sleep(12_000); continue; }

        if (!res.ok) {
          const text = await res.text();
          console.error(`Ringba [${res.status}]: ${text.substring(0, 400)}`);
          if ((res.status === 400 || res.status === 422) && useValueColumns) {
            const bad = text.match(/Unknown value column ([^"',}\s]+)/)?.[1];
            if (bad && requestColumns.includes(bad)) {
              requestColumns = requestColumns.filter((c) => c !== bad);
              droppedColumns.push(bad);
              console.warn(`Dropping unsupported column ${bad}`);
              if (requestColumns.length === 0) useValueColumns = false;
              continue;
            }
            useValueColumns = false;
            console.warn("Retrying without valueColumns (columns rejected)");
            continue;
          }
          httpErrors++;
          if (res.status >= 500 && httpErrors < 3) { await sleep(3_000); continue; }
          break;
        }

        const data = await res.json();
        const records: any[] = data?.report?.records || [];
        const totalCount = Number(data?.report?.totalCount || 0);
        totalFetched += records.length;

        for (const r of records) {
          campaignsSeen.add(r.campaignName || "unknown");
          publishersSeen.add(r.publisherName || "unknown");
        }

        if (records.length > 0) {
          const seen = new Set<string>();
          const rows = records.map(mapCallToRow).filter((r) => {
            if (seen.has(r.call_id)) return false;
            seen.add(r.call_id);
            return true;
          });
          taggedCalls += rows.filter((r) =>
            Object.keys(r.metadata).some((k) => k.startsWith("tag:"))
          ).length;

          const { error } = await supabase
            .from("ringba_calls")
            .upsert(rows, { onConflict: "client_id,call_id" });
          if (error) console.error(`Upsert error: ${error.message}`);
          else totalUpserted += rows.length;
        }

        if (records.length === 0 || offset + records.length >= totalCount) break;
        offset += pageSize;
        await sleep(250);
      }
      await sleep(150);
    }

    const elapsedMs = Date.now() - startTime;
    console.log(
      `Hablyte Ringba sync: fetched=${totalFetched}, upserted=${totalUpserted}, ` +
      `tagged=${taggedCalls}, apiCalls=${apiCalls}, errors=${httpErrors}, elapsed=${elapsedMs}ms`
    );

    if (apiCalls > 0) {
      await logIntegrationCall({
        client_id: HABLYTE_CLIENT_ID,
        service: "ringba_api",
        surface: "sync-ringba-calls-hablyte",
        calls: apiCalls,
        metadata: { days_back: daysBack, calls_fetched: totalFetched, calls_synced: totalUpserted },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      days_back: daysBack,
      calls_fetched: totalFetched,
      calls_synced: totalUpserted,
      calls_with_tags: taggedCalls,
      columns_requested: requestColumns.length,
      columns_dropped: droppedColumns,
      campaigns_in_response: [...campaignsSeen].slice(0, 40),
      publishers_in_response: [...publishersSeen].slice(0, 40),
      api_calls: apiCalls,
      http_errors: httpErrors,
      elapsed_ms: elapsedMs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("sync-ringba-calls-hablyte error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
