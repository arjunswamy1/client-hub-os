import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function parseRingbaDate(dt: any): string {
  if (!dt) return new Date().toISOString();
  if (typeof dt === "number") return new Date(dt).toISOString();
  if (typeof dt === "string") {
    if (dt.includes("T") || dt.match(/^\d{4}-/)) return dt;
    try {
      const d = new Date(dt);
      if (!isNaN(d.getTime())) return d.toISOString();
    } catch { /* fall through */ }
  }
  return new Date().toISOString();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
    let debugMode = false;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        clientId = body.client_id || body.clientId || null;
        daysBack = body.days_back || body.daysBack || 30;
        debugMode = body.debug || false;
      } catch { /* no body */ }
    }

    const authHeaders = {
      Authorization: `Token ${RINGBA_API_TOKEN}`,
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "application/json, text/plain, */*",
    };

    if (debugMode) {
      // Test multiple approaches to find one that works
      console.log(`Debug mode - testing different API approaches`);

      // Approach 1: GET /calllogs (no POST)
      const getRes = await fetch(
        `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`,
        { headers: authHeaders }
      );
      const getText = await getRes.text();
      console.log(`GET calllogs [${getRes.status}]: ${getText.substring(0, 500)}`);

      await sleep(1000);

      // Approach 2: POST with reportStart/End in ISO format
      const postIsoRes = await fetch(
        `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            reportStart: "2025-02-01T00:00:00Z",
            reportEnd: "2025-02-07T23:59:59Z",
            page: 1,
            pageSize: 500,
            columns: [
              { column: "campaignName" },
              { column: "publisherName" },
              { column: "inboundCallId" },
              { column: "callDt" },
              { column: "revenue" },
              { column: "payout" },
              { column: "conversionAmount" },
              { column: "callLengthInSeconds" },
              { column: "hasConverted" },
              { column: "hasConnected" },
              { column: "targetName" },
              { column: "profitNet" },
            ],
            filters: [
              { column: "publisherName", value: "CPM" }
            ],
          }),
        }
      );
      const postIsoData = await postIsoRes.json();
      const isoTotal = postIsoData?.report?.totalCount || 0;
      const isoRecords = postIsoData?.report?.records || [];
      console.log(`POST ISO + CPM filter [${postIsoRes.status}]: total=${isoTotal}, records=${isoRecords.length}`);
      if (isoRecords.length > 0) {
        console.log(`Sample: ${JSON.stringify(isoRecords[0])}`);
      }

      await sleep(1000);

      // Approach 3: POST with US date, no filter, just 1 week of 2025 data
      const postUsRes = await fetch(
        `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            reportStart: "02/01/2025",
            reportEnd: "02/07/2025",
            page: 1,
            pageSize: 500,
            columns: [
              { column: "campaignName" },
              { column: "publisherName" },
              { column: "inboundCallId" },
              { column: "callDt" },
              { column: "revenue" },
              { column: "conversionAmount" },
              { column: "callLengthInSeconds" },
              { column: "hasConverted" },
              { column: "targetName" },
              { column: "profitNet" },
            ],
            filters: [],
          }),
        }
      );
      const postUsData = await postUsRes.json();
      const usTotal = postUsData?.report?.totalCount || 0;
      const usRecords = postUsData?.report?.records || [];
      console.log(`POST US date no filter [${postUsRes.status}]: total=${usTotal}, records=${usRecords.length}`);
      if (usRecords.length > 0) {
        // Show unique publishers
        const pubs = [...new Set(usRecords.map((r: any) => r.publisherName))];
        console.log(`Publishers in sample: ${JSON.stringify(pubs)}`);
        // Check for CPM
        const cpmSample = usRecords.filter((r: any) => (r.publisherName || "").toLowerCase() === "cpm");
        console.log(`CPM in sample: ${cpmSample.length}`);
      }

      return new Response(
        JSON.stringify({
          success: true, debug: true,
          get_status: getRes.status,
          iso_total: isoTotal, iso_records: isoRecords.length,
          us_total: usTotal, us_records: usRecords.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normal sync mode - find clients
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

    // Fetch CPM calls using ISO date format with filter
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - daysBack);
    
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    console.log(`Fetching CPM calls from ${startISO} to ${endISO}`);

    let allCpmCalls: any[] = [];
    let page = 1;
    let totalCount = 0;
    let retries = 0;

    while (retries < 10) {
      const res = await fetch(
        `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            reportStart: startISO,
            reportEnd: endISO,
            page,
            pageSize: 500,
            columns: [
              { column: "campaignName" },
              { column: "publisherName" },
              { column: "publisherId" },
              { column: "inboundCallId" },
              { column: "callDt" },
              { column: "inboundPhoneNumber" },
              { column: "callerNumber" },
              { column: "callLengthInSeconds" },
              { column: "connectedCallLengthInSeconds" },
              { column: "targetName" },
              { column: "buyer" },
              { column: "profitNet" },
              { column: "totalCost" },
              { column: "telcoCost" },
              { column: "bidAmount" },
              { column: "wasBlocked" },
              { column: "hasConnected" },
              { column: "hasConverted" },
              { column: "campaignId" },
              { column: "ringTreeWinningBid" },
              { column: "revenue" },
              { column: "payout" },
              { column: "conversionAmount" },
              { column: "payoutAmount" },
            ],
            filters: [
              { column: "publisherName", value: "CPM" }
            ],
          }),
        }
      );

      if (res.status === 429) {
        retries++;
        console.log(`Rate limited on page ${page}, retry ${retries}, waiting 15s...`);
        await sleep(15000);
        continue;
      }

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Ringba API [${res.status}]: ${t.substring(0, 200)}`);
      }

      const data = await res.json();
      const records = data?.report?.records || [];
      
      if (page === 1) {
        totalCount = data?.report?.totalCount || 0;
        console.log(`Total CPM calls found: ${totalCount}`);
        if (records.length > 0) {
          console.log(`Sample: ${JSON.stringify({
            campaign: records[0].campaignName,
            publisher: records[0].publisherName,
            revenue: records[0].conversionAmount || records[0].revenue,
            callDt: records[0].callDt,
          })}`);
        }
      }

      allCpmCalls = allCpmCalls.concat(records);

      if (records.length === 0 || allCpmCalls.length >= totalCount) break;
      page++;
      if (page > 200) break;
      
      // Respect rate limits: max 5/min
      await sleep(13000); // ~4.6 requests/min to stay safe
    }

    console.log(`Fetched ${allCpmCalls.length} CPM calls total`);

    const uniqueCampaigns = [...new Set(allCpmCalls.map((c: any) => c.campaignName || "unknown"))];
    console.log(`Campaigns: ${JSON.stringify(uniqueCampaigns)}`);

    // Upsert calls
    let totalInserted = 0;
    for (const cId of clientIds) {
      const rows = allCpmCalls.map((call: any) => {
        const callId = call.inboundCallId || `${call.callDt}-${Math.random()}`;
        const revenue = Number(call.conversionAmount || call.revenue || call.ringTreeWinningBid || call.profitNet || 0);
        const payout = Number(call.payoutAmount || call.payout || call.totalCost || 0);
        const duration = call.callLengthInSeconds || call.connectedCallLengthInSeconds || 0;

        return {
          client_id: cId,
          call_id: callId,
          call_date: parseRingbaDate(call.callDt),
          campaign_name: call.campaignName || null,
          target_name: call.targetName || null,
          caller_number: call.callerNumber || null,
          duration_seconds: duration,
          connected: call.hasConnected ?? (duration > 0 && !call.wasBlocked),
          converted: call.hasConverted ?? revenue > 0,
          revenue,
          payout,
          inbound_number: call.inboundPhoneNumber || null,
          metadata: {
            publisherName: call.publisherName,
            publisherId: call.publisherId,
            buyer: call.buyer,
            campaignId: call.campaignId,
            bidAmount: call.bidAmount,
            profitNet: call.profitNet,
            totalCost: call.totalCost,
            telcoCost: call.telcoCost,
            winningBid: call.ringTreeWinningBid,
            conversionAmount: call.conversionAmount,
          },
        };
      });

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
        total_cpm_calls: allCpmCalls.length,
        calls_synced: totalInserted,
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
