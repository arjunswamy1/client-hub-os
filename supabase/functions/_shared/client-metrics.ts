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
const MAX_ROWS = 20000;

async function fetchAll(makeQuery: (from: number, to: number) => any): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await makeQuery(offset, offset + PAGE - 1);
    if (error) {
      console.error('[client-metrics] fetch error:', error.message);
      break;
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

function money(v: number): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  const startTs = `${window.from}T00:00:00Z`;
  const endTs = `${window.to}T23:59:59.999Z`;

  // ── spend ────────────────────────────────────────────────────────────────
  let spend = 0;
  const spendByPlatform: Record<string, number> = {};
  let spendRows = 0;
  let latestSpendDate: string | null = null;
  /** Which calendar days actually carry a spend row — a missing day is UNKNOWN spend, not $0. */
  const spendDays = new Set<string>();

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
      ? `Measured from ${spendTables.join(' + ')} (${spendRows} day-rows${platformParts.length ? `; ${platformParts.join(', ')}` : ''}). Latest spend day: ${latestSpendDate}.`
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
  }
  const calls: CallRow[] = [];
  let testRowsExcluded = 0;

  // WHOSE CALLS ARE THESE? CPM is one publisher on most of these feeds. The
  // recorded scoping decision is loaded before a single call is counted, and
  // calls from other publishers never reach the figures below.
  const { account: pubScope } = await loadPublisherScopes(supabase, client.id, client.name);
  const pubFilter = createPublisherFilter(pubScope, client.name);

  for (const tableKey of callTables) {
    const spec = CALL_SOURCES[tableKey];
    if (!spec) continue;
    const cols = [
      spec.dateCol, 'connected', spec.durationCol, 'payout',
      ...publisherColumns(tableKey),
      spec.hasConverted ? 'converted' : null,
      spec.hasRevenue ? 'revenue' : null,
      spec.hasCaptureFlags ? 'revenue_captured' : null,
      spec.hasCaptureFlags ? 'conversion_captured' : null,
      spec.hasCaptureFlags ? 'payload_shape' : null,
      spec.testFlagCol || null,
    ].filter(Boolean).join(', ');

    const rows = await fetchAll((f, t) =>
      supabase.from(spec.table).select(cols).eq('client_id', client.id)
        .gte(spec.dateCol, spec.isTimestamp ? startTs : window.from)
        .lte(spec.dateCol, spec.isTimestamp ? endTs : window.to)
        .range(f, t));

    for (const r of rows as any[]) {
      if (spec.testFlagCol && r[spec.testFlagCol] === true) { testRowsExcluded++; continue; }
      if (!pubFilter.keep(readPublisher(tableKey, r))) continue;
      const thin = spec.hasCaptureFlags && r.payload_shape === 'webhook_minimal';
      calls.push({
        connected: r.connected ?? null,
        converted: spec.hasConverted ? (r.converted ?? null) : null,
        // A thin delivery carries no conversion and no connection field. The
        // stored false is the column default, not a reported outcome, so it is
        // UNKNOWN. Only an explicit conversion_captured = true makes it known.
        conversionKnown: spec.hasCaptureFlags
          ? r.conversion_captured === true
          : spec.hasConverted && r.converted !== null,
        connectionKnown: !thin,
        duration: num(r[spec.durationCol]),
        payout: r.payout,
        revenue: spec.hasRevenue ? r.revenue : null,
        revenue_captured: spec.hasCaptureFlags ? (r.revenue_captured ?? null) : null,
        payload_shape: spec.hasCaptureFlags ? (r.payload_shape ?? null) : null,
        day: String(r[spec.dateCol] ?? '').slice(0, 10),
      });
    }
  }

  // Jacuzzi is paid per LEAD: calls and QR scans count identically and are
  // never separated. The lead sheet is the count; calls are only a subset of it.
  let jacuzziLeads: number | null = null;
  if (client.slug === 'jacuzzi') {
    const leadRows = await fetchAll((f, t) =>
      supabase.from('jacuzzi_leads').select('transaction_date, lead_type').eq('client_id', client.id)
        .gte('transaction_date', window.from).lte('transaction_date', window.to).range(f, t));
    jacuzziLeads = leadRows.length;
  }

  const pub: PublisherFilterSummary = pubFilter.summary();

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

  const callLabel = client.slug === 'jacuzzi' ? 'Leads (calls + QR scans, never split)' : 'Calls';
  const callValue = client.slug === 'jacuzzi' ? (jacuzziLeads ?? totalCalls) : totalCalls;

  metrics.push({
    key: 'calls',
    label: callLabel,
    value: callTables.length === 0 && jacuzziLeads === null ? null : callValue,
    display: callTables.length === 0 && jacuzziLeads === null ? 'not available — no call feed recorded for this account' : String(callValue),
    note: client.slug === 'jacuzzi'
      ? `Paid per lead: ${jacuzziLeads ?? 0} leads from jacuzzi_leads (calls and QR scans counted identically, never split). ${totalCalls} of them appear as tracked calls in ringfuel_calls.`
      : callTables.length
        ? `Counted from ${callTables.join(' + ')}${testRowsExcluded ? `; ${testRowsExcluded} flagged test row(s) excluded` : ''}.${
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
      value: connKnown > 0 ? connectedCalls : null,
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
      value: convertedKnown.length > 0 ? convertedCalls : null,
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
  if (spendRows > 0 && callValue > 0) {
    metrics.push({
      key: 'cost_per_call',
      label: client.slug === 'jacuzzi' ? 'Cost per lead' : 'Cost per call',
      value: spend / callValue,
      display: money(spend / callValue),
      note: `${money(spend)} ÷ ${callValue} ${client.slug === 'jacuzzi' ? 'leads' : 'calls'}. Total calls is the denominator — never a billable subset, so nothing is hidden.${spendCoverageIncomplete ? ` A FLOOR only: ${coverageNote}` : ''}`,
      sources: [...spendTables, ...callTables],
    });
  }
  if (spendRows > 0 && convertedKnown.length > 0 && convertedCalls > 0) {
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
  for (const c of calls) {
    const r = resolveClientRevenue({ engagement_type: client.engagement_type, revenue_field: client.revenue_field }, {
      payout: c.payout, revenue: c.revenue, revenue_captured: c.revenue_captured,
    });
    const shapeThin = c.payload_shape === 'webhook_minimal';
    if (r.captured && r.amount !== null && !(revenueField === 'revenue' && shapeThin && c.revenue_captured !== true)) {
      capturedRevenue += r.amount;
      capturedCalls++;
    } else {
      uncaptured++;
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
  const canDoProfit = revenueValue !== null && spendRows > 0 && !spendCoverageIncomplete;
  const withheldBecause = revenueValue === null
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

  // ── economics record ─────────────────────────────────────────────────────
  const { data: econ } = await supabase
    .from('media_brain_economics')
    .select('payout, payout_mode, revenue_source, billable_min_duration_seconds, known_problems')
    .eq('client_id', client.id).is('vertical_id', null).maybeSingle();
  const economicsNote = econ
    ? `Recorded terms: payout ${econ.payout ?? 'unknown'} (${econ.payout_mode ?? 'mode unknown'}), revenue source ${econ.revenue_source ?? 'unknown'}${econ.billable_min_duration_seconds ? `, billable at ${econ.billable_min_duration_seconds}s` : ''}.${econ.known_problems ? ` Known problems: ${econ.known_problems}` : ''}`
    : null;

  if (client.data_model_note) caveats.push(client.data_model_note);
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
    economicsNote ? `economics: ${economicsNote}` : null,
    '',
    ...metrics.map((m) => `[${m.key}] ${m.label}: ${m.display}\n    coverage: ${m.note}`),
    '',
    caveats.length ? `CAVEATS THE ANSWER MUST CARRY:\n${caveats.map((c) => `  • ${c}`).join('\n')}` : null,
    '--- END CANONICAL METRICS ---',
  ].filter((l) => l !== null).join('\n');

  return {
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
