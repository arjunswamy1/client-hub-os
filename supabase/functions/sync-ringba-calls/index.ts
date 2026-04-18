import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { logIntegrationCall } from "../_shared/cost-tracking.ts";

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

function mapCallToRow(call: any, clientId: string) {
  const callId = call.inboundCallId || call.callId || `${call.callDt}-${Math.random()}`;
  // Revenue = conversionAmount only (set on converted calls). Do NOT use ringTreeWinningBid — that's the bid, not earned revenue.
  const isConverted = call.hasConnected && call.hasConverted;
  const revenue = isConverted ? Number(call.conversionAmount || call.revenue || 0) : 0;
  const payout = Number(call.payoutAmount || call.payout || call.totalCost || 0);
  const duration = call.callLengthInSeconds || call.connectedCallLengthInSeconds || 0;

  return {
    client_id: clientId,
    call_id: callId,
    call_date: parseRingbaDate(call.callDt),
    campaign_name: call.campaignName || null,
    target_name: call.targetName || null,
    caller_number: call.callerNumber || call.inboundPhoneNumber || null,
    duration_seconds: duration,
    connected: call.hasConnected ?? (duration > 0 && !call.wasBlocked),
    converted: (call.hasConnected && call.hasConverted) ?? false,
    revenue, payout,
    inbound_number: call.inboundPhoneNumber || null,
    metadata: {
      publisher: call.publisherName,
      publisherId: call.publisherId,
      buyer: call.buyer,
      campaignId: call.campaignId,
      bidAmount: call.bidAmount,
      profitNet: call.profitNet,
      totalCost: call.totalCost,
      telcoCost: call.telcoCost,
      winningBid: call.ringTreeWinningBid,
      conversionAmount: call.conversionAmount,
      endCallSource: call.endCallSource,
    },
  };
}

/** Exact campaign names we pull from Ringba — must be CPM publisher */
const ALLOWED_CAMPAIGNS: Record<string, string> = {
  "premium flights call flow": "flights",
  "pest control us call flow": "pest-control",
  "potty us call flow": "porta-potties",
};

function isAllowedCampaign(campaignName: string): boolean {
  if (!campaignName) return false;
  return campaignName.toLowerCase() in ALLOWED_CAMPAIGNS;
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
    let daysBack = 30;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        clientId = body.client_id || body.clientId || null;
        daysBack = body.days_back || body.daysBack || 30;
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

    let totalInserted = 0;
    let totalFetched = 0;
    let totalFiltered = 0;
    let apiCallCount = 0;
    const allCampaigns = new Set<string>();
    const allPublishers = new Set<string>();
    const startTime = Date.now();
    const MAX_MS = 50000; // 50s budget

    // Process in 2-day chunks to avoid Ringba pagination limits
    const chunkDays = 2;
    let chunkStart = new Date(startDate);

    while (chunkStart < endDate && Date.now() - startTime < MAX_MS) {
      const chunkEnd = new Date(chunkStart);
      chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
      if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

      let offset = 0;
      const pageSize = 1000;

      // Paginate within each chunk using size/offset
      while (Date.now() - startTime < MAX_MS) {
        apiCallCount++;
        const res = await fetch(ringbaUrl, {
          method: "POST",
          headers: {
            Authorization: `Token ${RINGBA_API_TOKEN}`,
            "Content-Type": "application/json;charset=UTF-8",
            Accept: "application/json, text/plain, */*",
          },
          body: JSON.stringify({
            reportStart: chunkStart.toISOString(),
            reportEnd: chunkEnd.toISOString(),
            size: pageSize,
            offset,
          }),
        });

        if (res.status === 429) {
          console.log(`Rate limited at offset ${offset}, waiting 12s`);
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
        const totalCount = data?.report?.totalCount || 0;

        totalFetched += records.length;

        // Track all campaigns/publishers for debugging
        for (const r of records) {
          allCampaigns.add(r.campaignName || "unknown");
          allPublishers.add(r.publisherName || "unknown");
        }

        // Filter: only CPM publisher AND allowed campaigns
        const filtered = records.filter((call: any) => {
          const pub = (call.publisherName || "").toLowerCase();
          if (pub !== "cpm") return false;
          return isAllowedCampaign(call.campaignName || "");
        });

        totalFiltered += filtered.length;

        // Upsert filtered records
        if (filtered.length > 0) {
          for (const cId of clientIds) {
            const rows = filtered.map((call: any) => mapCallToRow(call, cId));
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
              console.error(`Upsert err: ${error.message}`);
            } else {
              totalInserted += deduped.length;
            }
          }
        }

        // Check if we've fetched all records in this chunk
        if (records.length === 0 || offset + records.length >= totalCount) {
          break;
        }

        offset += pageSize;
        await sleep(300);
      }

      // Move to next chunk
      chunkStart = new Date(chunkEnd);
      await sleep(200);
    }

    console.log(`Done: fetched=${totalFetched}, filtered(CPM+vertical)=${totalFiltered}, inserted=${totalInserted}`);
    console.log(`Campaigns: ${JSON.stringify([...allCampaigns])}`);
    console.log(`Publishers: ${JSON.stringify([...allPublishers])}`);

    // Log integration usage — split evenly across synced clients
    if (apiCallCount > 0 && clientIds.length > 0) {
      const perClient = Math.max(1, Math.round(apiCallCount / clientIds.length));
      for (const cId of clientIds) {
        await logIntegrationCall({
          client_id: cId,
          service: "ringba_api",
          surface: "sync-ringba-calls",
          calls: perClient,
          metadata: { days_back: daysBack, calls_fetched: totalFetched },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      calls_fetched: totalFetched,
      calls_filtered: totalFiltered,
      calls_synced: totalInserted,
      campaigns_found: [...allCampaigns],
      publishers_found: [...allPublishers],
      days_back: daysBack,
      chunk_size_days: chunkDays,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("sync-ringba-calls error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
