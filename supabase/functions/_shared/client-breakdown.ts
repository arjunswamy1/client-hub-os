// CAMPAIGN AND VERTICAL BREAKDOWN — the dimension layer under canonical metrics.
//
// WHY THIS EXISTS: the account total answers "how is Hablyte doing". It cannot
// answer "does auto beat home", and a blended account number actively hides the
// difference. Both sides of that comparison already exist in the data: every
// call feed records the campaign name the call arrived on, and campaign-level
// spend is recorded per account in clients.campaign_spend_source_tables. This
// module joins them and rolls campaigns up into verticals.
//
// THE RULES IT INHERITS, UNCHANGED:
//   • Absent is not zero. A group with any uncaptured money row publishes NO
//     revenue, profit or margin — the value is null and the note says why.
//   • Spend not covering a group's call days makes cost per call a FLOOR and
//     withholds margin, exactly as at account level.
//   • Calls are assigned by CALL-FEED CAMPAIGN NAME against the vertical's
//     ringba_patterns. Spend is assigned by campaign name against meta_patterns,
//     then google_patterns, then ringba_patterns. Never by creative matching.
//   • Anything matching no vertical is UNCLASSIFIED and is reported as such —
//     never silently dropped and never assigned to a vertical by default.
//   • These rows are a READ, not a verdict. Cut/hold/scale are ad-level rules
//     and must not render per vertical.
//
// @see docs/media-brain/01_Decision_Engine.md §2, §3
// @see docs/media-brain/04_Client_Data_Standard.md

import { revenueFieldForClient, resolveClientRevenue } from './client-revenue.ts';
import type { ResolvedClientRow } from './client-resolve.ts';
import {
  createPublisherFilter, loadPublisherScopes, publisherColumns, readPublisher,
  PUBLISHER_NOT_RECORDED,
} from './publisher-scope.ts';

/** Call tables and the column that carries their campaign name. */
const CALL_DIMS: Record<string, { dateCol: string; hasConverted: boolean; hasRevenue: boolean; hasCaptureFlags: boolean; testFlagCol?: string }> = {
  ringfuel_calls: { dateCol: 'call_start', hasConverted: true, hasRevenue: true, hasCaptureFlags: true, testFlagCol: 'is_test' },
  ringba_calls: { dateCol: 'call_date', hasConverted: true, hasRevenue: true, hasCaptureFlags: false },
  ringba_calls_4js: { dateCol: 'call_start', hasConverted: false, hasRevenue: false, hasCaptureFlags: false },
  cannaball_calls: { dateCol: 'call_start', hasConverted: false, hasRevenue: false, hasCaptureFlags: false },
  moja_calls: { dateCol: 'call_start', hasConverted: true, hasRevenue: true, hasCaptureFlags: false, testFlagCol: 'is_test_delivery' },
};

/** Spend tables that carry a campaign dimension, and how to read them. */
const CAMPAIGN_SPEND: Record<string, { campaignCol: string; entityFilter?: string; platformCol?: string; hasClicks: boolean; hasImpressions: boolean; defaultPlatform: string }> = {
  ad_campaigns: { campaignCol: 'campaign_name', platformCol: 'platform', hasClicks: true, hasImpressions: true, defaultPlatform: 'meta/google' },
  roku_daily_metrics: { campaignCol: 'campaign_name', entityFilter: 'campaign', hasClicks: true, hasImpressions: true, defaultPlatform: 'roku' },
  universal_ads_geo_metrics: { campaignCol: 'campaign_name', entityFilter: 'campaign', hasClicks: true, hasImpressions: true, defaultPlatform: 'universal_ads' },
  cannaball_spend: { campaignCol: 'campaign_name', platformCol: 'platform', hasClicks: true, hasImpressions: true, defaultPlatform: 'unknown' },
  platform_spend_4js: { campaignCol: 'campaign_name', platformCol: 'platform', hasClicks: true, hasImpressions: true, defaultPlatform: 'unknown' },
};

const UNCLASSIFIED = 'UNCLASSIFIED';
const NO_CAMPAIGN = '(no campaign name on the row)';

export interface BreakdownRow {
  key: string;
  /** Campaign names folded into this row (vertical rows only). */
  members: string[];
  calls: number;
  callDays: Set<string>;
  connectedKnown: number;
  connected: number;
  convertedKnown: number;
  converted: number;
  /** null = at least one money row was never captured. */
  revenue: number | null;
  capturedRevenue: number;
  uncaptured: number;
  /** null = no spend row for this group. */
  spend: number | null;
  spendDays: Set<string>;
  clicks: number;
  impressions: number;
  platforms: Set<string>;
  /** Every publisher that delivered calls to this group, counted — ours and theirs. */
  publishers: Map<string, number>;
  /** Calls on this group that another publisher delivered, excluded from the figures. */
  otherPublisherCalls: number;
}

