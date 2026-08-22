// Daily reconciliation: matches RingFuel tracked calls against the client's
// recognized-lead sheet, confirming which station and which payout rate applied.
// Runs automatically once a day (pg_cron) and can be invoked manually from the
// Jacuzzi dashboard with { client_id, days } (or explicit { from, to }).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const JACUZZI_CLIENT_ID = 'dc25f274-20f4-4650-b0cc-654073b925f4';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const last10 = (v: unknown): string | null => {
  if (!v) return null;
  const d = String(v).replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};

const stationFrom = (...vals: (string | null | undefined)[]): string | null => {
  for (const v of vals) {
    const m = String(v ?? '').toUpperCase().match(/CT\s?-?(\d{2})/);
    if (m) return `CT${m[1]}`;
  }
  return null;
};

const dayOf = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: Record<string, any> = {};
  try { body = req.method === 'POST' ? await req.json() : {}; } catch { body = {}; }

  const client_id: string = typeof body.client_id === 'string' ? body.client_id : JACUZZI_CLIENT_ID;
  const days = Number.isFinite(Number(body.days)) ? Math.min(Math.max(Number(body.days), 1), 120) : 7;
  const today = new Date().toISOString().slice(0, 10);
  const to: string = typeof body.to === 'string' ? body.to : today;
  const from: string = typeof body.from === 'string' ? body.from : addDays(to, -(days - 1));

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ---- Reference data ------------------------------------------------------
  const [{ data: rates }, { data: numbers }, { data: leads }, { data: calls }] = await Promise.all([
    supabase.from('jacuzzi_payout_rates').select('effective_from, rate')
      .eq('client_id', client_id).order('effective_from', { ascending: true }),
    supabase.from('ringfuel_numbers').select('phone_number, creative_label, campaign_label')
      .eq('client_id', client_id),
    supabase.from('jacuzzi_leads')
      .select('id, transaction_id, transaction_date, lead_type, station_code, attributed_station, toll_free_number, caller_ani, payout_rate')
      .eq('client_id', client_id).gte('transaction_date', from).lte('transaction_date', to),
    supabase.from('ringfuel_calls')
      .select('call_id, did, caller_number, campaign_name, creative_label, call_start, connected, converted, connection_duration_seconds')
      .eq('client_id', client_id)
      .gte('call_start', `${addDays(from, -1)}T00:00:00Z`)
      .lte('call_start', `${addDays(to, 1)}T23:59:59Z`),
  ]);

  const rateList = (rates || []).map((r: any) => ({ from: r.effective_from as string, rate: Number(r.rate) }));
  const rateFor = (date: string) => {
    let hit = { from: null as string | null, rate: 0 };
    for (const r of rateList) if (date >= r.from) hit = { from: r.from, rate: r.rate };
    return hit;
  };

  // DID -> station lookup (RingFuel numbers carry the station in label/campaign).
  const didStation = new Map<string, string>();
  for (const n of numbers || []) {
    const key = last10((n as any).phone_number);
    const st = stationFrom((n as any).creative_label, (n as any).campaign_label);
    if (key && st) didStation.set(key, st);
  }

  const callRows = (calls || []).filter((c: any) => {
    const d = dayOf(c.call_start);
    return d && d >= from && d <= to;
  });

  // ---- Match leads to calls -----------------------------------------------
  // Calls are matched on caller ANI within +/- 1 day of the recognized date,
  // falling back to the tracking number (DID) on the same day.
  const usedCalls = new Set<string>();
  const byAni = new Map<string, any[]>();
  const byDid = new Map<string, any[]>();
  for (const c of callRows) {
    const a = last10(c.caller_number);
    if (a) { if (!byAni.has(a)) byAni.set(a, []); byAni.get(a)!.push(c); }
    const d = last10(c.did);
    if (d) { if (!byDid.has(d)) byDid.set(d, []); byDid.get(d)!.push(c); }
  }

  const matches: any[] = [];

  const callStation = (c: any) =>
    didStation.get(last10(c.did) || '') || stationFrom(c.creative_label, c.campaign_name);

  for (const lead of leads || []) {
    const l: any = lead;
    const date: string = l.transaction_date;
    const expected = rateFor(date);
    const leadStation: string | null = l.attributed_station || l.station_code || null;

    let call: any = null;
    let method: string | null = null;

    if (l.lead_type === 'call') {
      const ani = last10(l.caller_ani);
      if (ani) {
        const cands = (byAni.get(ani) || []).filter((c) => !usedCalls.has(c.call_id));
        call = cands.find((c) => dayOf(c.call_start) === date)
          || cands.find((c) => Math.abs(Date.parse(`${dayOf(c.call_start)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) <= 86400000)
          || null;
        if (call) method = dayOf(call.call_start) === date ? 'ani_same_day' : 'ani_adjacent_day';
      }
      if (!call) {
        const tfn = last10(l.toll_free_number);
        const cands = (byDid.get(tfn || '') || []).filter((c) => !usedCalls.has(c.call_id) && dayOf(c.call_start) === date);
        if (cands.length === 1) { call = cands[0]; method = 'did_same_day'; }
      }
    }

    if (call) usedCalls.add(call.call_id);

    const rfStation = call ? callStation(call) : null;
    const leadRate = l.payout_rate === null || l.payout_rate === undefined ? null : Number(l.payout_rate);

    matches.push({
      client_id, date,
      status: call ? 'matched' : (l.lead_type === 'qr' ? 'qr_no_call_expected' : 'lead_only'),
      match_method: method,
      lead_id: l.id,
      transaction_id: l.transaction_id,
      lead_type: l.lead_type,
      lead_station: leadStation,
      ringfuel_call_id: call?.call_id ?? null,
      ringfuel_did: call?.did ?? null,
      ringfuel_station: rfStation,
      caller_number: call?.caller_number ?? l.caller_ani ?? null,
      station_agrees: call && rfStation && leadStation ? rfStation === leadStation : null,
      lead_payout_rate: leadRate,
      expected_rate: expected.rate,
      rate_agrees: leadRate === null ? null : Math.abs(leadRate - expected.rate) < 0.005,
      notes: l.lead_type === 'qr'
        ? 'QR scan — reported by client only, never appears in RingFuel'
        : (!call ? 'Recognized lead with no matching tracked call' : null),
    });
  }

  // Tracked calls with no recognized lead (only billable/connected ones matter).
  for (const c of callRows) {
    if (usedCalls.has(c.call_id)) continue;
    const date = dayOf(c.call_start)!;
    const expected = rateFor(date);
    matches.push({
      client_id, date,
      status: 'call_only',
      match_method: null,
      lead_id: null,
      transaction_id: null,
      lead_type: 'call',
      lead_station: null,
      ringfuel_call_id: c.call_id,
      ringfuel_did: c.did,
      ringfuel_station: callStation(c),
      caller_number: c.caller_number,
      station_agrees: null,
      lead_payout_rate: null,
      expected_rate: expected.rate,
      rate_agrees: null,
      notes: c.connected ? 'Tracked call not (yet) recognized by the client' : 'Unconnected tracked call',
    });
  }

  // ---- Daily roll-up ------------------------------------------------------
  const dates = new Set<string>(matches.map((m) => m.date));
  const dailyRows: any[] = [];
  for (const date of dates) {
    const rows = matches.filter((m) => m.date === date);
    const leadRows = rows.filter((m) => m.lead_id);
    const expected = rateFor(date);
    const byStation: Record<string, any> = {};
    for (const m of leadRows) {
      const st = m.lead_station || 'unattributed';
      byStation[st] ??= { leads: 0, calls: 0, qr: 0, matched: 0, station_mismatches: 0, revenue: 0 };
      byStation[st].leads += 1;
      byStation[st][m.lead_type === 'qr' ? 'qr' : 'calls'] += 1;
      if (m.status === 'matched') byStation[st].matched += 1;
      if (m.station_agrees === false) byStation[st].station_mismatches += 1;
      byStation[st].revenue += m.lead_payout_rate ?? expected.rate;
    }
    dailyRows.push({
      client_id, date,
      applied_rate: expected.rate,
      rate_effective_from: expected.from,
      leads_total: leadRows.length,
      call_leads: leadRows.filter((m) => m.lead_type === 'call').length,
      qr_leads: leadRows.filter((m) => m.lead_type === 'qr').length,
      ringfuel_calls: rows.filter((m) => m.ringfuel_call_id).length,
      matched_count: rows.filter((m) => m.status === 'matched').length,
      unmatched_leads: rows.filter((m) => m.status === 'lead_only').length,
      unmatched_calls: rows.filter((m) => m.status === 'call_only').length,
      station_mismatches: rows.filter((m) => m.station_agrees === false).length,
      rate_mismatches: rows.filter((m) => m.rate_agrees === false).length,
      expected_revenue: leadRows.reduce((s, m) => s + (m.lead_payout_rate ?? expected.rate), 0),
      by_station: byStation,
      generated_at: new Date().toISOString(),
    });
  }

  // Replace the window so re-runs are idempotent.
  const delRes = await supabase.from('jacuzzi_reconciliation_matches')
    .delete().eq('client_id', client_id).gte('date', from).lte('date', to);
  if (delRes.error) return json({ error: delRes.error.message }, 500);

  for (let i = 0; i < matches.length; i += 500) {
    const { error } = await supabase.from('jacuzzi_reconciliation_matches').insert(matches.slice(i, i + 500));
    if (error) return json({ error: error.message }, 500);
  }

  if (dailyRows.length) {
    const { error } = await supabase.from('jacuzzi_reconciliation_daily')
      .upsert(dailyRows, { onConflict: 'client_id,date' });
    if (error) return json({ error: error.message }, 500);
  }

  return json({
    success: true, from, to,
    days: dailyRows.length,
    leads: (leads || []).length,
    calls: callRows.length,
    matched: matches.filter((m) => m.status === 'matched').length,
    unmatched_leads: matches.filter((m) => m.status === 'lead_only').length,
    unmatched_calls: matches.filter((m) => m.status === 'call_only').length,
    station_mismatches: matches.filter((m) => m.station_agrees === false).length,
    rate_mismatches: matches.filter((m) => m.rate_agrees === false).length,
  });
});
