// CANONICAL METRICS — one place that knows what each number means per account.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: absent is not zero. Where a call's
// revenue was never captured (revenue_captured = false, or a webhook_minimal
// payload shape), the call still counts as a call, but NO revenue, profit or
// margin figure is published for a window containing it. The metric's value is
// null and its note states the coverage. A caller — including a language model
// reading these metrics — cannot obtain a revenue total that silently treats
// uncaptured rows as $0, because the number is not there to quote.
//
// Money field per account comes from _shared/client-revenue.ts:
//   performance_media → `revenue` (CPM buys the media; profit = revenue − spend,
//                        downside capped at media spend)
//   pay_per_call      → `payout`  (CPM is the publisher)
//   anything else     → no money field; revenue is not applicable, and said so.
//
// @see docs/media-brain/01_Decision_Engine.md §7

import { revenueFieldForClient, resolveClientRevenue } from './client-revenue.ts';
import type { ResolvedClientRow } from './client-resolve.ts';
import { reportingTimeZone, reportingWindowBounds, reportingDay, reportingDayNote } from './reporting-day.ts';
import {
  createPublisherFilter, loadPublisherScopes, publisherColumns, readPublisher,
  type PublisherFilterSummary,
} from './publisher-scope.ts';

export interface Metric {
  key: string;
  label: string;
  /** null means UNKNOWN — never render it as zero. */
  value: number | null;
  /** Slack-ready rendering, already "unknown" where the value is null. */
  display: string;
  /** Coverage / confidence. Always populated. */
  note: string;
  /** Which tables produced it. */
  sources: string[];
}

export interface ClientMetrics {
  clientId: string;
  clientName: string;
  engagementType: string | null;
  window: { from: string; to: string };
  metrics: Metric[];
  metricsUsed: string[];
  /** True when any row in the window lacked captured revenue. */
  hadUncapturedData: boolean;
  callSources: string[];
  spendSources: string[];
  /** Plain-language warnings the answer must carry. */
  caveats: string[];
  economicsNote: string | null;
  /** A compact block for the model prompt. */
  promptBlock: string;
  /**
   * The same figures, one row per calendar day of the window (reporting timezone).
   * Each day's spend / calls / revenue equals what this function returns for that
   * day alone — metricAgreement.test.ts holds that. The daily update reads these
   * rows instead of counting calls itself.
   */
  days: DayFigures[];
}

export const DURATION_BANDS = [['d10', 10], ['d25', 25], ['d60', 60], ['d90', 90], ['d600', 600], ['d1200', 1200]] as const;
export type BandKey = typeof DURATION_BANDS[number][0];

export interface DayFigures {
  date: string;
  /** Spend rows that exist for the date — 0 means nothing was recorded. */
  spendRows: number;
  /** null = no spend row (unknown), never $0. */
  spend: number | null;
  /** The account's call metric (Jacuzzi: leads). null = no call feed. */
  calls: number | null;
  /** Tracked calls after publisher scoping (equals calls except on Jacuzzi). */
  trackedCalls: number;
  /** Why `calls` is null for this day, or null when it is known. */
  callsMissingReason?: string | null;
  /** Rows with no publisher recorded, excluded under a confirmed scope. */
  unrecordedExcluded?: number;
  /** Every in-scope call that day lacks campaign, buyer and tracking number (feed narrowed). */
  attributionMissing?: boolean;
  connected: number | null;
  converted: number | null;
  /** null unless every call that day carries captured revenue and the money is CPM's. */
  revenue: number | null;
  /** Calls at or beyond each duration floor. */
  bands: Record<BandKey, number>;
}

// ─── Source registry ────────────────────────────────────────────────────────

interface CallSourceSpec {
  table: string;
  dateCol: string;
  /** Timestamp column (needs a time range) vs plain date. */
  isTimestamp: boolean;
  hasConverted: boolean;
  hasRevenue: boolean;
  hasCaptureFlags: boolean;
  durationCol: string;
  connectedDurationCol?: string;
  testFlagCol?: string;
}

const CALL_SOURCES: Record<string, CallSourceSpec> = {
  ringfuel_calls: {
    table: 'ringfuel_calls', dateCol: 'call_start', isTimestamp: true,
    hasConverted: true, hasRevenue: true, hasCaptureFlags: true,
    durationCol: 'duration_seconds', connectedDurationCol: 'connection_duration_seconds', testFlagCol: 'is_test',
  },
  ringba_calls: {
    table: 'ringba_calls', dateCol: 'call_date', isTimestamp: true,
    hasConverted: true, hasRevenue: true, hasCaptureFlags: false, durationCol: 'duration_seconds',
  },
  ringba_calls_4js: {
    table: 'ringba_calls_4js', dateCol: 'call_start', isTimestamp: true,
    hasConverted: false, hasRevenue: false, hasCaptureFlags: false,
    durationCol: 'call_duration_seconds', connectedDurationCol: 'connection_duration_seconds',
  },
  cannaball_calls: {
    table: 'cannaball_calls', dateCol: 'call_start', isTimestamp: true,
    hasConverted: false, hasRevenue: false, hasCaptureFlags: false,
    durationCol: 'duration_seconds', connectedDurationCol: 'connection_duration_seconds',
  },
  moja_calls: {
    table: 'moja_calls', dateCol: 'call_start', isTimestamp: true,
    hasConverted: true, hasRevenue: true, hasCaptureFlags: false,
    durationCol: 'duration_seconds', testFlagCol: 'is_test_delivery',
  },
};