export interface ClientBreakdown {
  /** True when this account can be read per campaign at all. */
  available: boolean;
  byCampaign: BreakdownRow[];
  byVertical: BreakdownRow[];
  notes: string[];
  promptBlock: string;
}

function blank(key: string): BreakdownRow {
  return {
    key, members: [], calls: 0, callDays: new Set(), connectedKnown: 0, connected: 0,
    convertedKnown: 0, converted: 0, revenue: null, capturedRevenue: 0, uncaptured: 0,
    spend: null, spendDays: new Set(), clicks: 0, impressions: 0, platforms: new Set(),
    publishers: new Map(), otherPublisherCalls: 0,
  };
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(v: number): string {
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `*` wildcard match, case-insensitive. A bare pattern must match the whole name. */
export function patternMatches(name: string, pattern: string): boolean {
  const p = (pattern || '').trim();
  if (!p) return false;
  const rx = new RegExp(
    '^' + p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$',
    'i',
  );
  return rx.test((name || '').trim());
}

interface VerticalDef {
  vertical_id: string;
  label: string | null;
  ringba_patterns: string[] | null;
  meta_patterns: string[] | null;
  google_patterns: string[] | null;
}

/** Which vertical a name belongs to, or null. More than one match = ambiguous, reported unclassified. */
function assign(name: string, verticals: VerticalDef[], side: 'calls' | 'spend'): string | null {
  const hits = verticals.filter((v) => {
    const lists = side === 'calls'
      ? [v.ringba_patterns]
      : [v.meta_patterns, v.google_patterns, v.ringba_patterns];
    return lists.some((l) => (l || []).some((p) => patternMatches(name, p)));
  });
  if (hits.length !== 1) return null;
  return hits[0].label || hits[0].vertical_id;
}

const PAGE = 1000;
const MAX_ROWS = 20000;

async function fetchAll(makeQuery: (from: number, to: number) => any): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await makeQuery(offset, offset + PAGE - 1);
    if (error) { console.error('[client-breakdown] fetch error:', error.message); break; }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

export async function computeClientBreakdown(
  supabase: any,
  client: ResolvedClientRow,
  window: { from: string; to: string },
): Promise<ClientBreakdown> {
  const notes: string[] = [];
  const callTables = (client.call_source_tables || []).filter((t) => CALL_DIMS[t]);
  const spendTables = ((client as any).campaign_spend_source_tables || []).filter((t: string) => CAMPAIGN_SPEND[t]);
  const revenueField = revenueFieldForClient(client);

  if (!callTables.length && !spendTables.length) {
    return {
      available: false, byCampaign: [], byVertical: [],
      notes: [`${client.name} records no campaign-level feed, so per-campaign and per-vertical figures are NOT AVAILABLE — that is a setup gap on the account record, not zero activity. Only the account total can be quoted.`],
      promptBlock: '',
    };
  }
  if (!spendTables.length) {
    notes.push(`No campaign-level spend feed is recorded for ${client.name}, so spend CANNOT be split per campaign or vertical. Calls and revenue can be split; cost per call, profit and margin per vertical are UNKNOWN, not zero.`);
  }
  if (!callTables.length) {
    notes.push(`No call feed is recorded for ${client.name}, so spend can be split per campaign but calls and revenue cannot.`);
  }

  const { data: vRows } = await supabase
    .from('client_verticals')
    .select('vertical_id, label, ringba_patterns, meta_patterns, google_patterns')
    .eq('client_id', client.id)
    .order('position');
  const verticals: VerticalDef[] = vRows || [];
  if (!verticals.length) {
    notes.push(`No verticals are defined for ${client.name}, so campaigns cannot be grouped into verticals. The per-campaign rows below are the finest grouping available.`);
  } else if (callTables.length && !verticals.some((v) => (v.ringba_patterns || []).length)) {
    notes.push(`${client.name}'s verticals carry no call-campaign patterns, so CALLS and REVENUE cannot be assigned to a vertical — every call shows as UNCLASSIFIED. That is a setup gap: the patterns belong on the vertical record.`);
  }

  const campaigns = new Map<string, BreakdownRow>();
  const row = (k: string) => {
    if (!campaigns.has(k)) campaigns.set(k, blank(k));
    return campaigns.get(k)!;
  };

  const startTs = `${window.from}T00:00:00Z`;
  const endTs = `${window.to}T23:59:59.999Z`;

  // ── calls, revenue and conversion per campaign ────────────────────────────
  for (const table of callTables) {
    const spec = CALL_DIMS[table];
    const cols = [
      spec.dateCol, 'campaign_name', 'connected', 'payout',
      spec.hasConverted ? 'converted' : null,
      spec.hasRevenue ? 'revenue' : null,
      spec.hasCaptureFlags ? 'revenue_captured' : null,
      spec.hasCaptureFlags ? 'conversion_captured' : null,
      spec.hasCaptureFlags ? 'payload_shape' : null,
      spec.testFlagCol || null,
    ].filter(Boolean).join(', ');

    const rows = await fetchAll((f, t) =>
      supabase.from(table).select(cols).eq('client_id', client.id)
        .gte(spec.dateCol, startTs).lte(spec.dateCol, endTs).range(f, t));

    for (const r of rows as any[]) {
      if (spec.testFlagCol && r[spec.testFlagCol] === true) continue;
      const name = (r.campaign_name || '').trim() || NO_CAMPAIGN;
      const g = row(name);
      g.calls++;
      g.callDays.add(String(r[spec.dateCol] ?? '').slice(0, 10));

      const thin = spec.hasCaptureFlags && r.payload_shape === 'webhook_minimal';
      if (!thin) { g.connectedKnown++; if (r.connected === true) g.connected++; }
      const convKnown = spec.hasCaptureFlags
        ? r.conversion_captured === true
        : spec.hasConverted && r.converted !== null;
      if (convKnown) { g.convertedKnown++; if (r.converted === true) g.converted++; }

      const res = resolveClientRevenue(
        { engagement_type: client.engagement_type, revenue_field: client.revenue_field },
        { payout: r.payout, revenue: spec.hasRevenue ? r.revenue : null, revenue_captured: spec.hasCaptureFlags ? (r.revenue_captured ?? null) : null },
      );
      const captured = res.captured && res.amount !== null
        && !(revenueField === 'revenue' && thin && r.revenue_captured !== true);
      if (captured) g.capturedRevenue += res.amount!;
      else g.uncaptured++;
    }
  }

  // ── spend per campaign ────────────────────────────────────────────────────
  for (const table of spendTables) {
    const spec = CAMPAIGN_SPEND[table];
    const cols = ['date', spec.campaignCol, 'spend', spec.platformCol || null,
      spec.hasClicks ? 'clicks' : null, spec.hasImpressions ? 'impressions' : null,
      spec.entityFilter ? 'entity' : null].filter(Boolean).join(', ');

    const rows = await fetchAll((f, t) => {
      let q = supabase.from(table).select(cols).eq('client_id', client.id)
        .gte('date', window.from).lte('date', window.to);
      if (spec.entityFilter) q = q.eq('entity', spec.entityFilter);
      return q.range(f, t);
    });

    for (const r of rows as any[]) {
      const name = (r[spec.campaignCol] || '').trim() || NO_CAMPAIGN;
      const g = row(name);
      g.spend = (g.spend ?? 0) + num(r.spend);
      g.spendDays.add(String(r.date).slice(0, 10));
      g.clicks += num(r.clicks);
      g.impressions += num(r.impressions);
      g.platforms.add((spec.platformCol ? r[spec.platformCol] : null) || spec.defaultPlatform);
    }
  }

  // Gate each campaign's revenue on its own capture coverage.
  for (const g of campaigns.values()) {
    g.revenue = g.calls > 0 && g.uncaptured === 0 && revenueField !== null ? g.capturedRevenue : null;
  }

  // ── roll campaigns up into verticals ──────────────────────────────────────
  const verticalRows = new Map<string, BreakdownRow>();
  for (const g of campaigns.values()) {
    const callSide = g.calls > 0 ? assign(g.key, verticals, 'calls') : null;
    const spendSide = g.spend !== null ? assign(g.key, verticals, 'spend') : null;
    // A campaign that carries both calls and spend must land in ONE vertical, or
    // it is unclassified — splitting it would invent an attribution.
    const target = callSide && spendSide
      ? (callSide === spendSide ? callSide : UNCLASSIFIED)
      : (callSide || spendSide || UNCLASSIFIED);
    const key = target || UNCLASSIFIED;
    if (!verticalRows.has(key)) verticalRows.set(key, blank(key));
    const v = verticalRows.get(key)!;
    v.members.push(g.key);
    v.calls += g.calls;
    g.callDays.forEach((d) => v.callDays.add(d));
    g.spendDays.forEach((d) => v.spendDays.add(d));
    v.connectedKnown += g.connectedKnown; v.connected += g.connected;
    v.convertedKnown += g.convertedKnown; v.converted += g.converted;
    v.capturedRevenue += g.capturedRevenue; v.uncaptured += g.uncaptured;
    v.clicks += g.clicks; v.impressions += g.impressions;
    g.platforms.forEach((p) => v.platforms.add(p));
    if (g.spend !== null) v.spend = (v.spend ?? 0) + g.spend;
  }
  for (const v of verticalRows.values()) {
    v.revenue = v.calls > 0 && v.uncaptured === 0 && revenueField !== null ? v.capturedRevenue : null;
  }

  const byCampaign = [...campaigns.values()].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0) || b.calls - a.calls);
  const byVertical = [...verticalRows.values()].sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0) || b.calls - a.calls);

  const promptBlock = renderBlock(client, window, byVertical, byCampaign, notes, revenueField);
  return { available: true, byCampaign, byVertical, notes, promptBlock };
}

