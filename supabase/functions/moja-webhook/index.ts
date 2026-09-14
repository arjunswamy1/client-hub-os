// Moja AI (call tracking) → Client Hub webhook receiver.
// Public endpoint (verify_jwt is false by default on Lovable-managed functions).
// Auth: shared secret via header `x-moja-secret`, Bearer token, or `?secret=` query param,
// matching MOJA_WEBHOOK_SECRET.
// Client routing: `?client_id=<uuid>` query param (required).
// Optional: `?service_line=windows|plumbing`, `?platform=meta|google` to force.
//
// EVERY receipt — valid or not — writes a row to media_brain_sync_status and emits one
// structured log line. An invalid-secret delivery must never vanish into a silent 401:
// "misconfigured" and "never sent" are different problems and used to look identical.
// The secret is never logged or stored. Payload VALUES are never logged — only the list of
// field NAMES, plus the list of fields that arrived as unreplaced macro literals. That
// second list is how we learn Moja's real substitution capability on delivery one.
//
// Payload shape and coercion live in ./normalize.ts, which is pure and unit-tested.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { fieldNames, mergeExisting, normalizeDelivery, unreplacedTagFields } from './normalize.ts';

/** Timing-safe string compare — no early exit on the first differing byte. */
function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  const a = new TextEncoder().encode(provided ?? '');
  const b = new TextEncoder().encode(expected);
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

type Validation =
  | 'ok'
  | 'server_not_configured'
  | 'invalid_secret'
  | 'missing_client_id'
  | 'invalid_body'
  | 'rejected_call_row'
  | 'db_error';

interface Receipt {
  validation: Validation;
  clientId: string | null;
  fields: string[];
  unreplaced: string[];
  deliveryId: string | null;
  rowsWritten: number;
  shape?: string;
  eventType?: string | null;
  error?: string;
}

/**
 * One row per (source, client_id). UNIQUE treats NULLs as distinct in Postgres, so the
 * unresolved-client case is updated by hand rather than upserted — otherwise every bad
 * delivery would pile up a new row.
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
      last_unreplaced_tags: r.unreplaced,
      last_payload_shape: r.shape ?? null,
      last_event_type: r.eventType ?? null,
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

  const finish = async (r: Receipt, body: unknown, status: number) => {
    console.log(
      JSON.stringify({
        event: 'moja_webhook_receipt',
        received_at: receivedAt,
        client_id: r.clientId,
        validation: r.validation,
        payload_shape: r.shape ?? null,
        event_type: r.eventType ?? null,
        payload_fields: r.fields,
        unreplaced_tags: r.unreplaced,
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

  const base = {
    clientId: resolvedClientId,
    fields: fieldNames(payload),
    unreplaced: unreplacedTagFields(payload),
    deliveryId: null as string | null,
    rowsWritten: 0,
  };

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

  const norm = normalizeDelivery(payload, {
    clientId: resolvedClientId,
    forcedServiceLine: url.searchParams.get('service_line'),
    forcedPlatform: url.searchParams.get('platform'),
  });

  const receipt: Receipt = {
    ...base,
    fields: norm.fields,
    unreplaced: norm.unreplaced,
    deliveryId: norm.deliveryId,
    shape: norm.shape,
    eventType: norm.eventType,
    validation: 'ok',
  };

  if (norm.reject || !norm.row) {
    // A call with no id cannot be deduplicated, so it is refused BY NAME rather than
    // inserted as an unmergeable duplicate. The receipt still records everything.
    return finish(
      {
        ...receipt,
        validation: 'rejected_call_row',
        error: `Call row rejected: ${norm.reject}. Payload recorded; no row written.`,
      },
      {
        ok: false,
        accepted: false,
        reason: norm.reject,
        detail: 'call_id is required so deliveries can be deduplicated. Receipt was recorded.',
      },
      202,
    );
  }

  const row = norm.row;

  const { data: existing } = await supabase
    .from('moja_calls')
    .select('id, converted, revenue, payout, converted_at')
    .eq('client_id', row.client_id)
    .eq('call_id', row.call_id)
    .maybeSingle();

  const { error } = existing
    ? await supabase.from('moja_calls').update(mergeExisting(existing, row)).eq('id', existing.id)
    : await supabase.from('moja_calls').insert(row);

  if (error) {
    console.error('moja_calls write failed', error);
    return finish(
      { ...receipt, validation: 'db_error', error: `moja_calls write failed: ${error.message}` },
      { error: 'DB write failed', details: error.message },
      500,
    );
  }

  return finish(
    { ...receipt, rowsWritten: 1 },
    {
      ok: true,
      call_id: row.call_id,
      client_id: row.client_id,
      action: existing ? 'updated' : 'inserted',
      service_line: row.service_line,
      platform: row.platform,
      unreplaced_tag_count: norm.unreplaced.length,
    },
    200,
  );
});
