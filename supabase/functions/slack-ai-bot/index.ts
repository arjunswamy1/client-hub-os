import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAnthropic, truncate } from "../_shared/anthropic.ts";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const SLACK_SIGNING_SECRET = Deno.env.get('SLACK_SIGNING_SECRET')!;
const SLACK_CLIENT_ID = Deno.env.get('SLACK_CLIENT_ID')!;
const SLACK_CLIENT_SECRET = Deno.env.get('SLACK_CLIENT_SECRET')!;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const DIRECT_CHANNEL_TYPES = new Set(['im', 'app_home']);
const PENDING_REPLY_TEXT = 'Got it — thinking…';

// ─── Token rotation helpers ────────────────────────────────────────────────

async function getValidBotToken(): Promise<string> {
  const { data: row } = await supabase
    .from('slack_tokens')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (row) {
    const expiresAt = new Date(row.expires_at);
    if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
      return row.bot_access_token;
    }
    console.log('Token expired or expiring soon, refreshing...');
    return await refreshToken(row.refresh_token, row.workspace_id);
  }

  const staticToken = Deno.env.get('SLACK_BOT_TOKEN');
  if (staticToken) {
    console.log('Exchanging static bot token for rotating tokens...');
    return await exchangeStaticToken(staticToken);
  }

  throw new Error('No Slack bot token available.');
}

async function exchangeStaticToken(token: string): Promise<string> {
  const res = await fetch('https://slack.com/api/oauth.v2.exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      token,
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error('oauth.v2.exchange failed:', data.error);
    return token;
  }
  const expiresAt = new Date(Date.now() + (data.expires_in || 43200) * 1000);
  const workspaceId = data.team?.id || 'default';

  await supabase.from('slack_tokens').upsert({
    workspace_id: workspaceId,
    bot_access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' });

  return data.access_token;
}

async function refreshToken(rt: string, workspaceId: string): Promise<string> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: rt,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Token refresh failed: ${data.error}`);
  const expiresAt = new Date(Date.now() + (data.expires_in || 43200) * 1000);

  await supabase.from('slack_tokens').upsert({
    workspace_id: workspaceId,
    bot_access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' });

  return data.access_token;
}

// ─── Slack helpers ─────────────────────────────────────────────────────────

async function verifySlackSignature(body: string, timestamp: string, signature: string): Promise<boolean> {
  try {
    const sigBasestring = `v0:${timestamp}:${body}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(SLACK_SIGNING_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sigBasestring));
    const hashHex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `v0=${hashHex}` === signature;
  } catch (e) {
    console.error('Signature verification error:', e);
    return false;
  }
}

