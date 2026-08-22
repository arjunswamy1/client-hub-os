// Server-side rebuild of the BuyologyIQ creative-level analysis payload.
// Mirrors src/hooks/useBuyologyCreativeAnalysis.ts so scheduled optimizer runs
// do not need a browser to assemble the request body.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type ProductLine = 'tubs' | 'bath' | 'other';

export const QUALIFIED_SECONDS = 60;
export const PREMIUM_SECONDS = 120;

const UTM_CONTENT = 'tag:User:utm_content';
const CREATIVE_TAG = 'tag:User:creative';

const norm = (s?: string | null) => (s || '').trim().toLowerCase();
const isAdId = (s?: string | null) => !!s && /^\d{8,}$/.test(String(s).trim());

export const productLineLabel = (line: ProductLine) =>
  line === 'tubs' ? 'Walk-In Tubs' : line === 'bath' ? 'Bathroom Remodel' : 'Unclassified';

export function classifyName(name?: string | null): ProductLine {
  const n = (name || '').toLowerCase();
  if (!n) return 'other';
  if (/walk\s?in\s?tub|walkintub|\btubs?\b|tub_|_tub/.test(n)) return 'tubs';
  if (/bath/.test(n)) return 'bath';
  return 'other';
}

export function classifyCreative(campaignName?: string | null, adName?: string | null): ProductLine {
  const byCampaign = classifyName(campaignName);
  return byCampaign !== 'other' ? byCampaign : classifyName(adName);
}

export function qualityScore(q: { total: number; connected: number; qualified: number; premium: number; converted: number }) {
  if (!q.total) return 0;
  return Math.round(
    40 * (q.qualified / q.total) +
      25 * (q.premium / q.total) +
      20 * (q.converted / q.total) +
      15 * (q.connected / q.total),
  );
}

interface Row {
  key: string;
  adName: string;
  line: ProductLine;
  campaigns: string[];
  adsets: string[];
  format: string | null;
  status: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  total: number;
  connected: number;
  qualified: number;
  premium: number;
  converted: number;
  durations: number[];
  matched: boolean;
}

/** Build the optimizer request payload for a single product line. */
export async function buildBuyologyPayload(
  supabase: SupabaseClient,
  clientId: string,
  line: ProductLine,
) {
  const [creativesRes, callsRes] = await Promise.all([
    supabase
      .from('ad_creatives')
      .select('ad_name, adset_name, campaign_name, platform_ad_id, spend, impressions, clicks, status, format, creative_type')
      .eq('client_id', clientId),
    supabase
      .from('ringba_calls')
      .select('call_id, call_date, campaign_name, duration_seconds, connected, converted, metadata')
      .eq('client_id', clientId)
      .limit(50000),
  ]);
  if (creativesRes.error) throw creativesRes.error;
  if (callsRes.error) throw callsRes.error;

  const rows = new Map<string, Row>();
  const byAdId = new Map<string, string>();
  const byName = new Map<string, string>();

  for (const c of creativesRes.data || []) {
    const adName = (c as any).ad_name || 'Unnamed creative';
    const key = norm(adName) || 'unnamed';
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        adName,
        line: classifyCreative((c as any).campaign_name, adName),
        campaigns: [], adsets: [],
        format: (c as any).format || (c as any).creative_type || null,
        status: (c as any).status || null,
        spend: 0, impressions: 0, clicks: 0,
        total: 0, connected: 0, qualified: 0, premium: 0, converted: 0,
        durations: [], matched: true,
      };
      rows.set(key, row);
    }
    row.spend += Number((c as any).spend || 0);
    row.impressions += Number((c as any).impressions || 0);
    row.clicks += Number((c as any).clicks || 0);
    const cn = (c as any).campaign_name;
    const an = (c as any).adset_name;
    if (cn && !row.campaigns.includes(cn)) row.campaigns.push(cn);
    if (an && !row.adsets.includes(an)) row.adsets.push(an);
    if ((c as any).status === 'active') row.status = 'active';
    if ((c as any).platform_ad_id) byAdId.set(String((c as any).platform_ad_id), key);
    byName.set(key, key);
  }

  let lineCalls = 0;
  let attributedCalls = 0;
  let unattributedCalls = 0;
  const totals = { calls: 0, connected: 0, qualified: 0, premium: 0, converted: 0 };

  for (const call of callsRes.data || []) {
    const meta = ((call as any).metadata || {}) as Record<string, string>;
    const uc = meta[UTM_CONTENT];
    const tag = meta[CREATIVE_TAG];

    let key: string | undefined;
    if (uc && !isAdId(uc)) key = byName.get(norm(uc));
    if (!key && isAdId(uc)) key = byAdId.get(String(uc).trim());
    if (!key && isAdId(tag)) key = byAdId.get(String(tag).trim());

    const callLine: ProductLine = key ? rows.get(key)!.line : classifyName((call as any).campaign_name);
    if (callLine !== line) continue;

    const dur = Number((call as any).duration_seconds || 0);
    lineCalls++;
    totals.calls++;
    if ((call as any).connected) totals.connected++;
    if (dur >= QUALIFIED_SECONDS) totals.qualified++;
    if (dur >= PREMIUM_SECONDS) totals.premium++;
    if ((call as any).converted) totals.converted++;

    if (key) {
      attributedCalls++;
      const row = rows.get(key)!;
      row.total++;
      if ((call as any).connected) row.connected++;
      if (dur >= QUALIFIED_SECONDS) row.qualified++;
      if (dur >= PREMIUM_SECONDS) row.premium++;
      if ((call as any).converted) row.converted++;
      row.durations.push(dur);
    } else {
      unattributedCalls++;
    }
  }

  const lineRows = [...rows.values()].filter((r) => r.line === line && (r.spend > 0 || r.total > 0));
  const spend = lineRows.reduce((s, r) => s + r.spend, 0);

  const creatives = lineRows.map((r) => {
    const avgTalk = r.durations.length ? r.durations.reduce((s, x) => s + x, 0) / r.durations.length : 0;
    return {
      adName: r.adName,
      line,
      campaign: r.campaigns[0] || null,
      adset: r.adsets[0] || null,
      format: r.format,
      status: r.status,
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.impressions ? (r.clicks / r.impressions) * 100 : 0,
      cpm: r.impressions ? (r.spend / r.impressions) * 1000 : 0,
      calls: r.total,
      connected: r.connected,
      qualified: r.qualified,
      premium: r.premium,
      converted: r.converted,
      avgTalkSeconds: avgTalk,
      qualityScore: qualityScore(r),
      costPerCall: r.total ? r.spend / r.total : 0,
      costPerQualifiedCall: r.qualified ? r.spend / r.qualified : 0,
    };
  });

  return {
    hasData: creatives.length > 0,
    payload: {
      line,
      lineLabel: productLineLabel(line),
      totals: {
        meta_spend: Math.round(spend),
        raw_calls: totals.calls,
        connected_calls: totals.connected,
        qualified_calls_60s: totals.qualified,
        premium_calls_120s: totals.premium,
        converted_calls: totals.converted,
        cost_per_raw_call: totals.calls ? Number((spend / totals.calls).toFixed(2)) : 0,
        cost_per_qualified_call: totals.qualified ? Number((spend / totals.qualified).toFixed(2)) : 0,
        qualified_rate: totals.calls ? Number((totals.qualified / totals.calls).toFixed(3)) : 0,
        connect_rate: totals.calls ? Number((totals.connected / totals.calls).toFixed(3)) : 0,
      },
      attributionRate: lineCalls ? attributedCalls / lineCalls : 0,
      unattributedCalls,
      creatives,
    },
  };
}
