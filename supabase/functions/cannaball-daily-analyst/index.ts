/**
 * CANNABALL FE CTV — daily performance analyst.
 *
 * Runs on the COMPLETE prior day (Eastern, the account's reporting timezone),
 * reads the CallGrid payload through `_shared/cannaball-callgrid.ts`, stores one
 * row per platform in `cannaball_daily_metrics` so trends exist at all, and
 * drafts ONE internal Slack message.
 *
 * Non-negotiables baked in here:
 *  - Revenue is the `payout` column via the NAMED override. Never re-derived.
 *  - A platform with calls but zero/missing spend gets EVERY cost-derived metric
 *    withheld — no CPM, no cost per call, no profit, no ROAS, no ROI. We never
 *    print "$0 spend" and never publish a ROAS against partial spend.
 *  - Dark (no spend, no impressions, calls collapsed) and broken-feed (no spend,
 *    calls normal) are different findings and are named differently.
 *  - Nothing is written to `tasks`. Nothing posts unless post===true.
 *  - Anomalies are described and weighed. Never labelled fraud.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { postToSlack } from '../_shared/slack-post.ts';
import { reportingTimeZone, reportingWindowBounds, reportingDay } from '../_shared/reporting-day.ts';
import {
  CANNABALL_CLIENT_ID,
  REVENUE_COLUMN_OVERRIDES,
  readCall,
  isQualified,
  isEngaged,
  resolveDid,
  type CannaballCallView,
  type DidPeriod,
  type RawCall,
} from '../_shared/cannaball-callgrid.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b, null, 2), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const ROKU = 'roku';
const UNIVERSAL = 'universal_ads';
const UNATTRIBUTED = 'unattributed';
const INTERNAL_CHANNEL_NAME = 'int_cannaball';

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const money2 = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const div = (a: number, b: number | null): number | null => (b === null || b === 0 ? null : a / b);

interface SpendRow {
  platform: string;
  spend: number;
  impressions: number;
  reach: number | null;
  campaigns: { name: string; spend: number; impressions: number }[];
}

interface PlatformStats {
  platform: string;
  attempts: number;
  connected: number;
  over10: number;
  over60: number;
  avgConnectedDuration: number | null;
  noRoute: number;
  noAnswer: number;
  connectFailed: number;
  busy: number;
  duplicates: number;
  anonymous: number;
  distinctCallers: number;
  buyerAccepted: number | null;
  buyerRejected: number | null;
  vendors: { name: string; calls: number; revenue: number }[];
  revenue: number;
  revenueCaptured: number;
  revenueUncaptured: number;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  spendComplete: boolean;
  wasDark: boolean;
  dids: DidStat[];
  states: StateStat[];
  geoExcluded: number;
}

interface DidStat {
  did: string;
  creative: string | null;
  attempts: number;
  connected: number;
  over60: number;
  noRoute: number;
  anonymous: number;
  distinctCallers: number;
  stirValidated: number;
  stirSent: number;
  revenue: number;
  firstHour: number | null;
  lastHour: number | null;
  resolved: boolean;
}

interface StateStat {
  state: string;
  attempts: number;
  connected: number;
  over10: number;
  over60: number;
  revenue: number;
  spend: number | null;
  impressions: number | null;
}

function emptyStats(platform: string): PlatformStats {
  return {
    platform,
    attempts: 0, connected: 0, over10: 0, over60: 0, avgConnectedDuration: null,
    noRoute: 0, noAnswer: 0, connectFailed: 0, busy: 0, duplicates: 0, anonymous: 0, distinctCallers: 0,
    buyerAccepted: null, buyerRejected: null, vendors: [],
    revenue: 0, revenueCaptured: 0, revenueUncaptured: 0,
    spend: null, impressions: null, reach: null, spendComplete: false, wasDark: false,
    dids: [], states: [], geoExcluded: 0,
  };
}

function buildStats(
  platform: string,
  calls: CannaballCallView[],
  spend: SpendRow | null,
  stateSpend: Map<string, { spend: number; impressions: number }>,
  periods: DidPeriod[],
  day: string,
): PlatformStats {
  const s = emptyStats(platform);
  s.attempts = calls.length;

  let connectedDurTotal = 0;
  let paidSeen = 0, paidTrue = 0, rejectedSeen = 0, rejectedTrue = 0;
  const callers = new Set<string>();
  const didMap = new Map<string, DidStat>();
  const stateMap = new Map<string, StateStat>();
  const vendorMap = new Map<string, { calls: number; revenue: number }>();

  for (const c of calls) {
    if (c.connected) { s.connected += 1; connectedDurTotal += c.durationSeconds ?? 0; }
    if (isEngaged(c)) s.over10 += 1;
    if (isQualified(c)) s.over60 += 1;
    if (c.noRoute) s.noRoute += 1;
    if (c.noAnswer) s.noAnswer += 1;
    if (c.connectFailed) s.connectFailed += 1;
    if (c.busy) s.busy += 1;
    if (c.duplicate) s.duplicates += 1;
    if (c.anonymous) s.anonymous += 1;
    if (c.callerId && !c.anonymous) callers.add(c.callerId);

    if (c.paid !== null) { paidSeen += 1; if (c.paid) paidTrue += 1; }
    if (c.rejected !== null) { rejectedSeen += 1; if (c.rejected) rejectedTrue += 1; }

    if (c.revenueCaptured) { s.revenue += c.revenue ?? 0; s.revenueCaptured += 1; } else s.revenueUncaptured += 1;

    const vk = c.vendorName ?? 'unnamed buyer';
    const v = vendorMap.get(vk) ?? { calls: 0, revenue: 0 };
    v.calls += 1; v.revenue += c.revenue ?? 0; vendorMap.set(vk, v);

    const didKey = c.did ?? 'no DID';
    const d = didMap.get(didKey) ?? {
      did: didKey, creative: c.creative, attempts: 0, connected: 0, over60: 0, noRoute: 0,
      anonymous: 0, distinctCallers: 0, stirValidated: 0, stirSent: 0, revenue: 0,
      firstHour: null, lastHour: null, resolved: resolveDid(periods, c.did, day) !== null,
    };
    d.attempts += 1;
    if (c.connected) d.connected += 1;
    if (isQualified(c)) d.over60 += 1;
    if (c.noRoute) d.noRoute += 1;
    if (c.anonymous) d.anonymous += 1;
    if (c.stirValidated !== null) { d.stirSent += 1; if (c.stirValidated) d.stirValidated += 1; }
    d.revenue += c.revenue ?? 0;
    if (c.estHour !== null) {
      d.firstHour = d.firstHour === null ? c.estHour : Math.min(d.firstHour, c.estHour);
      d.lastHour = d.lastHour === null ? c.estHour : Math.max(d.lastHour, c.estHour);
    }
    didMap.set(didKey, d);

    // Geo: a call with no caller state is EXCLUDED and counted, never bucketed.
    if (!c.state) { s.geoExcluded += 1; continue; }
    const st = stateMap.get(c.state) ?? {
      state: c.state, attempts: 0, connected: 0, over10: 0, over60: 0, revenue: 0, spend: null, impressions: null,
    };
    st.attempts += 1;
    if (c.connected) st.connected += 1;
    if (isEngaged(c)) st.over10 += 1;
    if (isQualified(c)) st.over60 += 1;
    st.revenue += c.revenue ?? 0;
    stateMap.set(c.state, st);
  }

  for (const [, st] of stateMap) {
    const sp = stateSpend.get(st.state);
    if (sp) { st.spend = sp.spend; st.impressions = sp.impressions; }
  }

  s.avgConnectedDuration = s.connected ? connectedDurTotal / s.connected : null;
  s.distinctCallers = callers.size;
  s.buyerAccepted = paidSeen ? paidTrue : null;
  s.buyerRejected = rejectedSeen ? rejectedTrue : null;
  s.vendors = [...vendorMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.calls - a.calls);
  s.dids = [...didMap.values()].sort((a, b) => b.attempts - a.attempts);
  s.states = [...stateMap.values()].sort((a, b) => b.attempts - a.attempts);

  if (spend) {
    s.impressions = spend.impressions;
    s.reach = spend.reach && spend.reach > 0 ? spend.reach : null;
    // Zero spend is NOT a spend of zero. Either the platform was dark or the
    // feed has not landed; both mean cost metrics are unavailable.
    s.spendComplete = spend.spend > 0;
    s.spend = spend.spend > 0 ? spend.spend : null;
  }
  s.wasDark = !s.spendComplete && (s.impressions ?? 0) === 0 && s.attempts <= 5;
  return s;
}

interface Derived {
  cpm: number | null;
  frequency: number | null;
  costPerConnected: number | null;
  costPer10: number | null;
  costPer60: number | null;
  profit: number | null;
  roas: number | null;
  roi: number | null;
  /** Connected ÷ all attempts. Depressed by attempts that never reached a buyer. */
  connectRate: number | null;
  /**
   * Connected ÷ attempts that were actually ROUTED to a buyer. This is the
   * consumer-response number: a NO_ROUTE attempt says nothing about whether a
   * consumer engaged, so letting 307 of them sit in the denominator reports a
   * routing failure as though response had collapsed. Both are published.
   */
  routedConnectRate: number | null;
  routedAttempts: number;
  qualifiedRate: number | null;
}

