import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const SLACK_SIGNING_SECRET = Deno.env.get('SLACK_SIGNING_SECRET')!;
const SLACK_CLIENT_ID = Deno.env.get('SLACK_CLIENT_ID')!;
const SLACK_CLIENT_SECRET = Deno.env.get('SLACK_CLIENT_SECRET')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const DIRECT_CHANNEL_TYPES = new Set(['im', 'app_home']);
const PENDING_REPLY_TEXT = 'Got it — thinking…';

// Models to try in order — if one returns empty, try the next
const AI_MODELS = [
  'openai/gpt-5-mini',
  'google/gemini-2.5-flash',
  'openai/gpt-5-nano',
];

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
  token: string, channel: string, threadTs: string, isDirectConversation: boolean,
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

// ─── Client detection & data retrieval ─────────────────────────────────────

const CLIENT_PATTERNS: Record<string, string[]> = {
  billy: ['billy', 'kwca', 'billy.com'],
  'tinned-fish-club': ['tinned', 'tfc', 'tinned fish'],
  phantasmagorical: ['phantas', 'phant', 'phantasmagorical'],
};

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

// ─── Vertical detection ───────────────────────────────────────────────────

interface VerticalFilter {
  name: string;
  patterns: string[];
  accountIds: string[];
  exactMatch?: boolean;
}

const VERTICAL_KEYWORDS: Record<string, { keywords: string[]; label: string }> = {
  'pest-control': { keywords: ['pest', 'pest control', 'bed bug', 'bedbug'], label: 'Pest Control' },
  flights: { keywords: ['flight', 'flights', 'airline'], label: 'Flights' },
  'porta-potties': { keywords: ['porta', 'potty', 'porta potty', 'portapotty'], label: 'Porta Potties' },
};

function detectVerticalFromText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [id, { keywords }] of Object.entries(VERTICAL_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return id;
  }
  return null;
}

function detectPlatformFromText(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes('google') || lower.includes('search ads') || lower.includes('ppc')) return 'google';
  if (lower.includes('meta') || lower.includes('facebook') || lower.includes('instagram') || lower.includes('fb')) return 'meta';
  return null;
}

// ─── Data retrieval (vertical + platform aware) ───────────────────────────

interface ClientData {
  recentMetrics: string;
  campaignBreakdown: string;
  tasks: string;
  recentContext: string;
  ringbaData: string;
}

