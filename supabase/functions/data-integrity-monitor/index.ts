// Daily plumbing check: finds accounts that are not SET UP or not INTEGRATED
// correctly and files each gap as one task for AJ.
//
// v2 — expectation-driven. Every account carries `engagement_type` and
// `expected_sources`; a missing source is a finding ONLY when the client is
// expected to have it. An account with an empty expectation is correctly quiet:
// LeadGen is creative-only, Connatria and OneShare have not launched. That kills
// the false positives at the root instead of burying them in an exception list.
//
// The split that matters: setup and integration gaps are technical cleanup and
// belong to AJ. Day-to-day delivery judgement stays with the account lead in the
// daily update drafter.
//
// The one delivery-shaped check that lives here is `silent_feed`: a metric that
// drops to EXACTLY zero while a sibling metric keeps flowing (conversions zero
// while calls rise, calls zero while spend continues, spend zero while calls
// continue). A clean zero next to a healthy sibling is a broken pipe, not a
// business change, and no other check can see it — nothing is missing, it is
// present and wrong.
//
// Three rules keep it from becoming noise:
//   1. A finding matching `data_integrity_exceptions` is skipped and counted,
//      never filed.
//   2. ONE open task per (check_key, client_id), ever. dedupe_key is
//      'integrity:<check_key>:<client_id>' and an existing open task or live
//      candidate with that key means we do nothing at all — no update, no bump.
//   3. Nothing writes to `tasks`. Findings become `task_candidates` and pass the
//      gates in _shared/task-gate.ts like every other extractor.
//
// When a condition clears, the open task is closed automatically with a note.
// Every read in here is read-only against the call and ad sync tables.
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
/** A source that was flowing and has not moved for this many days is stale. */
const STALE_DAYS = 3;
/** Days of history the silent-feed check reads (excluding today, which is partial). */
const SILENT_WINDOW_DAYS = 8;
/** Only these engagement types are run through the Media Brain. */
const NEEDS_MEDIA_BRAIN = new Set(['pay_per_call', 'performance_media']);

type Probe = {
  table: string;
  dateCol: string;
  /** true when dateCol is a date (not a timestamp) and can be compared with eq. */
  dateOnly?: boolean;
  filterCol?: string;
  filterVals?: string[];
  /** Numeric column to sum per day, where the source carries spend. */
  spendCol?: string;
  /** Columns that mark a call as converted / revenue-bearing, where present. */
  convertedCol?: string;
  revenueCol?: string;
  /** Attribution columns, where present. */
  campaignCol?: string;
  didCol?: string;
  creativeCol?: string;
  payoutCol?: string;
};

const META_PLATFORMS = ['meta', 'Meta', 'facebook', 'Facebook', 'META', 'FACEBOOK'];
const GOOGLE_PLATFORMS = ['google', 'Google', 'google_ads', 'GOOGLE', 'Google Ads'];

