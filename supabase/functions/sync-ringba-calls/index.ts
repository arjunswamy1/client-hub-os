import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const ringbaUrl = `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`;
    console.log(`Fetching Ringba calls from ${formatDate(startDate)} to ${formatDate(endDate)}`);

    let allCalls: any[] = [];
    let page = 1;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
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
          pageSize,
          orderByColumns: [],
          filters: [],
          formatDateTime: true,
          formatPercentages: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ringba API error [${response.status}]: ${errorText.substring(0, 200)}`);
      }

      const data = await response.json();
      if (page === 1) {
        console.log("Response keys:", JSON.stringify(Object.keys(data)));
      }

      const calls = data?.report?.records || data?.report?.data || data?.callLog?.data || data?.calls || data?.data || [];
      if (!Array.isArray(calls)) {
        console.log("Full response:", JSON.stringify(data).substring(0, 2000));
        throw new Error("Unexpected Ringba response format");
      }

      allCalls = allCalls.concat(calls);
      console.log(`Page ${page}: ${calls.length} calls (total: ${allCalls.length})`);

      const totalCount = data?.report?.totalCount || data?.callLog?.totalCount || data?.totalCount || 0;
      hasMore = calls.length >= pageSize && allCalls.length < totalCount;
      page++;
      if (page > 50) break;
    }

    console.log(`Total Ringba calls fetched: ${allCalls.length}`);

    // Log unique campaign names for visibility
    const uniqueCampaigns = [...new Set(allCalls.map((c: any) => c.campaignName || "unknown"))];
    console.log("Campaign names found:", JSON.stringify(uniqueCampaigns));

    // Parse Ringba date format "MM/DD/YYYY HH:MM:SS AM/PM" to ISO
    function parseRingbaDate(dt: string): string {
      if (!dt) return new Date().toISOString();
      // Try ISO first
      if (dt.includes("T") || dt.match(/^\d{4}-/)) return dt;
      // Parse MM/DD/YYYY HH:MM:SS AM/PM
      try {
        const d = new Date(dt);
        if (!isNaN(d.getTime())) return d.toISOString();
      } catch { /* fall through */ }
      return new Date().toISOString();
    }

    let totalInserted = 0;

    for (const cId of clientIds) {
      // Sync ALL calls — frontend handles vertical filtering
      const rows = allCalls.map((call: any) => {
        // Ringba fields from actual API response
        const callId = call.inboundCallId || call.callId || call.id || `${call.callDt}-${call.inboundPhoneNumber || Math.random()}`;
        const revenue = Number(call.revenue || call.payoutAmount || call.profitNet || 0);
        const payout = Number(call.payout || call.publisherPayout || call.totalCost || 0);
        const duration = call.callLengthInSeconds || call.duration || call.timeToCallInSeconds || 0;
        // Derive connected/converted from available data since Ringba calllogs
        // don't always include explicit boolean flags
        const connected = call.connected ?? call.isConnected ?? (duration > 0 && !call.wasBlocked);
        const converted = call.converted ?? call.isConverted ?? (revenue > 0);

        return {
          client_id: cId,
          call_id: callId,
          call_date: parseRingbaDate(call.callDt || call.startTime || call.date),
          campaign_name: call.campaignName || null,
          target_name: call.targetName || call.previouseCallTargetName || null,
          caller_number: call.callerNumber || call.callerId || null,
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
            numberId: call.numberId,
            wasBlocked: call.wasBlocked,
            blockReason: call.blockReason,
            bidAmount: call.bidAmount,
            profitNet: call.profitNet,
            totalCost: call.totalCost,
            telcoCost: call.telcoCost,
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

    console.log(`Synced ${totalInserted} calls for ${clientIds.length} client(s)`);

    return new Response(
      JSON.stringify({
        success: true,
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