function getCleanMessageText(text: string) {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

function isDirectConversationEvent(event: any) {
  return event.type === 'message' && DIRECT_CHANNEL_TYPES.has(event.channel_type || '');
}

function mapSlackMessagesToConversation(messages: any[], botUserId: string | null) {
  return messages
    .filter((m: any) => !m.subtype)
    .map((m: any) => ({
      role: m.user === botUserId ? 'assistant' : 'user',
      content: getCleanMessageText(m.text || ''),
    }))
    .filter((m: any) => m.content.length > 0 && m.content !== PENDING_REPLY_TEXT);
}

async function getBotUserId(token: string): Promise<string | null> {
  const res = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  return data.ok ? data.user_id : null;
}

async function getConversationHistory(
  token: string,
  channel: string,
  threadTs: string,
  isDirectConversation: boolean,
): Promise<Array<{ role: string; content: string }>> {
  const endpoint = isDirectConversation
    ? `https://slack.com/api/conversations.history?channel=${channel}&limit=12`
    : `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=20`;

  const res = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  if (!data.ok || !data.messages) return [];

  const botUserId = await getBotUserId(token);
  const orderedMessages = isDirectConversation ? [...data.messages].reverse() : data.messages;
  return mapSlackMessagesToConversation(orderedMessages, botUserId);
}

// ─── Client detection & filters ────────────────────────────────────────────

const CLIENT_PATTERNS: Record<string, string[]> = {
  billy: ['billy', 'kwca', 'billy.com'],
  'tinned-fish-club': ['tinned', 'tfc', 'tinned fish'],
  phantasmagorical: ['phantas', 'phant', 'phantasmagorical'],
};

const VERTICAL_KEYWORDS: Record<string, { keywords: string[]; label: string }> = {
  'pest-control': { keywords: ['pest', 'pest control', 'bed bug', 'bedbug'], label: 'Pest Control' },
  flights: { keywords: ['flight', 'flights', 'airline'], label: 'Flights' },
  'porta-potties': { keywords: ['porta', 'potty', 'porta potty', 'portapotty'], label: 'Porta Potties' },
};

interface VerticalFilter {
  patterns: string[];
  accountIds: string[];
  exactMatch?: boolean;
}

interface PlatformSummary {
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
}

interface MetricSummary {
  totalSpend: number;
  totalRevenue: number;
  totalConversions: number;
  totalClicks: number;
  totalImpressions: number;
  totalRoas: number | null;
  totalCpa: number | null;
  ringbaRevenue: number;
  ringbaConvertedCalls: number;
  ringbaTotalCalls: number;
  usesRingbaRevenue: boolean;
  totalCtr: number | null;
  byPlatform: Record<string, PlatformSummary>;
  campaignCount: number;
  topCampaigns: Array<{
    name: string;
    platform: string;
    spend: number;
    revenue: number;
    conversions: number;
    status: string;
  }>;
}

interface LatestAvailableData {
  date: string;
  summary: MetricSummary;
}

interface UserContext {
  name: string;
  tzOffsetSeconds: number;
  timeZone: string | null;
}

interface ClientData {
  recentMetrics: string;
  campaignBreakdown: string;
  tasks: string;
  recentContext: string;
  ringbaData: string;
  creativesTable: string;
  keywordsTable: string;
  summary: MetricSummary | null;
  latestAvailable: LatestAvailableData | null;
}

async function detectClientFromText(text: string): Promise<{ id: string; name: string; slug: string } | null> {
  const lower = text.toLowerCase();
  for (const [slug, keywords] of Object.entries(CLIENT_PATTERNS)) {
    if (keywords.some((k) => lower.includes(k))) {
      const { data: client } = await supabase
        .from('clients')
        .select('id, name, slug')
        .eq('slug', slug)
        .maybeSingle();
      if (client) return client;
    }
  }
  return null;
}

async function detectClientFromChannel(token: string, channelId: string): Promise<{ id: string; name: string; slug: string } | null> {
  const chanRes = await fetch(`https://slack.com/api/conversations.info?channel=${channelId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const chanData = await chanRes.json();
  const channelName = chanData.channel?.name || '';
  if (!channelName) return null;
  return detectClientFromText(channelName);
}

function detectVerticalFromText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [id, { keywords }] of Object.entries(VERTICAL_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) return id;
  }
  return null;
}

function detectPlatformFromText(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('google') || lower.includes('search ads') || lower.includes('adwords') || lower.includes('ppc')) {
    return 'google';
  }
  if (lower.includes('meta') || lower.includes('facebook') || lower.includes('instagram') || lower.includes('fb')) {
    return 'meta';
  }
  return null;
}

function getMetricIntent(text: string): 'spend' | 'revenue' | 'roas' | 'conversions' | 'cpa' | 'ctr' | 'performance' | null {
  const lower = text.toLowerCase();
  if (lower.includes('how much') && lower.includes('spend')) return 'spend';
  if (lower.includes('spent') || lower.includes('spend') || lower.includes('cost')) return 'spend';
  if (lower.includes('revenue') || lower.includes('made') || lower.includes('earned')) return 'revenue';
  if (lower.includes('roas')) return 'roas';
  if (lower.includes('conversions') || lower.includes('leads')) return 'conversions';
  if (lower.includes('cpa') || lower.includes('cost per acquisition') || lower.includes('cost per conversion')) return 'cpa';
  if (lower.includes('ctr') || lower.includes('click through rate')) return 'ctr';
  if (lower.includes('perform') || lower.includes('doing') || lower.includes('performance') || lower.includes('how is') || lower.includes('how are')) return 'performance';
  return null;
}

function isMetricQuestion(text: string): boolean {
  return getMetricIntent(text) !== null;
}

function formatCurrency(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number | null): string {
  return value === null ? 'N/A' : `${value.toFixed(2)}%`;
}

function formatRatio(value: number | null): string {
  return value === null ? 'N/A' : `${value.toFixed(2)}x`;
}

function getVerticalConfig(verticalId: string | null): Record<string, VerticalFilter> {
  if (!verticalId) return {};

  const hardcoded: Record<string, Record<string, VerticalFilter>> = {
    'pest-control': {
      meta: {
        patterns: ['Pest', 'PestControl', 'Bed Bug', 'BedBug'],
        accountIds: ['448669084867269', '1779578786137314'],
      },
      google: {
        patterns: ['Pest', 'Bed Bug', 'BedBug'],
        accountIds: ['1939246766'],
      },
      ringba: {
        patterns: ['Pest Control US Call Flow'],
        accountIds: [],
        exactMatch: true,
      },
    },
    flights: {
      meta: { patterns: ['Flight'], accountIds: [] },
      google: { patterns: ['Flight'], accountIds: [] },
      ringba: { patterns: ['Flight'], accountIds: [] },
    },
    'porta-potties': {
      meta: { patterns: ['Porta', 'Potty'], accountIds: [] },
      google: { patterns: ['Porta', 'Potty'], accountIds: ['1939246766'] },
      ringba: { patterns: ['Porta', 'Potty', 'Portapotty'], accountIds: [] },
    },
  };

  return hardcoded[verticalId] || {};
}

function summarizeCampaignRows(campaignRows: Array<{
  campaign_name: string;
  platform: string;
  spend: number | string | null;
  revenue: number | string | null;
  conversions: number | string | null;
  clicks: number | string | null;
  impressions: number | string | null;
  status?: string | null;
}>): MetricSummary | null {
  if (campaignRows.length === 0) return null;

  const byPlatform: Record<string, PlatformSummary> = {};
  const byCampaign: Record<string, { platform: string; spend: number; revenue: number; conversions: number; status: string }> = {};
  let totalSpend = 0;
  let totalRevenue = 0;
  let totalConversions = 0;
  let totalClicks = 0;
  let totalImpressions = 0;

  for (const campaign of campaignRows) {
    const platform = campaign.platform || 'unknown';
    const spend = Number(campaign.spend) || 0;
    const revenue = Number(campaign.revenue) || 0;
    const conversions = Number(campaign.conversions) || 0;
    const clicks = Number(campaign.clicks) || 0;
    const impressions = Number(campaign.impressions) || 0;

    if (!byPlatform[platform]) {
      byPlatform[platform] = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
    }
    byPlatform[platform].spend += spend;
    byPlatform[platform].revenue += revenue;
    byPlatform[platform].conversions += conversions;
    byPlatform[platform].clicks += clicks;
    byPlatform[platform].impressions += impressions;

    const campaignKey = `${campaign.campaign_name}|${platform}`;
    if (!byCampaign[campaignKey]) {
      byCampaign[campaignKey] = {
        platform,
        spend: 0,
        revenue: 0,
        conversions: 0,
        status: campaign.status || 'unknown',
      };
    }
    byCampaign[campaignKey].spend += spend;
    byCampaign[campaignKey].revenue += revenue;
    byCampaign[campaignKey].conversions += conversions;

    totalSpend += spend;
    totalRevenue += revenue;
    totalConversions += conversions;
    totalClicks += clicks;
    totalImpressions += impressions;
  }

  const topCampaigns = Object.entries(byCampaign)
    .sort((a, b) => b[1].spend - a[1].spend)
    .slice(0, 10)
    .map(([key, value]) => ({
      name: key.split('|')[0],
      platform: value.platform,
      spend: value.spend,
      revenue: value.revenue,
      conversions: value.conversions,
      status: value.status,
    }));

  return {
    totalSpend,
    totalRevenue,
    totalConversions,
    totalClicks,
    totalImpressions,
    totalRoas: totalSpend > 0 ? totalRevenue / totalSpend : null,
    totalCpa: totalConversions > 0 ? totalSpend / totalConversions : null,
    totalCtr: totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null,
    byPlatform,
    campaignCount: campaignRows.length,
    topCampaigns,
    ringbaRevenue: 0,
    ringbaConvertedCalls: 0,
    ringbaTotalCalls: 0,
    usesRingbaRevenue: false,
  };
}

async function getClientData(
  clientId: string,
  dateRange: { from: string; to: string },
  verticalId: string | null,
  platformFilter: string | null,
): Promise<ClientData> {
  let verticalPatterns = getVerticalConfig(verticalId);

  if (verticalId) {
    const { data: dbVertical } = await supabase
      .from('client_verticals')
      .select('*')
      .eq('client_id', clientId)
      .eq('vertical_id', verticalId)
      .maybeSingle();

    if (dbVertical) {
      verticalPatterns = {
        meta: {
          patterns: dbVertical.meta_patterns,
          accountIds: dbVertical.meta_account_ids,
        },
        google: {
          patterns: dbVertical.google_patterns,
          accountIds: dbVertical.google_account_ids,
        },
        ringba: {
          patterns: dbVertical.ringba_patterns,
          accountIds: [],
          exactMatch: dbVertical.ringba_exact_match,
        },
      };
    }
  }

  function campaignMatchesVertical(campaignName: string, platform: string): boolean {
    if (!verticalId || Object.keys(verticalPatterns).length === 0) return true;
    const config = verticalPatterns[platform];
    if (!config || config.patterns.length === 0) return true;
    const lower = campaignName.toLowerCase();
    if (config.exactMatch) {
      return config.patterns.some((pattern) => lower === pattern.toLowerCase());
    }
    return config.patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
  }

  function accountMatchesVertical(accountId: string | null, platform: string): boolean {
    if (!verticalId || Object.keys(verticalPatterns).length === 0) return true;
    const config = verticalPatterns[platform];
    if (!config || config.accountIds.length === 0) return true;
    if (!accountId) return false;
    return config.accountIds.includes(accountId);
  }

  let campaignQuery = supabase
    .from('ad_campaigns')
    .select('campaign_name, platform, spend, revenue, conversions, clicks, impressions, status, date, account_id')
    .eq('client_id', clientId)
    .gte('date', dateRange.from)
    .lte('date', dateRange.to)
    .order('spend', { ascending: false })
    .limit(250);

  if (platformFilter) {
    campaignQuery = campaignQuery.eq('platform', platformFilter);
  }

  const [campaignsRes, tasksRes, contextRes, ringbaRes, dashConfigRes, creativesRes, keywordsRes] = await Promise.all([
    campaignQuery,
    supabase
      .from('tasks')
      .select('title, status, priority, due_date, description')
      .eq('client_id', clientId)
      .in('status', ['todo', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(25),
    // CONTEXT FEED — Slack/Fathom/email trimmed to 30 days, 80 items
    supabase
      .from('context_items')
      .select('title, content, content_type, source, occurred_at, participants, metadata')
      .eq('client_id', clientId)
      .gte('occurred_at', new Date(Date.now() - 30 * 86400000).toISOString())
      .order('occurred_at', { ascending: false })
      .limit(80),
    supabase
      .from('ringba_calls')
      .select('call_date, revenue, payout, converted, connected, duration_seconds, campaign_name, target_name')
      .eq('client_id', clientId)
      .gte('call_date', dateRange.from)
      .lte('call_date', dateRange.to)
      .order('call_date', { ascending: false })
      .limit(1500),
    supabase
      .from('dashboard_configs')
      .select('revenue_source')
      .eq('client_id', clientId)
      .maybeSingle(),
    // CREATIVES — top 30 by spend
    supabase
      .from('ad_creatives')
      .select('campaign_name, ad_name, platform, spend, revenue, conversions, ctr, cpa, roas, headline, status, creative_type, format')
      .eq('client_id', clientId)
      .gte('date_from', dateRange.from)
      .order('spend', { ascending: false })
      .limit(30),
    // GOOGLE KEYWORDS — top 30 by spend
    supabase
      .from('campaign_keywords')
      .select('keyword, ad_group, campaign_name, match_type, platform, spend, clicks, conversions, ctr, cpc, cpa, quality_score, is_negative')
      .eq('client_id', clientId)
      .gte('date', dateRange.from)
      .order('spend', { ascending: false })
      .limit(30),
  ]);

  const usesRingbaRevenue = dashConfigRes.data?.revenue_source === 'ringba';

  const filteredCampaigns = (campaignsRes.data || []).filter((campaign) => {
    if (!campaignMatchesVertical(campaign.campaign_name, campaign.platform)) return false;
    if (!accountMatchesVertical(campaign.account_id, campaign.platform)) return false;
    return true;
  });

  // Pre-filter Ringba calls by vertical
  const filteredCalls = (ringbaRes.data || []).filter((call: any) => {
    if (!verticalId || Object.keys(verticalPatterns).length === 0) return true;
    const config = verticalPatterns.ringba;
    if (!config || config.patterns.length === 0) return true;
    const name = (call.campaign_name || '').toLowerCase();
    if (config.exactMatch) {
      return config.patterns.some((pattern: string) => name === pattern.toLowerCase());
    }
    return config.patterns.some((pattern: string) => name.includes(pattern.toLowerCase()));
  });

  let summary: MetricSummary | null = null;
  let latestAvailable: LatestAvailableData | null = null;
  let recentMetrics = '';
  let campaignBreakdown = '';

  if (filteredCampaigns.length > 0) {
    const byPlatform: Record<string, PlatformSummary> = {};
    const byDate: Record<string, { spend: number; revenue: number; conversions: number }> = {};
    const byCampaign: Record<string, { platform: string; spend: number; revenue: number; conversions: number; status: string }> = {};

    let totalSpend = 0;
    let totalRevenue = 0;
    let totalConversions = 0;
    let totalClicks = 0;
    let totalImpressions = 0;

    for (const campaign of filteredCampaigns) {
      const platform = campaign.platform || 'unknown';
      const spend = Number(campaign.spend) || 0;
      const revenue = Number(campaign.revenue) || 0;
      const conversions = Number(campaign.conversions) || 0;
      const clicks = Number(campaign.clicks) || 0;
      const impressions = Number(campaign.impressions) || 0;

      if (!byPlatform[platform]) {
        byPlatform[platform] = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
      }
      byPlatform[platform].spend += spend;
      byPlatform[platform].revenue += revenue;
      byPlatform[platform].conversions += conversions;
      byPlatform[platform].clicks += clicks;
      byPlatform[platform].impressions += impressions;

      if (!byDate[campaign.date]) {
        byDate[campaign.date] = { spend: 0, revenue: 0, conversions: 0 };
      }
      byDate[campaign.date].spend += spend;
      byDate[campaign.date].revenue += revenue;
      byDate[campaign.date].conversions += conversions;

      const campaignKey = `${campaign.campaign_name}|${platform}`;
      if (!byCampaign[campaignKey]) {
        byCampaign[campaignKey] = {
          platform,
          spend: 0,
          revenue: 0,
          conversions: 0,
          status: campaign.status || 'unknown',
        };
      }
      byCampaign[campaignKey].spend += spend;
      byCampaign[campaignKey].revenue += revenue;
      byCampaign[campaignKey].conversions += conversions;

      totalSpend += spend;
      totalRevenue += revenue;
      totalConversions += conversions;
      totalClicks += clicks;
      totalImpressions += impressions;
    }

    const topCampaigns = Object.entries(byCampaign)
      .sort((a, b) => b[1].spend - a[1].spend)
      .slice(0, 10)
      .map(([key, value]) => ({
        name: key.split('|')[0],
        platform: value.platform,
        spend: value.spend,
        revenue: value.revenue,
        conversions: value.conversions,
        status: value.status,
      }));

    // If client uses Ringba as revenue source, override revenue & conversions with Ringba data
    let ringbaRev = 0;
    let ringbaConv = 0;
    let ringbaTotal = 0;

    if (usesRingbaRevenue && filteredCalls.length > 0) {
      for (const call of filteredCalls) {
        ringbaRev += Number(call.revenue) || 0;
        if (call.converted) ringbaConv++;
        ringbaTotal++;
      }
      // Replace ad platform revenue with Ringba revenue
      totalRevenue = ringbaRev;
      totalConversions = ringbaConv;

      // Also update daily breakdown with Ringba revenue
      for (const [dateKey] of Object.entries(byDate)) {
        byDate[dateKey].revenue = 0;
        byDate[dateKey].conversions = 0;
      }
      for (const call of filteredCalls) {
        const callDateKey = (call.call_date || '').split('T')[0];
        if (callDateKey && byDate[callDateKey]) {
          byDate[callDateKey].revenue += Number(call.revenue) || 0;
          if (call.converted) byDate[callDateKey].conversions++;
        }
      }
    }

    const totalRoas = totalSpend > 0 ? totalRevenue / totalSpend : null;
    const totalCpa = totalConversions > 0 ? totalSpend / totalConversions : null;
    const totalCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null;

    summary = {
      totalSpend,
      totalRevenue,
      totalConversions,
      totalClicks,
      totalImpressions,
      totalRoas,
      totalCpa,
      totalCtr,
      byPlatform,
      campaignCount: filteredCampaigns.length,
      topCampaigns,
      ringbaRevenue: ringbaRev,
      ringbaConvertedCalls: ringbaConv,
      ringbaTotalCalls: ringbaTotal,
      usesRingbaRevenue,
    };

    const verticalLabel = verticalId ? VERTICAL_KEYWORDS[verticalId]?.label || verticalId : 'All Verticals';
    const platformLabel = platformFilter ? ` (${platformFilter})` : '';

    recentMetrics = `📊 ${verticalLabel}${platformLabel} Performance (${dateRange.from} to ${dateRange.to}):\n`;
    recentMetrics += `*Total:* Spend ${formatCurrency(totalSpend)} | Revenue ${formatCurrency(totalRevenue)} | ROAS ${formatRatio(totalRoas)} | Conversions ${totalConversions} | CPA ${totalCpa === null ? 'N/A' : formatCurrency(totalCpa)}\n`;

    for (const [platform, data] of Object.entries(byPlatform)) {
      const ctr = data.impressions > 0 ? (data.clicks / data.impressions) * 100 : null;
      const cpa = data.conversions > 0 ? data.spend / data.conversions : null;
      const roas = data.spend > 0 ? data.revenue / data.spend : null;
      recentMetrics += `  ${platform}: Spend ${formatCurrency(data.spend)} | Rev ${formatCurrency(data.revenue)} | ROAS ${formatRatio(roas)} | Conv ${data.conversions} | CPA ${cpa === null ? 'N/A' : formatCurrency(cpa)} | CTR ${formatPercent(ctr)}\n`;
    }

    const sortedDates = Object.entries(byDate)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 7);

    if (sortedDates.length > 0) {
      recentMetrics += '\nDaily breakdown:\n';
      for (const [date, data] of sortedDates) {
        const dayRoas = data.spend > 0 ? data.revenue / data.spend : null;
        recentMetrics += `  ${date}: ${formatCurrency(data.spend)} spend, ${formatCurrency(data.revenue)} rev, ${data.conversions} conv, ROAS ${formatRatio(dayRoas)}\n`;
      }
    }

    campaignBreakdown = '\n🎯 Top Campaigns:\n';
    for (const campaign of topCampaigns.slice(0, 10)) {
      const cpa = campaign.conversions > 0 ? campaign.spend / campaign.conversions : null;
      const roas = campaign.spend > 0 ? campaign.revenue / campaign.spend : null;
      campaignBreakdown += `  • ${campaign.name} (${campaign.platform}): ${formatCurrency(campaign.spend)} spend, ${campaign.conversions} conv, CPA ${cpa === null ? 'N/A' : formatCurrency(cpa)}, ROAS ${formatRatio(roas)} [${campaign.status}]\n`;
    }
  }

  let tasks = '';
  if (tasksRes.data?.length) {
    tasks = `\n📋 Open Tasks (${tasksRes.data.length}):\n`;
    for (const task of tasksRes.data) {
      tasks += `  • [${task.priority}] ${task.title} (${task.status})${task.due_date ? ` due ${task.due_date}` : ''}\n`;
    }
  }

  let recentContext = '';
  if (contextRes.data?.length) {
    const fathom = contextRes.data.filter((c: any) => c.source === 'fathom');
    const slack = contextRes.data.filter((c: any) => c.source === 'slack');
    const emails = contextRes.data.filter((c: any) => c.source === 'email' || c.source === 'gmail');
    const other = contextRes.data.filter((c: any) => !['fathom', 'slack', 'email', 'gmail'].includes(c.source));

    if (fathom.length) {
      recentContext += `\n🎙️ Fathom Meeting Recordings (last 90d):\n`;
      for (const m of fathom.slice(0, 15)) {
        recentContext += `  • [${(m.occurred_at || '').slice(0, 10)}] ${m.title}${(m.participants || []).length ? ' — ' + (m.participants || []).join(', ') : ''}\n    ${(m.content || '').slice(0, 600).replace(/\n/g, ' ')}\n`;
      }
    }
    if (slack.length) {
      recentContext += `\n💬 Slack Communications (last 90d):\n`;
      for (const s of slack.slice(0, 50)) {
        recentContext += `  • [${(s.occurred_at || '').slice(0, 10)}] ${s.title || s.content_type}: ${(s.content || '').slice(0, 400).replace(/\n/g, ' ')}\n`;
      }
    }
    if (emails.length) {
      recentContext += `\n✉️ Email Threads (last 90d):\n`;
      for (const e of emails.slice(0, 15)) {
        recentContext += `  • [${(e.occurred_at || '').slice(0, 10)}] ${e.title}: ${(e.content || '').slice(0, 350).replace(/\n/g, ' ')}\n`;
      }
    }
    if (other.length) {
      recentContext += `\n📝 Other Notes/Docs:\n`;
      for (const o of other.slice(0, 15)) {
        recentContext += `  • [${o.source} • ${(o.occurred_at || '').slice(0, 10)}] ${o.title}: ${(o.content || '').slice(0, 300).replace(/\n/g, ' ')}\n`;
      }
    }
  }

  // Creatives table
  let creativesTable = '';
  if (creativesRes.data?.length) {
    creativesTable = `\n🎨 Top Creatives (by spend):\n`;
    for (const c of creativesRes.data.slice(0, 30)) {
      creativesTable += `  • ${c.ad_name || c.headline || '(no name)'} (${c.platform}, ${c.creative_type || c.format || 'n/a'}): ${formatCurrency(Number(c.spend || 0))} spend, ${c.conversions || 0} conv, CTR ${c.ctr || 'N/A'}%, CPA ${c.cpa ? formatCurrency(Number(c.cpa)) : 'N/A'}\n`;
    }
  }

  // Keywords table
  let keywordsTable = '';
  if (keywordsRes.data?.length) {
    keywordsTable = `\n🔑 Top Keywords (Google):\n`;
    for (const k of keywordsRes.data.slice(0, 30)) {
      keywordsTable += `  • ${k.keyword} [${k.match_type || 'n/a'}] (${k.ad_group} / ${k.campaign_name}): ${formatCurrency(Number(k.spend || 0))} spend, ${k.clicks || 0} clicks, ${k.conversions || 0} conv, QS ${k.quality_score || 'N/A'}${k.is_negative ? ' [NEG]' : ''}\n`;
    }
  }

  let ringbaData = '';

  if (filteredCalls.length > 0) {
    const totalCalls = filteredCalls.length;
    const connectedCalls = filteredCalls.filter((call) => call.connected).length;
    const convertedCalls = filteredCalls.filter((call) => call.converted).length;
    const totalRevenue = filteredCalls.reduce((sum, call) => sum + (Number(call.revenue) || 0), 0);
    const totalPayout = filteredCalls.reduce((sum, call) => sum + (Number(call.payout) || 0), 0);
    const avgDuration = filteredCalls.reduce((sum, call) => sum + (call.duration_seconds || 0), 0) / totalCalls;

    ringbaData = `\n📞 Ringba Calls (${dateRange.from} to ${dateRange.to}):\n`;
    ringbaData += `  Total: ${totalCalls} calls | Connected: ${connectedCalls} | Converted: ${convertedCalls}\n`;
    ringbaData += `  Revenue: ${formatCurrency(totalRevenue)} | Payout: ${formatCurrency(totalPayout)} | Avg Duration: ${Math.round(avgDuration)}s\n`;
  }

  if (!summary) {
    let latestQuery = supabase
      .from('ad_campaigns')
      .select('campaign_name, platform, spend, revenue, conversions, clicks, impressions, status, date, account_id')
      .eq('client_id', clientId)
      .order('date', { ascending: false })
      .limit(1000);

    if (platformFilter) {
      latestQuery = latestQuery.eq('platform', platformFilter);
    }

    const { data: latestRows } = await latestQuery;
    const latestFiltered = (latestRows || []).filter((campaign) => {
      if (!campaignMatchesVertical(campaign.campaign_name, campaign.platform)) return false;
      if (!accountMatchesVertical(campaign.account_id, campaign.platform)) return false;
      return true;
    });

    if (latestFiltered.length > 0) {
      const latestDate = latestFiltered[0].date;
      const latestDateRows = latestFiltered.filter((campaign) => campaign.date === latestDate);
      const latestSummary = summarizeCampaignRows(latestDateRows);
      if (latestSummary) {
        // Also merge Ringba revenue for the latest date if applicable
        if (usesRingbaRevenue) {
          const { data: latestRingba } = await supabase
            .from('ringba_calls')
            .select('revenue, converted')
            .eq('client_id', clientId)
            .gte('call_date', `${latestDate}T00:00:00`)
            .lte('call_date', `${latestDate}T23:59:59`)
            .limit(500);

          if (latestRingba && latestRingba.length > 0) {
            let rRev = 0;
            let rConv = 0;
            for (const c of latestRingba) {
              rRev += Number(c.revenue) || 0;
              if (c.converted) rConv++;
            }
            latestSummary.totalRevenue = rRev;
            latestSummary.totalConversions = rConv;
            latestSummary.totalRoas = latestSummary.totalSpend > 0 ? rRev / latestSummary.totalSpend : null;
            latestSummary.totalCpa = rConv > 0 ? latestSummary.totalSpend / rConv : null;
            latestSummary.ringbaRevenue = rRev;
            latestSummary.ringbaConvertedCalls = rConv;
            latestSummary.usesRingbaRevenue = true;
          }
        }
        latestAvailable = {
          date: latestDate,
          summary: latestSummary,
        };
      }
    }
  }

  return { recentMetrics, campaignBreakdown, tasks, recentContext, ringbaData, creativesTable, keywordsTable, summary, latestAvailable };
}

const DEFAULT_BUSINESS_TIME_ZONE = 'America/New_York';

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatShiftedDate(date: Date): string {
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

function normalizeDateParts(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return formatShiftedDate(candidate);
}

function parseExplicitDate(text: string, fallbackYear: number): string | null {
  const isoMatch = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    return normalizeDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!slashMatch) {
    return null;
  }

  const yearToken = slashMatch[3];
  const year = !yearToken
    ? fallbackYear
    : yearToken.length === 2
      ? 2000 + Number(yearToken)
      : Number(yearToken);

  return normalizeDateParts(year, Number(slashMatch[1]), Number(slashMatch[2]));
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return formatShiftedDate(date);
  }

  return `${year}-${month}-${day}`;
}

function getResolvedToday(userContext: Pick<UserContext, 'tzOffsetSeconds' | 'timeZone'>): string {
  const timeZone = userContext.timeZone?.trim();
  if (timeZone && timeZone.toLowerCase() !== 'utc' && timeZone.toLowerCase() !== 'etc/utc') {
    return formatDateInTimeZone(new Date(), timeZone);
  }

  if (userContext.tzOffsetSeconds !== 0) {
    return formatShiftedDate(new Date(Date.now() + userContext.tzOffsetSeconds * 1000));
  }

  return formatDateInTimeZone(new Date(), DEFAULT_BUSINESS_TIME_ZONE);
}

function shiftIsoDate(dateValue: string, days: number): string {
  const shifted = new Date(`${dateValue}T12:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return formatShiftedDate(shifted);
}

function parseDateIntent(
  text: string,
  userContext: Pick<UserContext, 'tzOffsetSeconds' | 'timeZone'>,
): { from: string; to: string; userToday: string } {
  const today = getResolvedToday(userContext);
  const lower = text.toLowerCase();
  const explicitDate = parseExplicitDate(lower, Number(today.slice(0, 4)));

  if (explicitDate) {
    return { from: explicitDate, to: explicitDate, userToday: today };
  }
  if (lower.includes('today')) {
    return { from: today, to: today, userToday: today };
  }
  if (lower.includes('yesterday')) {
    const yesterday = shiftIsoDate(today, -1);
    return { from: yesterday, to: yesterday, userToday: today };
  }
  if (lower.includes('this week') || lower.includes('past week') || lower.includes('last 7')) {
    return { from: shiftIsoDate(today, -7), to: today, userToday: today };
  }
  if (lower.includes('this month') || lower.includes('past month') || lower.includes('last 30')) {
    return { from: shiftIsoDate(today, -30), to: today, userToday: today };
  }

  return { from: shiftIsoDate(today, -7), to: today, userToday: today };
}

async function resolveUserContext(token: string, userId: string): Promise<UserContext> {
  const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  return {
    name: data.user?.profile?.display_name || data.user?.real_name || 'Someone',
    tzOffsetSeconds: data.user?.tz_offset || 0,
    timeZone: data.user?.tz || null,
  };
}

function buildDeterministicMetricReply(
  clientName: string,
  text: string,
  dateRange: { from: string; to: string },
  verticalId: string | null,
  platformFilter: string | null,
  summary: MetricSummary | null,
  latestAvailable: LatestAvailableData | null,
): string {
  const metricIntent = getMetricIntent(text) || 'performance';
  const verticalLabel = verticalId ? VERTICAL_KEYWORDS[verticalId]?.label || verticalId : null;
  const scopeParts = [clientName, verticalLabel, platformFilter].filter(Boolean);
  const scope = scopeParts.join(' • ');
  const dateLabel = dateRange.from === dateRange.to ? dateRange.from : `${dateRange.from} to ${dateRange.to}`;

  if (!summary || summary.campaignCount === 0) {
    if (!latestAvailable) {
      return `I couldn't find campaign data for *${scope}* during *${dateLabel}*.`;
    }

    const lines: string[] = [
      `I don't have *${scope}* data for *${dateLabel}* yet.`,
      `• Latest available date: *${latestAvailable.date}*`,
    ];

    if (metricIntent === 'spend') {
      lines.push(`• Latest spend: *${formatCurrency(latestAvailable.summary.totalSpend)}*`);
      lines.push(`• Latest revenue: ${formatCurrency(latestAvailable.summary.totalRevenue)}`);
      lines.push(`• Latest ROAS: ${formatRatio(latestAvailable.summary.totalRoas)}`);
    } else if (metricIntent === 'revenue') {
      lines.push(`• Latest revenue: *${formatCurrency(latestAvailable.summary.totalRevenue)}*`);
      lines.push(`• Latest spend: ${formatCurrency(latestAvailable.summary.totalSpend)}`);
      lines.push(`• Latest ROAS: ${formatRatio(latestAvailable.summary.totalRoas)}`);
    } else {
      lines.push(`• Latest spend: ${formatCurrency(latestAvailable.summary.totalSpend)}`);
      lines.push(`• Latest revenue: ${formatCurrency(latestAvailable.summary.totalRevenue)}`);
      lines.push(`• Latest conversions: ${latestAvailable.summary.totalConversions}`);
      lines.push(`• Latest ROAS: ${formatRatio(latestAvailable.summary.totalRoas)}`);
    }

    if (!platformFilter && Object.keys(latestAvailable.summary.byPlatform).length > 1) {
      lines.push('• Latest platform breakdown:');
      for (const [platform, data] of Object.entries(latestAvailable.summary.byPlatform)) {
        const roas = data.spend > 0 ? data.revenue / data.spend : null;
        lines.push(`  ◦ ${platform}: ${formatCurrency(data.spend)} spend, ${formatCurrency(data.revenue)} revenue, ${formatRatio(roas)} ROAS`);
      }
    }

    return lines.join('\n');
  }

  const lines: string[] = [`*${scope}* — ${dateLabel}`];
  if (summary.usesRingbaRevenue && summary.ringbaTotalCalls > 0) {
    lines.push(`_Revenue from Ringba calls (${summary.ringbaTotalCalls} calls, ${summary.ringbaConvertedCalls} converted)_`);
  }

  if (metricIntent === 'spend') {
    lines.push(`• Spend: *${formatCurrency(summary.totalSpend)}*`);
    lines.push(`• Revenue: ${formatCurrency(summary.totalRevenue)}`);
    lines.push(`• ROAS: ${formatRatio(summary.totalRoas)}`);
    lines.push(`• Conversions: ${summary.totalConversions}`);
  } else if (metricIntent === 'revenue') {
    lines.push(`• Revenue: *${formatCurrency(summary.totalRevenue)}*`);
    lines.push(`• Spend: ${formatCurrency(summary.totalSpend)}`);
    lines.push(`• ROAS: ${formatRatio(summary.totalRoas)}`);
    lines.push(`• Conversions: ${summary.totalConversions}`);
  } else if (metricIntent === 'roas') {
    lines.push(`• ROAS: *${formatRatio(summary.totalRoas)}*`);
    lines.push(`• Spend: ${formatCurrency(summary.totalSpend)}`);
    lines.push(`• Revenue: ${formatCurrency(summary.totalRevenue)}`);
  } else if (metricIntent === 'conversions') {
    lines.push(`• Conversions: *${summary.totalConversions}*`);
    lines.push(`• Spend: ${formatCurrency(summary.totalSpend)}`);
    lines.push(`• CPA: ${summary.totalCpa === null ? 'N/A' : formatCurrency(summary.totalCpa)}`);
  } else if (metricIntent === 'cpa') {
    lines.push(`• CPA: *${summary.totalCpa === null ? 'N/A' : formatCurrency(summary.totalCpa)}*`);
    lines.push(`• Spend: ${formatCurrency(summary.totalSpend)}`);
    lines.push(`• Conversions: ${summary.totalConversions}`);
  } else if (metricIntent === 'ctr') {
    lines.push(`• CTR: *${formatPercent(summary.totalCtr)}*`);
    lines.push(`• Clicks: ${summary.totalClicks}`);
    lines.push(`• Impressions: ${summary.totalImpressions}`);
  } else {
    lines.push(`• Spend: ${formatCurrency(summary.totalSpend)}`);
    lines.push(`• Revenue: ${formatCurrency(summary.totalRevenue)}`);
    lines.push(`• ROAS: ${formatRatio(summary.totalRoas)}`);
    lines.push(`• Conversions: ${summary.totalConversions}`);
    lines.push(`• CPA: ${summary.totalCpa === null ? 'N/A' : formatCurrency(summary.totalCpa)}`);
  }

  if (!platformFilter && Object.keys(summary.byPlatform).length > 1) {
    lines.push('• Platform breakdown:');
    for (const [platform, data] of Object.entries(summary.byPlatform)) {
      const roas = data.spend > 0 ? data.revenue / data.spend : null;
      lines.push(`  ◦ ${platform}: ${formatCurrency(data.spend)} spend, ${formatCurrency(data.revenue)} revenue, ${formatRatio(roas)} ROAS`);
    }
  }

  if (summary.topCampaigns.length > 0 && metricIntent === 'performance') {
    lines.push('• Top campaigns:');
    for (const campaign of summary.topCampaigns.slice(0, 3)) {
      const roas = campaign.spend > 0 ? campaign.revenue / campaign.spend : null;
      lines.push(`  ◦ ${campaign.name}: ${formatCurrency(campaign.spend)} spend, ${campaign.conversions} conv, ${formatRatio(roas)} ROAS`);
    }
  }

  return lines.join('\n');
}

// ─── AI call ───────────────────────────────────────────────────────────────

interface AIReply {
  text: string;
  charts: Array<{ url: string; title: string; chart_type: string }>;
}

async function callAI(messages: Array<{ role: string; content: string }>): Promise<AIReply> {
  const totalChars = messages.reduce((sum, message) => sum + (message.content?.length || 0), 0);
  console.log(`AI call: ${messages.length} messages, ~${totalChars} chars total — Anthropic Claude (charts enabled)`);

  const result = await callAnthropic(messages, {
    max_tokens: 1200,
    temperature: 0.4,
    enableCharts: true,
  });

  if (!result.ok) {
    console.error('Anthropic error:', result.status, result.error);
    if (result.status === 429) return { text: "I'm being rate limited right now. Try again in a moment! 🕐", charts: [] };
    if (result.status === 401) return { text: 'Anthropic API key is invalid — please update ANTHROPIC_API_KEY.', charts: [] };
    return { text: "I couldn't generate a response right now. Please try again in a moment! 🔧", charts: [] };
  }

  const text = result.content && result.content.trim().length > 0
    ? result.content
    : (result.charts.length > 0 ? "Here's the chart you asked about:" : "I couldn't generate a response right now. Please try again in a moment! 🔧");

  return { text, charts: result.charts };
}

// ─── Slack messaging ───────────────────────────────────────────────────────

async function postSlackMessage(token: string, channel: string, text: string, threadTs?: string) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`chat.postMessage failed: ${data.error || 'unknown_error'}`);
  return data as { ok: boolean; ts: string };
}