/** Which call table belongs to which account. Probed against the data, not assumed. */
/** Spend tables that record one row per entity level, where only campaign rows are totals. */
const ENTITY_SCOPED_SPEND = new Set(['roku_daily_metrics', 'universal_ads_geo_metrics']);

const KNOWN_SPEND_TABLES = new Set([
  'ad_daily_metrics', 'roku_daily_metrics', 'universal_ads_geo_metrics',
  'platform_spend_4js', 'cannaball_spend',
]);

export interface SourceResolution {
  tables: string[];
  /** Named gap when the account record does not say where its data lives. */
  gap: string | null;
}

/**
 * WHERE AN ACCOUNT'S DATA LIVES IS AN ACCOUNT FACT, read from the client record
 * (clients.call_source_tables / spend_source_tables) — never guessed from the
 * slug and never defaulted to another account's feed. An unrecorded account
 * returns a named gap, because "we have not recorded where this account's calls
 * land" and "this account had no calls" are different answers.
 */
function resolveSources(
  recorded: string[] | null | undefined,
  known: Set<string>,
  kind: 'call' | 'spend',
  clientName: string,
): SourceResolution {
  const listed = (recorded || []).filter((t) => t && t.length > 0);
  if (listed.length === 0) {
    return {
      tables: [],
      gap: `No ${kind} feed is recorded for ${clientName} (clients.${kind}_source_tables is empty), so ${
        kind === 'call' ? 'call and revenue' : 'spend'
      } figures are NOT AVAILABLE for this account — that is a setup gap, not zero ${kind === 'call' ? 'calls' : 'spend'}.`,
    };
  }
  const usable = listed.filter((t) => known.has(t));
  const unsupported = listed.filter((t) => !known.has(t));
  return {
    tables: usable,
    gap: unsupported.length
      ? `${clientName} records ${kind} data in ${unsupported.join(', ')}, which this metric layer cannot read yet. Those figures are missing from the totals below.`
      : null,
  };
}

function spendSourcesFor(client: ResolvedClientRow): SourceResolution {
  return resolveSources(client.spend_source_tables, KNOWN_SPEND_TABLES, 'spend', client.name);
}

function callSourcesFor(client: ResolvedClientRow): SourceResolution {
  return resolveSources(
    client.call_source_tables,
    new Set(Object.keys(CALL_SOURCES)),
    'call',
    client.name,
  );
}


// ─── Fetch helpers ──────────────────────────────────────────────────────────

const PAGE = 1000;
/** Hard ceiling. Reaching it THROWS — a silently truncated read is a false total. */
export const MAX_ROWS = 200_000;

/**
 * Paged read. A failed page or a read that hits the ceiling throws: either one
 * would otherwise hand back a partial set that every caller reads as complete
 * (Spektrafin's 28-day window is ~25k calls and used to stop at 20k).
 */
