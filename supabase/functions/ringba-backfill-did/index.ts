/**
 * Ringba DID backfill — the ONE authorised write to a raw call table.
 *
 * STRICTLY BOUNDED, and the bounds are the point:
 *   - Writes ONLY the five columns added by the additive migration:
 *     did, did_pool_name, is_from_number_pool, has_payout, no_payout_reason.
 *   - ONLY `update(...).eq('call_id', ...).eq('client_id', ...)`.
 *   - NEVER insert, NEVER delete, NEVER touch a pre-existing column.
 *   - Idempotent and re-runnable: re-running writes the same values.
 *
 * Parameterised by client and date window — not hardcoded to any client or to
 * 30 days — because the same gap affects every Ringba client on this platform.
 *
 * Matching is `inboundCallId` → `ringba_calls.call_id`, the same key the sync
 * upserts on.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** The only columns this function is permitted to write. */
const WRITABLE_COLUMNS = [
  "did",
  "did_pool_name",
  "is_from_number_pool",
  "has_payout",
  "no_payout_reason",
] as const;

const BUYOLOGY_CLIENT_ID = "b3d600f5-5d6b-4378-aa96-b395c05e9297";

/** Which Ringba credentials belong to which client. */
function credentialsFor(clientId: string): { token?: string; account?: string; label: string } {
  if (clientId === BUYOLOGY_CLIENT_ID) {
    return {
      token: Deno.env.get("RINGBA_API_TOKEN_BUYOLOGY"),
      account: Deno.env.get("RINGBA_ACCOUNT_ID_BUYOLOGY"),
      label: "RINGBA_*_BUYOLOGY",
    };
  }
  return {
    token: Deno.env.get("RINGBA_API_TOKEN"),
    account: Deno.env.get("RINGBA_ACCOUNT_ID"),
    label: "RINGBA_API_TOKEN / RINGBA_ACCOUNT_ID",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const VALUE_COLUMNS = [
  "inboundCallId",
  "callDt",
  "campaignName",
  "number",
  "numberId",
  "numberPoolName",
  "numberPoolId",
  "isFromNumberPool",
  "hasPayout",
  "noPayoutReason",
  "payoutAmount",
  "callLengthInSeconds",
  "tag:DialedNumber:Number",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const clientId: string | null = body.client_id ?? body.clientId ?? null;
    if (!clientId) {
      return new Response(JSON.stringify({ error: "client_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const daysBack = Math.min(Math.max(Number(body.days_back ?? 30) || 30, 1), 365);
    const end = body.end ? new Date(body.end) : new Date();
    const start = body.start
      ? new Date(body.start)
      : new Date(end.getTime() - daysBack * 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      return new Response(JSON.stringify({ error: "Invalid window: start must precede end" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const dryRun = body.dry_run === true;

    const { token, account, label } = credentialsFor(clientId);
    if (!token || !account) {
      return new Response(JSON.stringify({ error: `Ringba credentials missing (${label})` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    /* ---- how many rows exist in the window at all (read-only) ---- */
    const { count: rowsInWindow } = await supabase
      .from("ringba_calls")
      .select("call_id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gte("call_date", start.toISOString())
      .lte("call_date", end.toISOString());

    /* ---- re-pull the window from Ringba ---- */
    // Resolve columns first: Ringba 422s the whole request on one unknown column.
    let requestColumns = [...VALUE_COLUMNS];
    const auth = { Authorization: `Token ${token}`, Accept: "application/json" };
    try {
      const colRes = await fetch(`https://api.ringba.com/v2/${account}/calllogs/columns`, { headers: auth });
      if (colRes.ok) {
        const colJson = await colRes.json();
        const raw = colJson?.columns ?? colJson?.report?.columns ?? colJson;
        const ids = new Set<string>();
        if (Array.isArray(raw)) {
          for (const c of raw) {
            const id = typeof c === "string" ? c : (c?.id || c?.name);
            if (id) ids.add(String(id));
          }
        }
        if (ids.size) requestColumns = requestColumns.filter((c) => c.startsWith("tag:") || ids.has(c));
      }
    } catch { /* fall through with the full list */ }

    const records: Record<string, unknown>[] = [];
    let apiCalls = 0;
    let httpErrors = 0;
    const startedAt = Date.now();
    const MAX_MS = 110_000;

    // Newest-first weekly chunks, matching the sync's pagination shape.
    const chunks: Array<{ s: Date; e: Date }> = [];
    let cursor = new Date(end);
    while (cursor > start) {
      const cs = new Date(cursor.getTime() - 7 * 86_400_000);
      chunks.push({ s: cs < start ? new Date(start) : cs, e: new Date(cursor) });
      cursor = cs;
    }

    for (const chunk of chunks) {
      if (Date.now() - startedAt > MAX_MS) break;
      let offset = 0;
      while (Date.now() - startedAt < MAX_MS) {
        apiCalls++;
        const res = await fetch(`https://api.ringba.com/v2/${account}/calllogs`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json;charset=UTF-8" },
          body: JSON.stringify({
            reportStart: chunk.s.toISOString(),
            reportEnd: chunk.e.toISOString(),
            size: 1000,
            offset,
            valueColumns: requestColumns.map((c) => ({ column: c })),
          }),
        });
        if (res.status === 429) { await sleep(12_000); continue; }
        if (!res.ok) {
          httpErrors++;
          console.error(`Ringba [${res.status}]: ${(await res.text()).substring(0, 300)}`);
          break;
        }
        const data = await res.json();
        const page: Record<string, unknown>[] = data?.report?.records ?? [];
        records.push(...page);
        const total = Number(data?.report?.totalCount ?? 0);
        if (!page.length || offset + page.length >= total) break;
        offset += 1000;
        await sleep(250);
      }
      await sleep(150);
    }

    /* ---- build the bounded patches ---- */
    const dialed = (c: Record<string, any>): string | null => {
      const v = c["tag:DialedNumber:Number"] ?? c["tag:DialedNumber:NumberE164"] ?? c.number ?? null;
      const s = v === null || v === undefined ? "" : String(v).trim();
      return s === "" ? null : s;
    };

    let matched = 0;
    let populatedDid = 0;
    let noDialedNumber = 0;
    let updateErrors = 0;
    const distinctDids = new Set<string>();
    const noPayoutReasonSamples: Record<string, number> = {};

    for (const rec of records as Record<string, any>[]) {
      const callId = rec.inboundCallId ?? rec.callId;
      if (!callId) continue;

      const did = dialed(rec);
      if (did) distinctDids.add(did);
      else noDialedNumber++;

      const reason = rec.noPayoutReason ? String(rec.noPayoutReason) : null;
      if (reason) noPayoutReasonSamples[reason] = (noPayoutReasonSamples[reason] ?? 0) + 1;

      // ONLY the five new columns. No pre-existing column appears in this object.
      const patch: Record<string, unknown> = {
        did,
        did_pool_name: rec.numberPoolName ? String(rec.numberPoolName) : null,
        is_from_number_pool:
          rec.isFromNumberPool === undefined || rec.isFromNumberPool === null ? null : !!rec.isFromNumberPool,
        has_payout: rec.hasPayout === undefined || rec.hasPayout === null ? null : !!rec.hasPayout,
        no_payout_reason: reason,
      };
      for (const k of Object.keys(patch)) {
        if (!(WRITABLE_COLUMNS as readonly string[]).includes(k)) {
          throw new Error(`Refusing to write disallowed column ${k}`);
        }
      }

      if (dryRun) { matched++; if (did) populatedDid++; continue; }

      const { data, error } = await supabase
        .from("ringba_calls")
        .update(patch)
        .eq("call_id", String(callId))
        .eq("client_id", clientId)
        .select("call_id");

      if (error) { updateErrors++; console.error(`Update ${callId}: ${error.message}`); continue; }
      if (data && data.length) {
        matched += data.length;
        if (did) populatedDid += data.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      client_id: clientId,
      window: { start: start.toISOString(), end: end.toISOString() },
      rows_in_window: rowsInWindow ?? null,
      ringba_records_pulled: records.length,
      rows_matched_by_call_id: matched,
      rows_populated_with_did: populatedDid,
      ringba_records_with_no_dialed_number: noDialedNumber,
      distinct_did_values: distinctDids.size,
      distinct_did_sample: [...distinctDids].slice(0, 25),
      no_payout_reason_counts: noPayoutReasonSamples,
      api_calls: apiCalls,
      http_errors: httpErrors,
      update_errors: updateErrors,
      wrote_columns: WRITABLE_COLUMNS,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