/** Every expected-source token, and the tables that would carry it. */
const SOURCE_REGISTRY: Record<string, { label: string; kind: 'spend' | 'calls' | 'other'; probes: Probe[] }> = {
  meta_spend: {
    label: 'Meta ad spend', kind: 'spend',
    probes: [
      { table: 'ad_daily_metrics', dateCol: 'date', dateOnly: true, filterCol: 'platform', filterVals: META_PLATFORMS, spendCol: 'spend' },
      { table: 'ad_campaigns', dateCol: 'date', dateOnly: true, filterCol: 'platform', filterVals: META_PLATFORMS, spendCol: 'spend' },
    ],
  },
  google_spend: {
    label: 'Google Ads spend', kind: 'spend',
    probes: [
      { table: 'ad_daily_metrics', dateCol: 'date', dateOnly: true, filterCol: 'platform', filterVals: GOOGLE_PLATFORMS, spendCol: 'spend' },
      { table: 'ad_campaigns', dateCol: 'date', dateOnly: true, filterCol: 'platform', filterVals: GOOGLE_PLATFORMS, spendCol: 'spend' },
    ],
  },
  roku_spend: {
    label: 'Roku spend', kind: 'spend',
    probes: [{ table: 'roku_daily_metrics', dateCol: 'date', dateOnly: true, spendCol: 'spend' }],
  },
  calls: {
    label: 'tracked calls', kind: 'calls',
    probes: [
      { table: 'ringba_calls', dateCol: 'call_date', convertedCol: 'converted', revenueCol: 'revenue', payoutCol: 'payout' },
      { table: 'ringba_calls_4js', dateCol: 'call_start', payoutCol: 'payout' },
      { table: 'ringfuel_calls', dateCol: 'call_start', convertedCol: 'converted', revenueCol: 'revenue', payoutCol: 'payout', campaignCol: 'campaign_name', didCol: 'did', creativeCol: 'creative_label' },
      { table: 'cannaball_calls', dateCol: 'call_start', payoutCol: 'payout' },
      { table: 'moja_calls', dateCol: 'call_start', convertedCol: 'converted', revenueCol: 'revenue', payoutCol: 'payout' },
    ],
  },
  ringfuel_calls: {
    label: 'RingFuel calls', kind: 'calls',
    probes: [{ table: 'ringfuel_calls', dateCol: 'call_start', convertedCol: 'converted', revenueCol: 'revenue', payoutCol: 'payout', campaignCol: 'campaign_name', didCol: 'did', creativeCol: 'creative_label' }],
  },
  qr_scans: {
    label: 'QR scan conversions', kind: 'other',
    probes: [{ table: 'jacuzzi_leads', dateCol: 'transaction_date', dateOnly: true, filterCol: 'lead_type', filterVals: ['qr', 'QR', 'Qr'] }],
  },
  universal_ads: {
    label: 'Universal Ads delivery', kind: 'spend',
    probes: [{ table: 'universal_ads_geo_metrics', dateCol: 'date', dateOnly: true, spendCol: 'spend' }],
  },
  // Handled on its own: nothing lands in our database by design.
  external_dashboard: { label: 'external reporting dashboard', kind: 'other', probes: [] },
};

interface Finding {
  check_key: string;
  client_id: string | null;
  client_name: string;
  priority: 'urgent' | 'high' | 'normal';
  title: string;
  expected: string;
  found: string;
  proof: string;
  dedupe_key: string;
}

/** Current wall-clock hour and weekday in US Eastern, DST included. */
function easternNow(): { hour: number; minute: number; weekday: string; date: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    hour: Number(parts.hour), minute: Number(parts.minute), weekday: String(parts.weekday),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

const dedupeKey = (checkKey: string, clientId: string | null) => `integrity:${checkKey}:${clientId ?? 'agency'}`;
const daysSince = (isoDate: string) =>
  Math.floor((Date.now() - new Date(`${isoDate}T00:00:00Z`).getTime()) / 86400000);
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const prettyDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function applyFilter<T>(q: any, p: Probe) {
  return p.filterCol && p.filterVals ? q.in(p.filterCol, p.filterVals) : q;
}

/** Bound one probe to a single day, whether its date column is a date or a timestamp. */
function boundDay(q: any, p: Probe, day: string) {
  if (p.dateOnly) return q.eq(p.dateCol, day);
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return q.gte(p.dateCol, `${day}T00:00:00`).lt(p.dateCol, `${next.toISOString().slice(0, 10)}T00:00:00`);
}

/** Newest row date for one probe, or null when this client has nothing in it. */
async function latestForProbe(db: SupabaseClient, clientId: string, p: Probe): Promise<string | null> {
  // nullsFirst: false matters — Postgres sorts NULLs first on a descending order,
  // so a single undated row would otherwise read as "no data at all".
  let q = db.from(p.table).select(p.dateCol).eq('client_id', clientId)
    .order(p.dateCol, { ascending: false, nullsFirst: false }).limit(1);
  q = applyFilter(q, p);
  const { data, error } = await q;
  if (error) { console.warn(`integrity: ${p.table} read failed — ${error.message}`); return null; }
  const row = (data ?? [])[0] as Record<string, string> | undefined;
  return row?.[p.dateCol] ? String(row[p.dateCol]).slice(0, 10) : null;
}

async function dayCount(db: SupabaseClient, clientId: string, p: Probe, day: string, extra?: (q: any) => any): Promise<number> {
  let q = db.from(p.table).select('id', { count: 'exact', head: true }).eq('client_id', clientId);
  q = boundDay(applyFilter(q, p), p, day);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) { console.warn(`integrity: count ${p.table} failed — ${error.message}`); return 0; }
  return count ?? 0;
}

