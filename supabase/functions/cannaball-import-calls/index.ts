import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const CANNABALL_CLIENT_ID = "a1dabea1-5518-4c7f-a29d-23739cb52f9b";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const csvUrl: string | undefined = body.csv_url;
    const csvText: string | undefined = body.csv_text;
    if (!csvUrl && !csvText) return json({ error: "csv_url or csv_text is required" }, 400);

    let text = csvText ?? "";
    if (!text && csvUrl) {
      const res = await fetch(csvUrl);
      if (!res.ok) return json({ error: `Could not download CSV (${res.status})` }, 400);
      text = await res.text();
    }

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

    const lines = text.trim().split(/\r?\n/);
    const headers = splitCsvLine(lines.shift() ?? "").map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const idx = (...names: string[]) => {
      for (const n of names) {
        const i = headers.indexOf(n.replace(/[^a-z0-9]/g, ""));
        if (i >= 0) return i;
      }
      return -1;
    };

    const iStart = idx("calldate", "callstart", "starttime", "datetime", "date");
    const iId = idx("callid", "id", "uuid");
    const iCaller = idx("callerid", "caller", "callernumber", "from", "ani");
    const iDid = idx("sourcenumber", "did", "trackingnumber", "to", "dnis");
    const iTalk = idx("durationfromconnect", "talktime", "connectionduration", "duration");
    const iConnected = idx("connected");
    const iStatus = idx("callstatus", "disposition", "status", "result");
    const iZip = idx("inboundzipcode", "zip", "zipcode", "postalcode");
    const iRevenue = idx("revenue", "payout", "amount");
    const iRecording = idx("recordingurl", "recording");
    const iVendor = idx("vendorname", "campaign", "campaignname");

    if (iStart < 0) return json({ error: "CSV needs a call date column" }, 400);

    let unmapped = 0;
    const seen = new Set<string>();
    const rows: any[] = [];

    lines.forEach((line, n) => {
      const c = splitCsvLine(line);
      const start = new Date(c[iStart]);
      if (isNaN(start.getTime())) return;
      const did = iDid >= 0 ? digits(c[iDid]) : "";
      const dateStr = start.toISOString().slice(0, 10);
      const match = did ? resolve(did, dateStr) : undefined;
      if (!match) unmapped++;
      const talk = iTalk >= 0 ? Number(c[iTalk]) || 0 : 0;
      const callId = (iId >= 0 && c[iId]) || `csv-${did || "na"}-${start.getTime()}-${n}`;
      if (seen.has(callId)) return;
      seen.add(callId);
      rows.push({
        client_id: CANNABALL_CLIENT_ID,
        call_id: callId,
        caller_number: iCaller >= 0 ? c[iCaller] || null : null,
        did: did || null,
        call_start: start.toISOString(),
        duration_seconds: talk,
        connection_duration_seconds: talk,
        connected: iConnected >= 0 ? c[iConnected] === "1" || c[iConnected].toLowerCase() === "true" : talk > 0,
        payout: iRevenue >= 0 ? Number(String(c[iRevenue]).replace(/[^0-9.-]/g, "")) || 0 : 0,
        disposition: iStatus >= 0 ? c[iStatus] || null : null,
        campaign_name: match?.campaign_name || (iVendor >= 0 ? c[iVendor] || null : null),
        creative_name: match?.creative_name ?? null,
        platform: match?.platform ?? null,
        recording_url: iRecording >= 0 ? c[iRecording] || null : null,
        raw_payload: iZip >= 0 && c[iZip] ? { zip: c[iZip] } : null,
      });
    });

    if (!rows.length) return json({ error: "No valid call rows found" }, 400);

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin
        .from("cannaball_calls")
        .upsert(rows.slice(i, i + 500), { onConflict: "client_id,call_id" });
      if (error) throw error;
    }

    return json({ success: true, imported: rows.length, unmapped_dids: unmapped });
  } catch (e) {
    console.error("cannaball-import-calls failed:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
