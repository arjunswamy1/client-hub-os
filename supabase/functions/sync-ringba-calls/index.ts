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

const COLUMNS = [
  "campaignName", "publisherName", "publisherId",
  "inboundCallId", "callDt", "inboundPhoneNumber", "callerNumber",
  "callLengthInSeconds", "connectedCallLengthInSeconds",
  "targetName", "buyer",
  "profitNet", "totalCost", "telcoCost", "bidAmount",
  "wasBlocked", "hasConnected", "hasConverted",
  "campaignId", "ringTreeWinningBid",
  "revenue", "payout", "conversionAmount", "payoutAmount",
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
    let startPage = 1;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        clientId = body.client_id || body.clientId || null;
        daysBack = body.days_back || body.daysBack || 30;
        startPage = body.start_page || 1;
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
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - daysBack);

    console.log(`Fetching pages starting from ${startPage}, range: ${daysBack} days`);

    let allCalls: any[] = [];
    let page = startPage;
    let totalCount = 0;
    let lastPage = startPage;
    const startTime = Date.now();
    const MAX_RUNTIME_MS = 45000; // 45s safety margin

    while (Date.now() - startTime < MAX_RUNTIME_MS) {
      const res = await fetch(ringbaUrl, {
        method: "POST",
        headers: {
          Authorization: `Token ${RINGBA_API_TOKEN}`,
          "Content-Type": "application/json;charset=UTF-8",
          Accept: "application/json, text/plain, */*",
        },
        body: JSON.stringify({
          reportStart: startDate.toISOString(),
          reportEnd: endDate.toISOString(),
          page,
          pageSize: 100,
          columns: COLUMNS,
          orderByColumns: [],
          filters: [],
        }),
      });

      if (res.status === 429) {
        console.log(`Rate limited on page ${page}, waiting 12s...`);
        await sleep(12000);
        if (Date.now() - startTime > MAX_RUNTIME_MS) break;
        continue;
      }

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Ringba API [${res.status}]: ${t.substring(0, 200)}`);
      }

      const data = await res.json();
      const records = data?.report?.records || [];

      if (page === startPage) {
        totalCount = data?.report?.totalCount || 0;
        console.log(`Total calls: ${totalCount}`);
        if (records.length > 0) {
          const pubs = [...new Set(records.map((r: any) => r.publisherName))];
          console.log(`Publishers in first page: ${JSON.stringify(pubs)}`);
        }
      }

      allCalls = allCalls.concat(records);
      lastPage = page;

      if (records.length === 0 || allCalls.length >= totalCount) {
        lastPage = -1; // done
        break;
      }

      page++;
      if (page > 500) break;

      // Brief pause between requests
      await sleep(500);
    }

    console.log(`Fetched ${allCalls.length} calls (pages ${startPage}-${lastPage})`);

    // Show campaigns and publisher breakdown
    const campaigns = [...new Set(allCalls.map((c: any) => c.campaignName))];
    const publishers = [...new Set(allCalls.map((c: any) => c.publisherName))];
    console.log(`Campaigns: ${JSON.stringify(campaigns.slice(0, 20))}`);
    console.log(`Publishers: ${JSON.stringify(publishers)}`);

    // Upsert ALL calls to database
    let totalInserted = 0;
    for (const cId of clientIds) {
      const rows = allCalls.map((call: any) => {
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

    console.log(`Synced ${totalInserted} calls`);

    return new Response(
      JSON.stringify({
        success: true,
        total_in_range: totalCount,
        calls_fetched: allCalls.length,
        calls_synced: totalInserted,
        campaigns_found: campaigns,
        publishers_found: publishers,
        last_page: lastPage,
        next_page: lastPage === -1 ? null : lastPage + 1,
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