/** One row, with every number carrying its own coverage. */
function renderRow(g: BreakdownRow, revenueField: string | null): string {
  const bits: string[] = [];
  bits.push(`calls ${g.calls}`);
  if (g.spend !== null) bits.push(`spend ${money(g.spend)}`);
  else bits.push('spend UNKNOWN (no campaign-level spend row for this group — not $0)');

  if (g.convertedKnown > 0) bits.push(`converted ${g.converted}/${g.convertedKnown} reported`);
  else if (g.calls > 0) bits.push('converted UNKNOWN (not reported on this feed)');

  if (g.revenue !== null) bits.push(`revenue ${money(g.revenue)}`);
  else if (g.calls > 0) {
    bits.push(revenueField === null
      ? 'revenue not applicable to this account'
      : `revenue UNKNOWN (${g.uncaptured} of ${g.calls} calls never reported a ${revenueField})`);
  }

  if (g.spend !== null && g.calls > 0) {
    const daysMissing = [...g.callDays].filter((d) => d && !g.spendDays.has(d)).length;
    bits.push(`cost/call ${money(g.spend / g.calls)}${daysMissing ? ` (FLOOR — ${daysMissing} call day(s) carry no spend row)` : ''}`);
    if (g.revenue !== null && daysMissing === 0) {
      const profit = g.revenue - g.spend;
      bits.push(`profit ${money(profit)}`);
      if (g.revenue > 0) bits.push(`margin ${((profit / g.revenue) * 100).toFixed(1)}%`);
    } else if (g.revenue !== null) {
      bits.push('profit WITHHELD (spend does not cover every call day)');
    } else {
      bits.push('profit UNKNOWN');
    }
  } else if (g.calls > 0) {
    bits.push('cost/call and profit UNKNOWN — no campaign-level spend for this group');
  }

  if (g.clicks) bits.push(`clicks ${g.clicks}`);
  if (g.calls > 0 && g.clicks > 0) {
    const rate = (g.calls / g.clicks) * 100;
    // More calls than clicks means this group's calls did not all come from this
    // group's media — other publishers are routed into the same call campaign.
    // A "call rate" above 100% is an attribution warning, never engagement.
    bits.push(rate > 100
      ? `MORE CALLS THAN CLICKS (${g.calls} calls vs ${g.clicks} clicks) — calls in this group are NOT all from CPM's media on this campaign, so cost per call and margin here are mixed-source and must be read as such, not as engagement`
      : `call rate ${rate.toFixed(1)}%`);
  }
  if (g.platforms.size) bits.push(`platform ${[...g.platforms].join('/')}`);
  return bits.join(' · ');
}

