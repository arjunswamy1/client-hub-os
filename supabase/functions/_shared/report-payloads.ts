// Server-side brief builders for the weekly Slack optimizer digests.
// One builder per client scope; each returns the AI prompt plus the headline
// metrics that get rendered in Slack, so the frontend never has to run.
import { PLAN_JSON_SHAPE } from './optimizer-ai.ts';

type Client = { from: (t: string) => any };

export interface BriefInput {
  lineKey: string;
  lineLabel: string;
  rangeLabel: string;
  headlineMetrics: string[];
  totals: Record<string, number>;
  prompt: string;
}

const div = (a: number, b: number) => (b > 0 ? a / b : 0);
const money = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
const money2 = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const pct = (n: number) => `${Math.round((Number(n) || 0) * 100)}%`;
const round = (n: number, d = 2) => Number((Number(n) || 0).toFixed(d));

/** Inclusive UTC date window ending yesterday, `days` long. */
export function lastNDays(days: number, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end), label: `${iso(start)} → ${iso(end)} (last ${days} days)` };
}

/* ------------------------------ RRM ------------------------------ */

export const RRM_CLIENT_ID = '4b2434db-6d47-4653-be34-313976790f9d';

function rrmLineOf(text: string | null | undefined): 'windows' | 'plumbing' | 'unassigned' {
  const t = (text || '').toLowerCase();
  if (/window|glass|door/.test(t)) return 'windows';
  if (/plumb|drain|sewer|water heater|water line|pipe|leak/.test(t)) return 'plumbing';
  return 'unassigned';
}

function rrmCampaignLine(name: string | null, platform: string | null): 'windows' | 'plumbing' | 'excluded' {
  const line = rrmLineOf(name);
  if (line !== 'unassigned') return line;
  return (platform || '').toLowerCase() === 'meta' ? 'windows' : 'excluded';
}

