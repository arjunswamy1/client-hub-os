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
].map(c => ({ column: c }));

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Fetch one day of calls, all pages */
async function fetchDay(
  url: string, token: string, dateStr: string
): Promise<any[]> {
  let all: any[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json;charset=UTF-8",
        Accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify({
        reportStart: dateStr,
        reportEnd: dateStr,
        page,
        pageSize: 1000,
        columns: COLUMNS,
        orderByColumns: [],
        filters: [],
        formatDateTime: true,
        formatPercentages: false,
      }),
    });

    if (res.status === 429) {
      console.log(`  Rate limited on page ${page}, waiting 5s...`);
      await sleep(5000);
      continue; // retry same page
    }

    if (!res.ok) {
      const t = await res.text();
      console.error(`Ringba API [${res.status}]: ${t.substring(0, 500)}`);
      throw new Error(`Ringba API [${res.status}]: ${t.substring(0, 200)}`);
    }

    const data = await res.json();
    if (page === 1) {
      console.log(`  RAW response keys: ${JSON.stringify(Object.keys(data))}`);
      if (data.report) console.log(`  report keys: ${JSON.stringify(Object.keys(data.report))}`);
    }
    const records = data?.report?.records || [];
    const total = data?.report?.totalCount || 0;

    all = all.concat(records);

    if (page === 1) {
      console.log(`  ${dateStr}: ${total} total calls, page1=${records.length}`);
    }

    if (records.length === 0 || all.length >= total) break;
    page++;
    if (page > 100) break;

    // Small delay between pages to avoid rate limits
    if (page % 10 === 0) await sleep(500);
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
    const endDate = new Date();

    console.log(`Account ID: ${RINGBA_ACCOUNT_ID}`);
    console.log(`Ringba URL: ${ringbaUrl}`);
    console.log(`Syncing ${daysBack} days, day by day`);

    let allCpmCalls: any[] = [];
    const allPubs = new Set<string>();

    for (let d = 0; d < daysBack; d++) {
      const day = addDays(endDate, -d);
      const dayStr = fmtDate(day);

      const dayCalls = await fetchDay(ringbaUrl, RINGBA_API_TOKEN, dayStr);

      // Track publishers
      for (const c of dayCalls) allPubs.add(c.publisherName || "unknown");

      // Filter CPM publisher
      const cpm = dayCalls.filter((c: any) =>
        (c.publisherName || "").toLowerCase() === "cpm"
      );

      if (cpm.length > 0) {
        console.log(`  → ${cpm.length} CPM calls on ${dayStr}`);
        allCpmCalls = allCpmCalls.concat(cpm);
      }

      // Delay between days
      if (d < daysBack - 1) await sleep(300);
    }

    console.log(`Total CPM calls: ${allCpmCalls.length}`);
    console.log(`All publishers: ${JSON.stringify([...allPubs])}`);

    if (allCpmCalls.length > 0) {
      console.log("Sample CPM:", JSON.stringify({
        campaign: allCpmCalls[0].campaignName,
        publisher: allCpmCalls[0].publisherName,
        revenue: allCpmCalls[0].revenue,
        profitNet: allCpmCalls[0].profitNet,
        bidAmount: allCpmCalls[0].bidAmount,
        target: allCpmCalls[0].targetName,
        duration: allCpmCalls[0].callLengthInSeconds,
      }));
    }

    const uniqueCampaigns = [...new Set(allCpmCalls.map((c: any) => c.campaignName || "unknown"))];

    // Upsert CPM calls
    let totalInserted = 0;
    for (const cId of clientIds) {
      const rows = allCpmCalls.map((call: any) => {
        const callId = call.inboundCallId || `${call.callDt}-${Math.random()}`;
        const revenue = Number(call.revenue || call.ringTreeWinningBid || call.profitNet || 0);
        const payout = Number(call.payout || call.totalCost || 0);
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
          converted: revenue > 0,
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
        cpm_calls: allCpmCalls.length,
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