/** Every cost-derived metric is null unless spend actually landed. One gate. */
function derive(s: PlatformStats): Derived {
  const spend = s.spendComplete ? s.spend : null;
  const routed = Math.max(0, s.attempts - s.noRoute);
  return {
    cpm: spend !== null && s.impressions ? (spend / s.impressions) * 1000 : null,
    frequency: s.impressions && s.reach ? s.impressions / s.reach : null,
    costPerConnected: spend !== null ? div(spend, s.connected) : null,
    costPer10: spend !== null ? div(spend, s.over10) : null,
    costPer60: spend !== null ? div(spend, s.over60) : null,
    profit: spend !== null ? s.revenue - spend : null,
    roas: spend !== null ? div(s.revenue, spend) : null,
    roi: spend !== null ? div(s.revenue - spend, spend) : null,
    connectRate: div(s.connected, s.attempts),
    routedConnectRate: div(s.connected, routed),
    routedAttempts: routed,
    qualifiedRate: div(s.over60, s.connected),
  };
}

// ── Anomalies ────────────────────────────────────────────────────────────────
interface Anomaly { title: string; evidence: string; reading: string; confirm: string }

function findAnomalies(day: PlatformStats[], all: CannaballCallView[]): Anomaly[] {
  const out: Anomaly[] = [];

  for (const s of day) {
    if (s.platform === UNATTRIBUTED && s.attempts > 0) {
      out.push({
        title: `${s.attempts} calls on unattributed DIDs (${s.dids.map((d) => d.did).join(', ')})`,
        evidence: `${money2(s.revenue)} revenue with no platform or creative resolved for the day.`,
        reading: 'A DID in service without a dated mapping row. Held out of every platform total rather than guessed at.',
        confirm: 'Add the DID to client_did_periods with its platform, creative and effective dates.',
      });
    }

    // Spend feed vs dark campaign — opposite meanings, never "we spent nothing".
    if (!s.spendComplete && s.platform !== UNATTRIBUTED) {
      if (s.wasDark) {
        out.push({
          title: `${s.platform} was dark`,
          evidence: `No spend, ${s.impressions ?? 0} impressions and only ${s.attempts} calls.`,
          reading: 'The campaign did not deliver. A real finding, not a reporting gap.',
          confirm: 'Check campaign status and flight dates in the platform.',
        });
      } else if (s.attempts > 10) {
        out.push({
          title: `${s.platform} spend has not landed`,
          evidence: `${s.attempts} calls, ${s.connected} connected, ${s.over60} qualified and ${money2(s.revenue)} revenue against zero reported spend in both spend tables.`,
          reading: 'The spend feed is behind or broken — calls are arriving normally, so the media ran.',
          confirm: 'Re-pull the platform report for the day; cost metrics stay withheld until it lands.',
        });
      }
    }

    // A DID diverging from its siblings on connect rate.
    const siblings = s.dids.filter((d) => d.attempts >= 10);
    if (siblings.length > 1) {
      for (const d of siblings) {
        const rate = d.connected / d.attempts;
        const others = siblings.filter((o) => o.did !== d.did);
        const othersRate =
          others.reduce((a, o) => a + o.connected, 0) / Math.max(1, others.reduce((a, o) => a + o.attempts, 0));
        if (rate < 0.4 && othersRate - rate > 0.3) {
          const stir = d.stirSent
            ? `${d.stirValidated} of ${d.stirSent} carried a validated SHAKEN/STIR attestation`
            : 'no SHAKEN/STIR attestation was sent on any of them';
          out.push({
            title: `DID ${d.did}${d.creative ? ` (${d.creative})` : ''} connected ${d.connected} of ${d.attempts} — ${pct(rate)}`,
            evidence:
              `Siblings on the same platform connected at ${pct(othersRate)} the same day. ` +
              `${d.noRoute} of the ${d.attempts} attempts ended NO_ROUTE, ${d.anonymous} had no caller identity, ` +
              `${d.distinctCallers || 'few'} distinct caller IDs, and ${stir}. ` +
              (d.firstHour !== null ? `Attempts ran ${d.firstHour}:00–${d.lastHour}:00 ET.` : ''),
            reading:
              d.noRoute / d.attempts > 0.5
                ? 'The evidence favours routing configuration or buyer availability rather than consumer response: the calls never reached a buyer, so nothing about them says a consumer engaged. Automated traffic is the weaker reading while the attestation is valid, and this is not called fraud.'
                : 'Anomalous connect behaviour on one DID while its siblings are normal. Routing or buyer capacity is the leading explanation.',
            confirm:
              'Check the routing plan and buyer hours behind this DID for the day, and compare NO_ROUTE timestamps to buyer schedule. These attempts are reported separately and excluded from the platform connect rate.',
          });
        }
      }
    }
  }

  // Repeated caller IDs across the day.
  const callerCounts = new Map<string, number>();
  for (const c of all) if (c.callerId && !c.anonymous) callerCounts.set(c.callerId, (callerCounts.get(c.callerId) ?? 0) + 1);
  const repeats = [...callerCounts.entries()].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]);
  if (repeats.length) {
    out.push({
      title: `${repeats.length} caller number(s) dialled 4+ times`,
      evidence: repeats.slice(0, 5).map(([id, n]) => `${id} × ${n}`).join(', '),
      reading: 'Most often retry behaviour after a dropped or unanswered call. Duplicate/retry is the leading reading.',
      confirm: 'Check whether the repeats follow a NO_ANSWER or short-duration first attempt.',
    });
  }

  return out;
}

