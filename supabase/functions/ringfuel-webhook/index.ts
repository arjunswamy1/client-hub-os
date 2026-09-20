// RingFuel → Client Hub webhook receiver.
// Public endpoint (verify_jwt is false by default on Lovable-managed functions).
// Auth: shared secret via header `x-ringfuel-secret`, Bearer token, or `?secret=` query param,
// matching RINGFUEL_WEBHOOK_SECRET.
// Client routing: `?client_id=<uuid>` query param, else resolved from the DID via ringfuel_numbers.
//
// TWO PAYLOAD SHAPES, both accepted:
//   `webhook_minimal` — the current live template: { state, payout, call_id, duration }.
//   `csv_full`        — the full RingFuel field set (Revenue, Converted, Campaign,
//                       Dialed Number, Publisher, Duration (s), ...), in either the
//                       spaced/capitalised CSV names or their snake_case variants.
//
// ABSENT IS NOT ZERO. A field the payload does not carry is never written as 0 or
// false, and never overwrites a richer stored value. `revenue_captured`,
// `conversion_captured` and `payload_shape` record what we actually received so
// that no aggregation reads a missing revenue as "earned nothing".
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ringfuel-secret',
};

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
  const n = Number(String(v).replace(/[$,]/g, ''));
  return isFinite(n) ? n : 0;
}

