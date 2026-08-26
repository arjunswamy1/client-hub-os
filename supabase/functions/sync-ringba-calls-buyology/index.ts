import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { logIntegrationCall } from "../_shared/cost-tracking.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUYOLOGY_CLIENT_ID = "b3d600f5-5d6b-4378-aa96-b395c05e9297";

/** Only these campaigns are live for BuyologyIQ — everything else in the Ringba
 * account (Health Sharing, Timeshare Exit, etc.) is ignored. */
const LIVE_CAMPAIGNS = ["walk in tubs", "bathroom remodel"];
const isLiveCampaign = (name: string) => {
  const n = (name || "").trim().toLowerCase();
  if (!n) return false;
  return LIVE_CAMPAIGNS.some((c) => n === c || n.includes(c));
};

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

/** Columns we ask Ringba for. Tag columns carry the Meta/Google UTM values that
 * the dashboard joins creatives on (`tag:User:utm_content` etc.). */
const VALUE_COLUMNS = [
  "inboundCallId", "callDt", "campaignName", "targetName", "buyer",
  "inboundPhoneNumber", "callerId", "callLengthInSeconds", "connectedCallLengthInSeconds",
  "hasConnected", "hasConverted", "conversionAmount", "payoutAmount", "totalCost",
  "publisherName", "callerStateProvince", "callerCity", "endCallSource", "recordingUrl",
  "tag:User:utm_content", "tag:User:utm_source", "tag:User:utm_medium",
  "tag:User:utm_campaign", "tag:User:utm_term", "tag:User:creative",
];

/** Keep every Ringba tag on the row so creative attribution keeps working even
 * if Buyology renames a tag later. */
function collectTags(call: Record<string, any>): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(call)) {
    if (k.startsWith("tag:") && v !== null && v !== undefined && String(v).trim() !== "") {
      tags[k] = String(v).trim();
    }
  }
  // Some Ringba responses nest tags under `tags` as an object or array.
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
  const callId = call.inboundCallId || call.callId || `${call.callDt}-${call.callerId || call.callerNumber || "unknown"}`;
  const duration = Number(call.callLengthInSeconds || call.connectedCallLengthInSeconds || 0);
  const connected = call.hasConnected ?? (duration > 0 && !call.wasBlocked);
  const converted = !!(connected && call.hasConverted);
  const revenue = converted ? Number(call.conversionAmount || call.revenue || 0) : 0;
  const payout = Number(call.payoutAmount || call.payout || call.totalCost || 0);

  return {
    client_id: BUYOLOGY_CLIENT_ID,
    call_id: String(callId),
    call_date: parseRingbaDate(call.callDt),
    campaign_name: call.campaignName || null,
    target_name: call.targetName || call.buyer || null,
    caller_number: call.callerId || call.callerNumber || null,
    inbound_number: call.inboundPhoneNumber || null,
    duration_seconds: duration,
    connected: !!connected,
    converted,
    revenue,
    payout,
    metadata: {
      source: "ringba_api",
      publisher: call.publisherName || null,
      state: call.callerStateProvince || call.callerState || null,
      city: call.callerCity || null,
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
    const RINGBA_API_TOKEN = Deno.env.get("RINGBA_API_TOKEN_BUYOLOGY");
    const RINGBA_ACCOUNT_ID = Deno.env.get("RINGBA_ACCOUNT_ID_BUYOLOGY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!RINGBA_API_TOKEN) throw new Error("RINGBA_API_TOKEN_BUYOLOGY is not configured");
    if (!RINGBA_ACCOUNT_ID) throw new Error("RINGBA_ACCOUNT_ID_BUYOLOGY is not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let daysBack = 7;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        daysBack = Number(body.days_back ?? body.daysBack ?? 7) || 7;
      } catch { /* default */ }
    }
    daysBack = Math.min(Math.max(daysBack, 1), 120);

    const ringbaUrl = `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`;
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - daysBack);

    // Newest-first day chunks so today's calls always land even if we time out.
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

    let totalFetched = 0, totalFiltered = 0, totalUpserted = 0, apiCalls = 0, httpErrors = 0;
    let taggedCalls = 0;
    let useValueColumns = true;
    const campaignsSeen = new Set<string>();
    const campaignsKept = new Set<string>();
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
        if (useValueColumns) payload.valueColumns = VALUE_COLUMNS.map((c) => ({ column: c }));

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
          // Unknown column names -> retry the same page without valueColumns.
          if (res.status === 400 && useValueColumns) {
            useValueColumns = false;
            console.warn("Retrying without valueColumns (tag columns rejected)");
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

        for (const r of records) campaignsSeen.add(r.campaignName || "unknown");

        const live = records.filter((r) => isLiveCampaign(r.campaignName || ""));
        for (const r of live) campaignsKept.add(r.campaignName || "unknown");
        totalFiltered += live.length;

        if (live.length > 0) {
          const seen = new Set<string>();
          const rows = live.map(mapCallToRow).filter((r) => {
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
      `Buyology Ringba sync: fetched=${totalFetched}, live=${totalFiltered}, upserted=${totalUpserted}, ` +
      `tagged=${taggedCalls}, apiCalls=${apiCalls}, errors=${httpErrors}, elapsed=${elapsedMs}ms`
    );

    if (apiCalls > 0) {
      await logIntegrationCall({
        client_id: BUYOLOGY_CLIENT_ID,
        service: "ringba_api",
        surface: "sync-ringba-calls-buyology",
        calls: apiCalls,
        metadata: { days_back: daysBack, calls_fetched: totalFetched, calls_synced: totalUpserted },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      days_back: daysBack,
      calls_fetched: totalFetched,
      calls_live_campaigns: totalFiltered,
      calls_synced: totalUpserted,
      calls_with_tags: taggedCalls,
      tag_columns_requested: useValueColumns,
      campaigns_in_response: [...campaignsSeen].slice(0, 40),
      campaigns_kept: [...campaignsKept],
      api_calls: apiCalls,
      http_errors: httpErrors,
      elapsed_ms: elapsedMs,
      warning: totalFetched > 50 && totalFiltered === 0
        ? "Fetched calls but none matched Walk In Tubs / Bathroom Remodel — check campaign names in Ringba"
        : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("sync-ringba-calls-buyology error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
