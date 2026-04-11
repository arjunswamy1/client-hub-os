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

function fmtDateUS(d: Date) {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const COLUMNS = [
  "campaignName", "publisherName", "publisherId",
  "inboundCallId", "callDt", "inboundPhoneNumber", "callerNumber",
  "callLengthInSeconds", "connectedCallLengthInSeconds",
  "targetName", "buyer",
  "profitNet", "totalCost", "telcoCost", "bidAmount",
  "wasBlocked", "hasConnected", "campaignId",
  "ringTreeWinningBid", "revenue", "payout",
  "conversionAmount", "payoutAmount", "hasConverted",
].map(c => ({ column: c }));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchPage(
  url: string, token: string, startDate: string, endDate: string, page: number,
  filters: any[] = []
): Promise<{ records: any[]; totalCount: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "application/json, text/plain, */*",
    },
    body: JSON.stringify({
      reportStart: startDate,
      reportEnd: endDate,
      page,
      pageSize: 100,
      columns: COLUMNS,
      orderByColumns: [],
      filters,
    }),
  });

  if (res.status === 429) {
    return { records: [], totalCount: -1 }; // signal rate limit
  }

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ringba API [${res.status}]: ${t.substring(0, 200)}`);
  }

  const data = await res.json();
  return {
    records: data?.report?.records || [],
    totalCount: data?.report?.totalCount || 0,
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
    let daysBack = 90;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        clientId = body.client_id || body.clientId || null;
        daysBack = body.days_back || body.daysBack || 90;
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
    const startDate = addDays(endDate, -daysBack);
    const startStr = fmtDateUS(startDate);
    const endStr = fmtDateUS(endDate);

    console.log(`Fetching calls from ${startStr} to ${endStr}`);

    // Fetch all pages
    let allCalls: any[] = [];
    let page = 1;
    let totalCount = 0;

    while (true) {
      const result = await fetchPage(ringbaUrl, RINGBA_API_TOKEN, startStr, endStr, page);
      
      if (result.totalCount === -1) {
        console.log(`Rate limited on page ${page}, waiting 5s...`);
        await sleep(5000);
        continue;
      }

      if (page === 1) {
        totalCount = result.totalCount;
        console.log(`Total calls in range: ${totalCount}`);
      }

      allCalls = allCalls.concat(result.records);

      if (result.records.length === 0 || allCalls.length >= totalCount) break;
      page++;
      if (page > 500) break;

      // Rate limit prevention
      if (page % 5 === 0) await sleep(200);
      if (page % 20 === 0) await sleep(1000);
    }

    console.log(`Fetched ${allCalls.length} total calls`);

    // Find all publishers
    const allPubs = new Set<string>();
    for (const c of allCalls) allPubs.add(c.publisherName || "unknown");
    console.log(`Publishers: ${JSON.stringify([...allPubs])}`);

    // Filter CPM publisher
    const cpmCalls = allCalls.filter((c: any) =>
      (c.publisherName || "").toLowerCase() === "cpm"
    );

    console.log(`CPM calls: ${cpmCalls.length}`);

    if (cpmCalls.length > 0) {
      const campaigns = [...new Set(cpmCalls.map((c: any) => c.campaignName))];
      console.log(`CPM campaigns: ${JSON.stringify(campaigns)}`);
      console.log(`Sample CPM call: ${JSON.stringify({
        campaign: cpmCalls[0].campaignName,
        publisher: cpmCalls[0].publisherName,
        revenue: cpmCalls[0].conversionAmount || cpmCalls[0].revenue || cpmCalls[0].ringTreeWinningBid,
        payout: cpmCalls[0].payoutAmount || cpmCalls[0].payout,
        profit: cpmCalls[0].profitNet,
        duration: cpmCalls[0].callLengthInSeconds,
        converted: cpmCalls[0].hasConverted,
        callDt: cpmCalls[0].callDt,
      })}`);
    }

    const uniqueCampaigns = [...new Set(cpmCalls.map((c: any) => c.campaignName || "unknown"))];

    // Upsert CPM calls
    let totalInserted = 0;
    for (const cId of clientIds) {
      const rows = cpmCalls.map((call: any) => {
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
        total_calls_fetched: allCalls.length,
        cpm_calls: cpmCalls.length,
        calls_synced: totalInserted,
        campaigns_found: uniqueCampaigns,
        publishers_found: [...allPubs],
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
