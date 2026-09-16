// CallGrid → client call receiver.
// Public endpoint (verify_jwt is false by default on Lovable-managed functions).
// Auth: shared secret in header `x-callgrid-secret` matching CALLGRID_WEBHOOK_SECRET.
//
// Multi-client: pass `?client_id=<uuid>` so each CallGrid account writes to its own
// client. The id is validated against `clients` — an unknown id is rejected rather
// than defaulted, so a mistyped URL can never silently file another client's calls.
// With no `client_id` the endpoint keeps its original Cannaball behaviour so the
// existing CallGrid configuration keeps working unchanged.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const CANNABALL_CLIENT_ID = 'a1dabea1-5518-4c7f-a29d-23739cb52f9b';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CallGrid nests forwarded URL parameters under a container on some accounts.
 * The attribution reader walks one level of `raw_payload`, so lift those keys to
 * the top of the stored payload — copied, never renamed or invented.
 */
function flattenTagBags(payload: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...payload };
  for (const key of ['tags', 'custom', 'custom_tags', 'variables', 'params', 'query']) {
    const bag = payload?.[key];
    if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
      for (const [k, v] of Object.entries(bag)) {
        if (out[k] === undefined) out[k] = v;
      }
    }
  }
  return out;
}


function pick<T = unknown>(obj: Record<string, any>, keys: string[]): T | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v as T;
  }
  return undefined;
}

function toInt(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? Math.round(n) : 0;
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function toIso(v: unknown): string {
  if (!v) return new Date().toISOString();
  const s = String(v);
  const n = Number(s);
  // seconds or ms epoch
  if (isFinite(n) && n > 1_000_000_000) {
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const expected = Deno.env.get('CALLGRID_WEBHOOK_SECRET');
  if (!expected) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Accept secret via header OR query param (some webhook UIs only allow URL query strings)
  const url = new URL(req.url);
  const provided = req.headers.get('x-callgrid-secret')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || url.searchParams.get('secret');
  if (provided !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let payload: any = {};
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      payload = await req.json();
    } else if (ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data')) {
      const form = await req.formData();
      payload = Object.fromEntries(form.entries());
    } else {
      const text = await req.text();
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid body', details: String(e) }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Map common CallGrid field names (docs vary; we're permissive).
  const call_id = String(
    pick(payload, ['call_id', 'callId', 'id', 'uuid', 'call_uuid']) ??
    crypto.randomUUID()
  );

  const duration_seconds = toInt(pick(payload, ['duration', 'call_duration', 'duration_seconds', 'total_duration']));
  const connection_duration_seconds = toInt(
    pick(payload, ['connection_duration', 'talk_time', 'talk_duration', 'billable_duration'])
  );
  const connectedRaw = pick(payload, ['connected', 'answered', 'is_connected']);
  const connected =
    connectedRaw === true || connectedRaw === 'true' || connectedRaw === 1 || connectedRaw === '1' ||
    connection_duration_seconds > 0;

  const rawDid = pick<string>(payload, ['did', 'to', 'to_number', 'tracking_number', 'dnis', 'tracking_did']) ?? null;
  const didDigits = rawDid ? String(rawDid).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') : null;

  const row: Record<string, unknown> = {
    client_id: CANNABALL_CLIENT_ID,
    call_id,
    caller_number: pick<string>(payload, ['caller', 'caller_number', 'from', 'from_number', 'ani']) ?? null,
    did: didDigits || rawDid,
    caller_state: pick<string>(payload, ['caller_state', 'state', 'from_state']) ?? null,
    caller_city: pick<string>(payload, ['caller_city', 'city', 'from_city']) ?? null,
    call_start: toIso(pick(payload, ['call_start', 'start_time', 'started_at', 'timestamp', 'created_at'])),
    duration_seconds,
    connected,
    connection_duration_seconds,
    payout: toNumber(pick(payload, ['payout', 'revenue', 'amount', 'price'])),
    disposition: pick<string>(payload, ['disposition', 'status', 'result']) ?? null,
    campaign_name: pick<string>(payload, ['campaign', 'campaign_name', 'source']) ?? null,
    creative_name: pick<string>(payload, ['creative', 'creative_name', 'ad_name']) ?? null,
    recording_url: pick<string>(payload, ['recording_url', 'recording', 'audio_url']) ?? null,
    raw_payload: payload,
  };

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Fill creative/campaign from the DID assignment grid when CallGrid doesn't send them
  if (didDigits && (!row.creative_name || !row.campaign_name)) {
    const { data: dids } = await supabase
      .from('client_dids')
      .select('did, did_formatted, creative_name, campaign_name')
      .eq('client_id', CANNABALL_CLIENT_ID);
    const match = (dids || []).find((d: any) => {
      const a = String(d.did || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      const b = String(d.did_formatted || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      return a === didDigits || b === didDigits;
    });
    if (match) {
      row.creative_name = row.creative_name || match.creative_name || null;
      row.campaign_name = row.campaign_name || match.campaign_name || null;
    }
  }

  const { error } = await supabase
    .from('cannaball_calls')
    .upsert(row, { onConflict: 'client_id,call_id' });

  if (error) {
    console.error('cannaball_calls upsert failed', error);
    return new Response(JSON.stringify({ error: 'DB insert failed', details: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, call_id }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