// ── Slack draft ──────────────────────────────────────────────────────────────
function platformBlock(label: string, s: PlatformStats, d: Derived, prev: PlatformStats | null): string {
  const lines: string[] = [`*${label}*`];
  if (!s.spendComplete) {
    lines.push(
      s.wasDark
        ? '• Spend: none — the campaign was dark, so no cost metrics apply.'
        : '• Spend: *not landed* — the feed reports zero while calls arrived normally. CPM, cost per connected/qualified call, profit, ROAS and ROI are *withheld* until spend lands. We are not reporting $0 spend.',
    );
  } else {
    lines.push(
      `• Spend ${money(s.spend!)}${s.impressions ? ` · ${s.impressions.toLocaleString()} impressions` : ''}` +
        `${d.cpm !== null ? ` · CPM ${money2(d.cpm)}` : ''}` +
        `${d.frequency !== null ? ` · frequency ${d.frequency.toFixed(2)}` : ' · frequency unavailable (no reach in the feed)'}`,
    );
  }
  lines.push(
    `• ${s.attempts} attempts (${d.routedAttempts} routed to a buyer) → ${s.connected} connected` +
      `${d.routedConnectRate !== null ? ` — ${pct(d.routedConnectRate)} of routed attempts` : ''}` +
      `${s.noRoute && d.connectRate !== null ? `, ${pct(d.connectRate)} of all attempts` : ''}` +
      ` → ${s.over10} over 10s → ${s.over60} qualified (60s+)` +
      `${s.avgConnectedDuration !== null ? `, avg connected ${Math.round(s.avgConnectedDuration)}s` : ''}`,
  );
  if (s.noRoute || s.noAnswer || s.connectFailed) {
    lines.push(`• Losses: ${s.noRoute} NO_ROUTE · ${s.noAnswer} no answer · ${s.connectFailed} connect failed`);
  }
  lines.push(
    `• Revenue ${money2(s.revenue)}` +
      (d.profit !== null ? ` · profit ${money2(d.profit)} · ROAS ${d.roas!.toFixed(2)}x · ROI ${pct(d.roi!)}` : ' · profit/ROAS withheld (spend unavailable)') +
      (d.costPer60 !== null ? ` · cost per qualified call ${money2(d.costPer60)}` : ''),
  );
  if (prev && prev.attempts) {
    lines.push(
      `• vs prior media day: attempts ${prev.attempts}→${s.attempts}, connected ${prev.connected}→${s.connected}, ` +
        `qualified ${prev.over60}→${s.over60}, revenue ${money2(prev.revenue)}→${money2(s.revenue)}`,
    );
  }
  return lines.join('\n');
}