async function addReaction(token: string, channel: string, timestamp: string, emoji: string) {
  try {
    const res = await fetch('https://slack.com/api/reactions.add', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, timestamp, name: emoji }),
    });
    const data = await res.json();
    if (!data.ok && data.error !== 'already_reacted') {
      console.warn('reactions.add failed:', data.error);
    }
  } catch (e) {
    console.warn('reactions.add error (non-fatal):', e);
  }
}

async function uploadChartToSlack(
  token: string,
  channel: string,
  chart: { url: string; title: string },
  threadTs?: string,
) {
  try {
    const imgRes = await fetch(chart.url);
    if (!imgRes.ok) {
      console.warn('QuickChart fetch failed:', imgRes.status);
      return;
    }
    const blob = await imgRes.blob();
    const fileSize = blob.size;
    const filename = `${chart.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;

    // Step 1: get upload URL
    const getUrlRes = await fetch(
      `https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${fileSize}`,
      { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } },
    );
    const getUrlData = await getUrlRes.json();
    if (!getUrlData.ok) {
      console.warn('files.getUploadURLExternal failed:', getUrlData.error);
      return;
    }

    // Step 2: upload bytes
    const uploadRes = await fetch(getUrlData.upload_url, {
      method: 'POST',
      body: blob,
    });
    if (!uploadRes.ok) {
      console.warn('chart upload PUT failed:', uploadRes.status);
      return;
    }

    // Step 3: complete and post into thread
    const completeBody: Record<string, unknown> = {
      files: [{ id: getUrlData.file_id, title: chart.title }],
      channel_id: channel,
    };
    if (threadTs) completeBody.thread_ts = threadTs;

    const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(completeBody),
    });
    const completeData = await completeRes.json();
    if (!completeData.ok) {
      console.warn('files.completeUploadExternal failed:', completeData.error);
    }
  } catch (e) {
    console.warn('uploadChartToSlack error (non-fatal):', e);
  }
}

async function processSlackMessage(event: any) {
  const isDirectConversation = isDirectConversationEvent(event);
  const historyAnchorTs = event.thread_ts || event.ts;
  const replyThreadTs = historyAnchorTs;
  const cleanText = getCleanMessageText(event.text || '');

  try {
    const token = await getValidBotToken();

    console.log('Processing:', event.type, event.channel, 'thread:', historyAnchorTs, 'direct:', isDirectConversation);
    addReaction(token, event.channel, event.ts, 'brain');
    await postSlackMessage(token, event.channel, PENDING_REPLY_TEXT, replyThreadTs);

    let client = await detectClientFromText(cleanText);
    const verticalId = detectVerticalFromText(cleanText);
    const platformFilter = detectPlatformFromText(cleanText);

    if (!client && !isDirectConversation) {
      client = await detectClientFromChannel(token, event.channel);
    }

    let conversationHistory = await getConversationHistory(token, event.channel, historyAnchorTs, isDirectConversation);
    if (!client && conversationHistory.length > 0) {
      const allText = conversationHistory.map((message) => message.content).join(' ');
      client = await detectClientFromText(allText);
    }

    if (conversationHistory.length === 0 && cleanText) {
      conversationHistory = [{ role: 'user', content: cleanText }];
    }

    const userContext = await resolveUserContext(token, event.user);
    const userName = userContext.name;
    const dateRange = parseDateIntent(cleanText, userContext);

    let dataContext = '';
    let clientData: ClientData | null = null;

    if (client) {
      const verticalLabel = verticalId ? VERTICAL_KEYWORDS[verticalId]?.label || verticalId : 'All Verticals';
      const platformLabel = platformFilter || 'all platforms';
      console.log(`Detected: client=${client.name}, vertical=${verticalLabel}, platform=${platformLabel}, dates=${dateRange.from}-${dateRange.to}, user_today=${dateRange.userToday}, tz_offset=${userContext.tzOffsetSeconds}`);

      clientData = await getClientData(client.id, dateRange, verticalId, platformFilter);
      dataContext = `\n--- CLIENT DATA FOR ${client.name.toUpperCase()} (${verticalLabel}, ${platformLabel}) ---\n`;
      dataContext += clientData.recentMetrics || 'No ad metrics found for this period.\n';
      dataContext += clientData.campaignBreakdown || '';
      dataContext += clientData.creativesTable || '';
      dataContext += clientData.keywordsTable || '';
      dataContext += clientData.ringbaData || '';
      dataContext += clientData.tasks || '';
      dataContext += clientData.recentContext || '';
      dataContext += '--- END CLIENT DATA ---\n';
    }

    if (client && clientData && isMetricQuestion(cleanText)) {
      const directReply = buildDeterministicMetricReply(
        client.name,
        cleanText,
        dateRange,
        verticalId,
        platformFilter,
        clientData.summary,
        clientData.latestAvailable,
      );
      await postSlackMessage(token, event.channel, directReply, replyThreadTs);
      console.log('Deterministic metric reply sent for client:', client.name);
      return;
    }

    let clientList = '';
    if (!client) {
      const { data: allClients } = await supabase
        .from('clients')
        .select('name, slug')
        .eq('status', 'active');
      if (allClients?.length) {
        clientList = `\nAvailable clients: ${allClients.map((c) => c.name).join(', ')}\n`;
      }
    }

    let channelInfo = '';
    if (!isDirectConversation) {
      const chanRes = await fetch(`https://slack.com/api/conversations.info?channel=${event.channel}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const chanData = await chanRes.json();
      channelInfo = chanData.channel?.name ? `Channel: #${chanData.channel.name}\n` : '';
    }

    const systemPrompt = `You are CPM Bot, an AI assistant for Connect Paid Media (CPM), a digital advertising agency. You help the team with client management, campaign strategy, media buying insights, and task coordination.

${channelInfo}${clientList}${dataContext}

The person talking to you is: ${userName}
Today's date: ${dateRange.userToday}

Guidelines:
- Be concise and actionable — use bullet points and short paragraphs
- When discussing metrics, ALWAYS reference the specific numbers from the CLIENT DATA section above
- If asked about spend, revenue, conversions etc., USE THE DATA PROVIDED — do not say you don't have access
- If asked about a specific date range and the data doesn't cover it, say what data you have and offer to check a different range
- If no client is detected, ask which client they're asking about and list available clients
- For campaign strategy questions, use the actual campaign performance data
- Use emoji sparingly but naturally 🎯
- Format responses for Slack (use *bold*, _italic_, \`code\`, and bullet points)
- Keep responses under 2000 characters when possible
- When the user mentions "billy" or "billy.com", that refers to the Billy.com client
- The data above is real and current — present it confidently`;

    const aiMessages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
    ];

    const response = await callAI(aiMessages);
    await postSlackMessage(token, event.channel, response.text, replyThreadTs);
    for (const chart of response.charts) {
      await uploadChartToSlack(token, event.channel, chart, replyThreadTs);
    }
    console.log('Reply sent successfully for client:', client?.name || 'none detected', 'charts:', response.charts.length);
  } catch (error) {
    console.error('Error processing Slack event:', error);
    try {
      const fallbackToken = await getValidBotToken().catch(() => Deno.env.get('SLACK_BOT_TOKEN') || '');
      if (fallbackToken) {
        await postSlackMessage(fallbackToken, event.channel, 'Sorry, I hit an error while processing that. Please try again! 🔧', replyThreadTs);
      }
    } catch (replyError) {
      console.error('Failed to send error message:', replyError);
    }
  }
}

Deno.serve(async (req) => {
  const bodyText = await req.text();
  const timestamp = req.headers.get('x-slack-request-timestamp') || '';
  const slackSignature = req.headers.get('x-slack-signature') || '';

  let body: any;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  if (body.type === 'url_verification') {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!(await verifySlackSignature(bodyText, timestamp, slackSignature))) {
    console.error('Invalid Slack signature');
    return new Response('Unauthorized', { status: 401 });
  }

  if (body.type === 'event_callback') {
    const event = body.event;
    console.log('Received event:', event.type, 'channel_type:', event.channel_type, 'user:', event.user, 'bot_id:', event.bot_id);

    if (event.bot_id || event.subtype) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (event.type === 'app_mention' || isDirectConversationEvent(event)) {
      EdgeRuntime.waitUntil(processSlackMessage(event));
      return new Response(JSON.stringify({ ok: true, status: 'received' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
