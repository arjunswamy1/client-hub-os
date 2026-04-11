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
    try { const d = new Date(dt); if (!isNaN(d.getTime())) return d.toISOString(); } catch {}
  }
  return new Date().toISOString();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const COLUMNS = [
  "campaignName", "publisherName", "publisherId",
  "inboundCallId", "callDt", "inboundPhoneNumber", "callerNumber",
  "callLengthInSeconds", "connectedCallLengthInSeconds",
  "targetName", "buyer", "profitNet", "totalCost", "telcoCost", "bidAmount",
  "wasBlocked", "hasConnected", "hasConverted", "campaignId",
  "ringTreeWinningBid", "revenue", "payout", "conversionAmount", "payoutAmount",
].map(c => ({ column: c }));

function mapCallToRow(call: any, clientId: string) {
  const callId = call.inboundCallId || `${call.callDt}-${Math.random()}`;
  const revenue = Number(call.conversionAmount || call.revenue || call.ringTreeWinningBid || call.profitNet || 0);
  const payout = Number(call.payoutAmount || call.payout || call.totalCost || 0);
  const duration = call.callLengthInSeconds || call.connectedCallLengthInSeconds || 0;

  return {
    client_id: clientId,
    call_id: callId,
    call_date: parseRingbaDate(call.callDt),
    campaign_name: call.campaignName || null,
    target_name: call.targetName || null,
    caller_number: call.callerNumber || null,
    duration_seconds: duration,
    connected: call.hasConnected ?? (duration > 0 && !call.wasBlocked),
    converted: call.hasConverted ?? revenue > 0,
    revenue, payout,
    inbound_number: call.inboundPhoneNumber || null,
    metadata: {
      publisherName: call.publisherName, publisherId: call.publisherId,
      buyer: call.buyer, campaignId: call.campaignId,
      bidAmount: call.bidAmount, profitNet: call.profitNet,
      totalCost: call.totalCost, telcoCost: call.telcoCost,
      winningBid: call.ringTreeWinningBid, conversionAmount: call.conversionAmount,
    },
  };
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
    let daysBack = 365;
    let startPage = 1;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        clientId = body.client_id || body.clientId || null;
        daysBack = body.days_back || body.daysBack || 365;
        startPage = body.start_page || 1;
      } catch {}
    }

    // Find client(s)
    let clientIds: string[] = [];
    if (clientId) {
      clientIds = [clientId];
    } else {
      const { data: configs } = await supabase
        .from("dashboard_configs").select("client_id").eq("revenue_source", "ringba");
      if (configs?.length) {
        clientIds = configs.map((c: any) => c.client_id);
      } else {
        const { data: clients } = await supabase
          .from("clients").select("id, slug").ilike("slug", "%billy%");
        clientIds = (clients || []).map((c: any) => c.id);
      }
    }

    if (clientIds.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No Ringba clients found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ringbaUrl = `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`;
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - daysBack);

    let page = startPage;
    let totalCount = 0;
    let totalFetched = 0;
    let totalInserted = 0;
    let lastPage = startPage;
    const allCampaigns = new Set<string>();
    const allPublishers = new Set<string>();
    const startTime = Date.now();
    const MAX_MS = 25000; // 25s for fetching, leaves time for upserts
    const MAX_PAGES = 20; // fetch at most 20 pages per invocation

    console.log(`Sync from page ${startPage}, ${daysBack} days`);

    while (Date.now() - startTime < MAX_MS) {
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
          page, pageSize: 100,
          columns: COLUMNS, orderByColumns: [], filters: [],
        }),
      });

      if (res.status === 429) {
        console.log(`Rate limited p${page}, wait 12s`);
        await sleep(12000);
        if (Date.now() - startTime > MAX_MS) break;
        continue;
      }

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`Ringba [${res.status}]: ${t.substring(0, 200)}`);
      }

      const data = await res.json();
      const records = data?.report?.records || [];

      if (page === startPage) {
        totalCount = data?.report?.totalCount || 0;
        console.log(`Total in range: ${totalCount}`);
      }

      totalFetched += records.length;
      lastPage = page;

      // Track metadata
      for (const r of records) {
        allCampaigns.add(r.campaignName || "unknown");
        allPublishers.add(r.publisherName || "unknown");
      }

      // IMMEDIATELY upsert this page's records
      if (records.length > 0) {
        for (const cId of clientIds) {
          const rows = records.map((call: any) => mapCallToRow(call, cId));
          const seen = new Set<string>();
          const deduped = rows.filter((r: any) => {
            if (seen.has(r.call_id)) return false;
            seen.add(r.call_id);
            return true;
          });

          const { error } = await supabase
            .from("ringba_calls")
            .upsert(deduped, { onConflict: "client_id,call_id" });
          if (error) {
            console.error(`Upsert err p${page}: ${error.message}`);
          } else {
            totalInserted += deduped.length;
          }
        }
      }

      if (records.length === 0 || totalFetched >= totalCount) {
        lastPage = -1;
        break;
      }

      page++;
      if (page > 500) break;
      await sleep(300);
    }

    console.log(`Done: fetched=${totalFetched}, inserted=${totalInserted}, pages=${startPage}-${lastPage}`);
    console.log(`Campaigns: ${JSON.stringify([...allCampaigns])}`);

    return new Response(JSON.stringify({
      success: true,
      total_in_range: totalCount,
      calls_fetched: totalFetched,
      calls_synced: totalInserted,
      campaigns_found: [...allCampaigns],
      publishers_found: [...allPublishers],
      last_page: lastPage,
      next_page: lastPage === -1 ? null : lastPage + 1,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("sync-ringba-calls error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
