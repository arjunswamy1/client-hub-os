// RingFuel → Client Hub webhook receiver.
// Public endpoint (verify_jwt is false by default on Lovable-managed functions).
// Auth: shared secret via header `x-ringfuel-secret`, Bearer token, or `?secret=` query param,
// matching RINGFUEL_WEBHOOK_SECRET.
// Client routing: `?client_id=<uuid>` query param, else resolved from the DID via ringfuel_numbers.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

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

function toBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1 || v === '1' || v === 'yes';
}

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

function digits(v: unknown): string | null {
  if (!v) return null;
  const d = String(v).replace(/\D/g, '');
  return d ? d.slice(-10) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const expected = Deno.env.get('RINGFUEL_WEBHOOK_SECRET');
  if (!expected) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const provided = req.headers.get('x-ringfuel-secret')
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

  // RingFuel may nest the call object
  const call = payload?.call ?? payload?.data ?? payload;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const did = pick<string>(call, ['did', 'tracking_number', 'to', 'to_number', 'dnis', 'number']) ?? null;
  const campaign_id = pick<string>(call, ['campaign_id', 'campaignId']) ?? null;

  // Resolve client: explicit query param wins, else DID lookup, else campaign lookup.
  let client_id = url.searchParams.get('client_id');
  if (!client_id) {
    const last10 = digits(did);
    if (last10) {
      const { data } = await supabase
        .from('ringfuel_numbers')
        .select('client_id, phone_number, creative_label')
        .ilike('phone_number', `%${last10}`)
        .limit(1);
      if (data?.[0]) client_id = data[0].client_id;
    }
  }
  if (!client_id && campaign_id) {
    const { data } = await supabase
      .from('ringfuel_numbers')
      .select('client_id')
      .eq('ringfuel_campaign_id', campaign_id)
      .limit(1);
    if (data?.[0]) client_id = data[0].client_id;
  }

  if (!client_id) {
    console.error('ringfuel-webhook: could not resolve client', { did, campaign_id });
    return new Response(JSON.stringify({ error: 'Unable to resolve client for this call', did, campaign_id }), {
      status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const call_id = String(
    pick(call, ['call_id', 'callId', 'id', 'uuid', 'call_uuid', 'inbound_call_id']) ?? crypto.randomUUID()
  );

  const connection_duration_seconds = toInt(
    pick(call, ['connection_duration', 'talk_time', 'talk_duration', 'billable_duration', 'connected_duration'])
  );
  const duration_seconds = toInt(pick(call, ['duration', 'call_duration', 'duration_seconds', 'total_duration']));

  const row = {
    client_id,
    call_id,
    event_type: pick<string>(payload, ['event', 'event_type', 'type']) ?? null,
    campaign_id,
    campaign_name: pick<string>(call, ['campaign_name', 'campaign', 'campaignName']) ?? null,
    did,
    caller_number: pick<string>(call, ['caller', 'caller_number', 'from', 'from_number', 'ani']) ?? null,
    caller_state: pick<string>(call, ['caller_state', 'state', 'from_state']) ?? null,
    caller_city: pick<string>(call, ['caller_city', 'city', 'from_city']) ?? null,
    creative_label: pick<string>(call, ['creative', 'creative_label', 'creative_name', 'sub_id', 'subid', 'tag']) ?? null,
    call_start: toIso(pick(call, ['call_start', 'start_time', 'started_at', 'timestamp', 'created_at'])),
    duration_seconds,
    connection_duration_seconds,
    connected: toBool(pick(call, ['connected', 'answered', 'is_connected'])) || connection_duration_seconds > 0,
    converted: toBool(pick(call, ['converted', 'conversion', 'is_converted'])),
    payout: toNumber(pick(call, ['payout', 'payout_amount', 'cost'])),
    revenue: toNumber(pick(call, ['revenue', 'amount', 'price', 'bid_amount'])),
    disposition: pick<string>(call, ['disposition', 'status', 'result', 'end_reason']) ?? null,
    recording_url: pick<string>(call, ['recording_url', 'recording', 'audio_url']) ?? null,
    buyer_name: pick<string>(call, ['buyer', 'buyer_name']) ?? null,
    target_name: pick<string>(call, ['target', 'target_name']) ?? null,
    raw_payload: payload,
  };

  const { error } = await supabase
    .from('ringfuel_calls')
    .upsert(row, { onConflict: 'client_id,call_id' });

  if (error) {
    console.error('ringfuel_calls upsert failed', error);
    return new Response(JSON.stringify({ error: 'DB insert failed', details: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, call_id, client_id }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