async function getClientData(
  clientId: string,
  dateRange: { from: string; to: string },
  verticalId: string | null,
  platformFilter: string | null,
): Promise<ClientData> {
  // Load vertical config for filtering
  let verticalPatterns: Record<string, VerticalFilter> = {};
  if (verticalId) {
    // Check hardcoded verticals first
    const hardcoded: Record<string, { meta: string[]; google: string[]; ringba: string[]; googleAccounts?: string[]; metaAccounts?: string[]; ringbaExact?: boolean }> = {
      'pest-control': {
        meta: ['Pest', 'PestControl', 'Bed Bug', 'BedBug'],
        google: ['Pest', 'Bed Bug', 'BedBug'],
        ringba: ['Pest Control US Call Flow'],
        googleAccounts: ['1939246766'],
        metaAccounts: ['448669084867269', '1779578786137314'],
        ringbaExact: true,
      },
      flights: {
        meta: ['Flight'], google: ['Flight'], ringba: ['Flight'],
      },
      'porta-potties': {
        meta: ['Porta', 'Potty'], google: ['Porta', 'Potty'], ringba: ['Porta', 'Potty', 'Portapotty'],
        googleAccounts: ['1939246766'],
      },
    };

    if (hardcoded[verticalId]) {
      const v = hardcoded[verticalId];
      verticalPatterns = {
        meta: { name: verticalId, patterns: v.meta, accountIds: v.metaAccounts || [] },
        google: { name: verticalId, patterns: v.google, accountIds: v.googleAccounts || [] },
        ringba: { name: verticalId, patterns: v.ringba, accountIds: [], exactMatch: v.ringbaExact },
      };
    }

    // Also check DB for custom verticals
    const { data: dbVerticals } = await supabase
      .from('client_verticals')
      .select('*')
      .eq('client_id', clientId)
      .eq('vertical_id', verticalId)
      .maybeSingle();

    if (dbVerticals) {
      verticalPatterns = {
        meta: { name: verticalId, patterns: dbVerticals.meta_patterns, accountIds: dbVerticals.meta_account_ids },
        google: { name: verticalId, patterns: dbVerticals.google_patterns, accountIds: dbVerticals.google_account_ids },
        ringba: { name: verticalId, patterns: dbVerticals.ringba_patterns, accountIds: [], exactMatch: dbVerticals.ringba_exact_match },
      };
    }
  }

  // Helper to check if campaign matches vertical
  function campaignMatchesVertical(campaignName: string, platform: string): boolean {
    if (!verticalId || Object.keys(verticalPatterns).length === 0) return true;
    const config = verticalPatterns[platform];
    if (!config || config.patterns.length === 0) return true;
    const lower = campaignName.toLowerCase();
    if (config.exactMatch) {
      return config.patterns.some(p => lower === p.toLowerCase());
    }
    return config.patterns.some(p => lower.includes(p.toLowerCase()));
  }

  function accountMatchesVertical(accountId: string | null, platform: string): boolean {
    if (!verticalId || Object.keys(verticalPatterns).length === 0) return true;
    const config = verticalPatterns[platform];
    if (!config || config.accountIds.length === 0) return true;
    if (!accountId) return false;
    return config.accountIds.includes(accountId);
  }

  // Build campaign query
  let campaignQuery = supabase
    .from('ad_campaigns')
    .select('campaign_name, platform, spend, revenue, conversions, clicks, impressions, status, date, account_id')
    .eq('client_id', clientId)
    .gte('date', dateRange.from)
    .lte('date', dateRange.to)
    .order('spend', { ascending: false })
    .limit(200);

  if (platformFilter) {
    campaignQuery = campaignQuery.eq('platform', platformFilter);
  }

  // Parallel fetch all data
  const [campaignsRes, tasksRes, contextRes, ringbaRes] = await Promise.all([
    campaignQuery,
    supabase
      .from('tasks')
      .select('title, status, priority, due_date')
      .eq('client_id', clientId)
      .in('status', ['todo', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('context_items')
      .select('title, content, occurred_at')
      .eq('client_id', clientId)
      .order('occurred_at', { ascending: false })
      .limit(5),
    supabase
      .from('ringba_calls')
      .select('call_date, revenue, payout, converted, connected, duration_seconds, campaign_name, target_name')
      .eq('client_id', clientId)
      .gte('call_date', dateRange.from)
      .lte('call_date', dateRange.to)
      .order('call_date', { ascending: false })
      .limit(500),
  ]);

  // Filter campaigns by vertical + account
  const allCampaigns = (campaignsRes.data || []).filter(c => {
    if (!campaignMatchesVertical(c.campaign_name, c.platform)) return false;
    if (!accountMatchesVertical(c.account_id, c.platform)) return false;
    return true;
  });

  // Aggregate metrics from filtered campaigns
  let recentMetrics = '';
  if (allCampaigns.length > 0) {
    const verticalLabel = verticalId ? VERTICAL_KEYWORDS[verticalId]?.label || verticalId : 'All Verticals';
    const platformLabel = platformFilter ? ` (${platformFilter})` : '';

    const byPlatform: Record<string, { spend: number; revenue: number; conversions: number; clicks: number; impressions: number }> = {};
    let totalSpend = 0, totalRevenue = 0, totalConversions = 0;

    for (const c of allCampaigns) {
      const p = c.platform || 'unknown';
      if (!byPlatform[p]) byPlatform[p] = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
      byPlatform[p].spend += Number(c.spend) || 0;
      byPlatform[p].revenue += Number(c.revenue) || 0;
      byPlatform[p].conversions += Number(c.conversions) || 0;
      byPlatform[p].clicks += Number(c.clicks) || 0;
      byPlatform[p].impressions += Number(c.impressions) || 0;
      totalSpend += Number(c.spend) || 0;
      totalRevenue += Number(c.revenue) || 0;
      totalConversions += Number(c.conversions) || 0;
    }

    const totalRoas = totalSpend > 0 ? (totalRevenue / totalSpend).toFixed(2) : 'N/A';
    const totalCpa = totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : 'N/A';

    recentMetrics = `📊 ${verticalLabel}${platformLabel} Performance (${dateRange.from} to ${dateRange.to}):\n`;
    recentMetrics += `*Total:* Spend $${totalSpend.toFixed(2)} | Revenue $${totalRevenue.toFixed(2)} | ROAS ${totalRoas}x | Conversions ${totalConversions} | CPA $${totalCpa}\n`;

    for (const [platform, data] of Object.entries(byPlatform)) {
      const ctr = data.impressions > 0 ? ((data.clicks / data.impressions) * 100).toFixed(2) : '0';
      const cpa = data.conversions > 0 ? (data.spend / data.conversions).toFixed(2) : 'N/A';
      const roas = data.spend > 0 ? (data.revenue / data.spend).toFixed(2) : 'N/A';
      recentMetrics += `  ${platform}: Spend $${data.spend.toFixed(2)} | Rev $${data.revenue.toFixed(2)} | ROAS ${roas}x | Conv ${data.conversions} | CPA $${cpa} | CTR ${ctr}%\n`;
    }

    // Daily breakdown
    const byDate: Record<string, { spend: number; conversions: number; revenue: number }> = {};
    for (const c of allCampaigns) {
      if (!byDate[c.date]) byDate[c.date] = { spend: 0, conversions: 0, revenue: 0 };
      byDate[c.date].spend += Number(c.spend) || 0;
      byDate[c.date].conversions += Number(c.conversions) || 0;
      byDate[c.date].revenue += Number(c.revenue) || 0;
    }
    const sortedDates = Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
    if (sortedDates.length > 0) {
      recentMetrics += '\nDaily breakdown:\n';
      for (const [date, data] of sortedDates) {
        const dayRoas = data.spend > 0 ? (data.revenue / data.spend).toFixed(2) : 'N/A';
        recentMetrics += `  ${date}: $${data.spend.toFixed(2)} spend, $${data.revenue.toFixed(2)} rev, ${data.conversions} conv, ROAS ${dayRoas}x\n`;
      }
    }
  }

  // Campaign breakdown (top campaigns)
  let campaignBreakdown = '';
  if (allCampaigns.length > 0) {
    // Aggregate by campaign name
    const byCampaign: Record<string, { platform: string; spend: number; revenue: number; conversions: number; clicks: number; status: string }> = {};
    for (const c of allCampaigns) {
      const key = `${c.campaign_name}|${c.platform}`;
      if (!byCampaign[key]) byCampaign[key] = { platform: c.platform, spend: 0, revenue: 0, conversions: 0, clicks: 0, status: c.status || 'unknown' };
      byCampaign[key].spend += Number(c.spend) || 0;
      byCampaign[key].revenue += Number(c.revenue) || 0;
      byCampaign[key].conversions += Number(c.conversions) || 0;
      byCampaign[key].clicks += Number(c.clicks) || 0;
    }
    const sortedCampaigns = Object.entries(byCampaign).sort((a, b) => b[1].spend - a[1].spend).slice(0, 10);
    campaignBreakdown = `\n🎯 Top Campaigns:\n`;
    for (const [key, data] of sortedCampaigns) {
      const name = key.split('|')[0];
      const cpa = data.conversions > 0 ? (data.spend / data.conversions).toFixed(2) : 'N/A';
      const roas = data.spend > 0 ? (data.revenue / data.spend).toFixed(2) : 'N/A';
      campaignBreakdown += `  • ${name} (${data.platform}): $${data.spend.toFixed(2)} spend, ${data.conversions} conv, CPA $${cpa}, ROAS ${roas}x [${data.status}]\n`;
    }
  }

  // Tasks
  let tasksStr = '';
  if (tasksRes.data?.length) {
    tasksStr = `\n📋 Open Tasks (${tasksRes.data.length}):\n`;
    for (const t of tasksRes.data) {
      tasksStr += `  • [${t.priority}] ${t.title} (${t.status})${t.due_date ? ` due ${t.due_date}` : ''}\n`;
    }
  }

  // Context
  let recentContext = '';
  if (contextRes.data?.length) {
    recentContext = `\n📝 Recent Notes:\n`;
    for (const item of contextRes.data) {
      recentContext += `  • ${item.title}: ${item.content?.substring(0, 200)}\n`;
    }
  }

  // Ringba calls (filtered by vertical)
  let ringbaData = '';
  const filteredCalls = (ringbaRes.data || []).filter(c => {
    if (!verticalId || Object.keys(verticalPatterns).length === 0) return true;
    const config = verticalPatterns['ringba'];
    if (!config || config.patterns.length === 0) return true;
    const name = (c.campaign_name || '').toLowerCase();
    if (config.exactMatch) {
      return config.patterns.some(p => name === p.toLowerCase());
    }
    return config.patterns.some(p => name.includes(p.toLowerCase()));
  });

  if (filteredCalls.length > 0) {
    const totalCalls = filteredCalls.length;
    const connectedCalls = filteredCalls.filter(c => c.connected).length;
    const convertedCalls = filteredCalls.filter(c => c.converted).length;
    const totalRevenue = filteredCalls.reduce((s, c) => s + (Number(c.revenue) || 0), 0);
    const totalPayout = filteredCalls.reduce((s, c) => s + (Number(c.payout) || 0), 0);
    const avgDuration = filteredCalls.reduce((s, c) => s + (c.duration_seconds || 0), 0) / totalCalls;

    ringbaData = `\n📞 Ringba Calls (${dateRange.from} to ${dateRange.to}):\n`;
    ringbaData += `  Total: ${totalCalls} calls | Connected: ${connectedCalls} | Converted: ${convertedCalls}\n`;
    ringbaData += `  Revenue: $${totalRevenue.toFixed(2)} | Payout: $${totalPayout.toFixed(2)} | Avg Duration: ${Math.round(avgDuration)}s\n`;

    // By target
    const byTarget: Record<string, { calls: number; revenue: number; converted: number }> = {};
    for (const c of filteredCalls) {
      const t = c.target_name || 'Unknown';
      if (!byTarget[t]) byTarget[t] = { calls: 0, revenue: 0, converted: 0 };
      byTarget[t].calls++;
      byTarget[t].revenue += Number(c.revenue) || 0;
      if (c.converted) byTarget[t].converted++;
    }
    const topTargets = Object.entries(byTarget).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 5);
    if (topTargets.length) {
      ringbaData += '  Top targets:\n';
      for (const [name, data] of topTargets) {
        ringbaData += `    • ${name}: ${data.calls} calls, $${data.revenue.toFixed(2)} rev, ${data.converted} converted\n`;
      }
    }
  }

  return { recentMetrics, campaignBreakdown, tasks: tasksStr, recentContext, ringbaData };
}

function parseDateIntent(text: string): { from: string; to: string } {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const lower = text.toLowerCase();

  if (lower.includes('today')) {
    return { from: today, to: today };
  }
  if (lower.includes('yesterday')) {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { from: y.toISOString().split('T')[0], to: y.toISOString().split('T')[0] };
  }
  if (lower.includes('this week') || lower.includes('past week') || lower.includes('last 7')) {
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return { from: weekAgo.toISOString().split('T')[0], to: today };
  }
  if (lower.includes('this month') || lower.includes('past month') || lower.includes('last 30')) {
    const monthAgo = new Date(now);
    monthAgo.setDate(monthAgo.getDate() - 30);
    return { from: monthAgo.toISOString().split('T')[0], to: today };
  }
  // Default: last 7 days
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  return { from: weekAgo.toISOString().split('T')[0], to: today };
}

async function resolveUserName(token: string, userId: string): Promise<string> {
  const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  return data.user?.profile?.display_name || data.user?.real_name || 'Someone';
}

// ─── AI call with multi-model retry ────────────────────────────────────────

async function callAI(messages: Array<{ role: string; content: string }>): Promise<string> {
  const totalChars = messages.reduce((s, m) => s + (m.content?.length || 0), 0);
  console.log(`AI call: ${messages.length} messages, ~${totalChars} chars total`);

  for (const model of AI_MODELS) {
    try {
      console.log(`Trying model: ${model}`);
      const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 1500,
          temperature: 0.7,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Model ${model} HTTP error:`, res.status, errText);
        if (res.status === 429) return "I'm being rate limited right now. Try again in a moment! 🕐";
        if (res.status === 402) return 'AI credits have been exhausted. Please top up workspace usage.';
        continue; // Try next model
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      const finishReason = data.choices?.[0]?.finish_reason;

      console.log(`Model ${model}: finish_reason=${finishReason}, content_length=${content?.length || 0}`);

      if (content && content.trim().length > 0) {
        return content;
      }

      console.warn(`Model ${model} returned empty content, trying next...`);
    } catch (err) {
      console.error(`Model ${model} exception:`, err);
    }
  }

  return "I couldn't generate a response right now. Please try again in a moment! 🔧";
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

// ─── Main handler ──────────────────────────────────────────────────────────

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

    // Detect client, vertical, and platform from message text
    let client = await detectClientFromText(cleanText);
    const verticalId = detectVerticalFromText(cleanText);
    const platformFilter = detectPlatformFromText(cleanText);

    if (!client && !isDirectConversation) {
      client = await detectClientFromChannel(token, event.channel);
    }

    let conversationHistory = await getConversationHistory(token, event.channel, historyAnchorTs, isDirectConversation);
    if (!client && conversationHistory.length > 0) {
      const allText = conversationHistory.map(m => m.content).join(' ');
      client = await detectClientFromText(allText);
    }

    if (conversationHistory.length === 0 && cleanText) {
      conversationHistory = [{ role: 'user', content: cleanText }];
    }

    const userName = await resolveUserName(token, event.user);
    const dateRange = parseDateIntent(cleanText);

    // Build rich context with actual data (now vertical + platform aware)
    let dataContext = '';
    if (client) {
      const verticalLabel = verticalId ? (VERTICAL_KEYWORDS[verticalId]?.label || verticalId) : 'All Verticals';
      const platformLabel = platformFilter || 'all platforms';
      console.log(`Detected: client=${client.name}, vertical=${verticalLabel}, platform=${platformLabel}, dates=${dateRange.from}-${dateRange.to}`);

      const clientData = await getClientData(client.id, dateRange, verticalId, platformFilter);
      dataContext = `\n--- CLIENT DATA FOR ${client.name.toUpperCase()} (${verticalLabel}, ${platformLabel}) ---\n`;
      dataContext += clientData.recentMetrics || 'No ad metrics found for this period.\n';
      dataContext += clientData.campaignBreakdown || '';
      dataContext += clientData.ringbaData || '';
      dataContext += clientData.tasks || '';
      dataContext += clientData.recentContext || '';
      dataContext += `--- END CLIENT DATA ---\n`;
    }

    // Get all clients list for general queries
    let clientList = '';
    if (!client) {
      const { data: allClients } = await supabase
        .from('clients')
        .select('name, slug')
        .eq('status', 'active');
      if (allClients?.length) {
        clientList = `\nAvailable clients: ${allClients.map(c => c.name).join(', ')}\n`;
      }
    }

    // Channel context for non-DM
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
Today's date: ${new Date().toISOString().split('T')[0]}

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
- The data above is REAL and CURRENT — present it confidently`;

    const aiMessages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
    ];

    const response = await callAI(aiMessages);
    await postSlackMessage(token, event.channel, response, replyThreadTs);
    console.log('Reply sent successfully for client:', client?.name || 'none detected');
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
