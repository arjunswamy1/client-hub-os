// Metrics for the daily client update draft.
//
// Everything here is measured, never estimated. When a source has no rows for a
// client we return null for it and say so in the draft — a draft that guesses is
// worse than one that admits a gap, because the account lead will send it on.
//
// Read-only: this module never writes to a call or ad-sync table.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const admin = (): SupabaseClient =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

/** Call tables, each with the column that carries the call's own timestamp. */
const CALL_SOURCES: { table: string; tsColumn: string; label: string }[] = [
  { table: 'ringba_calls', tsColumn: 'call_date', label: 'Ringba' },
  { table: 'cannaball_calls', tsColumn: 'call_start', label: 'CallGrid' },
  { table: 'moja_calls', tsColumn: 'call_start', label: 'Moja' },
  { table: 'ringfuel_calls', tsColumn: 'call_start', label: 'RingFuel' },
];

export interface DayRow {
  date: string;
  spend: number;
  calls: number;
  cost_per_call: number | null;
  /** null where no spend source for this client carries an impression column. */
  impressions: number | null;
  bands: Record<string, number>;
  band_pct: Record<string, number>;
}

/**
 * Why a reporting day shows no spend. Zero spend has two entirely different
 * causes and telling the lead the wrong one points at a plumbing problem that
 * does not exist while hiding one that does.
 *
 * - `dark`    — the campaign genuinely did not run: no spend, no impressions
 *               (or, where impressions are unavailable, call volume collapsed
 *               alongside). A real finding for the lead.
 * - `stale`   — spend is missing but delivery evidence says it ran: impressions
 *               non-zero, or call volume held up. A feed problem.
 * - `ok`      — spend landed.
 */
export type SpendDeliveryState = 'ok' | 'dark' | 'stale';

export interface SpendDelivery {
  state: SpendDeliveryState;
  /** Which test decided it, so the note can say so. */
  test: 'impressions' | 'call volume' | 'none';
  detail: string;
}

/**
 * Classify the reporting day. Impressions decide when we have them; otherwise
 * the call-volume comparison decides alone and the note says which was used.
 */
export function spendDelivery(m: ClientMetrics): SpendDelivery {
  const y = m.yesterday;
  if (!y) return { state: 'ok', test: 'none', detail: 'no reporting day row' };
  if (y.spend > 0) return { state: 'ok', test: 'none', detail: 'spend landed' };

  const prior = m.trend.filter((d) => d.date !== m.for_date);
  const priorCalls = prior.map((d) => d.calls).filter((n) => n > 0);
  const typical = priorCalls.length
    ? priorCalls.slice().sort((a, b) => a - b)[Math.floor(priorCalls.length / 2)]
    : 0;
  const collapsed = typical > 0 ? y.calls <= Math.max(1, typical * 0.2) : false;

  if (y.impressions !== null) {
    if (y.impressions === 0) {
      return {
        state: 'dark',
        test: 'impressions',
        detail: `$0 spend and 0 impressions on ${m.for_date}${
          collapsed ? `, with calls down to ${y.calls} against a typical ${typical}` : ''
        }`,
      };
    }
    return {
      state: 'stale',
      test: 'impressions',
      detail: `$0 spend but ${y.impressions.toLocaleString()} impressions on ${m.for_date} — it delivered, the spend row has not landed`,
    };
  }

  if (collapsed) {
    return {
      state: 'dark',
      test: 'call volume',
      detail: `$0 spend and calls down to ${y.calls} from a typical ${typical} (no impression column on this account's spend source, so call volume was the only test)`,
    };
  }
  return {
    state: 'stale',
    test: 'call volume',
    detail: `$0 spend but ${y.calls} calls still arrived, in line with the week (no impression column on this account's spend source, so call volume was the only test)`,
  };
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
  /** One layer deeper: per-campaign spend and, where joinable, per-campaign calls. */
  campaign_breakdown: { campaign: string; spend: number; calls: number | null }[];
  /** Campaigns that spent on earlier days in the window but nothing on for_date. */
  anomalies: { campaign: string; detail: string }[];
  media_brain: { window_start: string; window_end: string; status: string; breakers: unknown } | null;
  gaps: string[];
  has_data: boolean;
}

const BANDS: [string, number][] = [
  ['d10', 10], ['d25', 25], ['d90', 90], ['d600', 600], ['d1200', 1200],
];

const dayKey = (iso: string) => iso.slice(0, 10);
const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