async function fetchAll(makeQuery: (from: number, to: number) => any, what = 'rows'): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE) {
    if (offset >= MAX_ROWS) throw new Error(`[client-metrics] ${what}: more than ${MAX_ROWS} rows — refusing to return a truncated set`);
    const { data, error } = await makeQuery(offset, offset + PAGE - 1);
    if (error) throw new Error(`[client-metrics] ${what}: ${error.message}`);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

/**
 * The last reporting day a feed has recorded anything for this client, or null
 * if it never has. A day AFTER this is not "zero calls" — the feed has not
 * reported it yet, so it is missing.
 */
async function feedThrough(supabase: any, table: string, col: string, clientId: string, isTimestamp: boolean, tz: string): Promise<string | null> {
  const { data, error } = await supabase.from(table).select(col).eq('client_id', clientId)
    .order(col, { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`[client-metrics] ${table} coverage: ${error.message}`);
  const v = data?.[col];
  if (!v) return null;
  return isTimestamp ? reportingDay(String(v), tz) : String(v).slice(0, 10);
}

function money(v: number): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─── The metric layer ───────────────────────────────────────────────────────

export async function computeClientMetrics(
  supabase: any,
  client: ResolvedClientRow,
  window: { from: string; to: string },
): Promise<ClientMetrics> {
  const callSrc = callSourcesFor(client);
  const spendSrc = spendSourcesFor(client);
  const callTables = callSrc.tables;
  const spendTables = spendSrc.tables;
  const caveats: string[] = [];
  const metrics: Metric[] = [];
  const revenueField = revenueFieldForClient(client);

  // A gap in the account's own setup is stated first: it changes what any
  // number below is allowed to mean.
  if (callSrc.gap) caveats.push(callSrc.gap);
  if (spendSrc.gap) caveats.push(spendSrc.gap);
  if (!client.engagement_type) {
    caveats.push(`${client.name} has no engagement type recorded, so how CPM earns on this account is UNKNOWN. Do not state revenue, profit or margin for it.`);
  }

  // A calendar day is cut on the account's own reporting timezone, so a call
  // and the spend row for the same day belong to the same day.
  const tz = reportingTimeZone(client);
  const { startTs, endTs } = reportingWindowBounds(window, tz);

  // ── spend ────────────────────────────────────────────────────────────────
  let spend = 0;
  const spendByPlatform: Record<string, number> = {};
  let spendRows = 0;
  let latestSpendDate: string | null = null;
  /** Which calendar days actually carry a spend row — a missing day is UNKNOWN spend, not $0. */
  const spendDays = new Set<string>();
  const spendByDay = new Map<string, { rows: number; spend: number }>();

  for (const table of spendTables) {
    // Every recorded spend table is read the same way: date, spend, and a
    // platform label where the table has one. Entity-scoped feeds are narrowed
    // to campaign rows so nothing is counted twice.
    const entityScoped = ENTITY_SCOPED_SPEND.has(table);
    const labelCol = table === 'roku_daily_metrics' || table === 'universal_ads_geo_metrics' ? null : 'platform';
    const cols = ['date', 'spend', entityScoped ? 'entity' : null, labelCol].filter(Boolean).join(', ');
    const defaultLabel = table === 'roku_daily_metrics'
      ? 'roku'
      : table === 'universal_ads_geo_metrics'
        ? 'universal_ads'
        : 'unknown';

    const rows = await fetchAll((f, t) => {
      let q = supabase.from(table).select(cols).eq('client_id', client.id)
        .gte('date', window.from).lte('date', window.to);
      if (entityScoped) q = q.eq('entity', 'campaign');
      return q.range(f, t);
    });
    for (const r of rows as any[]) {
      spend += num(r.spend);
      const p = (labelCol ? r[labelCol] : null) || defaultLabel;
      spendByPlatform[p] = (spendByPlatform[p] || 0) + num(r.spend);
      spendRows++;
      spendDays.add(String(r.date).slice(0, 10));
      const sd = spendByDay.get(String(r.date).slice(0, 10)) ?? { rows: 0, spend: 0 };
      sd.rows++; sd.spend += num(r.spend);
      spendByDay.set(String(r.date).slice(0, 10), sd);
      if (!latestSpendDate || r.date > latestSpendDate) latestSpendDate = r.date;
    }
  }



  const platformParts = Object.entries(spendByPlatform).map(([p, v]) => `${p} ${money(v)}`);
  metrics.push({
    key: 'spend',
    label: 'Media spend',
    value: spendRows > 0 ? spend : null,
    display: spendRows > 0 ? money(spend) : spendTables.length === 0 ? 'not available — no spend feed recorded for this account' : 'no spend rows in this window',
    note: spendRows > 0
      ? `Measured from ${spendTables.join(' + ')} over ${window.from} to ${window.to} (${spendRows} row(s) covering ${spendDays.size} day(s) — a row is one campaign-day, not one day${platformParts.length ? `; ${platformParts.join(', ')}` : ''}). Latest spend day: ${latestSpendDate}.`
      : spendTables.length === 0
        ? spendSrc.gap || 'No spend feed is recorded for this account, so spend is UNKNOWN, not $0.'
        : `No spend rows found in ${spendTables.join(' + ')} for this window. That is a missing feed, not $0 of spend, unless the account is expected to be quiet.`,
    sources: spendTables,
  });

  // ── calls ────────────────────────────────────────────────────────────────
  interface CallRow {
    connected: boolean | null;
    converted: boolean | null;
    /** Was the conversion outcome genuinely reported? false/null = UNKNOWN. */
    conversionKnown: boolean;
    /** Was connection state genuinely reported? A thin webhook does not send it. */
    connectionKnown: boolean;
    duration: number;
    payout: unknown;
    revenue: unknown;
    revenue_captured: boolean | null;
    payload_shape: string | null;
    /** Calendar day of the call, for comparing against the days spend covers. */
    day: string;
    /** Publisher as recorded on the row, for the per-day dedicated-feed check. */
    publisher: string | null;
  }
  const calls: CallRow[] = [];
  let testRowsExcluded = 0;

  // WHOSE CALLS ARE THESE? CPM is one publisher on most of these feeds. The
  // recorded scoping decision is loaded before a single call is counted, and
  // calls from other publishers never reach the figures below.
  const { account: pubScope } = await loadPublisherScopes(supabase, client.id, client.name);
  const pubFilter = createPublisherFilter(pubScope, client.name);
  // THE ACCOUNT'S CONFIRMED PUBLISHER SCOPE (clients.publisher_scope) governs
  // when set: only those publishers' calls are counted, whatever the economics
  // record says. When it is not set and the feed carries more than one named
  // publisher, every call-derived figure is withheld below — never estimated,
  // never "all publishers".
  const clientScope = (client.publisher_scope ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean);
  // NAMED publishers only. A row with no publisher recorded is a coverage gap,
  // never a second publisher: unrecorded rows alone never trigger withholding.
  const seenPublishers = new Map<string, number>();
  let outOfScope = 0;
  /** Unrecorded-publisher rows dropped under a confirmed scope, per reporting day. */
  const unrecordedByDay = new Map<string, number>();
  /** Per day: in-scope calls, and how many of them carry no campaign/buyer/number. */
  const attributionByDay = new Map<string, { calls: number; bare: number }>();
  /** Last day each call feed has recorded anything for this client (unscoped). */
  const throughDays: (string | null)[] = [];

  for (const tableKey of callTables) {
    const spec = CALL_SOURCES[tableKey];
    if (!spec) continue;
    throughDays.push(await feedThrough(supabase, spec.table, spec.dateCol, client.id, spec.isTimestamp, tz));
    const cols = [
      spec.dateCol, 'connected', spec.durationCol, 'payout',
      ...publisherColumns(tableKey),
      spec.hasConverted ? 'converted' : null,
      spec.hasRevenue ? 'revenue' : null,
      spec.hasCaptureFlags ? 'revenue_captured' : null,
      spec.hasCaptureFlags ? 'conversion_captured' : null,
      spec.hasCaptureFlags ? 'payload_shape' : null,
      tableKey === 'ringfuel_calls' ? 'campaign_name, buyer_name, target_name' : null,
      spec.testFlagCol || null,
    ].filter(Boolean).join(', ');

    const rows = await fetchAll((f, t) =>
      supabase.from(spec.table).select(cols).eq('client_id', client.id)
        .gte(spec.dateCol, spec.isTimestamp ? startTs : window.from)
        .lte(spec.dateCol, spec.isTimestamp ? endTs : window.to)
        .range(f, t), `${spec.table} calls`);

    for (const r of rows as any[]) {
      if (spec.testFlagCol && r[spec.testFlagCol] === true) { testRowsExcluded++; continue; }
      const publisher = readPublisher(tableKey, r);
      const rowDay = spec.isTimestamp ? reportingDay(r[spec.dateCol], tz) : String(r[spec.dateCol] ?? '').slice(0, 10);
      if (publisher) seenPublishers.set(publisher, (seenPublishers.get(publisher) ?? 0) + 1);
      if (clientScope.length) {
        if (!publisher) { outOfScope++; unrecordedByDay.set(rowDay, (unrecordedByDay.get(rowDay) ?? 0) + 1); continue; }
        if (!clientScope.includes(publisher.toLowerCase())) { outOfScope++; continue; }
      } else if (!pubFilter.keep(publisher)) continue;
      if (tableKey === 'ringfuel_calls') {
        const a = attributionByDay.get(rowDay) ?? { calls: 0, bare: 0 };
        a.calls++;
        if (!r.campaign_name && !r.buyer_name && !r.target_name) a.bare++;
        attributionByDay.set(rowDay, a);
      }
      const thin = spec.hasCaptureFlags && r.payload_shape === 'webhook_minimal';
      // CONVERTED comes ONLY from the account's configured money field: a call is
      // converted when that field carries a captured amount above zero. The
      // platform's own `converted` flag is not read — a status we cannot tie to
      // revenue is not a conversion. A thin webhook's stored zero is UNKNOWN.
      const money = revenueField === null ? null : resolveClientRevenue(
        { engagement_type: client.engagement_type, revenue_field: client.revenue_field },
        { payout: r.payout, revenue: spec.hasRevenue ? r.revenue : null, revenue_captured: spec.hasCaptureFlags ? (r.revenue_captured ?? null) : null },
      );
      const moneyKnown = !!money && money.captured && money.amount !== null &&
        !(revenueField === 'revenue' && thin && r.revenue_captured !== true);
      calls.push({
        connected: r.connected ?? null,
        converted: moneyKnown ? (money!.amount as number) > 0 : null,
        conversionKnown: moneyKnown,
        connectionKnown: !thin,
        duration: num(r[spec.durationCol]),
        payout: r.payout,
        revenue: spec.hasRevenue ? r.revenue : null,
        revenue_captured: spec.hasCaptureFlags ? (r.revenue_captured ?? null) : null,
        payload_shape: spec.hasCaptureFlags ? (r.payload_shape ?? null) : null,
        day: rowDay,
        publisher,
      });
    }
  }
  /** Calls are known through this day; later days are MISSING, never zero. Null = feed never reported. */
  const callsThrough: string | null = throughDays.length
    ? (throughDays.some((d) => d === null) ? null : (throughDays as string[]).sort()[0])
    : null;

  // Jacuzzi is paid per LEAD: calls and QR scans count identically and are
  // never separated. The lead sheet is the count; calls are only a subset of it.
  // The sheet is uploaded by hand and lags: a day after its last row is NOT a
  // day with zero leads — it is a day whose leads have not been uploaded yet.
  let jacuzziLeads: number | null = null;
  let leadsThrough: string | null = null;
  const leadsByDay = new Map<string, number>();
  if (client.slug === 'jacuzzi') {
    leadsThrough = await feedThrough(supabase, 'jacuzzi_leads', 'transaction_date', client.id, false, tz);
    const leadRows = await fetchAll((f, t) =>
      supabase.from('jacuzzi_leads').select('transaction_date, lead_type').eq('client_id', client.id)
        .gte('transaction_date', window.from).lte('transaction_date', window.to).range(f, t), 'jacuzzi_leads');
    jacuzziLeads = leadRows.length;
    for (const l of leadRows as any[]) {
      const d = String(l.transaction_date ?? '').slice(0, 10);
      leadsByDay.set(d, (leadsByDay.get(d) ?? 0) + 1);
    }
  }
  /** The day through which the account's CALL METRIC is known. */
  const metricThrough = client.slug === 'jacuzzi' ? leadsThrough : callsThrough;
  const metricCovers = (d: string) => metricThrough !== null && d <= metricThrough;
  const callsCover = (d: string) => callsThrough !== null && d <= callsThrough;
  const windowCovered = metricCovers(window.to);
  const coverageGap = (callTables.length || client.slug === 'jacuzzi') && !windowCovered
    ? (client.slug === 'jacuzzi'
      ? `The lead sheet has ${leadsThrough ? `rows only through ${leadsThrough}` : 'no rows at all'}, so leads for ${leadsThrough ? `${nextDay(leadsThrough)} onward` : 'this window'} are NOT YET RECORDED — missing, not zero.`
      : `The call feed has ${callsThrough ? `recorded nothing after ${callsThrough}` : 'never recorded a call for this account'}, so calls for ${callsThrough ? `${nextDay(callsThrough)} onward` : 'this window'} are NOT YET RECORDED — missing, not zero.`)
    : null;

  const pub: PublisherFilterSummary = pubFilter.summary();
  const scopeUnconfirmed = clientScope.length === 0 && seenPublishers.size > 1;
  /** Calls that came from the call feed are withheld (Jacuzzi's lead sheet is not a call feed). */
  const callFiguresWithheld = scopeUnconfirmed;
  const moneyBlocked = clientScope.length ? false : (pub.moneyBlocked || scopeUnconfirmed);
  const scopeReason = scopeUnconfirmed
    ? `publisher scoping is unconfirmed for ${client.name}: its call feed carries ${seenPublishers.size} publishers (${[...seenPublishers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => `${p} ${n}`).join(', ')}) and clients.publisher_scope is not set, so no call-derived figure is published.`
    : null;
  const moneyBlockReason = scopeReason ?? pub.blockReason;

  const totalCalls = calls.length;
  const connectionKnownCalls = calls.filter((c) => c.connectionKnown);
  const connectedCalls = connectionKnownCalls.filter((c) => c.connected === true).length;
  const convertedKnown = calls.filter((c) => c.conversionKnown);
  const convertedCalls = convertedKnown.filter((c) => c.converted === true).length;

  // ── spend coverage ───────────────────────────────────────────────────────
  // Absent applies to the cost side too. If calls arrived on days that carry no
  // spend row, the spend total is a PARTIAL cost against a FULL revenue, and any
  // margin computed from the pair flatters the account. Name the gap and withhold.
  const callDays = new Set(calls.map((c) => c.day).filter(Boolean));
  const daysWithCallsNoSpend = [...callDays].filter((d) => !spendDays.has(d)).sort();
  const spendCoverageIncomplete = spendRows > 0 && daysWithCallsNoSpend.length > 0;
  const coverageNote = spendCoverageIncomplete
    ? `Spend covers ${spendDays.size} day(s) but calls arrived on ${callDays.size}. ${daysWithCallsNoSpend.length} day(s) have calls and no spend row (${daysWithCallsNoSpend.slice(0, 6).join(', ')}${daysWithCallsNoSpend.length > 6 ? '…' : ''}) — that is missing spend data, not free traffic.`
    : '';

  const callLabel = client.slug === 'jacuzzi' ? 'Leads (calls + QR scans, never split)' : 'Validated calls (call-tracking records)';
  const callValue = client.slug === 'jacuzzi' ? (jacuzziLeads ?? totalCalls) : totalCalls;
  /** The window runs past what the call metric's feed has recorded: the count is MISSING. */
  const callMetricMissing = coverageGap !== null;
  /** Revenue's own feed (the call feed) runs short of the window. */
  const revenueFeedMissing = callTables.length > 0 && !callsCover(window.to);
  if (coverageGap) caveats.push(coverageGap);

  metrics.push({
    key: 'calls',
    label: callLabel,
    value: (callTables.length === 0 && jacuzziLeads === null) || (callFiguresWithheld && client.slug !== 'jacuzzi') || callMetricMissing ? null : callValue,
    display: callTables.length === 0 && jacuzziLeads === null
      ? 'not available — no call feed recorded for this account'
      : callFiguresWithheld && client.slug !== 'jacuzzi' ? 'WITHHELD — publisher scoping unconfirmed'
      : callMetricMissing ? 'NOT YET RECORDED — the feed has not reported this window' : String(callValue),
    note: client.slug === 'jacuzzi'
      ? `Paid per lead: ${jacuzziLeads ?? 0} leads from jacuzzi_leads (calls and QR scans counted identically, never split). ${totalCalls} of them appear as tracked calls in ringfuel_calls.`
      : callTables.length
        ? `Counted from ${callTables.join(' + ')} over ${window.from} to ${window.to} inclusive — ${callDays.size} day(s) of calls. ${reportingDayNote(tz)}${testRowsExcluded ? ` ${testRowsExcluded} flagged test row(s) excluded.` : ''}${
          pub.excludedCalls
            ? ` ${pub.excludedCalls} call(s) from other publishers were excluded — this is CPM's volume, not the tracking campaign's total.`
            : ''
        }`
        : 'No call table is mapped to this account.',
    sources: client.slug === 'jacuzzi' ? ['jacuzzi_leads', ...callTables] : callTables,
  });

  if (callTables.length) {
    const connKnown = connectionKnownCalls.length;
    metrics.push({
      key: 'connected_calls',
      label: 'Connected calls',
      value: connKnown > 0 && !callFiguresWithheld ? connectedCalls : null,
      display: connKnown > 0 ? String(connectedCalls) : 'unknown — connection is not reported on this feed',
      note: totalCalls === 0
        ? 'No calls in the window.'
        : connKnown === 0
          ? `Not one of the ${totalCalls} calls reports whether it connected (every delivery was a thin webhook), so connection is UNKNOWN, not zero.`
          : connKnown < totalCalls
            ? `${connectedCalls} connected out of the ${connKnown} calls that report connection (${((connectedCalls / connKnown) * 100).toFixed(1)}%). The other ${totalCalls - connKnown} calls do not report it and are excluded, never counted as unconnected.`
            : `${((connectedCalls / totalCalls) * 100).toFixed(1)}% of ${totalCalls} calls. Measured.`,
      sources: callTables,
    });


    metrics.push({
      key: 'converted_calls',
      label: 'Converted (billable) calls',
      value: convertedKnown.length > 0 && !callFiguresWithheld ? convertedCalls : null,
      display: convertedKnown.length > 0 ? String(convertedCalls) : 'unknown — conversion is not reported on this feed',
      note: convertedKnown.length === 0
        ? `No call in this window carries a conversion value, so conversions are UNKNOWN, not zero. Conversion is a buyer-side decision and is never inferred from call length.`
        : convertedKnown.length < totalCalls
          ? `Conversion known for ${convertedKnown.length} of ${totalCalls} calls; the other ${totalCalls - convertedKnown.length} are UNKNOWN, not non-converting.`
          : `All ${totalCalls} calls carry a conversion value.`,
      sources: callTables,
    });
  }

  // ── cost per call / per converted call ───────────────────────────────────
  if (spendRows > 0 && callValue > 0 && !callMetricMissing && !(callFiguresWithheld && client.slug !== 'jacuzzi')) {
    metrics.push({
      key: 'cost_per_call',
      label: client.slug === 'jacuzzi' ? 'Cost per lead' : 'Cost per call',
      value: spend / callValue,
      display: money(spend / callValue),
      note: `${money(spend)} ÷ ${callValue} ${client.slug === 'jacuzzi' ? 'leads' : 'calls'}. Total calls is the denominator — never a billable subset, so nothing is hidden.${spendCoverageIncomplete ? ` A FLOOR only: ${coverageNote}` : ''}${
        pubScope.scoping === 'unknown' && pub.inventory.length > 1
          ? ` UNDERSTATED: the denominator still contains other publishers' calls (publisher scoping is unknown here) while the numerator is only CPM's spend. Our true cost per call is HIGHER than this.`
          : ''
      }`,
      sources: [...spendTables, ...callTables],
    });
  }
  if (spendRows > 0 && convertedKnown.length > 0 && convertedCalls > 0 && !callFiguresWithheld) {
    metrics.push({
      key: 'cost_per_converted_call',
      label: 'Cost per converted call',
      value: spend / convertedCalls,
      display: money(spend / convertedCalls),
      note: `${money(spend)} ÷ ${convertedCalls} converted calls. Compare against the payout per converted call, not against cost per raw call.`,
      sources: [...spendTables, ...callTables],
    });
  }

  // ── revenue, and the capture gate ────────────────────────────────────────
  let uncaptured = 0;
  let capturedRevenue = 0;
  let capturedCalls = 0;
  const dayRevenue = new Map<string, { captured: number; uncaptured: number }>();
  for (const c of calls) {
    const dr = dayRevenue.get(c.day) ?? { captured: 0, uncaptured: 0 };
    dayRevenue.set(c.day, dr);
    const r = resolveClientRevenue({ engagement_type: client.engagement_type, revenue_field: client.revenue_field }, {
      payout: c.payout, revenue: c.revenue, revenue_captured: c.revenue_captured,
    });
    const shapeThin = c.payload_shape === 'webhook_minimal';
    if (r.captured && r.amount !== null && !(revenueField === 'revenue' && shapeThin && c.revenue_captured !== true)) {
      capturedRevenue += r.amount;
      capturedCalls++;
      dr.captured += r.amount;
    } else {
      uncaptured++;
      dr.uncaptured++;
    }
  }
  const hadUncapturedData = uncaptured > 0;

  let revenueValue: number | null = null;
  let revenueDisplay: string;
  let revenueNote: string;

  if (revenueField === null) {
    revenueNote = `This account's engagement type (${client.engagement_type || 'not recorded'}) is not paid per call and no money column is recorded on the account, so neither the revenue nor the payout column is CPM's income. No revenue figure exists to quote here.`;
    revenueDisplay = 'not applicable to this account';
  } else if (callTables.length === 0) {
    revenueNote = 'No call source is mapped to this account, so revenue cannot be computed.';
    revenueDisplay = 'unknown — no call source';
  } else if (moneyBlocked) {
    // THE PUBLISHER GATE. The payout column on this feed pays several
    // publishers. Until we know which calls are ours, none of that money is.
    revenueDisplay = 'UNKNOWN — cannot be separated from other publishers';
    revenueNote = `Revenue CANNOT be stated for ${client.name}: ${moneyBlockReason} ${pub.notes.join(' ')}`;
  } else if (revenueFeedMissing) {
    revenueDisplay = 'NOT YET RECORDED — the call feed has not reported the whole window';
    revenueNote = `The call feed has ${callsThrough ? `recorded nothing after ${callsThrough}` : 'never recorded a call'}, so revenue for the rest of the window is missing, not $0.`;
  } else if (hadUncapturedData) {
    // THE GATE. No total is produced while any row is uncaptured.
    revenueDisplay = 'UNKNOWN — cannot be totalled';
    revenueNote = `${uncaptured} of ${totalCalls} calls in this window have no captured ${revenueField}, so revenue CANNOT be stated and margin CANNOT be computed. Absent is not zero. ${capturedCalls > 0 ? `Only ${capturedCalls} calls reported a figure, totalling ${money(capturedRevenue)} — that is a partial subset, never the window's revenue.` : 'Not one call in this window reported a figure.'}`;
  } else if (totalCalls === 0) {
    revenueDisplay = 'no calls in this window';
    revenueNote = 'No calls, so no revenue. Confirm the call feed is alive before reading this as a real zero.';
  } else {
    revenueValue = capturedRevenue;
    revenueDisplay = money(capturedRevenue);
    revenueNote = `All ${totalCalls} calls reported a ${revenueField} figure, read from the ${revenueField} column — the money column recorded for this account. ${client.engagement_type === 'performance_media' && revenueField === 'revenue' ? 'Performance media: revenue is CPM\'s income and payout is ignored on this account.' : revenueField === 'payout' ? 'The payout column is what CPM is paid here.' : ''}`;
  }

  metrics.push({
    key: 'revenue', label: 'Revenue', value: revenueValue, display: revenueDisplay,
    note: revenueNote, sources: callTables,
  });

  // ── profit and margin, gated on revenue AND on spend coverage ────────────
  const canDoProfit = revenueValue !== null && !moneyBlocked && spendRows > 0 && !spendCoverageIncomplete;
  const withheldBecause = moneyBlocked
    ? `${moneyBlockReason} Our media spend is ours; the payouts on this feed are not all ours, so a margin built from the pair would credit CPM for other publishers' calls.`
    : revenueValue === null
    ? 'revenue is unknown for at least one call in the window. Stating it would mean treating unreported calls as having earned nothing.'
    : spendRows === 0
      ? 'no spend rows arrived for this window, so the cost side is unknown — not zero.'
      : `the spend feed does not cover every day that produced calls. ${coverageNote} Publishing a margin here would compare full revenue against partial cost.`;
  metrics.push({
    key: 'profit', label: 'Profit', value: canDoProfit ? revenueValue! - spend : null,
    display: canDoProfit ? money(revenueValue! - spend) : 'UNKNOWN — cannot be stated for this window',
    note: canDoProfit
      ? `Revenue ${money(revenueValue!)} − media spend ${money(spend)}.${client.engagement_type === 'performance_media' ? ' Downside is capped at media spend: a negative figure is profit not earned, never a debt.' : ''}`
      : `Profit is withheld because ${withheldBecause}`,
    sources: [...spendTables, ...callTables],
  });
  metrics.push({
    key: 'margin_pct', label: 'Margin %',
    value: canDoProfit && revenueValue! > 0 ? ((revenueValue! - spend) / revenueValue!) * 100 : null,
    display: canDoProfit && revenueValue! > 0 ? `${(((revenueValue! - spend) / revenueValue!) * 100).toFixed(1)}%` : 'UNKNOWN — cannot be stated for this window',
    note: canDoProfit && revenueValue! > 0 ? 'Profit ÷ revenue.' : `Withheld because ${withheldBecause}`,
    sources: [...spendTables, ...callTables],
  });

  // ── duration bands ───────────────────────────────────────────────────────
  if (totalCalls > 0) {
    const bands: Array<[string, (d: number) => boolean]> = [
      ['under 30s', (d) => d < 30],
      ['30–59s', (d) => d >= 30 && d < 60],
      ['60–119s', (d) => d >= 60 && d < 120],
      ['120–299s', (d) => d >= 120 && d < 300],
      ['300s+', (d) => d >= 300],
    ];
    const parts = bands.map(([label, test]) => {
      const n = calls.filter((c) => test(c.duration)).length;
      return `${label}: ${n} (${((n / totalCalls) * 100).toFixed(1)}%)`;
    });
    metrics.push({
      key: 'duration_bands', label: 'Duration band shares', value: null,
      display: parts.join(' · '),
      note: `Shares of ${totalCalls} calls. Descriptive only — duration never decides whether a call converted.`,
      sources: callTables,
    });
  }

  // ── platform events — reported, labelled, never summed with validated calls ─
  if (spendTables.includes('ad_daily_metrics')) {
    const evRows = await fetchAll((f, t) => supabase.from('ad_daily_metrics').select('date, conversions')
      .eq('client_id', client.id).gte('date', window.from).lte('date', window.to).range(f, t));
    const withValue = (evRows as any[]).filter((r) => r.conversions !== null && r.conversions !== undefined);
    metrics.push({
      key: 'platform_events',
      label: 'Platform-reported conversion events (e.g. Meta "Call Placed") — NOT validated calls',
      value: withValue.length ? withValue.reduce((a, r) => a + num(r.conversions), 0) : null,
      display: withValue.length ? String(withValue.reduce((a, r) => a + num(r.conversions), 0)) : 'not reported',
      note: 'An ad platform\'s own event count. It is never added to, compared with, or used as a denominator in place of validated calls from the call-tracking feed.',
      sources: ['ad_daily_metrics'],
    });
  }

  // ── economics record ─────────────────────────────────────────────────────
  const { data: econ } = await supabase
    .from('media_brain_economics')
    .select('payout, payout_mode, revenue_source, billable_min_duration_seconds, known_problems')
    .eq('client_id', client.id).is('vertical_id', null).maybeSingle();
  const economicsNote = econ
    ? `Recorded terms: payout ${econ.payout ?? 'unknown'} (${econ.payout_mode ?? 'mode unknown'}), revenue source ${econ.revenue_source ?? 'unknown'}${econ.billable_min_duration_seconds ? `, billable at ${econ.billable_min_duration_seconds}s` : ''}.${econ.known_problems ? ` Known problems: ${econ.known_problems}` : ''}`
    : null;

  if (client.data_model_note) caveats.push(client.data_model_note);
  // Whose traffic this is comes first: it decides what every money figure means.
  if (scopeReason) caveats.push(scopeReason.charAt(0).toUpperCase() + scopeReason.slice(1));
  if (clientScope.length && callTables.length) {
    caveats.push(`Calls counted only from the confirmed publisher scope (${(client.publisher_scope ?? []).join(', ')}); ${outOfScope} call(s) from other publishers on this feed were excluded from every figure.`);
  } else if (callTables.length) for (const n of pub.notes) caveats.push(n);
  if (spendCoverageIncomplete) caveats.push(coverageNote + ' Cost per call is therefore a floor, and profit and margin are withheld.');
  if (hadUncapturedData) {
    caveats.push(`Revenue is unknown for ${uncaptured} of ${totalCalls} calls in this window. Do not state a revenue, profit or margin figure for it.`);
  }
  if (spendRows === 0 && (client.expected_sources || []).some((s) => s.includes('spend'))) {
    caveats.push('Spend is expected for this account but no spend rows arrived in this window — treat it as a feed gap, not as zero spend.');
  }

  const promptBlock = [
    `--- CANONICAL METRICS: ${client.name} (${window.from} to ${window.to}) ---`,
    `engagement_type: ${client.engagement_type || 'not recorded'} · money field: ${revenueField || 'none — calls are not this account\'s income'}`,
    `call sources: ${callTables.join(', ') || 'none'} · spend sources: ${spendTables.join(', ')}`,
    callTables.length
      ? `publisher scoping: ${pubScope.scoping}${pubScope.attributed.length ? ` · CPM's publisher name(s): ${pubScope.attributed.join(', ')}` : ''}${pub.excludedCalls ? ` · ${pub.excludedCalls} other-publisher call(s) excluded` : ''}`
      : null,
    economicsNote ? `economics: ${economicsNote}` : null,
    '',
    ...metrics.map((m) => `[${m.key}] ${m.label}: ${m.display}\n    coverage: ${m.note}`),
    '',
    caveats.length ? `CAVEATS THE ANSWER MUST CARRY:\n${caveats.map((c) => `  • ${c}`).join('\n')}` : null,
    '--- END CANONICAL METRICS ---',
  ].filter((l) => l !== null).join('\n');

  // ── per-day rows: the same gates, applied to one day at a time ────────────
  const days: DayFigures[] = [];
  const noCallMetric = callTables.length === 0 && jacuzziLeads === null;
  for (let d = window.from; d <= window.to; d = nextDay(d)) {
    const dayCalls = calls.filter((c) => c.day === d);
    const sd = spendByDay.get(d);
    const connKnownDay = dayCalls.filter((c) => c.connectionKnown);
    const convKnownDay = dayCalls.filter((c) => c.conversionKnown);
    const dr = dayRevenue.get(d) ?? { captured: 0, uncaptured: 0 };
    // The money gate as it would read for this day alone: the scope's own block,
    // or a "dedicated" feed that shows more than one named publisher that day.
    const namedThatDay = new Set(dayCalls.map((c) => c.publisher).filter((p): p is string => !!p));
    const dayBlocked = clientScope.length ? false
      : pubScope.moneyBlocked || scopeUnconfirmed || (pubScope.scoping === 'not_required_dedicated_campaigns' && namedThatDay.size > 1);
    // A day the feed has not reported is MISSING: no count, no revenue, never 0.
    const feedCovers = callsCover(d);
    const metricCoversDay = metricCovers(d);
    // A covered day with no in-scope calls genuinely earned $0; an uncovered one is unknown.
    const revenueOk = revenueField !== null && callTables.length > 0 && !dayBlocked && dr.uncaptured === 0 && feedCovers;
    const attr = attributionByDay.get(d);
    days.push({
      date: d,
      spendRows: sd?.rows ?? 0,
      spend: sd && sd.rows > 0 ? sd.spend : null,
      calls: noCallMetric || !metricCoversDay ? null
        : client.slug === 'jacuzzi' ? (leadsByDay.get(d) ?? 0) : callFiguresWithheld ? null : dayCalls.length,
      trackedCalls: dayCalls.length,
      callsMissingReason: noCallMetric ? 'no call feed is recorded for this account'
        : !metricCoversDay ? (client.slug === 'jacuzzi' ? 'the lead sheet has not been uploaded for this day yet' : 'the call feed has not reported this day yet')
        : callFiguresWithheld && client.slug !== 'jacuzzi' ? 'publisher scope unconfirmed' : null,
      unrecordedExcluded: unrecordedByDay.get(d) ?? 0,
      attributionMissing: attr ? attr.calls > 0 && attr.bare === attr.calls : false,
      connected: !callFiguresWithheld && feedCovers && callTables.length && connKnownDay.length ? connKnownDay.filter((c) => c.connected === true).length : null,
      converted: !callFiguresWithheld && feedCovers && callTables.length && convKnownDay.length ? convKnownDay.filter((c) => c.converted === true).length : null,
      revenue: revenueOk ? dr.captured : null,
      bands: Object.fromEntries(DURATION_BANDS.map(([k, floor]) => [k, dayCalls.filter((c) => c.duration >= floor).length])) as Record<BandKey, number>,
    });
  }

  return {
    days,
    clientId: client.id,
    clientName: client.name,
    engagementType: client.engagement_type,
    window,
    metrics,
    metricsUsed: metrics.map((m) => m.key),
    hadUncapturedData,
    callSources: callTables,
    spendSources: spendTables,
    caveats,
    economicsNote,
    promptBlock,
  };
}

/**
 * The answer the bot gives when revenue cannot be stated, built from metrics
 * alone. Used as the deterministic spine of the reply and as the fallback when
 * the model is unavailable — so the safe answer never depends on the model.
 */
export function buildCaptureSafeSummary(m: ClientMetrics): string {
  const pick = (k: string) => m.metrics.find((x) => x.key === k);
  const lines: string[] = [`*${m.clientName}* — ${m.window.from} to ${m.window.to}`];
  for (const key of ['spend', 'calls', 'connected_calls', 'converted_calls', 'cost_per_call', 'cost_per_converted_call', 'revenue', 'profit', 'margin_pct']) {
    const metric = pick(key);
    if (!metric) continue;
    lines.push(`• ${metric.label}: ${metric.display}`);
  }
  if (m.hadUncapturedData) {
    const rev = pick('revenue');
    lines.push('', `⚠️ ${rev?.note || 'Revenue is unknown for part of this window.'}`);
  }
  for (const c of m.caveats.filter((c) => !c.startsWith('Revenue is unknown'))) lines.push(`_${c}_`);
  return lines.join('\n');
}
