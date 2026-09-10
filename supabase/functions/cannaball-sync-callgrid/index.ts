import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const CANNABALL_CLIENT_ID = "a1dabea1-5518-4c7f-a29d-23739cb52f9b";
const ENDPOINT = "https://api.callgrid.com/api/call";

const digits = (v: unknown) =>
  String(v ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

const pick = (o: Record<string, any>, keys: string[]) => {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  }
  return undefined;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const apiKey = Deno.env.get("CALLGRID_API_KEY_CANNABALL");
    if (!apiKey) return json({ error: "CALLGRID_API_KEY_CANNABALL is not configured" }, 400);

    const body = await req.json().catch(() => ({} as any));
    const days = Math.min(Math.max(Number(body.days) || 7, 1), 400);
    const endDate: string = body.end_date ?? new Date().toISOString().slice(0, 10);
    const startDate: string =
      body.start_date ??
      new Date(new Date(`${endDate}T00:00:00Z`).getTime() - (days - 1) * 86400000)
        .toISOString()
        .slice(0, 10);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: periods, error: perErr } = await admin
      .from("client_did_periods")
      .select("did, creative_name, platform, campaign_name, effective_from, effective_to")
      .eq("client_id", CANNABALL_CLIENT_ID);
    if (perErr) throw perErr;

    const resolve = (did: string, dateStr: string) =>
      (periods ?? []).find(
        (p) =>
          digits(p.did) === did &&
          dateStr >= p.effective_from &&
          (!p.effective_to || dateStr <= p.effective_to),
      );

    let searchAfter: unknown = null;
    let pages = 0;
    let fetched = 0;
    let unmapped = 0;
    const seen = new Set<string>();
    const rows: any[] = [];

    while (pages < 200) {
      pages++;
      const params = new URLSearchParams({
        startDate,
        endDate,
        maxItems: "100",
        useCursor: "true",
        reportTimeZone: "US/Eastern",
      });
      if (searchAfter !== null) params.set("searchAfter", JSON.stringify(searchAfter));

      const res = await fetch(`${ENDPOINT}?${params}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(60_000),
      });

      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 5000));
        pages--;
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        return json({ error: `CallGrid API error ${res.status}: ${t.slice(0, 400)}` }, 502);
      }

      const payload = await res.json();
      const items: any[] =
        payload.data ?? payload.items ?? payload.results ?? payload.calls ?? [];
      fetched += items.length;

      for (const c of items) {
        const startRaw = pick(c, [
          "UTCISODate", "UTCDate", "createdAt", "callStart", "callDate", "startTime",
        ]);
        const start = new Date(String(startRaw));
        if (isNaN(start.getTime())) continue;

        const did = digits(pick(c, ["SourceNumber", "sourceNumber", "did", "trackingNumber", "to", "dnis"]));
        const dateStr = start.toISOString().slice(0, 10);
        const match = did ? resolve(did, dateStr) : undefined;
        if (!match) unmapped++;

        const talk = Number(
          pick(c, ["CallDurationFromConnect", "durationFromConnect", "connectionDuration", "talkTime", "callDuration", "CallDuration"]) ?? 0,
        ) || 0;
        const callId = String(pick(c, ["CallId", "callId", "id", "uuid"]) ?? `${did}-${start.getTime()}`);
        if (seen.has(callId)) continue;
        seen.add(callId);

        const connectedRaw = pick(c, ["CallConnected", "connected", "isConnected"]);
        rows.push({
          client_id: CANNABALL_CLIENT_ID,
          call_id: callId,
          caller_number: pick(c, ["CallerId", "InboundNumber", "callerId", "caller", "callerNumber", "from", "ani"]) ?? null,
          did: did || null,
          call_start: start.toISOString(),
          duration_seconds: talk,
          connection_duration_seconds: talk,
          connected:
            connectedRaw === undefined
              ? talk > 0
              : connectedRaw === true || connectedRaw === 1 || String(connectedRaw) === "1" ||
                String(connectedRaw).toLowerCase() === "true",
          payout:
            Number(String(pick(c, ["CallRevenue", "revenue", "CallPayout", "payout", "amount"]) ?? 0).replace(/[^0-9.-]/g, "")) || 0,
          disposition: pick(c, ["CallStatus", "callStatus", "disposition", "status", "result"]) ?? null,
          campaign_name:
            match?.campaign_name ?? pick(c, ["CampaignName", "VendorName", "campaignName", "campaign"]) ?? null,
          creative_name: match?.creative_name ?? null,
          platform: match?.platform ?? null,
          recording_url: pick(c, ["callRecordingUrl", "recordingUrl", "recording"]) ?? null,
          raw_payload: c,
        });
      }

      if (!payload.hasMore || !payload.nextCursor) break;
      searchAfter = payload.nextCursor;
      await new Promise((r) => setTimeout(r, 400));
    }

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin
        .from("cannaball_calls")
        .upsert(rows.slice(i, i + 500), { onConflict: "client_id,call_id" });
      if (error) throw error;
    }

    return json({
      success: true,
      start_date: startDate,
      end_date: endDate,
      pages,
      fetched,
      synced: rows.length,
      unmapped_dids: unmapped,
    });
  } catch (e) {
    console.error("cannaball-sync-callgrid failed:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
