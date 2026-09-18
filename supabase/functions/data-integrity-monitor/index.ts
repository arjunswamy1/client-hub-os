// Daily plumbing check: finds accounts that are not SET UP or not INTEGRATED
// correctly and files each gap as one task for AJ.
//
// The split that matters: setup and integration gaps are technical cleanup and
// belong to AJ. Delivery anomalies — a campaign that stopped spending, spend with
// no calls on a given day — are media decisions and stay with the account lead in
// the daily update drafter. Nothing in here looks at a single day's delivery.
//
// Three rules keep it from becoming noise:
//   1. A finding matching `data_integrity_exceptions` is skipped and counted,
//      never filed. Not every gap is a bug (Tinned Fish Club has no call
//      tracking by design).
//   2. ONE open task per (check_key, client_id), ever. dedupe_key is
//      'integrity:<check_key>:<client_id>' and an existing open task or live
//      candidate with that key means we do nothing at all — no update, no bump.
//      A daily monitor without this is how 907 duplicate tasks happened.
//   3. Nothing writes to `tasks`. Findings become `task_candidates` and pass the
//      gates in _shared/task-gate.ts like every other extractor.
//
// When a condition clears, the open task is closed automatically with a note.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { gateCandidates, type CandidateRow } from '../_shared/task-gate.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** AJ Swamy — every finding here is technical cleanup and he owns it. */
const AJ_TEAM_MEMBER_ID = '1fdd684e-6cb7-447e-b616-7e1b9c598971';
/** Data that was flowing and has not moved for this many days is stale. */
const STALE_DAYS = 3;

/** Spend tables, with the column that dates a row. Read-only, always. */
const SPEND_SOURCES: [string, string][] = [
  ['roku_daily_metrics', 'date'],
  ['ad_daily_metrics', 'date'],
  ['ad_campaigns', 'date'],
  ['cannaball_spend', 'date'],
  ['platform_spend_4js', 'date'],
  ['universal_ads_geo_metrics', 'date'],
];

const CALL_SOURCES: [string, string][] = [
  ['ringba_calls', 'call_date'],
  ['ringba_calls_4js', 'call_start'],
  ['ringfuel_calls', 'call_start'],
  ['cannaball_calls', 'call_start'],
  ['moja_calls', 'call_start'],
];

interface Finding {
  check_key: string;
  client_id: string | null;
  client_name: string;
  title: string;
  expected: string;
  found: string;
  proof: string;
  dedupe_key: string;
}

/** Current wall-clock hour and weekday in US Eastern, DST included. */
function easternNow(): { hour: number; weekday: string; date: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour), weekday: String(parts.weekday), date: `${parts.year}-${parts.month}-${parts.day}` };
}

const dedupeKey = (checkKey: string, clientId: string | null) => `integrity:${checkKey}:${clientId ?? 'agency'}`;

/** Newest row per source for one client. `null` max means the source is empty for it. */
async function latestPerSource(
  db: SupabaseClient, clientId: string, sources: [string, string][],
): Promise<{ table: string; latest: string }[]> {
  const out: { table: string; latest: string }[] = [];
  for (const [table, col] of sources) {
    // nullsFirst: false matters — Postgres sorts NULLs first on a descending
    // order, so a single undated row would otherwise read as "no data at all".
    const { data, error } = await db.from(table).select(col)
      .eq('client_id', clientId).order(col, { ascending: false, nullsFirst: false }).limit(1);
    // A table this client is not wired into at all is not an error worth failing on.
    if (error) { console.warn(`integrity: ${table} read failed — ${error.message}`); continue; }
    const row = (data ?? [])[0] as Record<string, string> | undefined;
    if (row && row[col]) out.push({ table, latest: String(row[col]).slice(0, 10) });
  }
  return out;
}