async function daySum(db: SupabaseClient, clientId: string, p: Probe, day: string): Promise<number> {
  if (!p.spendCol) return 0;
  let q = db.from(p.table).select(p.spendCol).eq('client_id', clientId).limit(2000);
  q = boundDay(applyFilter(q, p), p, day);
  const { data, error } = await q;
  if (error) { console.warn(`integrity: sum ${p.table} failed — ${error.message}`); return 0; }
  return (data ?? []).reduce((s: number, r: any) => s + Number(r[p.spendCol!] ?? 0), 0);
}

/** The last SILENT_WINDOW_DAYS calendar days, oldest first, excluding today. */
function recentDays(): string[] {
  const out: string[] = [];
  for (let i = SILENT_WINDOW_DAYS; i >= 1; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Trailing run of days where `zero` is true and `sibling` is healthy. */
function trailingZeroRun(days: string[], zero: boolean[], sibling: boolean[]): string[] {
  const run: string[] = [];
  for (let i = days.length - 1; i >= 0; i--) {
    if (zero[i] && sibling[i]) run.unshift(days[i]);
    else break;
  }
  return run;
}

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
        return json({ skipped: true, reason: `not the 8am ET hour on a weekday (currently ${et.weekday} ${et.hour}:${String(et.minute).padStart(2, '0')} ET)` });
      }
    }

    const { data: clients, error: clientErr } = await supabase.from('clients')
      .select('id, name, status, engagement_type, expected_sources, external_dashboard_url, data_model_note')
      .eq('status', 'active');
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
    /** What each client was expected to have and what we actually found. */
    const expectationReport: Record<string, unknown>[] = [];
    const days = recentDays();

    type ClientRow = {
      id: string; name: string; engagement_type: string | null;
      expected_sources: string[] | null; external_dashboard_url: string | null;
    };

    for (const c of (clients ?? []) as ClientRow[]) {
      const hasLead = leadByClient.has(c.id);
      const expected = (c.expected_sources ?? []).filter((t) => t && t in SOURCE_REGISTRY);
      const unknownTokens = (c.expected_sources ?? []).filter((t) => t && !(t in SOURCE_REGISTRY));
      const engagement = c.engagement_type;

      if (!hasLead) {
        findings.push({
          check_key: 'no_media_buyer', client_id: c.id, client_name: c.name, priority: 'high',
          title: `${c.name} has no assigned media buyer — account has no owner`,
          expected: "one client_assignments row with role_on_account = 'media_buyer'",
          found: 'no media_buyer assignment for this active client',
          proof: `select * from client_assignments where client_id = '${c.id}' and role_on_account = 'media_buyer'`,
          dedupe_key: dedupeKey('no_media_buyer', c.id),
        });
        // Every other check reads "has a lead, but…" — an unowned account is one finding, not five.
        expectationReport.push({ client: c.name, engagement_type: engagement, expected_sources: expected, skipped: 'no assigned lead' });
        continue;
      }

      if (!engagement) {
        // Unclassified: we do not know what this account should have, so we do
        // not guess. Blanket assumptions are exactly what v1 got wrong.
        findings.push({
          check_key: 'no_engagement_type', client_id: c.id, client_name: c.name, priority: 'normal',
          title: `${c.name} has no engagement type set — the integrity monitor cannot tell what data it should have`,
          expected: "clients.engagement_type set (pay_per_call | performance_media | ecommerce | creative_only | pre_launch | self_managed) and expected_sources populated",
          found: 'engagement_type is null, so every source check is skipped for this account',
          proof: `select engagement_type, expected_sources from clients where id = '${c.id}'`,
          dedupe_key: dedupeKey('no_engagement_type', c.id),
        });
        expectationReport.push({ client: c.name, engagement_type: null, expected_sources: [], skipped: 'unclassified' });
        continue;
      }

      if (unknownTokens.length) {
        findings.push({
          check_key: 'unknown_expected_source', client_id: c.id, client_name: c.name, priority: 'normal',
          title: `${c.name} lists expected sources the monitor does not know how to check: ${unknownTokens.join(', ')}`,
          expected: 'every token in clients.expected_sources maps to a table the monitor can read',
          found: `unrecognised token(s): ${unknownTokens.join(', ')}`,
          proof: `select expected_sources from clients where id = '${c.id}'`,
          dedupe_key: dedupeKey('unknown_expected_source', c.id),
        });
      }

      if (!channelByClient.has(c.id)) {
        findings.push({
          check_key: 'no_internal_channel', client_id: c.id, client_name: c.name, priority: 'normal',
          title: `${c.name} has no internal Slack channel mapped — daily updates cannot post`,
          expected: "a slack_channel_mappings row with channel_purpose = 'client_internal'",
          found: 'no client_internal channel mapped, so the daily update drafter holds the draft back',
          proof: `select * from slack_channel_mappings where client_id = '${c.id}'`,
          dedupe_key: dedupeKey('no_internal_channel', c.id),
        });
      }

      // Media Brain is only for accounts we buy and optimise media for.
      if (NEEDS_MEDIA_BRAIN.has(engagement) && !withInstance.has(c.id)) {
        findings.push({
          check_key: 'no_media_brain_instance', client_id: c.id, client_name: c.name, priority: 'high',
          title: `${c.name} has no Media Brain instance — margin per call and kill thresholds cannot be computed`,
          expected: `one media_brain_instances row (required for ${engagement} accounts)`,
          found: 'no instance record, so every Media Brain command for this client stops before it pulls',
          proof: `select * from media_brain_instances where client_id = '${c.id}'`,
          dedupe_key: dedupeKey('no_media_brain_instance', c.id),
        });
      }

      // External reporting is a decision, not a defect — filed once, and the
      // dedupe key guarantees it never reappears.
      if (expected.includes('external_dashboard')) {
        findings.push({
          check_key: 'external_reporting_only', client_id: c.id, client_name: c.name, priority: 'normal',
          title: `${c.name} reports outside the hub${c.external_dashboard_url ? ` (${c.external_dashboard_url})` : ''} — record the integration decision`,
          expected: 'a recorded decision that this account is reported externally, so hub checks stay quiet',
          found: `engagement_type '${engagement}' with external_dashboard as the expected source; no spend or call data is expected to land here`,
          proof: `select engagement_type, expected_sources, external_dashboard_url from clients where id = '${c.id}'`,
          dedupe_key: dedupeKey('external_reporting_only', c.id),
        });
      }

      // ---- Expected sources: present, missing, stale ----
      const presentSources: { token: string; probe: Probe; latest: string }[] = [];
      const missingSources: string[] = [];

      for (const token of expected) {
        const spec = SOURCE_REGISTRY[token];
        if (!spec.probes.length) continue; // external_dashboard, handled above
        let best: { probe: Probe; latest: string } | null = null;
        for (const p of spec.probes) {
          const latest = await latestForProbe(supabase, c.id, p);
          if (latest && (!best || latest > best.latest)) best = { probe: p, latest };
        }
        if (best) presentSources.push({ token, probe: best.probe, latest: best.latest });
        else missingSources.push(token);
      }

      for (const token of missingSources) {
        const spec = SOURCE_REGISTRY[token];
        const siblings = presentSources.map((s) => `${SOURCE_REGISTRY[s.token].label} (latest ${s.latest})`).join(', ');
        findings.push({
          check_key: `missing_source:${token}`, client_id: c.id, client_name: c.name, priority: 'high',
          title: `${c.name}: ${spec.label} is expected but nothing has ever landed — integration not wired`,
          expected: `rows for this client in ${spec.probes.map((p) => p.table).join(' or ')} (${token} is listed in expected_sources)`,
          found: siblings
            ? `zero rows for ${spec.label}, while other expected sources are arriving: ${siblings}`
            : `zero rows for ${spec.label}`,
          proof: spec.probes.map((p) => `select count(*) from ${p.table} where client_id = '${c.id}'${p.filterCol ? ` and ${p.filterCol} in (${p.filterVals!.map((v) => `'${v}'`).join(',')})` : ''}`).join('; '),
          dedupe_key: dedupeKey(`missing_source:${token}`, c.id),
        });
      }

      const stale = presentSources.filter((s) => daysSince(s.latest) > STALE_DAYS);
      if (stale.length) {
        findings.push({
          check_key: 'stale_data_feed', client_id: c.id, client_name: c.name, priority: 'high',
          title: `${c.name} data feed has gone stale — ${stale.map((s) => SOURCE_REGISTRY[s.token].label).join(', ')} stopped delivering`,
          expected: `every expected source for this client within ${STALE_DAYS} days`,
          found: stale.map((s) => `${s.probe.table} last row ${s.latest} (${daysSince(s.latest)} days ago)`).join('; '),
          proof: stale.map((s) => `select max(${s.probe.dateCol}) from ${s.probe.table} where client_id = '${c.id}'`).join('; '),
          dedupe_key: dedupeKey('stale_data_feed', c.id),
        });
      }

      // ---- Silent feed: an exact zero beside a healthy sibling ----
      const callSource = presentSources.find((s) => SOURCE_REGISTRY[s.token].kind === 'calls');
      const spendSources = presentSources.filter((s) => SOURCE_REGISTRY[s.token].kind === 'spend');

      // One read per source, bucketed in memory. Per-day queries were far too
      // slow to finish inside a single invocation.
      const callsByDay = days.map(() => 0);
      const convByDay = days.map(() => 0);
      const spendByDay = days.map(() => 0);
      const idx = new Map(days.map((d, i) => [d, i]));
      let payoutSum = 0, revenueSum = 0;

      if (callSource) {
        const p = callSource.probe;
        const cols = [p.dateCol, p.convertedCol, p.revenueCol, p.payoutCol].filter(Boolean).join(',');
        let q = supabase.from(p.table).select(cols).eq('client_id', c.id).limit(50000);
        q = p.dateOnly ? q.gte(p.dateCol, days[0]) : q.gte(p.dateCol, `${days[0]}T00:00:00`);
        const { data: rows, error } = await q;
        if (error) console.warn(`integrity: window read ${p.table} failed — ${error.message}`);
        for (const r of (rows ?? []) as any[]) {
          const i = idx.get(String(r[p.dateCol] ?? '').slice(0, 10));
          payoutSum += Number(r[p.payoutCol ?? ''] ?? 0);
          revenueSum += Number(r[p.revenueCol ?? ''] ?? 0);
          if (i === undefined) continue;
          callsByDay[i]++;
          const converted = (p.convertedCol && r[p.convertedCol] === true) || (p.revenueCol && Number(r[p.revenueCol] ?? 0) > 0);
          if (converted) convByDay[i]++;
        }
      }
      for (const s of spendSources) {
        const p = s.probe;
        let q = supabase.from(p.table).select(`${p.dateCol},${p.spendCol}`).eq('client_id', c.id).limit(20000);
        q = applyFilter(q, p);
        q = p.dateOnly ? q.gte(p.dateCol, days[0]) : q.gte(p.dateCol, `${days[0]}T00:00:00`);
        const { data: rows, error } = await q;
        if (error) console.warn(`integrity: window read ${p.table} failed — ${error.message}`);
        for (const r of (rows ?? []) as any[]) {
          const i = idx.get(String(r[p.dateCol] ?? '').slice(0, 10));
          if (i !== undefined) spendByDay[i] += Number(r[p.spendCol!] ?? 0);
        }
      }


      const hadConvEarlier = convByDay.some((v, i) => v > 0 && i < days.length - 1);
      const convRun = callSource?.probe.convertedCol || callSource?.probe.revenueCol
        ? trailingZeroRun(days, convByDay.map((v) => v === 0), callsByDay.map((v) => v > 0))
        : [];
      if (convRun.length >= 2 && hadConvEarlier) {
        const firstIdx = days.indexOf(convRun[0]);
        const spendAtRisk = spendByDay.slice(firstIdx).reduce((a, b) => a + b, 0);
        const callsInRun = callsByDay.slice(firstIdx).reduce((a, b) => a + b, 0);
        findings.push({
          check_key: 'silent_feed:conversions', client_id: c.id, client_name: c.name, priority: 'urgent',
          title: `${c.name}: conversions zero since ${prettyDate(convRun[0])} — ${money(spendAtRisk)} spent with no recorded revenue`,
          expected: `conversions and revenue continuing alongside call volume in ${callSource!.probe.table}`,
          found: `${convRun.length} consecutive days with exactly zero conversions and zero revenue while ${callsInRun.toLocaleString('en-US')} calls arrived (${convRun.map((d, i) => `${d}: ${callsByDay[firstIdx + i]} calls, 0 converted`).join('; ')}), against ${money(spendAtRisk)} of spend`,
          proof: `select date(${callSource!.probe.dateCol}), count(*), sum(case when ${callSource!.probe.convertedCol ?? 'converted'} then 1 else 0 end), sum(coalesce(revenue,0)) from ${callSource!.probe.table} where client_id = '${c.id}' and ${callSource!.probe.dateCol} >= '${days[0]}' group by 1 order by 1`,
          dedupe_key: dedupeKey('silent_feed:conversions', c.id),
        });
      }

      const hadCallsEarlier = callsByDay.some((v, i) => v > 0 && i < days.length - 1);
      const callRun = callSource ? trailingZeroRun(days, callsByDay.map((v) => v === 0), spendByDay.map((v) => v > 0)) : [];
      if (callRun.length >= 2 && hadCallsEarlier) {
        const firstIdx = days.indexOf(callRun[0]);
        const spendAtRisk = spendByDay.slice(firstIdx).reduce((a, b) => a + b, 0);
        findings.push({
          check_key: 'silent_feed:calls', client_id: c.id, client_name: c.name, priority: 'urgent',
          title: `${c.name}: calls zero since ${prettyDate(callRun[0])} while spend continues — ${money(spendAtRisk)} spent with no calls recorded`,
          expected: `calls continuing in ${callSource!.probe.table} alongside spend`,
          found: `${callRun.length} consecutive days with exactly zero calls while ${money(spendAtRisk)} of spend landed`,
          proof: `select date(${callSource!.probe.dateCol}), count(*) from ${callSource!.probe.table} where client_id = '${c.id}' and ${callSource!.probe.dateCol} >= '${days[0]}' group by 1 order by 1`,
          dedupe_key: dedupeKey('silent_feed:calls', c.id),
        });
      }

      const hadSpendEarlier = spendByDay.some((v, i) => v > 0 && i < days.length - 1);
      const spendRun = spendSources.length ? trailingZeroRun(days, spendByDay.map((v) => v === 0), callsByDay.map((v) => v > 0)) : [];
      if (spendRun.length >= 2 && hadSpendEarlier) {
        const firstIdx = days.indexOf(spendRun[0]);
        const callsInRun = callsByDay.slice(firstIdx).reduce((a, b) => a + b, 0);
        findings.push({
          check_key: 'silent_feed:spend', client_id: c.id, client_name: c.name, priority: 'urgent',
          title: `${c.name}: spend zero since ${prettyDate(spendRun[0])} while calls keep arriving — cost per call cannot be computed`,
          expected: `spend continuing in ${spendSources.map((s) => s.probe.table).join(', ')} alongside call volume`,
          found: `${spendRun.length} consecutive days with exactly zero spend while ${callsInRun.toLocaleString('en-US')} calls arrived`,
          proof: spendSources.map((s) => `select ${s.probe.dateCol}, sum(${s.probe.spendCol}) from ${s.probe.table} where client_id = '${c.id}' and ${s.probe.dateCol} >= '${days[0]}' group by 1 order by 1`).join('; '),
          dedupe_key: dedupeKey('silent_feed:spend', c.id),
        });
      }

      // ---- Revenue in the wrong field ----
      // The Media Brain reads `payout` as CPM's revenue. Where `revenue` carries
      // real money and `payout` is empty, margin computes against nothing.
      if (callSource?.probe.payoutCol && callSource.probe.revenueCol) {
        const p = callSource.probe;

        if (revenueSum > 0 && payoutSum < revenueSum * 0.01) {
          findings.push({
            check_key: 'revenue_field_mismatch', client_id: c.id, client_name: c.name, priority: 'high',
            title: `${c.name}: revenue sits in \`revenue\` while \`payout\` is ${money(payoutSum)} — the Media Brain computes margin against the empty field`,
            expected: `one authoritative revenue field for a ${engagement} account where CPM buys the media`,
            found: `over the last ${SILENT_WINDOW_DAYS} days ${p.table} holds ${money(revenueSum)} in revenue and ${money(payoutSum)} in payout — needs a deliberate decision on which field governs`,
            proof: `select sum(coalesce(${p.payoutCol},0)) payout, sum(coalesce(${p.revenueCol},0)) revenue from ${p.table} where client_id = '${c.id}'`,
            dedupe_key: dedupeKey('revenue_field_mismatch', c.id),
          });
        }
      }

      // ---- Attribution coverage ----
      if (callSource && (callSource.probe.campaignCol || callSource.probe.creativeCol)) {
        const p = callSource.probe;
        const total = await (async () => {
          const { count } = await supabase.from(p.table).select('id', { count: 'exact', head: true }).eq('client_id', c.id);
          return count ?? 0;
        })();
        if (total >= 100) {
          let unattributed = 0, noCreative = 0;
          if (p.campaignCol && p.didCol) {
            const { count } = await supabase.from(p.table).select('id', { count: 'exact', head: true })
              .eq('client_id', c.id).is(p.campaignCol, null).is(p.didCol, null);
            unattributed = count ?? 0;
          }
          if (p.creativeCol) {
            const { count } = await supabase.from(p.table).select('id', { count: 'exact', head: true })
              .eq('client_id', c.id).is(p.creativeCol, null);
            noCreative = count ?? 0;
          }
          const parts: string[] = [];
          if (unattributed / total > 0.2) parts.push(`${unattributed.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} calls (${Math.round((unattributed / total) * 100)}%) have neither campaign_name nor did`);
          if (p.creativeCol && noCreative / total > 0.5) parts.push(`${noCreative.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} calls (${Math.round((noCreative / total) * 100)}%) have no creative_label`);
          if (parts.length) {
            findings.push({
              check_key: 'attribution_gap', client_id: c.id, client_name: c.name, priority: 'high',
              title: `${c.name}: call attribution is incomplete — ${parts.length > 1 ? 'campaign and creative' : 'campaign or creative'} cannot be read for a large share of calls`,
              expected: 'campaign and creative identifiers on the calls we pay for, so spend can be judged per angle',
              found: parts.join('; '),
              proof: `select count(*) total, count(*) filter (where ${p.campaignCol} is null and ${p.didCol} is null) unattributed, count(*) filter (where ${p.creativeCol} is null) no_creative from ${p.table} where client_id = '${c.id}'`,
              dedupe_key: dedupeKey('attribution_gap', c.id),
            });
          }
        }
      }

      expectationReport.push({
        client: c.name, engagement_type: engagement,
        expected_sources: expected,
        present: presentSources.map((s) => ({ source: s.token, table: s.probe.table, latest: s.latest })),
        missing: missingSources,
      });
    }

    // Sync logs — failures in the last 24 hours, per client and agency-wide.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: ctxFails } = await supabase.from('context_sync_log')
      .select('source, client_id, status, error_message, last_sync_at')
      .neq('status', 'success').gte('last_sync_at', since);
    for (const row of (ctxFails ?? []) as any[]) {
      const key = `context_sync_failure:${row.source}`;
      findings.push({
        check_key: key, client_id: row.client_id ?? null, priority: 'high',
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
        check_key: key, client_id: row.client_id ?? null, priority: 'high',
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

    const suppressedByClient: Record<string, number> = {};
    for (const s of suppressed) suppressedByClient[String(s.client)] = (suppressedByClient[String(s.client)] ?? 0) + 1;

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
          check_key: f.check_key, priority: f.priority, expected: f.expected, found: f.found, proof: f.proof,
          client_name: f.client_name, detected_at: new Date().toISOString(), dedupe_key: f.dedupe_key,
        },
        raw_text: [
          f.title, '',
          `Check: ${f.check_key}`,
          `Priority: ${f.priority}`,
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

    const order = { urgent: 0, high: 1, normal: 2 } as const;
    const sorted = [...active].sort((a, b) => order[a.priority] - order[b.priority]);

    return json({
      success: true,
      dry_run: dryRun,
      eastern: `${et.weekday} ${et.hour}:${String(et.minute).padStart(2, '0')} ET`,
      clients_checked: (clients ?? []).length,
      findings_total: active.length,
      by_check: byCheck,
      urgent: sorted.filter((f) => f.priority === 'urgent').map((f) => f.title),
      findings: sorted.map((f) => ({
        check_key: f.check_key, client: f.client_name, priority: f.priority, title: f.title,
        expected: f.expected, found: f.found, dedupe_key: f.dedupe_key,
      })),
      expectations: expectationReport,
      suppressed_by_exception: suppressed,
      suppressed_count_by_client: suppressedByClient,
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