function renderBlock(
  client: ResolvedClientRow,
  window: { from: string; to: string },
  byVertical: BreakdownRow[],
  byCampaign: BreakdownRow[],
  notes: string[],
  revenueField: string | null,
): string {
  const lines: string[] = [
    `--- BREAKDOWN: ${client.name} per vertical and per campaign (${window.from} to ${window.to}) ---`,
    'Calls are assigned by the campaign name on the call; spend by the campaign name on the spend row. A group with any uncaptured money row publishes NO revenue, profit or margin. UNCLASSIFIED means the name matched no vertical — report it, never fold it into another vertical.',
    '',
    'BY VERTICAL:',
  ];
  if (!byVertical.length) lines.push('  (nothing in this window)');
  for (const v of byVertical) {
    lines.push(`  [${v.key}] ${renderRow(v, revenueField)}`);
    lines.push(`      campaigns: ${v.members.join(' | ')}`);
  }
  lines.push('', 'BY CAMPAIGN:');
  if (!byCampaign.length) lines.push('  (nothing in this window)');
  for (const g of byCampaign.slice(0, 40)) lines.push(`  [${g.key}] ${renderRow(g, revenueField)}`);
  if (byCampaign.length > 40) lines.push(`  …${byCampaign.length - 40} further campaigns not listed.`);
  if (notes.length) {
    lines.push('', 'BREAKDOWN CAVEATS THE ANSWER MUST CARRY:');
    for (const n of notes) lines.push(`  • ${n}`);
  }
  lines.push('--- END BREAKDOWN ---');
  return lines.join('\n');
}
