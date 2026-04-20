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

/** Exact campaign names we pull from Ringba — must be CPM publisher.
 * Add new campaigns here as Billy launches new verticals on CPM. */
const ALLOWED_CAMPAIGNS: Record<string, string> = {
  "premium flights call flow": "flights",
  "pest control us call flow": "pest-control",
  "potty us call flow": "porta-potties",
};

function isAllowedCampaign(campaignName: string): boolean {
  if (!campaignName) return false;
  return campaignName.toLowerCase() in ALLOWED_CAMPAIGNS;
}

/** Build day chunks NEWEST first so today's data always lands even if we time out. */
function buildChunksNewestFirst(startDate: Date, endDate: Date, chunkDays: number): Array<{ start: Date; end: Date }> {
  const chunks: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(endDate);
  while (cursor > startDate) {
    const chunkStart = new Date(cursor);
    chunkStart.setDate(chunkStart.getDate() - chunkDays);
    if (chunkStart < startDate) chunkStart.setTime(startDate.getTime());
    chunks.push({ start: new Date(chunkStart), end: new Date(cursor) });
    cursor = new Date(chunkStart);
  }
  return chunks;
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
    let daysBack = 7; // default to last 7 days for hourly cron — fast & always covers today
    let allowedPublishers: string[] = ["cpm"]; // default filter: only CPM publisher

    if (req.method === "POST") {
      try {
        const body = await req.json();
        clientId = body.client_id || body.clientId || null;
        daysBack = body.days_back || body.daysBack || 7;
        if (Array.isArray(body.publishers) && body.publishers.length > 0) {
          allowedPublishers = body.publishers.map((p: string) => p.toLowerCase());
        }
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
    let httpErrorCount = 0;
    const allCampaigns = new Set<string>();
    const allPublishers = new Set<string>();
    const filteredPublishers = new Set<string>();
    const filteredCampaigns = new Set<string>();
    const startTime = Date.now();
    const MAX_MS = 110000; // 110s budget — Edge Functions hard cap is 150s

    // Process newest first so today's data ALWAYS lands even if we time out
    const chunkDays = 7;
    const chunks = buildChunksNewestFirst(startDate, endDate, chunkDays);

    for (const chunk of chunks) {
      if (Date.now() - startTime > MAX_MS) {
        console.warn(`Time budget exceeded — skipping remaining ${chunks.length - chunks.indexOf(chunk)} chunks`);
        break;
      }

      let offset = 0;
      const pageSize = 1000;

      // Paginate within chunk
      while (Date.now() - startTime < MAX_MS) {
        apiCallCount++;
        let res: Response;
        try {
          res = await fetch(ringbaUrl, {
            method: "POST",
            headers: {
              Authorization: `Token ${RINGBA_API_TOKEN}`,
              "Content-Type": "application/json;charset=UTF-8",
              Accept: "application/json, text/plain, */*",
            },
            body: JSON.stringify({
              reportStart: chunk.start.toISOString(),
              reportEnd: chunk.end.toISOString(),
              size: pageSize,
              offset,
            }),
          });
        } catch (fetchErr) {
          httpErrorCount++;
          console.error(`Network err: ${fetchErr instanceof Error ? fetchErr.message : fetchErr}`);
          await sleep(2000);
          if (httpErrorCount >= 3) break;
          continue;
        }

        if (res.status === 429) {
          console.log(`Rate limited at offset ${offset}, waiting 12s`);
          await sleep(12000);
          if (Date.now() - startTime > MAX_MS) break;
          continue;
        }

        if (!res.ok) {
          httpErrorCount++;
          const t = await res.text();
          console.error(`Ringba [${res.status}]: ${t.substring(0, 300)}`);
          if (res.status >= 500 && httpErrorCount < 3) {
            await sleep(3000);
            continue;
          }
          break; // give up on this chunk, move on
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

        // Filter: publisher in allowed list AND campaign in allowed list
        const filtered = records.filter((call: any) => {
          const pub = (call.publisherName || "").toLowerCase().trim();
          if (!allowedPublishers.includes(pub)) return false;
          if (!isAllowedCampaign(call.campaignName || "")) return false;
          return true;
        });

        for (const r of filtered) {
          filteredPublishers.add(r.publisherName || "unknown");
          filteredCampaigns.add(r.campaignName || "unknown");
        }

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

        // Check pagination
        if (records.length === 0 || offset + records.length >= totalCount) break;
        offset += pageSize;
        await sleep(250);
      }

      await sleep(150);
    }

    const elapsedMs = Date.now() - startTime;
    console.log(
      `Ringba sync done: fetched=${totalFetched}, filtered=${totalFiltered}, inserted=${totalInserted}, ` +
      `chunks=${chunks.length}, apiCalls=${apiCallCount}, errors=${httpErrorCount}, elapsed=${elapsedMs}ms`
    );
    console.log(`Filtered publishers: ${JSON.stringify([...filteredPublishers])}`);
    console.log(`Filtered campaigns: ${JSON.stringify([...filteredCampaigns])}`);

    // Health alert: if we fetched a lot but got zero matches, log loudly so it's visible in monitoring
    if (totalFetched > 100 && totalFiltered === 0) {
      console.error(
        `⚠️  RINGBA SYNC HEALTH ALERT: fetched ${totalFetched} calls but 0 matched filter ` +
        `(publishers=${JSON.stringify(allowedPublishers)}, allowedCampaigns=${JSON.stringify(Object.keys(ALLOWED_CAMPAIGNS))}). ` +
        `Available publishers in response: ${JSON.stringify([...allPublishers].slice(0, 30))}. ` +
        `Available campaigns: ${JSON.stringify([...allCampaigns].slice(0, 30))}.`
      );
    }

    // Log integration usage — split evenly across synced clients
    if (apiCallCount > 0 && clientIds.length > 0) {
      const perClient = Math.max(1, Math.round(apiCallCount / clientIds.length));
      for (const cId of clientIds) {
        await logIntegrationCall({
          client_id: cId,
          service: "ringba_api",
          surface: "sync-ringba-calls",
          calls: perClient,
          metadata: { days_back: daysBack, calls_fetched: totalFetched, calls_synced: totalInserted },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      calls_fetched: totalFetched,
      calls_filtered: totalFiltered,
      calls_synced: totalInserted,
      campaigns_in_response: [...allCampaigns],
      publishers_in_response: [...allPublishers],
      filtered_campaigns: [...filteredCampaigns],
      filtered_publishers: [...filteredPublishers],
      api_calls: apiCallCount,
      http_errors: httpErrorCount,
      days_back: daysBack,
      chunk_size_days: chunkDays,
      elapsed_ms: elapsedMs,
      health_warning: totalFetched > 100 && totalFiltered === 0
        ? "Fetched many calls but matched zero — check filter or Ringba publisher names"
        : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("sync-ringba-calls error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
