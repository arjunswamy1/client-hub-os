import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function parseRingbaDate(dt: string): string {
  if (!dt) return new Date().toISOString();
  if (dt.includes("T") || dt.match(/^\d{4}-/)) return dt;
  try {
    const d = new Date(dt);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch { /* fall through */ }
  return new Date().toISOString();
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const COLUMNS = [
  "campaignName", "publisherName", "publisherId",
  "inboundCallId", "callDt", "inboundPhoneNumber", "callerNumber",
  "callLengthInSeconds", "connectedCallLengthInSeconds",
  "targetName", "buyer",
  "profitNet", "totalCost", "telcoCost", "bidAmount",
  "wasBlocked", "blockReason", "hasConnected",
  "campaignId", "numberPoolName",
  "ringTreeWinningBid", "revenue", "payout",
].map(c => ({ column: c }));

/** Fetch one date-range chunk, paginating up to maxPages */
async function fetchChunk(
  url: string, token: string,
  startStr: string, endStr: string,
  maxPages = 200
): Promise<any[]> {
  let all: any[] = [];
  let page = 1;

  while (page <= maxPages) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json;charset=UTF-8",
        Accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify({
        reportStart: startStr,
        reportEnd: endStr,
        page,
        pageSize: 1000,
        columns: COLUMNS,
        orderByColumns: [],
        filters: [],
        formatDateTime: true,
        formatPercentages: false,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Ringba API [${res.status}]: ${t.substring(0, 200)}`);
    }

    const data = await res.json();
    const records = data?.report?.records || [];
    const total = data?.report?.totalCount || 0;

    all = all.concat(records);

    if (page === 1) {
      console.log(`  Chunk ${startStr}→${endStr}: ${total} total, page1=${records.length}`);
    }

    if (records.length === 0 || all.length >= total) break;
    page++;
  }
  return all;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const RINGBA_API_TOKEN = Deno.env.get("RINGBA_API_TOKEN");
    const RINGBA_ACCOUNT_ID = Deno.env.get("RINGBA_ACCOUNT_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!RINGBA_API_TOKEN) throw new Error("RINGBA_API_TOKEN is not configured");
    if (!RINGBA_ACCOUNT_ID) throw new Error("RINGBA_ACCOUNT_ID is not configured");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let clientId: string | null = null;
    let daysBack = 7;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        clientId = body.client_id || body.clientId || null;
        daysBack = body.days_back || body.daysBack || 7;
      } catch { /* no body */ }
    }

    // Find client(s)
    let clientIds: string[] = [];
    if (clientId) {
      clientIds = [clientId];
    } else {
      const { data: configs } = await supabase
        .from("dashboard_configs")
        .select("client_id")
        .eq("revenue_source", "ringba");
      if (configs && configs.length > 0) {
        clientIds = configs.map((c: any) => c.client_id);
      } else {
        const { data: clients } = await supabase
          .from("clients")
          .select("id, slug")
          .ilike("slug", "%billy%");
        clientIds = (clients || []).map((c: any) => c.id);
      }
    }

    if (clientIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No Ringba clients found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ringbaUrl = `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`;

    // Break into 3-day chunks to avoid timeouts
    const chunkDays = 3;
    const endDate = new Date();
    const chunks: { start: string; end: string }[] = [];
    for (let d = 0; d < daysBack; d += chunkDays) {
      const cEnd = new Date(endDate);
      cEnd.setDate(cEnd.getDate() - d);
      const cStart = new Date(endDate);
      cStart.setDate(cStart.getDate() - Math.min(d + chunkDays - 1, daysBack - 1));
      chunks.push({ start: fmtDate(cStart), end: fmtDate(cEnd) });
    }

    console.log(`Fetching ${daysBack} days in ${chunks.length} chunks of ${chunkDays} days`);

    let allCalls: any[] = [];
    for (const chunk of chunks) {
      const calls = await fetchChunk(ringbaUrl, RINGBA_API_TOKEN, chunk.start, chunk.end);
      allCalls = allCalls.concat(calls);
    }

    console.log(`Total fetched: ${allCalls.length}`);

    // Filter for CPM publisher only
    const cpmCalls = allCalls.filter((c: any) =>
      (c.publisherName || "").toLowerCase() === "cpm"
    );

    // Log all publishers for debugging
    const allPubs = [...new Set(allCalls.map((c: any) => c.publisherName || "unknown"))];
    console.log(`Publishers found: ${JSON.stringify(allPubs)}`);
    console.log(`CPM calls: ${cpmCalls.length} of ${allCalls.length}`);

    if (cpmCalls.length > 0) {
      console.log("Sample CPM call:", JSON.stringify({
        campaign: cpmCalls[0].campaignName,
        publisher: cpmCalls[0].publisherName,
        revenue: cpmCalls[0].revenue,
        profitNet: cpmCalls[0].profitNet,
        bidAmount: cpmCalls[0].bidAmount,
        winningBid: cpmCalls[0].ringTreeWinningBid,
        duration: cpmCalls[0].callLengthInSeconds,
        target: cpmCalls[0].targetName,
      }));
    }

    const uniqueCampaigns = [...new Set(cpmCalls.map((c: any) => c.campaignName || "unknown"))];
    console.log("CPM campaigns:", JSON.stringify(uniqueCampaigns));

    let totalInserted = 0;

    for (const cId of clientIds) {
      const rows = cpmCalls.map((call: any) => {
        const callId = call.inboundCallId || `${call.callDt}-${call.inboundPhoneNumber || Math.random()}`;
        const revenue = Number(call.revenue || call.ringTreeWinningBid || call.profitNet || 0);
        const payout = Number(call.payout || call.totalCost || 0);
        const duration = call.callLengthInSeconds || call.connectedCallLengthInSeconds || 0;
        const connected = call.hasConnected ?? (duration > 0 && !call.wasBlocked);
        const converted = revenue > 0;

        return {
          client_id: cId,
          call_id: callId,
          call_date: parseRingbaDate(call.callDt),
          campaign_name: call.campaignName || null,
          target_name: call.targetName || null,
          caller_number: call.callerNumber || null,
          duration_seconds: duration,
          connected,
          converted,
          revenue,
          payout,
          inbound_number: call.inboundPhoneNumber || null,
          metadata: {
            campaignId: call.campaignId,
            publisherId: call.publisherId,
            publisherName: call.publisherName,
            buyer: call.buyer,
            targetName: call.targetName,
            numberPoolName: call.numberPoolName,
            wasBlocked: call.wasBlocked,
            bidAmount: call.bidAmount,
            profitNet: call.profitNet,
            totalCost: call.totalCost,
            telcoCost: call.telcoCost,
            winningBid: call.ringTreeWinningBid,
          },
        };
      });

      // Deduplicate
      const seen = new Set<string>();
      const deduped = rows.filter(r => {
        if (seen.has(r.call_id)) return false;
        seen.add(r.call_id);
        return true;
      });

      const batchSize = 200;
      for (let i = 0; i < deduped.length; i += batchSize) {
        const batch = deduped.slice(i, i + batchSize);
        const { error } = await supabase
          .from("ringba_calls")
          .upsert(batch, { onConflict: "client_id,call_id" });
        if (error) {
          console.error(`Upsert error:`, error.message);
        } else {
          totalInserted += batch.length;
        }
      }
    }

    console.log(`Synced ${totalInserted} CPM calls`);

    return new Response(
      JSON.stringify({
        success: true,
        total_fetched: allCalls.length,
        cpm_calls: cpmCalls.length,
        calls_synced: totalInserted,
        campaigns_found: uniqueCampaigns,
        publishers_found: allPubs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("sync-ringba-calls error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
