// Moja AI (call tracking) → Client Hub webhook receiver.
// Public endpoint (verify_jwt is false by default on Lovable-managed functions).
// Auth: shared secret via header `x-moja-secret`, Bearer token, or `?secret=` query param,
// matching MOJA_WEBHOOK_SECRET.
// Client routing: `?client_id=<uuid>` query param (required).
// Optional: `?service_line=windows|plumbing` to force a service line; otherwise inferred
// from the campaign name.
//
// EVERY receipt — valid or not — writes a row to media_brain_sync_status and emits one
// structured log line. An invalid-secret delivery must never vanish into a silent 401:
// "misconfigured" and "never sent" are different problems and used to look identical.
// The secret is never logged or stored. The payload body is never logged in plaintext —
// only the list of field NAMES it carried, which is what tells us Moja's real contract.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

/** Moja test fires leave unsubstituted macros like "[CALLER_STATE]" — treat those as empty. */
const isMacro = (v: unknown) => typeof v === 'string' && /^\[[A-Z0-9_]+\]$/.test(v.trim());

function pick<T = unknown>(obj: Record<string, any>, keys: string[]): T | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '' && !isMacro(v)) return v as T;
  }
  return undefined;
}


const toInt = (v: unknown) => (isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const toNumber = (v: unknown) => (isFinite(Number(v)) ? Number(v) : 0);
const toBool = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1' || v === 'yes';

function toIso(v: unknown): string {
  if (!v) return new Date().toISOString();
  const s = String(v);
  const n = Number(s);
  if (isFinite(n) && n > 1_000_000_000) {
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Timing-safe string compare — no early exit on the first differing byte. */
function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  const a = new TextEncoder().encode(provided ?? '');
  const b = new TextEncoder().encode(expected);
  // Compare a fixed number of bytes so length alone does not shortcut the loop.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * Field NAMES only, recursively, to a shallow depth. Never values — this is the
 * contract discovery mechanism, not a copy of the caller's data.
 */
function fieldNames(obj: unknown, prefix = '', depth = 0): string[] {
  if (depth > 2 || obj === null || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) return obj.length ? fieldNames(obj[0], `${prefix}[]`, depth + 1) : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push(path);
    if (v && typeof v === 'object') out.push(...fieldNames(v, path, depth + 1));
  }
  return out;
}

/** Infer the RRM service line + ad platform from free-text campaign / publisher labels. */
function classify(text: string): { service_line: string; platform: string | null } {
  const t = text.toLowerCase();
  let service_line = 'unassigned';
  if (/window|glass|door/.test(t)) service_line = 'windows';
  else if (/plumb|drain|sewer|water heater|leak/.test(t)) service_line = 'plumbing';

  let platform: string | null = null;
  if (/meta|facebook|fb|instagram|ig/.test(t)) platform = 'meta';
  else if (/google|gads|ppc|search|adwords/.test(t)) platform = 'google';
  else if (service_line === 'windows') platform = 'meta';
  else if (service_line === 'plumbing') platform = 'google';

  return { service_line, platform };
}

type Validation =
  | 'ok'
  | 'server_not_configured'
  | 'invalid_secret'
  | 'missing_client_id'
  | 'invalid_body'
  | 'db_error';

interface Receipt {
  validation: Validation;
  clientId: string | null;
  fields: string[];
  deliveryId: string | null;
  rowsWritten: number;
  error?: string;
}

/**
 * One row per (source, client_id). UNIQUE treats NULLs as distinct in Postgres, so the
 * unresolved-client case (a failed secret with no client) is updated by hand rather than
 * upserted — otherwise every bad delivery would pile up a new row.
 */
async function recordReceipt(supabase: any, r: Receipt) {
  const now = new Date().toISOString();
  const succeeded = r.validation === 'ok';
  const row = {
    source: 'moja',
    client_id: r.clientId,
    last_attempted_at: now,
    ...(succeeded ? { last_succeeded_at: now } : {}),
    rows_written: r.rowsWritten,
    status: succeeded ? 'ok' : 'error',
    error: succeeded ? null : r.error ?? r.validation,
    detail: {
      last_validation: r.validation,
      last_payload_fields: r.fields,
      last_delivery_id: r.deliveryId,
      last_receipt_at: now,
    },
  };

  if (r.clientId) {
    const { error } = await supabase
      .from('media_brain_sync_status')
      .upsert(row, { onConflict: 'source,client_id' });
    if (error) console.error(JSON.stringify({ event: 'moja_status_write_failed', error: error.message }));
    return;
  }

  const { data: existing } = await supabase
    .from('media_brain_sync_status')
    .select('id')
    .eq('source', 'moja')
    .is('client_id', null)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from('media_brain_sync_status').update(row).eq('id', existing.id)
    : await supabase.from('media_brain_sync_status').insert(row);
  if (error) console.error(JSON.stringify({ event: 'moja_status_write_failed', error: error.message }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const receivedAt = new Date().toISOString();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  /** Log + record, then answer. Identical shape in the log line and the table. */
  const finish = async (r: Receipt, body: unknown, status: number) => {
    console.log(
      JSON.stringify({
        event: 'moja_webhook_receipt',
        received_at: receivedAt,
        client_id: r.clientId,
        validation: r.validation,
        payload_fields: r.fields,
        delivery_id: r.deliveryId,
        rows_written: r.rowsWritten,
        error: r.error ?? null,
        // NOTE: no secret, no payload values — field names only, by design.
      }),
    );
    await recordReceipt(supabase, r);
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  };

  const url = new URL(req.url);
  const rawClientId = url.searchParams.get('client_id');
  const resolvedClientId = rawClientId && /^[0-9a-f-]{36}$/i.test(rawClientId) ? rawClientId : null;

  // Body is parsed BEFORE the secret check so a misconfigured delivery still reports
  // which fields Moja sends. Values are never logged or stored on a rejected receipt.
  let payload: any = {};
  let parseError: string | null = null;
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      payload = await req.json();
    } else if (ct.includes('form')) {
      payload = Object.fromEntries((await req.formData()).entries());
    } else {
      const text = await req.text();
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    }
  } catch (e) {
    parseError = String(e);
  }

  const fields = fieldNames(payload);
  const call = payload?.call ?? payload?.data ?? payload;
  const tags = call?.tags ?? payload?.tags ?? {};
  const deliveryId =
    pick<string>(payload, ['delivery_id', 'webhook_id', 'event_id', 'request_id']) ??
    pick<string>(call, ['call_id', 'callId', 'call_sid', 'id', 'uuid', 'inbound_call_id']) ??
    null;
  const base = { clientId: resolvedClientId, fields, deliveryId, rowsWritten: 0 };

  const expected = Deno.env.get('MOJA_WEBHOOK_SECRET');
  if (!expected) {
    return finish(
      { ...base, validation: 'server_not_configured', error: 'MOJA_WEBHOOK_SECRET is not set' },
      { error: 'Server not configured' },
      500,
    );
  }

  const provided = req.headers.get('x-moja-secret')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || url.searchParams.get('secret')
    || url.searchParams.get('moja_auth_key');
  if (!secretsMatch(provided, expected)) {
    // The case that used to vanish. It is now a row and a log line.
    return finish(
      {
        ...base,
        validation: 'invalid_secret',
        error: `Rejected: shared secret did not match (secret was ${provided ? 'present but wrong' : 'absent'}).`,
      },
      { error: 'Unauthorized' },
      401,
    );
  }

  if (parseError) {
    return finish(
      { ...base, validation: 'invalid_body', error: `Body could not be parsed: ${parseError}` },
      { error: 'Invalid body', details: parseError },
      400,
    );
  }

  if (!resolvedClientId) {
    return finish(
      { ...base, validation: 'missing_client_id', error: 'Missing or invalid client_id query parameter' },
      { error: 'Missing or invalid client_id query parameter' },
      400,
    );
  }
  const client_id = resolvedClientId;

  const call_id = String(
    pick(call, ['call_id', 'callId', 'call_sid', 'id', 'uuid', 'inbound_call_id']) ?? crypto.randomUUID()
  );

  const campaign_name = pick<string>(call, ['campaign_name', 'campaign', 'campaignName']) ?? null;
  const publisher_name = pick<string>(call, ['publisher_name', 'publisher']) ?? null;
  const utm_source = pick<string>(tags, ['source', 'utm_source']) ?? pick<string>(call, ['utm_source']) ?? null;
  const utm_campaign = pick<string>(tags, ['campaign', 'utm_campaign']) ?? pick<string>(call, ['utm_campaign']) ?? null;
  // Google: utm_term = keyword text, utm_content = ad id. Meta: utm_term = ad id, utm_content = ad/creative name.
  const utm_term =
    pick<string>(tags, ['term', 'utm_term', 'keyword']) ??
    pick<string>(call, ['utm_term', 'keyword']) ??
    null;
  const utm_content =
    pick<string>(tags, ['content', 'utm_content', 'creative']) ??
    pick<string>(call, ['utm_content', 'creative']) ??
    null;


  const inferred = classify([campaign_name, publisher_name, utm_campaign, utm_source].filter(Boolean).join(' '));
  const forcedLine = url.searchParams.get('service_line');
  const service_line = forcedLine || inferred.service_line;
  const platform = url.searchParams.get('platform') || inferred.platform;

  const duration_seconds = toInt(pick(call, ['duration', 'call_duration', 'outbound_duration', 'duration_seconds']));
  const revenue = toNumber(pick(call, ['revenue', 'revenue_paid_out', 'buyer_revenue', 'amount']));
  const payout = toNumber(pick(call, ['payout', 'publisher_paid_out', 'publisher_payout', 'target_payout', 'payout_numeric']));
  const converted = toBool(pick(call, ['converted', 'conversion', 'is_converted']));

  const row = {
    client_id,
    call_id,
    event_type: pick<string>(payload, ['event', 'event_type', 'type']) ?? null,
    service_line,
    platform,
    campaign_id: pick<string>(call, ['campaign_id', 'campaignId']) ?? null,
    campaign_name,
    publisher_name,
    target_name: pick<string>(call, ['target_name', 'target']) ?? null,
    buyer_name: pick<string>(call, ['buyer_name', 'buyer']) ?? null,
    tracking_number: pick<string>(call, ['to', 'tracking_number', 'did', 'dialed_number', 'publisher_number']) ?? null,
    caller_number: pick<string>(call, ['caller_id', 'caller', 'from', 'caller_number', 'ani']) ?? null,
    caller_state: pick<string>(call, ['caller_state', 'state', 'original_state']) ?? pick<string>(tags, ['state']) ?? null,
    caller_zip: pick<string>(call, ['caller_zip', 'zip_code', 'original_zip_code']) ?? pick<string>(tags, ['zip']) ?? null,
    call_start: toIso(pick(call, ['call_start', 'start_time', 'started_at', 'event_timestamp', 'timestamp', 'created_at'])),
    converted_at: converted
      ? toIso(pick(call, ['call_converted_at', 'converted_at', 'event_timestamp', 'timestamp']))
      : null,
    duration_seconds,
    inbound_duration_seconds: toInt(pick(call, ['inbound_duration', 'inbound_duration_seconds'])),
    connected: toBool(pick(call, ['connected', 'answered'])) || duration_seconds > 0,
    converted,
    revenue,
    payout,
    disposition: pick<string>(call, ['disposition', 'status', 'call_termination_by', 'result']) ?? null,
    recording_url: pick<string>(call, ['recording_url', 'recording', 'audio_url']) ?? null,
    utm_source,
    utm_campaign,
    utm_term,
    utm_content,
    raw_payload: payload,

  };

  const { error } = await supabase.from('moja_calls').upsert(row, { onConflict: 'client_id,call_id' });
  if (error) {
    console.error('moja_calls upsert failed', error);
    return finish(
      { ...base, validation: 'db_error', error: `moja_calls upsert failed: ${error.message}` },
      { error: 'DB insert failed', details: error.message },
      500,
    );
  }

  return finish(
    { ...base, validation: 'ok', rowsWritten: 1 },
    { ok: true, call_id, client_id, service_line, platform },
    200,
  );
});
