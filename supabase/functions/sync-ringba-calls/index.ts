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

    // Parse request body
    let clientId: string | null = null;
    let daysBack = 30;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        clientId = body.client_id || body.clientId || null;
        daysBack = body.days_back || body.daysBack || 30;
      } catch { /* no body is fine */ }
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

    // Date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // Ringba CallLogs endpoint uses POST with date body
    const ringbaUrl = `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/CallLogs/Date`;

    console.log(`Fetching Ringba calls from ${formatDate(startDate)} to ${formatDate(endDate)}`);

    // Paginate through all results
    let allCalls: any[] = [];
    let page = 1;
    const pageSize = 500;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(ringbaUrl, {
        method: "POST",
        headers: {
          Authorization: `Token ${RINGBA_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: formatDate(startDate),
          endDate: formatDate(endDate),
          page,
          pageSize,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Ringba API error [${response.status}]:`, errorText.substring(0, 500));
        throw new Error(`Ringba API error [${response.status}]: ${errorText.substring(0, 200)}`);
      }

      const data = await response.json();
      
      if (page === 1) {
        console.log("Ringba response keys:", JSON.stringify(Object.keys(data)));
      }

      // Ringba returns calls in callLog.data or similar structures
      const calls = data?.callLog?.data || data?.calls || data?.callLogs || data?.data || [];

      if (!Array.isArray(calls)) {
        console.log("Unexpected response shape:", JSON.stringify(data).substring(0, 1000));
        throw new Error("Unexpected Ringba response format");
      }

      allCalls = allCalls.concat(calls);
      console.log(`Page ${page}: ${calls.length} calls (total: ${allCalls.length})`);

      // Check if there are more pages
      const totalCount = data?.callLog?.totalCount || data?.totalCount || 0;
      hasMore = calls.length === pageSize && allCalls.length < totalCount;
      page++;

      // Safety: max 20 pages
      if (page > 20) break;
    }

    console.log(`Total Ringba calls fetched: ${allCalls.length}`);

    // Filter to only Billy.com verticals
    const verticalPatterns = [
      "premium flights call flow",
      "pest control call flow",
      "porta potty",
    ];

    const filteredCalls = allCalls.filter((call: any) => {
      const campaignName = (call.campaignName || call.campaign || "").toLowerCase();
      const targetName = (call.targetName || call.target || "").toLowerCase();
      const searchText = `${campaignName} ${targetName}`;
      return verticalPatterns.some((p) => searchText.includes(p));
    });

    console.log(`Filtered to ${filteredCalls.length} calls matching Billy verticals`);

    let totalInserted = 0;

    for (const cId of clientIds) {
      const rows = filteredCalls.map((call: any) => ({
        client_id: cId,
        call_id: call.callId || call.id || `${call.callDt || call.startTime}-${call.inboundPhoneNumber || ""}`,
        call_date: call.callDt || call.startTime || call.date,
        campaign_name: call.campaignName || call.campaign || null,
        target_name: call.targetName || call.target || null,
        caller_number: call.callerNumber || call.caller || call.ani || null,
        duration_seconds: call.callLengthInSeconds || call.duration || call.connectedCallLength || 0,
        connected: call.connected ?? call.isConnected ?? false,
        converted: call.converted ?? call.isConverted ?? false,
        revenue: Number(call.revenue || call.payoutAmount || 0),
        payout: Number(call.payout || call.publisherPayout || 0),
        inbound_number: call.inboundPhoneNumber || call.inboundNumber || null,
        metadata: {
          targetId: call.targetId,
          publisherId: call.publisherId,
          publisherName: call.publisherName,
          callType: call.callType,
          hasRecording: call.hasRecording,
          state: call.state || call.region,
        },
      }));

      // Batch upsert
      const batchSize = 200;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error } = await supabase
          .from("ringba_calls")
          .upsert(batch, { onConflict: "client_id,call_id" });

        if (error) {
          console.error(`Upsert error for batch ${i / batchSize}:`, error.message);
        } else {
          totalInserted += batch.length;
        }
      }
    }

    console.log(`Synced ${totalInserted} Ringba calls for ${clientIds.length} client(s)`);

    return new Response(
      JSON.stringify({
        success: true,
        total_fetched: allCalls.length,
        filtered_to_verticals: filteredCalls.length,
        calls_synced: totalInserted,
        clients: clientIds.length,
        verticals: verticalPatterns,
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