const daysSince = (isoDate: string) =>
  Math.floor((Date.now() - new Date(`${isoDate}T00:00:00Z`).getTime()) / 86400000);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const apiKey = Deno.env.get('LOVABLE_API_KEY') ?? '';

  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  const nonce = req.headers.get('x-cron-nonce') || '';
  let authorized = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorized && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data: tokenRow } = await supabase.from('cron_invocation_tokens').delete()
      .eq('token', nonce).gt('created_at', new Date(Date.now() - 5 * 60000).toISOString())
      .select('token').maybeSingle();
    authorized = !!tokenRow;
  }
  if (!authorized && bearer) {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: auth } = await asUser.auth.getUser();
    authorized = !!auth?.user;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dryRun = body.dry_run === true;
    const force = body.force === true;

    // Hourly cron gated on the Eastern clock, so 8:30am ET holds through DST.
    const et = easternNow();
    if (!force && !dryRun) {
      const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(et.weekday);
      if (!weekday || et.hour !== 8) {
        return json({ skipped: true, reason: `not 8am ET on a weekday (currently ${et.weekday} ${et.hour}:00 ET)` });
      }
    }

    const { data: clients, error: clientErr } = await supabase.from('clients')
      .select('id, name, status').eq('status', 'active');
    if (clientErr) throw clientErr;

    const { data: assignments, error: assignErr } = await supabase.from('client_assignments')
      .select('client_id, team_member_id, role_on_account').eq('role_on_account', 'media_buyer');
    if (assignErr) throw assignErr;
    const leadByClient = new Map((assignments ?? []).map((a: any) => [a.client_id as string, a.team_member_id as string]));

    const { data: mappings, error: mapErr } = await supabase.from('slack_channel_mappings')
      .select('client_id, channel_name').eq('channel_purpose', 'client_internal').not('client_id', 'is', null);
    if (mapErr) throw mapErr;
    const channelByClient = new Map((mappings ?? []).map((m: any) => [m.client_id as string, m.channel_name as string]));

    const { data: instances, error: instErr } = await supabase.from('media_brain_instances').select('client_id');
    if (instErr) throw instErr;
    const withInstance = new Set((instances ?? []).map((i: any) => i.client_id as string));

    const nameById = new Map((clients ?? []).map((c: any) => [c.id as string, c.name as string]));
    const findings: Finding[] = [];

    for (const c of (clients ?? []) as { id: string; name: string }[]) {
      const hasLead = leadByClient.has(c.id);

      if (!hasLead) {
        findings.push({
          check_key: 'no_media_buyer', client_id: c.id, client_name: c.name,
          title: `${c.name} has no assigned media buyer — account has no owner`,
          expected: "one client_assignments row with role_on_account = 'media_buyer'",
          found: 'no media_buyer assignment for this active client',
          proof: "select * from client_assignments where client_id = '" + c.id + "' and role_on_account = 'media_buyer'",
          dedupe_key: dedupeKey('no_media_buyer', c.id),
        });
        // Every other check reads "has a lead, but…" — an unowned account is one finding, not five.
        continue;
      }

      if (!channelByClient.has(c.id)) {
        findings.push({
          check_key: 'no_internal_channel', client_id: c.id, client_name: c.name,
          title: `${c.name} has no internal Slack channel mapped — daily updates cannot post`,
          expected: "a slack_channel_mappings row with channel_purpose = 'client_internal'",
          found: 'no client_internal channel mapped, so the daily update drafter holds the draft back',
          proof: "select * from slack_channel_mappings where client_id = '" + c.id + "'",
          dedupe_key: dedupeKey('no_internal_channel', c.id),
        });
      }

      if (!withInstance.has(c.id)) {
        findings.push({
          check_key: 'no_media_brain_instance', client_id: c.id, client_name: c.name,
          title: `${c.name} has no Media Brain instance — margin per call and kill thresholds cannot be computed`,
          expected: 'one media_brain_instances row carrying thresholds, margins, confidence gap and lifecycle',
          found: 'no instance record, so every Media Brain command for this client stops before it pulls',
          proof: "select * from media_brain_instances where client_id = '" + c.id + "'",
          dedupe_key: dedupeKey('no_media_brain_instance', c.id),
        });
      }

      const spend = await latestPerSource(supabase, c.id, SPEND_SOURCES);
      const calls = await latestPerSource(supabase, c.id, CALL_SOURCES);
      const newest = (rows: { latest: string }[]) => rows.map((r) => r.latest).sort().pop() ?? null;
      const spendLatest = newest(spend);
      const callsLatest = newest(calls);
      const describe = (rows: { table: string; latest: string }[]) =>
        rows.map((r) => `${r.table} (latest ${r.latest})`).join(', ');

      if (!spendLatest) {
        findings.push({
          check_key: 'no_spend_data', client_id: c.id, client_name: c.name,
          title: `${c.name} has an assigned lead but no spend data has ever landed — spend integration not wired`,
          expected: `rows in at least one of ${SPEND_SOURCES.map(([t]) => t).join(', ')}`,
          found: callsLatest
            ? `zero spend rows in every spend table, while calls are arriving (${describe(calls)}) — cost per call cannot be computed at all`
            : 'zero spend rows in every spend table',
          proof: SPEND_SOURCES.map(([t]) => `select count(*) from ${t} where client_id = '${c.id}'`).join('; '),
          dedupe_key: dedupeKey('no_spend_data', c.id),
        });
      }

      if (!callsLatest) {
        findings.push({
          check_key: 'no_call_data', client_id: c.id, client_name: c.name,
          title: `${c.name} has an assigned lead but no call data has ever landed — call tracking not wired`,
          expected: `rows in at least one of ${CALL_SOURCES.map(([t]) => t).join(', ')}`,
          found: spendLatest
            ? `zero call rows in every call table, while spend is landing (${describe(spend)}) — we are buying media we cannot measure`
            : 'zero call rows in every call table',
          proof: CALL_SOURCES.map(([t]) => `select count(*) from ${t} where client_id = '${c.id}'`).join('; '),
          dedupe_key: dedupeKey('no_call_data', c.id),
        });
      }

      // Stale is only meaningful where data was flowing: a source that has
      // NEVER delivered is the check above, not this one.
      const stale = [...spend, ...calls].filter((s) => daysSince(s.latest) > STALE_DAYS);
      if (stale.length && (spendLatest || callsLatest)) {
        findings.push({
          check_key: 'stale_data_feed', client_id: c.id, client_name: c.name,
          title: `${c.name} data feed has gone stale — ${stale.map((s) => s.table).join(', ')} stopped delivering`,
          expected: `every wired source for this client within ${STALE_DAYS} days`,
          found: stale.map((s) => `${s.table} last row ${s.latest} (${daysSince(s.latest)} days ago)`).join('; '),
          proof: stale.map((s) => `select max(${SPEND_SOURCES.concat(CALL_SOURCES).find(([t]) => t === s.table)![1]}) from ${s.table} where client_id = '${c.id}'`).join('; '),
          dedupe_key: dedupeKey('stale_data_feed', c.id),
        });
      }
    }

    // Sync logs — failures in the last 24 hours, per client and agency-wide.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: ctxFails } = await supabase.from('context_sync_log')
      .select('source, client_id, status, error_message, last_sync_at')
      .neq('status', 'success').gte('last_sync_at', since);
    for (const row of (ctxFails ?? []) as any[]) {
      const key = `context_sync_failure:${row.source}`;
      findings.push({
        check_key: key, client_id: row.client_id ?? null,
        client_name: row.client_id ? (nameById.get(row.client_id) ?? 'unknown client') : 'agency-wide',
        title: `${row.source} context sync failing${row.client_id ? ` for ${nameById.get(row.client_id) ?? 'a client'}` : ''} — ${row.status}`,
        expected: `context_sync_log rows with status 'success' for source '${row.source}'`,
        found: `status '${row.status}' at ${row.last_sync_at}${row.error_message ? ` — ${row.error_message}` : ''}`,
        proof: `select * from context_sync_log where source = '${row.source}' order by last_sync_at desc limit 5`,
        dedupe_key: dedupeKey(key, row.client_id ?? null),
      });
    }

    const { data: mbFails } = await supabase.from('media_brain_sync_status')
      .select('source, client_id, status, error, last_attempted_at')
      .eq('status', 'error').gte('last_attempted_at', since);
    for (const row of (mbFails ?? []) as any[]) {
      const key = `media_brain_sync_failure:${row.source}`;
      findings.push({
        check_key: key, client_id: row.client_id ?? null,
        client_name: row.client_id ? (nameById.get(row.client_id) ?? 'unknown client') : 'agency-wide',
        title: `${row.source} sync is erroring${row.client_id ? ` for ${nameById.get(row.client_id) ?? 'a client'}` : ''} — data is not landing`,
        expected: `media_brain_sync_status.status = 'ok' for source '${row.source}'`,
        found: `error at ${row.last_attempted_at}: ${row.error ?? 'no message recorded'}`,
        proof: `select * from media_brain_sync_status where source = '${row.source}' order by last_attempted_at desc limit 5`,
        dedupe_key: dedupeKey(key, row.client_id ?? null),
      });
    }

    // Exceptions — matched findings are counted, never filed, and expire.
    const { data: exceptions, error: excErr } = await supabase.from('data_integrity_exceptions')
      .select('client_id, check_key, reason, expires_at');
    if (excErr) throw excErr;
    const liveExceptions = (exceptions ?? []).filter((e: any) =>
      !e.expires_at || new Date(e.expires_at).getTime() > Date.now());
    const isExcepted = (f: Finding) => liveExceptions.find((e: any) =>
      e.check_key === f.check_key && (e.client_id ?? null) === f.client_id);

    const suppressed: Record<string, unknown>[] = [];
    const active: Finding[] = [];
    for (const f of findings) {
      const exc = isExcepted(f);
      if (exc) suppressed.push({ check_key: f.check_key, client: f.client_name, reason: (exc as any).reason });
      else active.push(f);
    }

    // Already-open work for the same gap: one task per (check_key, client_id), ever.
    const keys = active.map((f) => f.dedupe_key);
    const openTaskKeys = new Set<string>();
    const openTasks: { id: string; key: string; title: string }[] = [];
    {
      const { data, error } = await supabase.from('tasks')
        .select('id, title, status, type_data')
        .eq('type_data->>source', 'data_integrity');
      if (error) throw error;
      for (const t of (data ?? []) as any[]) {
        const key = t.type_data?.dedupe_key as string | undefined;
        if (!key) continue;
        const closed = t.status === 'done' || !!t.type_data?.archived_reason;
        if (closed) continue;
        openTaskKeys.add(key);
        openTasks.push({ id: t.id, key, title: t.title });
      }
    }
    const liveCandidateKeys = new Set<string>();
    if (keys.length) {
      const { data, error } = await supabase.from('task_candidates')
        .select('dedupe_key, status').in('dedupe_key', keys).in('status', ['pending', 'promoted']);
      if (error) throw error;
      for (const r of (data ?? []) as any[]) liveCandidateKeys.add(r.dedupe_key);
    }

    const toFile = active.filter((f) => !openTaskKeys.has(f.dedupe_key) && !liveCandidateKeys.has(f.dedupe_key));
    const alreadyTracked = active.filter((f) => openTaskKeys.has(f.dedupe_key) || liveCandidateKeys.has(f.dedupe_key));

    // Conditions that have cleared: close the open task with a note.
    const activeKeys = new Set(active.map((f) => f.dedupe_key));
    const resolvable = openTasks.filter((t) => !activeKeys.has(t.key));
    const resolved: Record<string, unknown>[] = [];
    if (!dryRun) {
      for (const t of resolvable) {
        const { data: row } = await supabase.from('tasks').select('type_data').eq('id', t.id).maybeSingle();
        const td = ((row as any)?.type_data ?? {}) as Record<string, unknown>;
        const { error } = await supabase.from('tasks').update({
          status: 'done', completed_at: new Date().toISOString(),
          type_data: {
            ...td,
            resolved_by_monitor_at: new Date().toISOString(),
            resolution_note: 'Closed automatically by the data integrity monitor: the condition no longer holds.',
          },
        }).eq('id', t.id);
        if (error) throw error;
        resolved.push({ task_id: t.id, title: t.title, dedupe_key: t.key });
      }
    }

    // Filing — candidates only. Nothing here writes to `tasks`.
    let gateSummary: unknown = null;
    const filed: Record<string, unknown>[] = [];
    if (!dryRun && toFile.length) {
      const rows = toFile.map((f) => ({
        client_id: f.client_id,
        source: 'data_integrity',
        source_ref: {
          check_key: f.check_key, expected: f.expected, found: f.found, proof: f.proof,
          client_name: f.client_name, detected_at: new Date().toISOString(), dedupe_key: f.dedupe_key,
        },
        raw_text: [
          f.title, '',
          `Check: ${f.check_key}`,
          `Expected: ${f.expected}`,
          `Found: ${f.found}`,
          `Proof: ${f.proof}`,
        ].join('\n'),
        proposed_title: f.title,
        proposed_assignee_id: AJ_TEAM_MEMBER_ID,
        owner_raw: 'Arjun Swamy',
        owner_side: 'cpm',
        status: 'pending',
        dedupe_key: f.dedupe_key,
      }));
      const { data: inserted, error } = await supabase.from('task_candidates')
        .insert(rows)
        .select('id, client_id, source, source_ref, raw_text, proposed_title, proposed_assignee_id, owner_raw, owner_side, status, created_at');
      if (error) throw error;
      for (const r of (inserted ?? []) as any[]) filed.push({ candidate_id: r.id, title: r.proposed_title });
      const run = await gateCandidates(supabase, (inserted ?? []) as CandidateRow[], apiKey);
      gateSummary = run.summary;
    }

    const byCheck: Record<string, { count: number; clients: string[] }> = {};
    for (const f of active) {
      byCheck[f.check_key] ??= { count: 0, clients: [] };
      byCheck[f.check_key].count++;
      byCheck[f.check_key].clients.push(f.client_name);
    }

    return json({
      success: true,
      dry_run: dryRun,
      eastern: `${et.weekday} ${et.hour}:00 ET`,
      clients_checked: (clients ?? []).length,
      findings_total: active.length,
      by_check: byCheck,
      findings: active.map((f) => ({
        check_key: f.check_key, client: f.client_name, title: f.title,
        expected: f.expected, found: f.found, dedupe_key: f.dedupe_key,
      })),
      suppressed_by_exception: suppressed,
      already_tracked: alreadyTracked.map((f) => ({ check_key: f.check_key, client: f.client_name })),
      would_file: dryRun ? toFile.map((f) => f.dedupe_key) : undefined,
      filed: dryRun ? [] : filed,
      would_resolve: dryRun ? resolvable : undefined,
      resolved: dryRun ? [] : resolved,
      gate_summary: gateSummary,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : JSON.stringify(e);
    console.error('data-integrity-monitor FAILED:', message);
    return json({ error: message }, 500);
  }
});
