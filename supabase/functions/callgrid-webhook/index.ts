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

  // CallGrid holds the live caller until this endpoint answers, so nothing that
  // touches the database may happen before the 200 goes out. Parse the body (fast,
  // in-memory), answer immediately, then persist in the background.

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
    if (k === 'secret' || k === 'client_id' || k === 'sync') continue;
    if (payload[k] === undefined || payload[k] === '') payload[k] = v;
  }
  payload = flattenTagBags(payload);

  const requestedClientId = url.searchParams.get('client_id');
  if (requestedClientId && !UUID_RE.test(requestedClientId)) {
    return new Response(JSON.stringify({ error: 'client_id must be a uuid' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const call_id = String(
    pick(payload, ['call_id', 'callId', 'id', 'uuid', 'call_uuid', 'CallId']) ??
    crypto.randomUUID()
  );

  const duration_seconds = toInt(pick(payload, ['duration', 'call_duration', 'duration_seconds', 'total_duration', 'CallDuration']));
  const connection_duration_seconds = toInt(
    pick(payload, ['connection_duration', 'talk_time', 'talk_duration', 'billable_duration', 'CallDurationFromConnect'])
  );
  const payout = toNumber(pick(payload, ['payout', 'revenue', 'amount', 'price', 'RevenueAmount']));
  const rawDid = pick<string>(payload, ['did', 'to', 'to_number', 'tracking_number', 'dnis', 'tracking_did', 'SourceNumber']) ?? null;
  const didDigits = rawDid ? String(rawDid).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') : null;

  // Answer CallGrid now; the write happens after the response is on the wire.
  const ack = {
    ok: true,
    call_id,
    client_id: requestedClientId ?? CANNABALL_CLIENT_ID,
    queued: true,
    received: {
      did: didDigits || rawDid || null,
      duration_seconds,
      connection_duration_seconds,
      payout,
      utm_source: pick(payload, ['utm_source', 'utmSource']) ?? null,
      utm_campaign: pick(payload, ['utm_campaign', 'utmCampaign']) ?? null,
      utm_content: pick(payload, ['utm_content', 'utmContent']) ?? null,
      creative_id: pick(payload, ['creative_id', 'ad_id', 'platform_ad_id']) ?? null,
    },
  };

  const persist = async () => {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Which client these calls belong to. Validated, never guessed.
    let clientId = CANNABALL_CLIENT_ID;
    if (requestedClientId) {
      const { data: client, error: clientError } = await supabase
        .from('clients').select('id').eq('id', requestedClientId).maybeSingle();
      if (clientError) {
        console.error('callgrid-webhook client lookup failed', { call_id, error: clientError.message });
        return;
      }
      if (!client) {
        console.error('callgrid-webhook unknown client_id', { call_id, requestedClientId });
        return;
      }
      clientId = client.id;
    }

    const row: Record<string, unknown> = {
      client_id: clientId,
      call_id,
      caller_number: pick<string>(payload, ['caller', 'caller_number', 'from', 'from_number', 'ani', 'InboundNumber', 'CallerId']) ?? null,
      did: didDigits || rawDid,
      caller_state: pick<string>(payload, ['caller_state', 'state', 'from_state', 'InboundStateCode']) ?? null,
      caller_city: pick<string>(payload, ['caller_city', 'city', 'from_city', 'InboundCity']) ?? null,
      caller_zip: pick<string>(payload, ['caller_zip', 'zip', 'zip_code', 'postal_code', 'caller_postal', 'InboundZipCode']) ?? null,
      caller_area_code: pick<string>(payload, ['caller_area_code', 'area_code', 'npa', 'InboundAreaCode']) ?? null,
      call_start: toIso(pick(payload, ['call_start', 'start_time', 'started_at', 'timestamp', 'created_at', 'UTCISODate'])),
      duration_seconds,
      connected: (() => {
        const c = pick(payload, ['connected', 'answered', 'is_connected', 'CallConnected']);
        return c === true || c === 'true' || c === 1 || c === '1' || connection_duration_seconds > 0;
      })(),
      connection_duration_seconds,
      payout,
      disposition: pick<string>(payload, ['disposition', 'status', 'result', 'CallStatus']) ?? null,
      campaign_name: pick<string>(payload, ['campaign', 'campaign_name', 'source', 'CampaignName']) ?? null,
      creative_name: pick<string>(payload, ['creative', 'creative_name', 'ad_name']) ?? null,
      recording_url: pick<string>(payload, ['recording_url', 'recording', 'audio_url']) ?? null,
      raw_payload: payload,
    };

    // Account separation guard. Each CallGrid account posts to its own `client_id`.
    // If the dialed number is registered to a DIFFERENT client, the URL is pointed at
    // the wrong account: skip rather than file one client's call under another.
    if (didDigits) {
      const { data: allDids } = await supabase
        .from('client_dids')
        .select('client_id, did, did_formatted, creative_name, campaign_name');

      const norm = (v: unknown) => String(v || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      const owners = (allDids || []).filter(
        (d: any) => norm(d.did) === didDigits || norm(d.did_formatted) === didDigits,
      );

      if (owners.length > 0 && !owners.some((d: any) => d.client_id === clientId)) {
        console.error('callgrid-webhook DID ownership mismatch', {
          didDigits, clientId, registered_client_id: owners[0].client_id,
        });
        return;
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
      row.payout = mergeNum(payout, existing.payout);
      row.disposition = mergeStr(row.disposition, existing.disposition);
      row.campaign_name = mergeStr(row.campaign_name, existing.campaign_name);
      row.creative_name = mergeStr(row.creative_name, existing.creative_name);
      row.recording_url = mergeStr(row.recording_url, existing.recording_url);
      row.raw_payload = { ...((existing.raw_payload as Record<string, any>) ?? {}), ...payload };
    }

    const { error } = await supabase
      .from('cannaball_calls')
      .upsert(row, { onConflict: 'client_id,call_id' });

    if (error) console.error('cannaball_calls upsert failed', { call_id, error: error.message });
  };

  // `?sync=1` keeps the old blocking behaviour for manual testing, where seeing the
  // write outcome matters more than latency. Live CallGrid traffic never sets it.
  if (url.searchParams.get('sync') === '1') {
    await persist();
    return new Response(JSON.stringify({ ...ack, queued: false }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Keeps the isolate alive for the write after the response is returned.
  (globalThis as any).EdgeRuntime?.waitUntil?.(
    persist().catch((e) => console.error('callgrid-webhook persist failed', { call_id, e: String(e) })),
  ) ?? persist().catch((e) => console.error('callgrid-webhook persist failed', { call_id, e: String(e) }));

  return new Response(JSON.stringify(ack), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

