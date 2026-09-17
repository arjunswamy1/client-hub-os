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

  // Either account's shared secret is accepted — each CallGrid account holds its own,
  // and client separation is enforced by client_id + registered DID, not by the token.
  const expectedSecrets = [
    Deno.env.get('CALLGRID_WEBHOOK_SECRET'),
    Deno.env.get('CALLGRID_WEBHOOK_SECRET_PPC'),
  ].filter(Boolean) as string[];
  if (expectedSecrets.length === 0) {
    return new Response(JSON.stringify({ error: 'Server not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Accept secret via header OR query param (some webhook UIs only allow URL query strings)
  const url = new URL(req.url);
  const provided = req.headers.get('x-callgrid-secret')
    || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || url.searchParams.get('secret');
  if (!provided || !expectedSecrets.includes(provided)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Which client these calls belong to. Validated, never guessed.
  const requestedClientId = url.searchParams.get('client_id');
  let clientId = CANNABALL_CLIENT_ID;
  if (requestedClientId) {
    if (!UUID_RE.test(requestedClientId)) {
      return new Response(JSON.stringify({ error: 'client_id must be a uuid' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('id', requestedClientId)
      .maybeSingle();
    if (clientError) {
      return new Response(JSON.stringify({ error: 'Client lookup failed', details: clientError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!client) {
      return new Response(JSON.stringify({ error: 'Unknown client_id' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    clientId = client.id;
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

  // Some CallGrid setups pass the ad tags on the URL rather than in the body.
  // Body values win; query values only fill what the body left absent.
  for (const [k, v] of url.searchParams.entries()) {
    if (k === 'secret' || k === 'client_id') continue;
    if (payload[k] === undefined || payload[k] === '') payload[k] = v;
  }
  payload = flattenTagBags(payload);


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
    client_id: clientId,
    call_id,
    caller_number: pick<string>(payload, ['caller', 'caller_number', 'from', 'from_number', 'ani']) ?? null,
    did: didDigits || rawDid,
    caller_state: pick<string>(payload, ['caller_state', 'state', 'from_state']) ?? null,
    caller_city: pick<string>(payload, ['caller_city', 'city', 'from_city']) ?? null,
    caller_zip: pick<string>(payload, ['caller_zip', 'zip', 'zip_code', 'postal_code', 'caller_postal']) ?? null,
    caller_area_code: pick<string>(payload, ['caller_area_code', 'area_code', 'npa']) ?? null,
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

  // Account separation guard. Each CallGrid account posts to its own `client_id`.
  // If the dialed number is registered to a DIFFERENT client, the URL is pointed at
  // the wrong account: reject rather than file one client's call under another.
  // Numbers that belong to nobody yet are accepted (unmapped DIDs are normal).
  if (didDigits) {
    const { data: allDids } = await supabase
      .from('client_dids')
      .select('client_id, did, did_formatted, creative_name, campaign_name');

    const norm = (v: unknown) => String(v || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    const owners = (allDids || []).filter(
      (d: any) => norm(d.did) === didDigits || norm(d.did_formatted) === didDigits,
    );

    if (owners.length > 0 && !owners.some((d: any) => d.client_id === clientId)) {
      console.error('callgrid-webhook DID ownership mismatch', { didDigits, clientId });
      return new Response(
        JSON.stringify({
          error: 'Number belongs to a different client',
          details: `Dialed number ${didDigits} is registered to another client. Check the client_id on this CallGrid postback URL.`,
          did: didDigits,
          posted_to_client_id: clientId,
          registered_client_id: owners[0].client_id,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fill creative/campaign from this client's DID assignment grid when CallGrid doesn't send them
    if (!row.creative_name || !row.campaign_name) {
      const match = owners.find((d: any) => d.client_id === clientId);
      if (match) {
        row.creative_name = row.creative_name || (match as any).creative_name || null;
        row.campaign_name = row.campaign_name || (match as any).campaign_name || null;
      }
    }
  }


  // CallGrid fires multiple events per call (Call Initiated, Call Billable, …).
  // Each event lands on the same (client_id, call_id) row: merge, never overwrite.
  // A later event that omits a field must not blank what an earlier one delivered.
  const mergeStr = (next: unknown, prev: unknown) =>
    next !== null && next !== undefined && next !== '' ? next : (prev ?? null);
  const mergeNum = (next: number, prev: unknown) => (next > 0 ? next : Number(prev) || 0);

  const { data: existing } = await supabase
    .from('cannaball_calls')
    .select('*')
    .eq('client_id', clientId)
    .eq('call_id', call_id)
    .maybeSingle();

  if (existing) {
    row.caller_number = mergeStr(row.caller_number, existing.caller_number);
    row.did = mergeStr(row.did, existing.did);
    row.caller_state = mergeStr(row.caller_state, existing.caller_state);
    row.caller_city = mergeStr(row.caller_city, existing.caller_city);
    row.caller_zip = mergeStr(row.caller_zip, existing.caller_zip);
    row.caller_area_code = mergeStr(row.caller_area_code, existing.caller_area_code);
    // Call Initiated fires first and carries the true start time; keep it.
    row.call_start = existing.call_start ?? row.call_start;
    row.duration_seconds = mergeNum(duration_seconds, existing.duration_seconds);
    row.connection_duration_seconds = mergeNum(
      connection_duration_seconds, existing.connection_duration_seconds,
    );
    row.connected = Boolean(existing.connected) || row.connected;
    // The Billable event is the one that usually carries payout; a non-zero wins.
    row.payout = mergeNum(toNumber(row.payout), existing.payout);
    row.disposition = mergeStr(row.disposition, existing.disposition);
    row.campaign_name = mergeStr(row.campaign_name, existing.campaign_name);
    row.creative_name = mergeStr(row.creative_name, existing.creative_name);
    row.recording_url = mergeStr(row.recording_url, existing.recording_url);
    row.raw_payload = { ...((existing.raw_payload as Record<string, any>) ?? {}), ...payload };
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

  // Echo back what was actually read, so a CallGrid test call shows immediately
  // whether the ad tags and the payout arrived — no silent blanks.
  return new Response(
    JSON.stringify({
      ok: true,
      call_id,
      client_id: clientId,
      received: {
        did: row.did ?? null,
        duration_seconds,
        connection_duration_seconds,
        payout: row.payout,
        utm_source: pick(payload, ['utm_source', 'utmSource']) ?? null,
        utm_campaign: pick(payload, ['utm_campaign', 'utmCampaign']) ?? null,
        utm_content: pick(payload, ['utm_content', 'utmContent']) ?? null,
        creative_id: pick(payload, ['creative_id', 'ad_id', 'platform_ad_id']) ?? null,
      },
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

});
