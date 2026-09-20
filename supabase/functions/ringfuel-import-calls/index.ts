// RingFuel CSV import — repeatable and idempotent.
//
// The one-off CSV import is the only reason any revenue history exists, so it is a
// first-class, re-runnable path: rows are keyed on (client_id, call_id) and a CSV
// row matching an existing thin webhook row ENRICHES it in place rather than
// inserting a duplicate. Capture flags are set wherever a value actually arrives.
// Doubles as the mechanism for Jacuzzi's client daily sheet.
//
// Body: { client_id, csv_text | csv_url, import_label?, dry_run? }
// Auth: service-role bearer, or a signed-in admin session.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function pick(row: Record<string, string>, names: string[]): string | undefined {
  for (const n of names) {
    const v = row[norm(n)];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const toNum = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/[$,]/g, ''));
  return isFinite(n) ? n : 0;
};
const toInt = (v: unknown) => Math.round(toNum(v));
const toBool = (v: unknown) => ['yes', 'y', 'true', '1', 'converted'].includes(String(v ?? '').trim().toLowerCase());

function toIso(v: unknown): string | null {
  if (!v) return null;
  const s = String(v);
  const n = Number(s);
  if (isFinite(n) && n > 1_000_000_000) return new Date(n < 1e12 ? n * 1000 : n).toISOString();
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Same field vocabulary as the webhook: spaced/capitalised CSV names first, then
// the snake_case variants.
const F = {
  call_id: ['call_id', 'Call ID', 'inbound_call_id', 'id', 'uuid'],
  revenue: ['Revenue', 'revenue', 'revenue_amount'],
  converted: ['Converted', 'converted', 'is_converted'],
  campaign: ['Campaign', 'campaign_name', 'campaign'],
  did: ['Dialed Number', 'dialed_number', 'number_called', 'did'],
  publisher: ['Publisher', 'publisher_name', 'publisher'],
  duration: ['Duration (s)', 'total_call_length', 'duration_seconds', 'duration'],
  connectedDuration: ['connected_call_length', 'connected_duration', 'connection_duration'],
  caller: ['Caller Number', 'caller_number_e164', 'caller_number'],
  status: ['Status', 'call_status', 'disposition'],
  buyer: ['Buyer', 'buyer_name'],
  target: ['Target', 'target_name'],
  recording: ['Recording URL', 'recording_url'],
  state: ['caller_state', 'State', 'state'],
  city: ['caller_city', 'City', 'city'],
  creative: ['creative', 'creative_label', 'creative_name', 'Creative'],
  payout: ['Payout', 'payout', 'payout_amount'],
  connected: ['connected', 'Connected', 'is_connected'],
  start: ['call_start', 'Call Date', 'call_date', 'iso_date', 'date_time', 'start_time', 'timestamp'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

    if (bearer !== serviceKey) {
      const { data: auth } = await admin.auth.getUser(bearer);
      if (!auth?.user) return json({ error: 'Unauthorized' }, 401);
      const { data: isAdmin } = await admin.rpc('is_admin', { check_user_id: auth.user.id });
      if (!isAdmin) return json({ error: 'Admins only' }, 403);
    }

    const body = await req.json().catch(() => ({} as any));
    const client_id: string | undefined = body.client_id;
    if (!client_id) return json({ error: 'client_id is required' }, 400);

    let text: string = body.csv_text ?? '';
    if (!text && body.csv_url) {
      const res = await fetch(body.csv_url);
      if (!res.ok) return json({ error: `Could not download CSV (${res.status})` }, 400);
      text = await res.text();
    }
    if (!text.trim()) return json({ error: 'csv_text or csv_url is required' }, 400);

    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return json({ error: 'CSV has no data rows' }, 400);

    const header = splitCsvLine(lines[0]).map(norm);
    const importLabel: string = body.import_label
      ?? `ringfuel_csv_import_${new Date().toISOString().replace(/[:.]/g, '-')}`;

    const rows: Record<string, unknown>[] = [];
    const skipped: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i]);
      const rec: Record<string, string> = {};
      header.forEach((h, idx) => { rec[h] = cells[idx] ?? ''; });

      const call_id = pick(rec, F.call_id);
      if (!call_id) { skipped.push(`line ${i + 1}: no call_id`); continue; }

      const revenueRaw = pick(rec, F.revenue);
      const convertedRaw = pick(rec, F.converted);
      const connDur = toInt(pick(rec, F.connectedDuration));

      const row: Record<string, unknown> = {
        client_id,
        call_id: String(call_id),
        duration_seconds: toInt(pick(rec, F.duration)),
        connection_duration_seconds: connDur,
        connected: toBool(pick(rec, F.connected)) || connDur > 0,
        payout: toNum(pick(rec, F.payout)),
        revenue_captured: revenueRaw !== undefined,
        conversion_captured: convertedRaw !== undefined,
        payload_shape: revenueRaw !== undefined ? 'csv_full' : 'webhook_minimal',
        // The whole CSV row is kept, always, plus the import label so any row can be
        // traced back to the file it came from.
        raw_payload: { ...rec, _import_source: importLabel },
      };

      const setIf = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') row[k] = v; };
      setIf('call_start', toIso(pick(rec, F.start)));
      setIf('campaign_name', pick(rec, F.campaign));
      setIf('did', pick(rec, F.did));
      setIf('caller_number', pick(rec, F.caller));
      setIf('caller_state', pick(rec, F.state));
      setIf('caller_city', pick(rec, F.city));
      setIf('creative_label', pick(rec, F.creative));
      setIf('disposition', pick(rec, F.status));
      setIf('recording_url', pick(rec, F.recording));
      setIf('buyer_name', pick(rec, F.buyer));
      setIf('target_name', pick(rec, F.target));
      if (revenueRaw !== undefined) row.revenue = toNum(revenueRaw);
      if (convertedRaw !== undefined) row.converted = toBool(convertedRaw);
      if (!row.call_start) row.call_start = new Date().toISOString();

      rows.push(row);
    }

    // How many of these already exist? Reported so a re-run is visibly a no-op
    // enrichment rather than a fresh load.
    const ids = rows.map((r) => String(r.call_id));
    let existing = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const { count } = await admin
        .from('ringfuel_calls')
        .select('call_id', { count: 'exact', head: true })
        .eq('client_id', client_id)
        .in('call_id', ids.slice(i, i + 500));
      existing += count ?? 0;
    }

    if (body.dry_run) {
      return json({
        ok: true, dry_run: true, client_id, parsed: rows.length,
        would_enrich_existing: existing, would_insert_new: rows.length - existing,
        revenue_captured_rows: rows.filter((r) => r.revenue_captured).length,
        skipped, sample: rows.slice(0, 3),
      });
    }

    let written = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await admin
        .from('ringfuel_calls')
        .upsert(chunk, { onConflict: 'client_id,call_id' });
      if (error) return json({ error: 'Upsert failed', details: error.message, written }, 500);
      written += chunk.length;
    }

    return json({
      ok: true, client_id, import_label: importLabel, parsed: rows.length, written,
      enriched_existing: existing, inserted_new: rows.length - existing,
      revenue_captured_rows: rows.filter((r) => r.revenue_captured).length, skipped,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