function toBool(v: unknown): boolean {
  const s = String(v).trim().toLowerCase();
  return v === true || v === 1 || s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'converted';
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

// Field-name lists. Each reads BOTH the CSV's spaced/capitalised names and the
// snake_case / camelCase variants — the payloads contain both conventions.
const F = {
  revenue: ['Revenue', 'revenue', 'revenue_amount', 'conversion_revenue'],
  converted: ['Converted', 'converted', 'isConverted', 'is_converted', 'conversion'],
  campaign: ['Campaign', 'campaign_name', 'campaign', 'campaignName'],
  did: ['Dialed Number', 'dialed_number', 'number_called', 'did', 'dialedNumber', 'tracking_number', 'to', 'to_number', 'dnis', 'number'],
  duration: ['Duration (s)', 'total_call_length', 'duration', 'durationSeconds', 'duration_seconds', 'call_duration', 'total_duration'],
  connectedDuration: ['connected_call_length', 'connected_duration', 'connection_duration', 'talk_time', 'talk_duration', 'billable_duration'],
  caller: ['Caller Number', 'caller_number_e164', 'caller_number', 'callerNumber', 'caller_id', 'caller', 'from', 'from_number', 'ani'],
  status: ['Status', 'call_status', 'disposition', 'status', 'result', 'End Reason', 'end_reason', 'endReason'],
  buyer: ['Buyer', 'buyer_name', 'buyerName', 'buyer'],
  target: ['Target', 'target_name', 'targetName', 'target'],
  recording: ['Recording URL', 'recording_url', 'recordingUrl', 'recording', 'audio_url'],
  state: ['caller_state', 'callerState', 'state', 'from_state', 'State'],
  city: ['caller_city', 'callerCity', 'city', 'from_city', 'City'],
  creative: ['creative', 'creative_label', 'creative_name', 'Creative', 'sub_id', 'subid'],
  payout: ['payout', 'payoutAmount', 'payout_amount', 'Payout'],
  connected: ['connected', 'answered', 'is_connected'],
  event: ['event_type', 'event', 'type', 'event_name', 'webhook_event', 'Event', 'Event Type'],
  // Kept in raw_payload only, no columns: Quality Score, lead_score, is_duplicate,
  // is_repeat_caller, Telephony Cost, Platform Fee, Publisher Cost, Publisher.
};

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
    // A rejected delivery must never be invisible: a misconfigured secret used to look
    // exactly like no traffic at all. Key NAMES only — never values, never the token.
    let keys: string[] = [];
    let nested: string[] = [];
    try {
      const body = await req.clone().json();
      keys = Object.keys(body ?? {});
      const inner = body?.call ?? body?.data;
      if (inner && typeof inner === 'object') nested = Object.keys(inner);
    } catch { /* non-JSON body: no keys to report */ }
    console.error('ringfuel-webhook: REJECTED 401', JSON.stringify({
      at: new Date().toISOString(),
      client_id: url.searchParams.get('client_id') ?? null,
      secret_source: req.headers.get('x-ringfuel-secret') ? 'header'
        : req.headers.get('authorization') ? 'bearer'
        : url.searchParams.get('secret') ? 'query' : 'none',
      payload_keys: keys,
      nested_keys: nested,
    }));
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
  const rawCall = payload?.call ?? payload?.data ?? payload;
  // RingFuel's real payload is camelCase at the top level and carries a flat `tags`
  // object with snake_case detail (caller_state, connected_duration, ...). Merge both,
  // top-level winning, so a single `pick` list can read either shape.
  const tags = rawCall?.tags && typeof rawCall.tags === 'object' && !Array.isArray(rawCall.tags)
    ? rawCall.tags as Record<string, any>
    : {};
  const call: Record<string, any> = { ...tags, ...rawCall };

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const did = pick<string>(call, F.did) ?? null;
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

  // RingFuel fires FIVE events per call (Incoming, Connected, Completed, Converted,
  // Payout), all sharing one call_id. The event name is read from either the envelope
  // or the merged call object.
  const event_type = pick<string>(payload, F.event) ?? pick<string>(call, F.event) ?? null;

  // What did this payload actually carry?
  const revenueRaw = pick(call, F.revenue);
  const convertedRaw = pick(call, F.converted);
  const payoutRaw = pick(call, F.payout);
  const revenue_captured = revenueRaw !== undefined;
  // conversion_captured is true ONLY when a conversion value was genuinely received —
  // never merely because the column happens to read false.
  const conversion_captured = convertedRaw !== undefined;
  const payload_shape: 'csv_full' | 'webhook_minimal' = revenue_captured ? 'csv_full' : 'webhook_minimal';

  const connRaw = pick(call, F.connectedDuration);
  const durRaw = pick(call, F.duration);
  const connectedRaw = pick(call, F.connected);

  // Every value is either present or NULL — NEVER zero/false as a stand-in for absent.
  // The merge happens in the database (public.ringfuel_merge_call), so a concurrent
  // delivery cannot lose the race: each column is COALESCE(incoming, stored).
  const row: Record<string, unknown> = {
    client_id,
    call_id,
    event_type,
    call_start: pick(call, ['call_start', 'iso_date', 'started_at', 'start_time', 'timestamp', 'created_at'])
      ? toIso(pick(call, ['call_start', 'iso_date', 'started_at', 'start_time', 'timestamp', 'created_at']))
      : null,
    // Durations grow as the call progresses — newest wins, handled in the merge.
    duration_seconds: durRaw !== undefined ? toInt(durRaw) : null,
    connection_duration_seconds: connRaw !== undefined ? toInt(connRaw) : null,
    connected: connectedRaw !== undefined
      ? toBool(connectedRaw)
      : (connRaw !== undefined && toInt(connRaw) > 0 ? true : null),
    payout: payoutRaw !== undefined ? toNumber(payoutRaw) : null,
    revenue: revenue_captured ? toNumber(revenueRaw) : null,
    converted: conversion_captured ? toBool(convertedRaw) : null,
    campaign_id,
    campaign_name: pick<string>(call, F.campaign) ?? null,
    did,
    caller_number: pick<string>(call, F.caller) ?? null,
    caller_state: pick<string>(call, F.state) ?? null,
    caller_city: pick<string>(call, F.city) ?? null,
    creative_label: pick<string>(call, F.creative) ?? null,
    disposition: pick<string>(call, F.status) ?? null,
    recording_url: pick<string>(call, F.recording) ?? null,
    buyer_name: pick<string>(call, F.buyer) ?? null,
    target_name: pick<string>(call, F.target) ?? null,
    revenue_captured,
    conversion_captured,
    payload_shape,
    // raw_payload accumulates in the merge: every event's fields survive.
    raw_payload: payload,
  };

  const { data: merged, error } = await supabase.rpc('ringfuel_merge_call', {
    p_row: row,
    p_event: event_type ?? 'unlabelled',
  });

  if (error) {
    console.error('ringfuel_calls merge failed', error);
    return new Response(JSON.stringify({ error: 'DB write failed', details: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true, call_id, client_id, event_type,
    inserted: (merged as any)?.inserted ?? null,
    merged: (merged as any)?.merged ?? null,
    payload_shape,
    revenue_captured,
    conversion_captured,
  }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
