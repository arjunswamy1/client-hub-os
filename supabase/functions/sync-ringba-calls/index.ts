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

    if (!RINGBA_API_TOKEN) {
      throw new Error("RINGBA_API_TOKEN is not configured");
    }
    if (!RINGBA_ACCOUNT_ID) {
      throw new Error("RINGBA_ACCOUNT_ID is not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request body for optional client_id and date range
    let clientId: string | null = null;
    let daysBack = 30;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        clientId = body.client_id || null;
        daysBack = body.days_back || 30;
      } catch {
        // No body is fine for cron triggers
      }
    }

    // If no client_id, find Billy client(s) with ringba revenue source
    let clientIds: string[] = [];
    if (clientId) {
      clientIds = [clientId];
    } else {
      // Look for clients with dashboard config revenue_source = 'ringba'
      const { data: configs } = await supabase
        .from("dashboard_configs")
        .select("client_id")
        .eq("revenue_source", "ringba");

      if (configs && configs.length > 0) {
        clientIds = configs.map((c: any) => c.client_id);
      } else {
        // Fallback: look for clients with "billy" in the slug
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

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // Fetch call logs from Ringba API
    // Ringba supports GET with query params for call logs
    const ringbaUrl = `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs?startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}&pageSize=1000&page=1`;
    
    console.log(`Fetching Ringba calls from ${formatDate(startDate)} to ${formatDate(endDate)}`);
    console.log(`Ringba URL: ${ringbaUrl}`);
    console.log(`Token prefix: ${RINGBA_API_TOKEN.substring(0, 8)}...`);

    const response = await fetch(ringbaUrl, {
      method: "GET",
      headers: {
        Authorization: `Token ${RINGBA_API_TOKEN}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Ringba response headers:`, JSON.stringify(Object.fromEntries(response.headers.entries())));
      throw new Error(`Ringba API error [${response.status}]: ${errorText}`);
    }

    const ringbaData = await response.json();
    console.log("Ringba response keys:", JSON.stringify(Object.keys(ringbaData)));
    const calls = ringbaData.calls || ringbaData.callLogs || ringbaData.data || [];

    if (!Array.isArray(calls)) {
      console.log("Ringba full response:", JSON.stringify(ringbaData).substring(0, 500));
      throw new Error("Unexpected Ringba response format");
    }

    console.log(`Fetched ${calls.length} calls from Ringba`);

    let totalInserted = 0;

    for (const cId of clientIds) {
      // Map Ringba call data to our schema
      const rows = calls.map((call: any) => ({
        client_id: cId,
        call_id: call.callId || call.id || call.callDt + call.inboundPhoneNumber,
        call_date: call.callDt || call.startTime || call.date,
        campaign_name: call.campaignName || call.campaign || null,
        target_name: call.targetName || call.target || null,
        caller_number: call.callerNumber || call.caller || call.ani || null,
        duration_seconds: call.callLengthInSeconds || call.duration || 0,
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
        calls_synced: totalInserted,
        clients: clientIds.length,
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