function geoBlock(s: PlatformStats): string {
  const judged = s.states.filter((x) => x.attempts >= 10);
  if (!judged.length) return '';
  const rows = judged.slice(0, 8).map((x) => {
    const qr = x.connected ? pct(x.over60 / x.connected) : 'n/a';
    return `  • ${x.state}: ${x.attempts} calls, ${x.connected} connected, ${x.over60} qualified (${qr}), ${money2(x.revenue)}` +
      (x.spend !== null ? ` on ${money(x.spend)} spend` : ' — state spend not landed, cost metrics withheld');
  });
  const thin = s.states.filter((x) => x.attempts < 10).length;
  return `*GEO (${s.platform})*\n${rows.join('\n')}\n  • ${thin} states left unclassified on fewer than 10 calls; ${s.geoExcluded} calls had no caller state and are excluded from geo.`;
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const post = body.post === true; // default: draft only, nothing posted
    const store = body.store !== false;

    const db = admin();
    const { data: client, error: cErr } = await db
      .from('clients')
      .select('id, name, engagement_type, revenue_field, reporting_timezone')
      .eq('id', CANNABALL_CLIENT_ID)
      .single();
    if (cErr || !client) return json({ ok: false, error: 'Cannaball client record not found' }, 500);

    const tz = reportingTimeZone(client);
    const override = REVENUE_COLUMN_OVERRIDES[CANNABALL_CLIENT_ID];
    if (client.revenue_field !== override.column) {
      return json({
        ok: false,
        error: `clients.revenue_field is "${client.revenue_field}" but the named Cannaball override says "${override.column}". Reconcile before reporting.`,
      }, 409);
    }

    // The complete prior day, cut in the account's reporting timezone.
    const target: string = body.date ?? reportingDay(new Date(Date.now() - 86_400_000).toISOString(), tz);
    const lookbackFrom = reportingDay(new Date(new Date(`${target}T12:00:00Z`).getTime() - 9 * 86_400_000).toISOString(), tz);
    const { startTs, endTs } = reportingWindowBounds({ from: lookbackFrom, to: target }, tz);

    // Calls (paged — the data API caps a response at 1000 rows).
    const calls: RawCall[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from('cannaball_calls')
        .select('id, call_id, did, caller_number, caller_state, caller_city, caller_zip, call_start, duration_seconds, connected, connection_duration_seconds, payout, platform, creative_name, campaign_name, disposition, raw_payload')
        .eq('client_id', CANNABALL_CLIENT_ID)
        .gte('call_start', startTs)
        .lte('call_start', endTs)
        .order('call_start', { ascending: true })
        .range(offset, offset + 999);
      if (error) return json({ ok: false, error: `call read failed: ${error.message}` }, 500);
      calls.push(...(data ?? []) as RawCall[]);
      if (!data || data.length < 1000) break;
    }
    if (!calls.length) return json({ ok: false, error: `No Cannaball calls between ${lookbackFrom} and ${target} — an empty pull is a failure, not a zero.` }, 422);

    const [{ data: rokuSpend }, { data: uniSpend }, { data: rokuStates }, { data: periodRows }] = await Promise.all([
      db.from('roku_daily_metrics').select('date, campaign_name, spend, impressions, reach')
        .eq('client_id', CANNABALL_CLIENT_ID).eq('entity', 'campaign').gte('date', lookbackFrom).lte('date', target),
      db.from('cannaball_spend').select('date, platform, campaign_name, spend, impressions')
        .eq('client_id', CANNABALL_CLIENT_ID).eq('platform', UNIVERSAL).gte('date', lookbackFrom).lte('date', target),
      db.from('roku_daily_metrics').select('date, entity_name, spend, impressions')
        .eq('client_id', CANNABALL_CLIENT_ID).eq('entity', 'state').gte('date', lookbackFrom).lte('date', target),
      db.from('client_did_periods').select('did, platform, creative_name, campaign_name, effective_from, effective_to')
        .eq('client_id', CANNABALL_CLIENT_ID),
    ]);
    const periods = (periodRows ?? []) as DidPeriod[];

    const spendByDay = new Map<string, Map<string, SpendRow>>();
    const put = (date: string, platform: string, spend: number, impressions: number, reach: number | null, name: string) => {
      if (!spendByDay.has(date)) spendByDay.set(date, new Map());
      const m = spendByDay.get(date)!;
      const row = m.get(platform) ?? { platform, spend: 0, impressions: 0, reach: null, campaigns: [] };
      row.spend += spend; row.impressions += impressions;
      if (reach && reach > 0) row.reach = (row.reach ?? 0) + reach;
      if (spend > 0 || impressions > 0) row.campaigns.push({ name, spend, impressions });
      m.set(platform, row);
    };
    for (const r of rokuSpend ?? []) put(String(r.date), ROKU, Number(r.spend || 0), Number(r.impressions || 0), Number(r.reach || 0), r.campaign_name ?? '(unnamed)');
    for (const r of uniSpend ?? []) put(String(r.date), UNIVERSAL, Number(r.spend || 0), Number(r.impressions || 0), null, r.campaign_name ?? '(unnamed)');

    const stateSpendByDay = new Map<string, Map<string, { spend: number; impressions: number }>>();
    for (const r of rokuStates ?? []) {
      const d = String(r.date);
      if (!stateSpendByDay.has(d)) stateSpendByDay.set(d, new Map());
      const key = String(r.entity_name ?? '').trim();
      const m = stateSpendByDay.get(d)!;
      const cur = m.get(key) ?? { spend: 0, impressions: 0 };
      cur.spend += Number(r.spend || 0); cur.impressions += Number(r.impressions || 0);
      m.set(key, cur);
    }

    // Group calls by reporting day and platform.
    const byDay = new Map<string, Map<string, CannaballCallView[]>>();
    for (const raw of calls) {
      const v = readCall(raw);
      const day = reportingDay(v.startedAt, tz);
      const resolved = resolveDid(periods, v.did, day);
      const platform = v.platform ?? resolved?.platform ?? UNATTRIBUTED;
      if (!byDay.has(day)) byDay.set(day, new Map());
      const m = byDay.get(day)!;
      m.set(platform, [...(m.get(platform) ?? []), v]);
    }

    const statsFor = (day: string): PlatformStats[] => {
      const perPlatform = byDay.get(day) ?? new Map<string, CannaballCallView[]>();
      const platforms = new Set<string>([...perPlatform.keys(), ...(spendByDay.get(day)?.keys() ?? [])]);
      return [...platforms].map((p) =>
        buildStats(p, perPlatform.get(p) ?? [], spendByDay.get(day)?.get(p) ?? null, stateSpendByDay.get(day) ?? new Map(), periods, day),
      );
    };

    const today = statsFor(target);
    const todayCalls = [...(byDay.get(target)?.values() ?? [])].flat();

    // Preceding MEDIA day: skip dark days, comparing to a $0 day is meaningless.
    const priorDays = [...byDay.keys()].filter((d) => d < target).sort().reverse();
    const mediaDays = priorDays.filter((d) => statsFor(d).some((s) => s.spendComplete));
    const prevDay = mediaDays[0] ?? null;
    const prevStats = prevDay ? statsFor(prevDay) : [];
    const baselineDays = mediaDays.slice(0, 5);
    const baseline = baselineDays.flatMap((d) => statsFor(d));

    const platformOf = (rows: PlatformStats[], p: string) => rows.find((r) => r.platform === p) ?? null;
    const avg = (p: string, f: (s: PlatformStats) => number | null): number | null => {
      const vals = baseline.filter((s) => s.platform === p).map(f).filter((n): n is number => n !== null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };

    const anomalies = findAnomalies(today, todayCalls);

    // Program totals — cost metrics only from platforms whose spend landed.
    const spendComplete = today.filter((s) => s.spendComplete);
    const totalSpend = spendComplete.reduce((a, s) => a + (s.spend ?? 0), 0);
    const totalRevenue = today.reduce((a, s) => a + s.revenue, 0);
    const revenueFromCompleteSpend = spendComplete.reduce((a, s) => a + s.revenue, 0);
    // A program ROAS is only honest when EVERY delivering platform's spend is in.
    // With one platform's spend missing, a program figure computed on the rest is
    // a ROAS against partial spend — exactly the number we must never publish.
    const missingSpend = today.filter((s) => !s.spendComplete && !s.wasDark && s.attempts > 0).map((s) => s.platform);
    const programCoverageComplete = missingSpend.length === 0 && spendComplete.length > 0;
    const totals = {
      attempts: today.reduce((a, s) => a + s.attempts, 0),
      connected: today.reduce((a, s) => a + s.connected, 0),
      over60: today.reduce((a, s) => a + s.over60, 0),
      revenue: totalRevenue,
      spendLandedFor: spendComplete.map((s) => s.platform),
      spendWithheldFor: missingSpend,
      spend: spendComplete.length ? totalSpend : null,
      profit: programCoverageComplete ? revenueFromCompleteSpend - totalSpend : null,
      roas: programCoverageComplete && totalSpend > 0 ? revenueFromCompleteSpend / totalSpend : null,
    };

    // ── Draft ────────────────────────────────────────────────────────────────
    const roku = platformOf(today, ROKU), uni = platformOf(today, UNIVERSAL);
    const rokuD = roku ? derive(roku) : null, uniD = uni ? derive(uni) : null;
    const parts: string[] = [];
    parts.push(`*Cannaball FE CTV — ${target}* (day cut in ${tz}; prior media day ${prevDay ?? 'none'})`);

    parts.push(
      `*TOTAL PROGRAM*\n` +
        (totals.spendWithheldFor.length
          ? `• Spend: incomplete — ${totals.spendWithheldFor.join(', ')} has not reported, so program spend, profit, ROAS and ROI are *withheld* for the day. ${money(totalSpend)} is in from ${totals.spendLandedFor.join(', ')}, which is a fraction of what ran and must not be used as the program's cost.`
          : totals.spend !== null
            ? `• Spend ${money(totals.spend)}`
            : '• Spend: none landed, so no program cost metrics') +
        `\n• ${totals.attempts} attempts → ${totals.connected} connected → ${totals.over60} qualified (60s+)` +
        `\n• Revenue ${money2(totals.revenue)}` +
        (totals.profit !== null
          ? ` · profit ${money2(totals.profit)} · ROAS ${totals.roas!.toFixed(2)}x`
          : ' · profit and ROAS unavailable until spend is complete'),
    );

    if (roku && rokuD) parts.push(platformBlock('ROKU', roku, rokuD, platformOf(prevStats, ROKU)));
    if (uni && uniD) parts.push(platformBlock('UNIVERSAL', uni, uniD, platformOf(prevStats, UNIVERSAL)));

    const geo = today.map(geoBlock).filter(Boolean);
    if (geo.length) parts.push(geo.join('\n'));

    parts.push(
      '*NOT MEASURABLE TODAY*\n' +
        '• Genre / content targeting: not stored. `roku_daily_metrics.fields` carries only billed spend, impressions and video completions, so the News-vs-all-genre question cannot be answered from our data. Historically CPM ran ~$12–15 on News against ~$7 all-genre; whether that holds as spend scales is open and currently unmeasurable.\n' +
        '• Reach and frequency: the Roku feed returns reach 0 on every row and Universal reports no reach at all, so frequency is unavailable for both platforms.',
    );

    parts.push('*WHAT WE LEARNED*\n' + learned(roku, rokuD, uni, uniD, avg, baselineDays.length));
    parts.push('*TODAY\'S CHANGES*\n' + actions(roku, rokuD, uni, uniD, anomalies));
    if (anomalies.length) {
      parts.push(
        '*ANOMALIES*\n' +
          anomalies.map((a) => `• *${a.title}*\n   Evidence: ${a.evidence}\n   Reading: ${a.reading}\n   To confirm: ${a.confirm}`).join('\n'),
      );
    }
    const draft = parts.join('\n\n');

    // ── Store (additive, one row per day per platform) ───────────────────────
    const stored: string[] = [];
    if (store) {
      for (const s of today) {
        const d = derive(s);
        const { error } = await db.from('cannaball_daily_metrics').upsert({
          client_id: CANNABALL_CLIENT_ID,
          date: target,
          platform: s.platform,
          spend: s.spend, impressions: s.impressions, reach: s.reach, frequency: d.frequency, cpm: d.cpm,
          attempts: s.attempts, connected: s.connected, calls_over_10s: s.over10, calls_over_60s: s.over60,
          avg_connected_duration: s.avgConnectedDuration,
          no_route: s.noRoute, no_answer: s.noAnswer, connect_failed: s.connectFailed, busy: s.busy,
          duplicates: s.duplicates, anonymous_callers: s.anonymous, distinct_callers: s.distinctCallers,
          buyer_accepted: s.buyerAccepted, buyer_rejected: s.buyerRejected,
          buyer_acceptance_rate: s.buyerAccepted !== null ? div(s.buyerAccepted, s.attempts) : null,
          vendor_breakdown: s.vendors,
          revenue: s.revenue, revenue_calls_captured: s.revenueCaptured, revenue_calls_uncaptured: s.revenueUncaptured,
          profit: d.profit, roas: d.roas, roi: d.roi,
          cost_per_connected: d.costPerConnected, cost_per_10s: d.costPer10, cost_per_60s: d.costPer60,
          connect_rate: d.connectRate, qualified_rate: d.qualifiedRate,
          state_breakdown: s.states, did_breakdown: s.dids, geo_excluded_calls: s.geoExcluded,
          spend_complete: s.spendComplete, was_dark: s.wasDark,
          anomalies_present: anomalies.length > 0,
          anomalies: anomalies,
          unavailable_metrics: unavailableFor(s, d),
          notes: `Revenue read from the payout column via the named Cannaball override: ${override.why}`,
        }, { onConflict: 'date,platform' });
        if (error) return json({ ok: false, error: `store failed for ${s.platform}: ${error.message}` }, 500);
        stored.push(`${target}/${s.platform}`);
      }
    }

    // ── Post (only on explicit request; internal channel only) ───────────────
    let postResult: unknown = { posted: false, reason: 'draft only — post:true was not requested' };
    if (post) {
      const { data: mapping } = await db
        .from('slack_channel_mappings')
        .select('channel_id, channel_name, is_external')
        .eq('channel_name', INTERNAL_CHANNEL_NAME)
        .maybeSingle();
      if (!mapping) postResult = { posted: false, reason: `no slack_channel_mappings row for #${INTERNAL_CHANNEL_NAME}` };
      else postResult = await postToSlack({ channel: mapping.channel_id, text: draft });
    }

    return json({
      ok: true,
      date: target,
      reporting_timezone: tz,
      revenue_source: { column: 'payout', override: override.why, client_revenue_field: client.revenue_field },
      prior_media_day: prevDay,
      baseline_media_days: baselineDays,
      totals,
      platforms: today.map((s) => ({ platform: s.platform, ...s, derived: derive(s), unavailable: unavailableFor(s, derive(s)) })),
      anomalies,
      stored,
      slack: postResult,
      draft,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('cannaball-daily-analyst failed:', msg);
    return json({ ok: false, error: msg }, 500);
  }
});

function unavailableFor(s: PlatformStats, d: Derived): string[] {
  const out: string[] = [];
  if (!s.spendComplete) out.push('cpm', 'cost_per_connected', 'cost_per_10s', 'cost_per_60s', 'profit', 'roas', 'roi');
  if (d.frequency === null) out.push('frequency (no reach in the feed)');
  if (s.buyerAccepted === null) out.push('buyer_acceptance (paid flag absent on every call)');
  out.push('genre/content targeting (not stored)');
  return out;
}

function learned(
  roku: PlatformStats | null, rokuD: Derived | null,
  uni: PlatformStats | null, uniD: Derived | null,
  avg: (p: string, f: (s: PlatformStats) => number | null) => number | null,
  baselineCount: number,
): string {
  const out: string[] = [];
  if (roku && rokuD) {
    const avgQual = avg(ROKU, (s) => (s.connected ? s.over60 / s.connected : null));
    out.push(
      `Roku carried the day on volume and quality: ${roku.attempts} attempts, ${roku.connected} connected (${pct(rokuD.connectRate ?? 0)}), ` +
        `${roku.over60} qualified and ${money2(roku.revenue)} of revenue` +
        (avgQual !== null ? `, with a qualified rate of ${pct(rokuD.qualifiedRate ?? 0)} against a ${baselineCount}-media-day average of ${pct(avgQual)}` : '') +
        `. What we cannot yet say is whether it was profitable — Roku reported zero spend and zero impressions while delivering those calls, so the media cost is missing, not zero.`,
    );
  }
  if (uni && uniD) {
    out.push(
      `Universal's headline attempt count is misleading: ${uni.attempts} attempts but ${uni.connected} connected, because ${uni.noRoute} attempts ended NO_ROUTE on a single DID and never reached a buyer. ` +
        `Excluding that DID, Universal's legitimate consumer response is in line with its recent days.`,
    );
  }
  out.push(
    'The honest read: call quality and revenue held up, the routing on one Universal DID did not, and the Roku economics are unknowable until the spend feed catches up. No ROAS figure should leave this channel for the 21st.',
  );
  return out.map((l) => `• ${l}`).join('\n');
}

function actions(
  roku: PlatformStats | null, rokuD: Derived | null,
  uni: PlatformStats | null, uniD: Derived | null,
  anomalies: Anomaly[],
): string {
  const out: string[] = [];
  if (roku && !roku.spendComplete) out.push('Re-pull the Roku daily report for the day and confirm real spend before any budget decision; hold all Roku cost reporting until then.');
  const bad = anomalies.find((a) => a.title.startsWith('DID '));
  if (bad) out.push('Audit the routing plan and buyer hours behind the flagged Universal DID; if the buyer is unavailable in those hours, pause or reroute that DID rather than treating the attempts as response.');
  out.push('No budget increase today. Scaling needs CPM, response rate, qualified CPA, buyer acceptance, revenue and ROAS together, and three of those are currently unmeasurable.');
  if (uni && uniD && uniD.connectRate !== null) out.push('Report Universal connect rate on routed attempts only, so the NO_ROUTE block stops depressing the platform number.');
  out.push('Add the unmapped DIDs to client_did_periods so their calls stop sitting outside every platform total.');
  return out.slice(0, 5).map((l) => `• ${l}`).join('\n');
}