export async function buildRRMBriefs(supabase: Client, days = 7): Promise<BriefInput[]> {
  const w = lastNDays(days);

  const [{ data: calls }, { data: spendRows }, { data: creatives }, { data: terms }] = await Promise.all([
    supabase.from('moja_calls').select('*').eq('client_id', RRM_CLIENT_ID)
      .gte('call_start', `${w.from}T00:00:00`).lte('call_start', `${w.to}T23:59:59`),
    supabase.from('ad_campaigns').select('date, campaign_name, platform, spend, impressions, clicks, conversions')
      .eq('client_id', RRM_CLIENT_ID).gte('date', w.from).lte('date', w.to),
    supabase.from('ad_creatives').select('ad_name, campaign_name, platform, spend, impressions, clicks')
      .eq('client_id', RRM_CLIENT_ID).eq('platform', 'meta').gte('date_to', w.from),
    supabase.from('search_terms').select('keyword_text, search_term, campaign_name, spend, clicks, impressions, date')
      .eq('client_id', RRM_CLIENT_ID).gte('date', w.from).lte('date', w.to),
  ]);

  const out: BriefInput[] = [];

  for (const line of ['windows', 'plumbing'] as const) {
    const platform = line === 'windows' ? 'meta' : 'google';
    const lineCalls = (calls || []).filter((c: any) => {
      const sl = (c.service_line || '').toLowerCase();
      if (sl === 'windows' || sl === 'plumbing') return sl === line;
      return ((c.platform || '').toLowerCase() === 'meta' ? 'windows' : 'plumbing') === line;
    });
    const lineSpendRows = (spendRows || []).filter((r: any) => rrmCampaignLine(r.campaign_name, r.platform) === line);
    const spend = lineSpendRows.reduce((s: number, r: any) => s + Number(r.spend || 0), 0);
    if (!spend && !lineCalls.length) continue;

    const raw = lineCalls.length;
    const connected = lineCalls.filter((c: any) => c.connected).length;
    const converted = lineCalls.filter((c: any) => c.converted).length;
    const revenue = lineCalls.reduce((s: number, c: any) => s + Number(c.revenue || 0), 0);
    const talk = lineCalls.reduce((s: number, c: any) => s + Number(c.duration_seconds || 0), 0);

    const totals = {
      spend: round(spend),
      raw_calls: raw,
      connected_calls: connected,
      converted_calls: converted,
      revenue: round(revenue),
      profit: round(revenue - spend),
      cost_per_raw_call: round(div(spend, raw)),
      cost_per_connected_call: round(div(spend, connected)),
      cost_per_converted_call: round(div(spend, converted)),
      revenue_per_raw_call: round(div(revenue, raw)),
      connect_rate: round(div(connected, raw), 3),
      avg_talk_seconds: round(div(talk, connected), 0),
    };

    // Campaign level
    const byCampaign = new Map<string, { spend: number; clicks: number; impressions: number; calls: number }>();
    for (const r of lineSpendRows) {
      const k = r.campaign_name || '(unnamed)';
      const e = byCampaign.get(k) || { spend: 0, clicks: 0, impressions: 0, calls: 0 };
      e.spend += Number(r.spend || 0);
      e.clicks += Number(r.clicks || 0);
      e.impressions += Number(r.impressions || 0);
      byCampaign.set(k, e);
    }
    for (const c of lineCalls) {
      const k = c.utm_campaign || c.campaign_name;
      if (k && byCampaign.has(k)) byCampaign.get(k)!.calls += 1;
    }
    const campaigns = [...byCampaign.entries()]
      .sort((a, b) => b[1].spend - a[1].spend)
      .slice(0, 12)
      .map(([name, e]) => ({
        campaign: name,
        spend: round(e.spend),
        clicks: e.clicks,
        calls: e.calls,
        cost_per_call: e.calls ? round(div(e.spend, e.calls)) : null,
      }));

    // Entity level: Meta creatives (windows) or Google keywords/search terms (plumbing)
    let entities: unknown[] = [];
    if (line === 'windows') {
      const callsByAd = new Map<string, number>();
      for (const c of lineCalls) if (c.utm_content) callsByAd.set(c.utm_content, (callsByAd.get(c.utm_content) || 0) + 1);
      entities = (creatives || [])
        .filter((cr: any) => rrmCampaignLine(cr.campaign_name, 'meta') === 'windows')
        .sort((a: any, b: any) => Number(b.spend || 0) - Number(a.spend || 0))
        .slice(0, 15)
        .map((cr: any) => {
          const n = callsByAd.get(cr.ad_name) || 0;
          return {
            ad: cr.ad_name,
            campaign: cr.campaign_name,
            spend: round(Number(cr.spend || 0)),
            clicks: Number(cr.clicks || 0),
            attributed_calls: n,
            cost_per_call: n ? round(div(Number(cr.spend || 0), n)) : null,
          };
        });
    } else {
      const callsByTerm = new Map<string, number>();
      for (const c of lineCalls) if (c.utm_term) callsByTerm.set(String(c.utm_term).toLowerCase(), (callsByTerm.get(String(c.utm_term).toLowerCase()) || 0) + 1);
      const byKw = new Map<string, { spend: number; clicks: number; calls: number; campaign: string }>();
      for (const t of terms || []) {
        const k = (t.keyword_text || t.search_term || '(none)') as string;
        const e = byKw.get(k) || { spend: 0, clicks: 0, calls: 0, campaign: t.campaign_name || '' };
        e.spend += Number(t.spend || 0);
        e.clicks += Number(t.clicks || 0);
        byKw.set(k, e);
      }
      for (const [k, e] of byKw) e.calls = callsByTerm.get(k.toLowerCase()) || 0;
      entities = [...byKw.entries()]
        .sort((a, b) => b[1].spend - a[1].spend)
        .slice(0, 20)
        .map(([keyword, e]) => ({
          keyword,
          campaign: e.campaign,
          spend: round(e.spend),
          clicks: e.clicks,
          attributed_calls: e.calls,
          cost_per_call: e.calls ? round(div(e.spend, e.calls)) : null,
        }));
    }

    // Hour of day performance — dead hours are a recurring RRM cost sink.
    const byHour = new Map<number, { calls: number; connected: number }>();
    for (const c of lineCalls) {
      const h = new Date(c.call_start).getUTCHours();
      const e = byHour.get(h) || { calls: 0, connected: 0 };
      e.calls += 1;
      if (c.connected) e.connected += 1;
      byHour.set(h, e);
    }
    const hours = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([h, e]) => ({ hour_utc: h, calls: e.calls, connected: e.connected }));

    const lineLabel = line === 'windows' ? 'Windows (Meta)' : 'Plumbing (Google Ads)';

    out.push({
      lineKey: line,
      lineLabel,
      rangeLabel: w.label,
      totals,
      headlineMetrics: [
        `*Spend*\n${money(spend)}`,
        `*Raw calls*\n${raw}`,
        `*Cost / raw call*\n${money2(totals.cost_per_raw_call)}`,
        `*Connect rate*\n${pct(totals.connect_rate)}`,
        `*Revenue*\n${money(revenue)}`,
        `*Profit*\n${money(revenue - spend)}`,
      ],
      prompt: `You are a senior pay-per-call media buying strategist writing a weekly optimization brief for Belu, the media buyer running ${platform === 'meta' ? 'Meta Ads' : 'Google Ads'} for RRM (US home services lead generation, calls tracked in Moja).

SERVICE LINE UNDER REVIEW: ${lineLabel}
Reporting window: ${w.label}

Cost per raw call is the north-star efficiency metric; connect rate and cost per connected call show buyer-side quality.

LINE TOTALS:
${JSON.stringify(totals, null, 1)}

CAMPAIGN LEVEL:
${JSON.stringify(campaigns, null, 1)}

${line === 'windows' ? 'META CREATIVE LEVEL (calls matched via utm_content):' : 'GOOGLE KEYWORD / SEARCH TERM LEVEL (calls matched via utm_term):'}
${JSON.stringify(entities, null, 1)}

CALLS BY HOUR (UTC):
${JSON.stringify(hours, null, 1)}

Write the plan. Rules:
- Be specific and executable inside ${platform === 'meta' ? 'Meta Ads Manager' : 'Google Ads'}: name the exact campaign, ad set/ad group, ad or keyword and give a concrete budget/bid/negative-keyword/creative action with numbers.
- Quantify impact using only the data given. Never invent metrics.
- Ignore entities under $25 spend unless the point is that they need more data.
- Flag attribution gaps when many calls carry no creative/keyword match.
- Call out dead hours if calls cluster outside business hours with no connections.
- Prioritize highest expected impact first, at most 5 recommendations.

Return ONLY valid JSON in this exact shape:
${PLAN_JSON_SHAPE}`,
    });
  }

  return out;
}

