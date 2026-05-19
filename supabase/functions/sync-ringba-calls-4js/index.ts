import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FOURJS_CLIENT_ID = "a9fce72e-87d5-4c45-9d94-03d78be7e42d";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseRingbaDate(dt: any): string {
  if (!dt) return new Date().toISOString();
  if (typeof dt === "number") return new Date(dt).toISOString();
  if (typeof dt === "string") {
    if (dt.includes("T") || dt.match(/^\d{4}-/)) return dt;
    try { const d = new Date(dt); if (!isNaN(d.getTime())) return d.toISOString(); } catch {}
  }
  return new Date().toISOString();
}

/** Normalize a phone (any format) to E.164 +1XXXXXXXXXX */
function toE164(raw: any): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  return `+1${ten}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const RINGBA_API_TOKEN = Deno.env.get("RINGBA_API_TOKEN_4JS");
    const RINGBA_ACCOUNT_ID = Deno.env.get("RINGBA_ACCOUNT_ID_4JS");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!RINGBA_API_TOKEN) throw new Error("RINGBA_API_TOKEN_4JS missing");
    if (!RINGBA_ACCOUNT_ID) throw new Error("RINGBA_ACCOUNT_ID_4JS missing");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let daysBack = 7;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        daysBack = body.days_back ?? body.daysBack ?? 7;
      } catch {}
    }

    // Load DID map -> { e164: {platform, creative, cluster} }
    const { data: didRows, error: didErr } = await supabase
      .from("client_dids")
      .select("did, platform, creative_name, audience_cluster")
      .eq("client_id", FOURJS_CLIENT_ID);
    if (didErr) throw didErr;
    const didMap = new Map<string, any>();
    for (const d of didRows || []) didMap.set(d.did, d);

    const ringbaUrl = `https://api.ringba.com/v2/${RINGBA_ACCOUNT_ID}/calllogs`;
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - daysBack);

    let totalFetched = 0, totalMatched = 0, totalInserted = 0;
    let offset = 0;
    const pageSize = 1000;
    const startTime = Date.now();
    const MAX_MS = 110_000;
    let httpErrors = 0;
    const seenDids = new Set<string>();
    const unmatchedDids = new Set<string>();

    while (Date.now() - startTime < MAX_MS) {
      const res = await fetch(ringbaUrl, {
        method: "POST",
        headers: {
          Authorization: `Token ${RINGBA_API_TOKEN}`,
          "Content-Type": "application/json;charset=UTF-8",
          Accept: "application/json",
        },
        body: JSON.stringify({
          reportStart: startDate.toISOString(),
          reportEnd: endDate.toISOString(),
          size: pageSize,
          offset,
        }),
      });

      if (res.status === 429) { await sleep(12_000); continue; }
      if (!res.ok) {
        httpErrors++;
        const t = await res.text();
        console.error(`Ringba [${res.status}]: ${t.substring(0, 300)}`);
        if (httpErrors >= 3) break;
        await sleep(2_000);
        continue;
      }

      const data = await res.json();
      const records = data?.report?.records || [];
      const totalCount = data?.report?.totalCount || 0;
      totalFetched += records.length;

      // Filter to calls whose inbound DID is in our registry
      const rows: any[] = [];
      for (const c of records) {
        const e164 = toE164(c.inboundPhoneNumber || c.callerNumber);
        // Ringba "inboundPhoneNumber" is the DID dialed (our number); callerNumber is the caller.
        // Some Ringba responses use different fields — prefer inboundPhoneNumber.
        const didKey = e164;
        if (didKey) seenDids.add(didKey);
        if (!didKey || !didMap.has(didKey)) {
          if (didKey) unmatchedDids.add(didKey);
          continue;
        }
        const mapping = didMap.get(didKey);
        const callId = c.inboundCallId || c.callId || `${c.callDt}-${didKey}-${Math.random()}`;
        const isConverted = c.hasConnected && c.hasConverted;
        const payout = Number(c.payoutAmount || c.payout || (isConverted ? c.conversionAmount : 0) || 0);
        const duration = c.callLengthInSeconds || 0;
        const connDur = c.connectedCallLengthInSeconds || 0;

        rows.push({
          client_id: FOURJS_CLIENT_ID,
          ringba_call_id: callId,
          did: didKey,
          caller_number: toE164(c.callerNumber) || c.callerNumber || null,
          caller_state: c.callerStateProvince || c.callerState || null,
          caller_city: c.callerCity || null,
          call_start: parseRingbaDate(c.callDt),
          call_duration_seconds: duration,
          connected: !!c.hasConnected,
          connection_duration_seconds: connDur,
          payout,
          buyer_name: c.buyer || c.targetName || null,
          campaign_name: c.campaignName || null,
          publisher_name: c.publisherName || null,
          target_name: c.targetName || null,
          disposition: c.endCallSource || null,
          tags: {
            publisherId: c.publisherId,
            campaignId: c.campaignId,
            converted: c.hasConverted,
            conversionAmount: c.conversionAmount,
            profitNet: c.profitNet,
          },
          platform: mapping.platform,
          creative_name: mapping.creative_name,
          audience_cluster: mapping.audience_cluster,
        });
      }

      totalMatched += rows.length;

      if (rows.length > 0) {
        // dedupe by ringba_call_id within batch
        const seen = new Set<string>();
        const deduped = rows.filter((r) => !seen.has(r.ringba_call_id) && seen.add(r.ringba_call_id));
        const { error } = await supabase
          .from("ringba_calls_4js")
          .upsert(deduped, { onConflict: "client_id,ringba_call_id" });
        if (error) {
          console.error("upsert err:", error.message);
        } else {
          totalInserted += deduped.length;
        }
      }

      if (records.length === 0 || offset + records.length >= totalCount) break;
      offset += pageSize;
      await sleep(250);
    }

    const result = {
      success: true,
      calls_fetched: totalFetched,
      calls_matched_to_dids: totalMatched,
      calls_upserted: totalInserted,
      registered_dids: didMap.size,
      seen_dids_in_response: [...seenDids].slice(0, 50),
      unmatched_dids: [...unmatchedDids].slice(0, 50),
      days_back: daysBack,
      elapsed_ms: Date.now() - startTime,
    };
    console.log("4Js Ringba sync:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("sync-ringba-calls-4js error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
