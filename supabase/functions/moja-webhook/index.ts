// Moja AI (call tracking) → Client Hub webhook receiver.
// Public endpoint (verify_jwt is false by default on Lovable-managed functions).
// Auth: shared secret via header `x-moja-secret`, Bearer token, or `?secret=` query param,
// matching MOJA_WEBHOOK_SECRET.
// Client routing: `?client_id=<uuid>` query param (required).
// Optional: `?service_line=windows|plumbing` to force a service line; otherwise inferred
// from the campaign name.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  const expected = Deno.env.get('MOJA_WEBHOOK_SECRET');
  if (!expected) return json({ error: 'Server not configured' }, 500);

  const url = new URL(req.url);
  const provided = req.headers.get('x-moja-secret')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || url.searchParams.get('secret')
    || url.searchParams.get('moja_auth_key');
  if (provided !== expected) return json({ error: 'Unauthorized' }, 401);

  let payload: any = {};
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
    return json({ error: 'Invalid body', details: String(e) }, 400);
  }

  const call = payload?.call ?? payload?.data ?? payload;
  const tags = call?.tags ?? payload?.tags ?? {};

  const client_id = url.searchParams.get('client_id');
  if (!client_id || !/^[0-9a-f-]{36}$/i.test(client_id)) {
    return json({ error: 'Missing or invalid client_id query parameter' }, 400);
  }

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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { error } = await supabase.from('moja_calls').upsert(row, { onConflict: 'client_id,call_id' });
  if (error) {
    console.error('moja_calls upsert failed', error);
    return json({ error: 'DB insert failed', details: error.message }, 500);
  }

  return json({ ok: true, call_id, client_id, service_line, platform });
});
