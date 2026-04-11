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

    // Filter for CPM publisher only
    const filters = [{
      column: "publisherName",
      operand: "IS",
      value: "CPM",
    }];

    let allCalls: any[] = [];
    let page = 1;
    let totalCount = 0;
    const pageSize = 500;

    while (true) {
      // Try multiple pagination param names
      const requestBody = {
        reportStart: formatDate(startDate),
        reportEnd: formatDate(endDate),
        page,
        pageSize,
        recordCount: pageSize,
        rowCount: pageSize,
        columns: RINGBA_COLUMNS,
        orderByColumns: [],
        filters,
        formatDateTime: true,
        formatPercentages: false,
      };

      const response = await fetch(ringbaUrl, {
        method: "POST",
        headers: {
          Authorization: `Token ${RINGBA_API_TOKEN}`,
          "Content-Type": "application/json;charset=UTF-8",
          Accept: "application/json, text/plain, */*",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ringba API error [${response.status}]: ${errorText.substring(0, 300)}`);
      }

      const data = await response.json();
      const records = data?.report?.records || [];
      totalCount = data?.report?.totalCount || 0;

      if (page === 1) {
        console.log(`Total count from API: ${totalCount}`);
        if (records.length > 0) {
          console.log("Record keys:", JSON.stringify(Object.keys(records[0])));
          console.log("Sample record:", JSON.stringify(records[0]).substring(0, 500));
        }
        // If filter returned 0, try without filter and log publishers
        if (totalCount === 0 || records.length === 0) {
          console.log("No CPM publisher calls found with filter. Trying without filter to list publishers...");
          const unfilteredRes = await fetch(ringbaUrl, {
            method: "POST",
            headers: {
              Authorization: `Token ${RINGBA_API_TOKEN}`,
              "Content-Type": "application/json;charset=UTF-8",
              Accept: "application/json, text/plain, */*",
            },
            body: JSON.stringify({
              ...requestBody,
              filters: [],
            }),
          });
          if (unfilteredRes.ok) {
            const ufData = await unfilteredRes.json();
            const ufRecords = ufData?.report?.records || [];
            const publishers = [...new Set(ufRecords.map((r: any) => r.publisherName || "unknown"))];
            console.log(`Unfiltered: ${ufData?.report?.totalCount} total calls, ${ufRecords.length} in first page`);
            console.log("All publisher names:", JSON.stringify(publishers));
          }
          break;
        }
      }

      allCalls = allCalls.concat(records);
      console.log(`Page ${page}: ${records.length} records (total fetched: ${allCalls.length} of ${totalCount})`);

      if (records.length === 0 || allCalls.length >= totalCount) break;
      page++;
      if (page > 100) break;
    }

    console.log(`Total CPM calls fetched: ${allCalls.length}`);

    const uniqueCampaigns = [...new Set(allCalls.map((c: any) => c.campaignName || "unknown"))];
    console.log("Campaigns:", JSON.stringify(uniqueCampaigns));

    let totalInserted = 0;

    for (const cId of clientIds) {
      const rows = allCalls.map((call: any) => {
        const callId = call.inboundCallId || `${call.callDt}-${call.inboundPhoneNumber || Math.random()}`;
        // Revenue: Ringba uses profitNet for net revenue, bidAmount/winningBid for gross
        const revenue = Number(call.ringTreeWinningBid || call.bidAmount || call.profitNet || 0);
        const payout = Number(call.totalCost || 0);
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
          },
        };
      });

      const batchSize = 200;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
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
        total_api_count: totalCount,
        total_fetched: allCalls.length,
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
