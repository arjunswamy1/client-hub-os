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

function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const RINGBA_COLUMNS = [
  "campaignName", "publisherName", "publisherId", "publisherSubId",
  "inboundCallId", "callDt", "inboundPhoneNumber", "callerNumber",
  "callLengthInSeconds", "connectedCallLengthInSeconds", "timeToCallInSeconds",
  "targetName", "targetId", "buyer", "buyerId",
  "profitNet", "totalCost", "telcoCost", "bidAmount",
  "wasBlocked", "blockReason", "hasConnected", "isDuplicate",
  "campaignId", "numberPoolName", "isFromNumberPool",
  "endCallSource", "callCompletedDt", "callConnectionDt",
  "ringTreeWinningBid", "ringTreeWinningBidMinimumRevenueAmount",
  "revenue", "payout", "connected", "converted",
].map(c => ({ column: c }));

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
    let daysBack = 30;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        clientId = body.client_id || body.clientId || null;
        daysBack = body.days_back || body.daysBack || 30;
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

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const ringbaUrl = `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`;
    console.log(`Fetching Ringba calls from ${formatDate(startDate)} to ${formatDate(endDate)}`);

    // Filter for CPM publisher — try multiple filter formats
    const filters = [
      {
        column: "publisherName",
        operand: "Equals Single Value",
        value: "CPM",
      },
    ];

    async function fetchAllCalls(ringbaFilters: any[]): Promise<{ calls: any[], totalCount: number }> {
      let allCalls: any[] = [];
      let page = 1;
      let totalCount = 0;

      while (true) {
        const response = await fetch(ringbaUrl, {
          method: "POST",
          headers: {
            Authorization: `Token ${RINGBA_API_TOKEN}`,
            "Content-Type": "application/json;charset=UTF-8",
            Accept: "application/json, text/plain, */*",
          },
          body: JSON.stringify({
            reportStart: formatDate(startDate),
            reportEnd: formatDate(endDate),
            page,
            pageSize: 1000,
            recordCount: 1000,
            columns: RINGBA_COLUMNS,
            orderByColumns: [],
            filters: ringbaFilters,
            formatDateTime: true,
            formatPercentages: false,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Ringba API error [${response.status}]: ${errorText.substring(0, 300)}`);
        }

        const data = await response.json();
        const records = data?.report?.records || [];
        totalCount = data?.report?.totalCount || 0;

        if (page === 1) {
          console.log(`Filter: ${JSON.stringify(ringbaFilters)}`);
          console.log(`Total count from API: ${totalCount}, first page: ${records.length} records`);
          if (records.length > 0) {
            console.log("Sample:", JSON.stringify({
              campaign: records[0].campaignName,
              publisher: records[0].publisherName,
              revenue: records[0].revenue,
              payout: records[0].payout,
              profitNet: records[0].profitNet,
              bidAmount: records[0].bidAmount,
              winningBid: records[0].ringTreeWinningBid,
              duration: records[0].callLengthInSeconds,
              hasConnected: records[0].hasConnected,
              target: records[0].targetName,
            }));
          }
        }

        allCalls = allCalls.concat(records);
        console.log(`Page ${page}: ${records.length} records (total: ${allCalls.length}/${totalCount})`);

        if (records.length === 0 || allCalls.length >= totalCount) break;
        page++;
        if (page > 500) break; // safety limit
      }
      return { calls: allCalls, totalCount };
    }

    // Try with CPM filter first
    let result = await fetchAllCalls(filters);

    // If filter didn't work (returned all calls or 0), try client-side filtering
    if (result.calls.length === 0) {
      console.log("CPM filter returned 0. Trying 'IS' operand...");
      result = await fetchAllCalls([{ column: "publisherName", operand: "IS", value: "CPM" }]);
    }

    if (result.calls.length === 0) {
      console.log("Still 0. Fetching ALL calls and filtering client-side for publisher=CPM...");
      result = await fetchAllCalls([]);
      const before = result.calls.length;
      result.calls = result.calls.filter((c: any) =>
        (c.publisherName || "").toLowerCase() === "cpm"
      );
      console.log(`Client-side CPM filter: ${result.calls.length} of ${before} total calls`);
      // Log unique publishers for debugging
      if (result.calls.length === 0) {
        const allPubs = [...new Set(result.calls.length > 0 ? [] :
          (await fetchAllCalls([])).calls.slice(0, 500).map((c: any) => c.publisherName || "unknown")
        )];
        console.log("Publishers in first 500 calls:", JSON.stringify(allPubs));
      }
    }

    const allCalls = result.calls;
    console.log(`Final CPM calls to sync: ${allCalls.length}`);

    const uniqueCampaigns = [...new Set(allCalls.map((c: any) => c.campaignName || "unknown"))];
    console.log("Campaigns:", JSON.stringify(uniqueCampaigns));

    let totalInserted = 0;

    for (const cId of clientIds) {
      const rows = allCalls.map((call: any) => {
        const callId = call.inboundCallId || `${call.callDt}-${call.inboundPhoneNumber || Math.random()}`;
        // Use revenue field first, then winning bid, then profitNet
        const revenue = Number(call.revenue || call.ringTreeWinningBid || call.bidAmount || call.profitNet || 0);
        const payout = Number(call.payout || call.totalCost || 0);
        const duration = call.callLengthInSeconds || call.connectedCallLengthInSeconds || 0;
        const connected = call.hasConnected ?? call.connected ?? (duration > 0 && !call.wasBlocked);
        const converted = call.converted ?? (revenue > 0);

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
            publisherSubId: call.publisherSubId,
            buyer: call.buyer,
            buyerId: call.buyerId,
            targetId: call.targetId,
            numberPoolName: call.numberPoolName,
            wasBlocked: call.wasBlocked,
            blockReason: call.blockReason,
            bidAmount: call.bidAmount,
            profitNet: call.profitNet,
            totalCost: call.totalCost,
            telcoCost: call.telcoCost,
            winningBid: call.ringTreeWinningBid,
            isDuplicate: call.isDuplicate,
          },
        };
      });

      // Deduplicate by call_id before upserting
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
          console.error(`Upsert error batch ${i / batchSize}:`, error.message);
        } else {
          totalInserted += batch.length;
        }
      }
    }

    console.log(`Synced ${totalInserted} CPM calls for ${clientIds.length} client(s)`);

    return new Response(
      JSON.stringify({
        success: true,
        total_api_count: result.totalCount,
        cpm_calls: allCalls.length,
        calls_synced: totalInserted,
        clients: clientIds.length,
        campaigns_found: uniqueCampaigns,
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
