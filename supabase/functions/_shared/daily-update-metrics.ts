// Metrics for the daily client update draft — a VIEW over the canonical engine.
//
// This module no longer counts a single call or sums a single spend row of its
// own. Every per-day figure comes from loadDailySeries() (one computeClientMetrics
// call, strict publisher scoping, reporting-timezone day cuts), which is also what
// the CPM bot reads — so the 9am update and the bot cannot disagree on a day.
// metricAgreement.test.ts holds that.
//
// The only extra reads here are descriptive: per-campaign spend for one layer of
// detail, and the latest Media Brain review. Neither feeds a headline number.
//
// Read-only: this module never writes to a call or ad-sync table.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { QUALIFIED_BAND, type SeriesDay as RuleDay } from './daily-update-rules.ts';
import type { DailySeries } from './metric-comparison-data.ts';
import { addDays } from './reporting-day.ts';

export const admin = (): SupabaseClient =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

export interface DayRow {
  date: string;
  spend: number;
  calls: number;
  cost_per_call: number | null;
  impressions: number | null;
  bands: Record<string, number>;
  band_pct: Record<string, number>;
}

export interface ClientMetrics {
  client_id: string;
  client_name: string;
  for_date: string;
  window_start: string;
  spend_sources: string[];
  call_sources: string[];
  yesterday: DayRow | null;
  trend: DayRow[];
  campaign_breakdown: { campaign: string; spend: number; calls: number | null }[];
  /** 28 days, oldest first — for the weekday and baseline tests only. */
  history: RuleDay[];
  anomalies: { campaign: string; detail: string }[];
  media_brain: { window_start: string; window_end: string; status: string; breakers: unknown } | null;
  gaps: string[];
  has_data: boolean;
}

const BAND_KEYS = ['d10', 'd25', 'd90', 'd600', 'd1200'] as const;
const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

/** The draft's view of the canonical series. Pure apart from the two descriptive reads. */
export async function collectClientMetrics(db: SupabaseClient, series: DailySeries): Promise<ClientMetrics> {
  const { client, forDate, engine } = series;
  const windowStart = addDays(forDate, -6);
  const gaps: string[] = [];
  if (!engine.spendSources.length) gaps.push('no spend feed is recorded for this account');
  if (!engine.callSources.length) gaps.push('no call feed is recorded for this account');

  const toRow = (d: DailySeries['days'][number]): DayRow => {
    const spend = round(d.spend ?? 0);
    const calls = d.calls ?? 0;
    const bands = Object.fromEntries(BAND_KEYS.map((k) => [k, d.bands[k] ?? 0]));
    const tracked = d.trackedCalls;
    return {
      date: d.date, spend, calls,
      cost_per_call: calls > 0 && spend > 0 ? round(spend / calls) : null,
      impressions: d.impressions,
      bands,
      band_pct: Object.fromEntries(BAND_KEYS.map((k) => [k, tracked > 0 ? round((bands[k] / tracked) * 100, 1) : 0])),
    };
  };
  const trend = series.days.filter((d) => d.date >= windowStart).map(toRow);
  const history: RuleDay[] = series.days.map((d) => ({
    date: d.date, spend: round(d.spend ?? 0), calls: d.calls ?? 0,
    qualified: d.bands[QUALIFIED_BAND] ?? 0, impressions: d.impressions,
  }));

  // Descriptive campaign detail — spend only. Per-campaign call counts were the
  // old unscoped path and are gone; calls are not joined to campaigns here.
  const byCampaign = new Map<string, Map<string, number>>();
  const add = (campaign: string, date: string, spend: number) => {
    if (!byCampaign.has(campaign)) byCampaign.set(campaign, new Map());
    const m = byCampaign.get(campaign)!;
    m.set(date, (m.get(date) ?? 0) + spend);
  };
  const tables = client.spend_source_tables ?? [];
  if (tables.includes('roku_daily_metrics')) {
    const { data } = await db.from('roku_daily_metrics').select('date, campaign_name, entity_name, spend')
      .eq('client_id', client.id).eq('entity', 'campaign').gte('date', windowStart).lte('date', forDate);
    for (const r of data ?? []) add(String(r.campaign_name ?? r.entity_name ?? 'unnamed campaign'), String(r.date), Number(r.spend ?? 0));
  }
  if (tables.includes('ad_daily_metrics')) {
    const { data } = await db.from('ad_campaigns').select('date, campaign_name, spend')
      .eq('client_id', client.id).gte('date', windowStart).lte('date', forDate);
    for (const r of data ?? []) add(String(r.campaign_name ?? 'unnamed campaign'), String(r.date), Number(r.spend ?? 0));
  }
  const campaignBreakdown: ClientMetrics['campaign_breakdown'] = [];
  const anomalies: ClientMetrics['anomalies'] = [];
  for (const [campaign, byDay] of byCampaign) {
    const onDay = round(byDay.get(forDate) ?? 0);
    const earlier = round([...byDay.entries()].filter(([d]) => d !== forDate).reduce((s, [, v]) => s + v, 0));
    if (onDay > 0) campaignBreakdown.push({ campaign, spend: onDay, calls: null });
    else if (earlier > 0) anomalies.push({ campaign, detail: `spent $${earlier.toLocaleString()} earlier in the window but $0 on ${forDate}` });
  }
  campaignBreakdown.sort((a, b) => b.spend - a.spend);

  const { data: review } = await db.from('media_brain_reviews')
    .select('window_start, window_end, status, breakers')
    .eq('client_id', client.id).order('created_at', { ascending: false }).limit(1).maybeSingle();

  return {
    client_id: client.id,
    client_name: client.name,
    for_date: forDate,
    window_start: windowStart,
    spend_sources: engine.spendSources,
    call_sources: engine.callSources,
    yesterday: trend[trend.length - 1] ?? null,
    trend,
    history,
    campaign_breakdown: campaignBreakdown.slice(0, 12),
    anomalies: anomalies.slice(0, 8),
    media_brain: review
      ? { window_start: String(review.window_start), window_end: String(review.window_end), status: String(review.status), breakers: review.breakers ?? null }
      : null,
    gaps,
    has_data: series.days.some((d) => (d.spend ?? 0) > 0 || (d.calls ?? 0) > 0),
  };
}