/* ------------------------------ Jacuzzi ------------------------------ */

export async function buildJacuzziBriefs(supabase: Client, clientId: string, days = 7): Promise<BriefInput[]> {
  const w = lastNDays(days);

  const [{ data: delivery }, { data: calls }, { data: leads }] = await Promise.all([
    supabase.from('jacuzzi_delivery').select('date, station_code, campaign_name, impressions, spend, cpm')
      .eq('client_id', clientId).gte('date', w.from).lte('date', w.to),
    supabase.from('ringfuel_calls').select('call_id, did, campaign_name, creative_label, call_start, duration_seconds, connected, converted, revenue, payout, caller_state')
      .eq('client_id', clientId).gte('call_start', `${w.from}T00:00:00`).lte('call_start', `${w.to}T23:59:59`),
    supabase.from('jacuzzi_leads').select('transaction_date, lead_type, station_code, attributed_station, payout_rate, call_status')
      .eq('client_id', clientId).gte('transaction_date', w.from).lte('transaction_date', w.to),
  ]);

  const spend = (delivery || []).reduce((s: number, r: any) => s + Number(r.spend || 0), 0);
  const impressions = (delivery || []).reduce((s: number, r: any) => s + Number(r.impressions || 0), 0);
  const raw = (calls || []).length;
  const connected = (calls || []).filter((c: any) => c.connected).length;
  const recognized = (leads || []).length;
  const revenue = (leads || []).reduce((s: number, r: any) => s + Number(r.payout_rate || 0), 0);
  if (!spend && !raw && !recognized) return [];

  const totals = {
    spend: round(spend),
    impressions,
    cpm: round(div(spend, impressions) * 1000),
    raw_calls: raw,
    connected_calls: connected,
    recognized_leads: recognized,
    revenue: round(revenue),
    profit: round(revenue - spend),
    cost_per_raw_call: round(div(spend, raw)),
    cost_per_recognized_lead: round(div(spend, recognized)),
    recognition_rate: round(div(recognized, raw), 3),
    roas: round(div(revenue, spend)),
  };

  // Station level: spend from delivery, leads from recognized records.
  const stations = new Map<string, { spend: number; impressions: number; leads: number; revenue: number; calls: number }>();
  const bump = (k: string) => {
    if (!stations.has(k)) stations.set(k, { spend: 0, impressions: 0, leads: 0, revenue: 0, calls: 0 });
    return stations.get(k)!;
  };
  for (const r of delivery || []) {
    const e = bump(r.station_code || '(unknown)');
    e.spend += Number(r.spend || 0);
    e.impressions += Number(r.impressions || 0);
  }
  for (const l of leads || []) {
    const e = bump(l.attributed_station || l.station_code || '(unknown)');
    e.leads += 1;
    e.revenue += Number(l.payout_rate || 0);
  }
  const stationRows = [...stations.entries()]
    .sort((a, b) => b[1].spend - a[1].spend)
    .map(([station, e]) => ({
      station,
      spend: round(e.spend),
      impressions: e.impressions,
      cpm: round(div(e.spend, e.impressions) * 1000),
      recognized_leads: e.leads,
      revenue: round(e.revenue),
      profit: round(e.revenue - e.spend),
      cost_per_lead: e.leads ? round(div(e.spend, e.leads)) : null,
    }));

  // Creative / DID level from RingFuel.
  const byCreative = new Map<string, { calls: number; connected: number; talk: number }>();
  for (const c of calls || []) {
    const k = c.creative_label || c.campaign_name || c.did || '(unlabeled)';
    const e = byCreative.get(k) || { calls: 0, connected: 0, talk: 0 };
    e.calls += 1;
    if (c.connected) e.connected += 1;
    e.talk += Number(c.duration_seconds || 0);
    byCreative.set(k, e);
  }
  const creatives = [...byCreative.entries()]
    .sort((a, b) => b[1].calls - a[1].calls)
    .slice(0, 15)
    .map(([creative, e]) => ({ creative, calls: e.calls, connected: e.connected, avg_talk_seconds: round(div(e.talk, e.calls), 0) }));

  const leadMix = {
    call_leads: (leads || []).filter((l: any) => (l.lead_type || '').toLowerCase().includes('call')).length,
    qr_leads: (leads || []).filter((l: any) => (l.lead_type || '').toLowerCase().includes('qr')).length,
  };

  return [{
    lineKey: 'ctv',
    lineLabel: 'Roku CTV — Walk-in Tubs',
    rangeLabel: w.label,
    totals,
    headlineMetrics: [
      `*Media spend*\n${money(spend)}`,
      `*Recognized leads*\n${recognized}`,
      `*Cost / lead*\n${money2(totals.cost_per_recognized_lead)}`,
      `*Revenue*\n${money(revenue)}`,
      `*Profit*\n${money(revenue - spend)}`,
      `*ROAS*\n${totals.roas.toFixed(2)}x`,
    ],
    prompt: `You are a senior CTV performance strategist writing a weekly optimization brief for the media buyer running Roku CTV for Jacuzzi walk-in tubs. Calls are tracked in RingFuel; Jacuzzi pays a flat payout per recognized lead.

Reporting window: ${w.label}

Cost per recognized lead versus the payout rate decides profitability. Station-level (CT-code) delivery is the main lever.

ACCOUNT TOTALS:
${JSON.stringify(totals, null, 1)}

STATION LEVEL:
${JSON.stringify(stationRows, null, 1)}

CREATIVE / DID LEVEL (RingFuel calls):
${JSON.stringify(creatives, null, 1)}

LEAD MIX: ${JSON.stringify(leadMix)}

Write the plan. Rules:
- Name the exact station code or creative and give a concrete delivery, budget, CPM-target or creative action with numbers.
- Compare each station's cost per recognized lead against the blended payout to decide scale versus cut.
- Quantify impact using only the data given. Never invent metrics.
- Flag reconciliation/attribution gaps when recognized leads fall far below raw calls.
- Prioritize highest expected impact first, at most 5 recommendations.

Return ONLY valid JSON in this exact shape:
${PLAN_JSON_SHAPE}`,
  }];
}