async function pagedSelect(
  db: SupabaseClient, table: string, columns: string, clientId: string,
  tsColumn: string, fromIso: string, toIso: string,
) {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; from < 40_000; from += 1000) {
    const { data, error } = await db.from(table).select(columns)
      .eq('client_id', clientId)
      .gte(tsColumn, fromIso)
      .lt(tsColumn, toIso)
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Collect every measured number for one client: the day being reported on, the
 * seven-day trend behind it, one layer of campaign detail, and anomalies.
 */
export async function collectClientMetrics(
  db: SupabaseClient, clientId: string, clientName: string, forDate: string,
): Promise<ClientMetrics> {
  const start = new Date(`${forDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const windowStart = dayKey(start.toISOString());
  const endExclusive = new Date(`${forDate}T00:00:00Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const endIso = endExclusive.toISOString();

  const gaps: string[] = [];
  const spendSources: string[] = [];
  const callSources: string[] = [];

  // --- spend ---------------------------------------------------------------
  const spendByDay = new Map<string, number>();
  const spendByCampaignDay = new Map<string, Map<string, number>>();
  const addSpend = (date: string, campaign: string, spend: number) => {
    spendByDay.set(date, (spendByDay.get(date) ?? 0) + spend);
    if (!spendByCampaignDay.has(campaign)) spendByCampaignDay.set(campaign, new Map());
    const m = spendByCampaignDay.get(campaign)!;
    m.set(date, (m.get(date) ?? 0) + spend);
  };

  // Impressions are delivery evidence: they are what separates "the campaign
  // was dark" from "the spend feed is stale" on a $0 day.
  const impressionsByDay = new Map<string, number>();
  let impressionsAvailable = false;
  const addImpressions = (date: string, n: number) => {
    impressionsAvailable = true;
    impressionsByDay.set(date, (impressionsByDay.get(date) ?? 0) + n);
  };

  const { data: roku, error: rokuErr } = await db.from('roku_daily_metrics')
    .select('date, campaign_name, entity_name, spend, impressions')
    .eq('client_id', clientId).eq('entity', 'campaign')
    .gte('date', windowStart).lte('date', forDate);
  if (rokuErr) throw new Error(`roku_daily_metrics: ${rokuErr.message}`);
  if (roku && roku.length) {
    spendSources.push('Roku (roku_daily_metrics)');
    for (const r of roku) {
      addSpend(String(r.date), String(r.campaign_name ?? r.entity_name ?? 'unnamed campaign'), Number(r.spend ?? 0));
      if (r.impressions !== null && r.impressions !== undefined) addImpressions(String(r.date), Number(r.impressions));
    }
  }

  const { data: adDaily, error: adErr } = await db.from('ad_daily_metrics')
    .select('date, platform, spend, impressions, clicks, conversions')
    .eq('client_id', clientId).gte('date', windowStart).lte('date', forDate);
  if (adErr) throw new Error(`ad_daily_metrics: ${adErr.message}`);
  const platformSpend = new Map<string, number>();
  if (adDaily && adDaily.length) {
    for (const r of adDaily) {
      const platform = String(r.platform ?? 'unknown');
      spendByDay.set(String(r.date), (spendByDay.get(String(r.date)) ?? 0) + Number(r.spend ?? 0));
      if (r.impressions !== null && r.impressions !== undefined) addImpressions(String(r.date), Number(r.impressions));
      if (String(r.date) === forDate) platformSpend.set(platform, (platformSpend.get(platform) ?? 0) + Number(r.spend ?? 0));
    }
    const platforms = [...new Set(adDaily.map((r) => String(r.platform ?? 'unknown')))];
    spendSources.push(`${platforms.join(' / ')} (ad_daily_metrics)`);
  }

  // Campaign-level detail for Meta/Google comes from ad_campaigns.
  const { data: adCampaigns } = await db.from('ad_campaigns')
    .select('date, campaign_name, platform, spend')
    .eq('client_id', clientId).gte('date', windowStart).lte('date', forDate);
  for (const r of adCampaigns ?? []) {
    const campaign = String(r.campaign_name ?? 'unnamed campaign');
    if (!spendByCampaignDay.has(campaign)) spendByCampaignDay.set(campaign, new Map());
    const m = spendByCampaignDay.get(campaign)!;
    m.set(String(r.date), (m.get(String(r.date)) ?? 0) + Number(r.spend ?? 0));
  }

  if (!spendSources.length) gaps.push('no spend rows in the last 7 days from Roku, Meta or Google');

  // --- calls ---------------------------------------------------------------
  const callsByDay = new Map<string, number>();
  const bandsByDay = new Map<string, Record<string, number>>();
  const callsByCampaign = new Map<string, number>();
  let totalCallsInWindow = 0;

  for (const src of CALL_SOURCES) {
    const columns = `${src.tsColumn}, duration_seconds, campaign_name`;
    let rows: Record<string, unknown>[] = [];
    try {
      rows = await pagedSelect(db, src.table, columns, clientId, src.tsColumn, `${windowStart}T00:00:00Z`, endIso);
    } catch (_e) {
      // A table without campaign_name still gives us volume and duration.
      rows = await pagedSelect(db, src.table, `${src.tsColumn}, duration_seconds`, clientId, src.tsColumn, `${windowStart}T00:00:00Z`, endIso);
    }
    if (!rows.length) continue;
    callSources.push(`${src.label} (${src.table})`);
    totalCallsInWindow += rows.length;
    for (const r of rows) {
      const date = dayKey(String(r[src.tsColumn]));
      callsByDay.set(date, (callsByDay.get(date) ?? 0) + 1);
      if (!bandsByDay.has(date)) bandsByDay.set(date, Object.fromEntries(BANDS.map(([k]) => [k, 0])));
      const bands = bandsByDay.get(date)!;
      const dur = Number(r.duration_seconds ?? 0);
      for (const [key, floor] of BANDS) if (dur >= floor) bands[key] += 1;
      if (date === forDate && r.campaign_name) {
        const c = String(r.campaign_name);
        callsByCampaign.set(c, (callsByCampaign.get(c) ?? 0) + 1);
      }
    }
  }
  if (!callSources.length) gaps.push('no call records in the last 7 days from any call platform');
  else if (!callsByCampaign.size) gaps.push('calls are not joined to campaigns, so per-campaign cost per call is not available');

  // --- per-day series -----------------------------------------------------
  const trend: DayRow[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(`${forDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const date = dayKey(d.toISOString());
    const spend = round(spendByDay.get(date) ?? 0);
    const calls = callsByDay.get(date) ?? 0;
    const bands = bandsByDay.get(date) ?? Object.fromEntries(BANDS.map(([k]) => [k, 0]));
    trend.push({
      date, spend, calls,
      cost_per_call: calls > 0 && spend > 0 ? round(spend / calls) : null,
      bands,
      band_pct: Object.fromEntries(
        Object.entries(bands).map(([k, v]) => [k, calls > 0 ? round((v / calls) * 100, 1) : 0]),
      ),
    });
  }
  const yesterday = trend[trend.length - 1] ?? null;

  // --- one layer deeper, and anomalies ------------------------------------
  const campaignBreakdown: { campaign: string; spend: number; calls: number | null }[] = [];
  const anomalies: { campaign: string; detail: string }[] = [];
  for (const [campaign, byDay] of spendByCampaignDay) {
    const onDay = round(byDay.get(forDate) ?? 0);
    const earlier = round([...byDay.entries()].filter(([d]) => d !== forDate).reduce((s, [, v]) => s + v, 0));
    if (onDay > 0) {
      campaignBreakdown.push({ campaign, spend: onDay, calls: callsByCampaign.get(campaign) ?? null });
    } else if (earlier > 0) {
      anomalies.push({
        campaign,
        detail: `spent $${earlier.toLocaleString()} earlier in the window but $0 on ${forDate}`,
      });
    }
  }
  campaignBreakdown.sort((a, b) => b.spend - a.spend);

  // --- Media Brain (BuyologyIQ and RRM carry these) ------------------------
  const { data: review } = await db.from('media_brain_reviews')
    .select('window_start, window_end, status, breakers')
    .eq('client_id', clientId).order('created_at', { ascending: false }).limit(1).maybeSingle();

  const hasData = (yesterday?.spend ?? 0) > 0 || totalCallsInWindow > 0 ||
    trend.some((d) => d.spend > 0 || d.calls > 0);

  return {
    client_id: clientId,
    client_name: clientName,
    for_date: forDate,
    window_start: windowStart,
    spend_sources: spendSources,
    call_sources: callSources,
    yesterday,
    trend,
    campaign_breakdown: campaignBreakdown.slice(0, 12),
    anomalies: anomalies.slice(0, 8),
    media_brain: review
      ? {
          window_start: String(review.window_start), window_end: String(review.window_end),
          status: String(review.status), breakers: review.breakers ?? null,
        }
      : null,
    gaps,
    has_data: hasData,
  };
}
