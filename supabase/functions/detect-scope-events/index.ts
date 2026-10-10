// Records spend-platform pauses and restarts as client_scope_events
// (source 'auto_detected', idempotent on detected_key). Rules live in
// _shared/spend-scope-events.ts. Never edits or deletes an existing event.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { detectSpendScopeEvents } from '../_shared/spend-scope-events.ts';
import { spendPlatformFilter } from '../_shared/client-metrics.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const SPEC: Record<string, { platformCol: string | null; label: string; entity?: boolean }> = {
  roku_daily_metrics: { platformCol: null, label: 'roku', entity: true },
  cannaball_spend: { platformCol: 'platform', label: 'unknown' },
  platform_spend_4js: { platformCol: 'platform', label: 'unknown' },
  ad_daily_metrics: { platformCol: 'platform', label: 'unknown' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  let ok = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const nonce = req.headers.get('x-cron-nonce') || '';
  if (!ok && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data } = await db.from('cron_invocation_tokens').delete().eq('token', nonce)
      .gt('created_at', new Date(Date.now() - 5 * 60000).toISOString()).select('token').maybeSingle();
    ok = !!data;
  }
  if (!ok) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run === true;
  const to = typeof body.to === 'string' ? body.to : new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const from = typeof body.from === 'string' ? body.from : new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

  let q = db.from('clients').select('id, name, spend_source_tables, spend_source_platforms').eq('status', 'active');
  if (Array.isArray(body.client_ids)) q = q.in('id', body.client_ids);
  const { data: clients, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results: any[] = [];
  for (const c of clients ?? []) {
    const byDay = new Map<string, Record<string, number>>();
    for (const table of (c.spend_source_tables ?? []).filter((t: string) => t in SPEC)) {
      const spec = SPEC[table];
      const cols = ['date', 'spend', spec.platformCol].filter(Boolean).join(', ');
      for (let off = 0; ; off += 1000) {
        let r = db.from(table).select(cols).eq('client_id', c.id).gte('date', from).lte('date', to);
        if (spec.entity) r = r.eq('entity', 'campaign');
        const allowed = spendPlatformFilter(c, table);
        if (allowed && spec.platformCol) r = r.in(spec.platformCol, allowed);
        const { data, error: e } = await r.order('date').order('id').range(off, off + 999);
        if (e) throw new Error(`${table}: ${e.message}`);
        for (const row of (data ?? []) as any[]) {
          const d = String(row.date).slice(0, 10);
          const p = (spec.platformCol ? row[spec.platformCol] : null) || spec.label;
          const m = byDay.get(d) ?? {};
          m[p] = (m[p] ?? 0) + Number(row.spend ?? 0);
          byDay.set(d, m);
        }
        if ((data ?? []).length < 1000) break;
      }
    }
    const events = detectSpendScopeEvents(c.id, from, to, byDay);
    let inserted = 0;
    if (!dryRun && events.length) {
      const { data, error: e } = await db.from('client_scope_events').upsert(events.map((ev) => ({
        client_id: c.id, effective_date: ev.date, kind: ev.kind, description: ev.description,
        detail: { platform: ev.platform }, recorded_by: 'detect-scope-events', source: 'auto_detected', detected_key: ev.detected_key,
      })), { onConflict: 'detected_key', ignoreDuplicates: true }).select('id');
      if (e) throw new Error(`client_scope_events: ${e.message}`);
      inserted = (data ?? []).length;
    }
    if (events.length) results.push({ client: c.name, events, inserted });
  }
  return json({ from, to, dry_run: dryRun, results });
});
