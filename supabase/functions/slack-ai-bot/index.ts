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

interface ClientData {
  recentMetrics: string;
  campaignBreakdown: string;
  tasks: string;
  recentContext: string;
  ringbaData: string;
}

async function getClientData(clientId: string, dateRange: { from: string; to: string }): Promise<ClientData> {
  // Parallel fetch all data
  const [metricsRes, campaignsRes, tasksRes, contextRes, ringbaRes] = await Promise.all([
    supabase
      .from('ad_daily_metrics')
      .select('date, platform, spend, revenue, conversions, clicks, impressions')
      .eq('client_id', clientId)
      .gte('date', dateRange.from)
      .lte('date', dateRange.to)
      .order('date', { ascending: false }),
    supabase
      .from('ad_campaigns')
      .select('campaign_name, platform, spend, revenue, conversions, clicks, impressions, status, date')
      .eq('client_id', clientId)
      .gte('date', dateRange.from)
      .lte('date', dateRange.to)
      .order('spend', { ascending: false })
      .limit(20),
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
      .limit(100),
  ]);

  // Aggregate daily metrics by platform
  let recentMetrics = '';
  if (metricsRes.data?.length) {
    const byPlatform: Record<string, { spend: number; revenue: number; conversions: number; clicks: number; impressions: number }> = {};
    let totalSpend = 0, totalRevenue = 0, totalConversions = 0;

    for (const m of metricsRes.data) {
      const p = m.platform || 'unknown';
      if (!byPlatform[p]) byPlatform[p] = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
      byPlatform[p].spend += m.spend || 0;
      byPlatform[p].revenue += m.revenue || 0;
      byPlatform[p].conversions += m.conversions || 0;
      byPlatform[p].clicks += m.clicks || 0;
      byPlatform[p].impressions += m.impressions || 0;
      totalSpend += m.spend || 0;
      totalRevenue += m.revenue || 0;
      totalConversions += m.conversions || 0;
    }

    recentMetrics = `📊 Performance (${dateRange.from} to ${dateRange.to}):\n`;
    recentMetrics += `Total: Spend $${totalSpend.toFixed(2)} | Revenue $${totalRevenue.toFixed(2)} | Conversions ${totalConversions}\n`;
    for (const [platform, data] of Object.entries(byPlatform)) {
      const ctr = data.impressions > 0 ? ((data.clicks / data.impressions) * 100).toFixed(2) : '0';
      const cpa = data.conversions > 0 ? (data.spend / data.conversions).toFixed(2) : 'N/A';
      recentMetrics += `  ${platform}: Spend $${data.spend.toFixed(2)} | Rev $${data.revenue.toFixed(2)} | Conv ${data.conversions} | CPA $${cpa} | CTR ${ctr}%\n`;
    }

    // Daily breakdown
    const byDate: Record<string, { spend: number; conversions: number }> = {};
    for (const m of metricsRes.data) {
      if (!byDate[m.date]) byDate[m.date] = { spend: 0, conversions: 0 };
      byDate[m.date].spend += m.spend || 0;
      byDate[m.date].conversions += m.conversions || 0;
    }
    recentMetrics += '\nDaily breakdown:\n';
    for (const [date, data] of Object.entries(byDate).slice(0, 7)) {
      recentMetrics += `  ${date}: $${data.spend.toFixed(2)} spend, ${data.conversions} conversions\n`;
    }
  }

  // Campaign breakdown
  let campaignBreakdown = '';
  if (campaignsRes.data?.length) {
    campaignBreakdown = `\n🎯 Top Campaigns:\n`;
    for (const c of campaignsRes.data.slice(0, 10)) {
      const cpa = c.conversions && c.conversions > 0 ? (c.spend / c.conversions).toFixed(2) : 'N/A';
      campaignBreakdown += `  • ${c.campaign_name} (${c.platform}): $${(c.spend || 0).toFixed(2)} spend, ${c.conversions || 0} conv, CPA $${cpa}\n`;
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

  // Ringba calls
  let ringbaData = '';
  if (ringbaRes.data?.length) {
    const totalCalls = ringbaRes.data.length;
    const connectedCalls = ringbaRes.data.filter(c => c.connected).length;
    const convertedCalls = ringbaRes.data.filter(c => c.converted).length;
    const totalRevenue = ringbaRes.data.reduce((s, c) => s + (c.revenue || 0), 0);
    const totalPayout = ringbaRes.data.reduce((s, c) => s + (c.payout || 0), 0);
    const avgDuration = ringbaRes.data.reduce((s, c) => s + (c.duration_seconds || 0), 0) / totalCalls;

    ringbaData = `\n📞 Ringba Calls (${dateRange.from} to ${dateRange.to}):\n`;
    ringbaData += `  Total: ${totalCalls} calls | Connected: ${connectedCalls} | Converted: ${convertedCalls}\n`;
    ringbaData += `  Revenue: $${totalRevenue.toFixed(2)} | Payout: $${totalPayout.toFixed(2)} | Avg Duration: ${Math.round(avgDuration)}s\n`;

    // By target
    const byTarget: Record<string, { calls: number; revenue: number; converted: number }> = {};
    for (const c of ringbaRes.data) {
      const t = c.target_name || 'Unknown';
      if (!byTarget[t]) byTarget[t] = { calls: 0, revenue: 0, converted: 0 };
      byTarget[t].calls++;
      byTarget[t].revenue += c.revenue || 0;
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

// ─── AI call ───────────────────────────────────────────────────────────────

async function callAI(messages: Array<{ role: string; content: string }>): Promise<string> {
  // Log prompt size for debugging
  const totalChars = messages.reduce((s, m) => s + (m.content?.length || 0), 0);
  console.log(`AI call: ${messages.length} messages, ~${totalChars} chars total`);

  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'google/gemini-2.5-flash', messages }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('AI error:', res.status, errText);
    if (res.status === 429) return "I'm being rate limited right now. Try again in a moment! 🕐";
    if (res.status === 402) return 'AI credits have been exhausted. Please top up workspace usage.';
    return `Sorry, I hit an error (${res.status}). Please try again.`;
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  const finishReason = data.choices?.[0]?.finish_reason;
  
  console.log('AI response: finish_reason=', finishReason, 'content_length=', content?.length || 0, 'has_tool_calls=', !!data.choices?.[0]?.message?.tool_calls);
  
  if (!content && data.choices?.[0]?.message?.tool_calls) {
    console.log('AI returned tool_calls instead of content:', JSON.stringify(data.choices[0].message.tool_calls).substring(0, 500));
  }
  
  if (!content) {
    console.error('Empty AI response. Full response:', JSON.stringify(data).substring(0, 1000));
    return "Let me try that again — I had trouble generating a response. Could you rephrase your question?";
  }
  
  return content;
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
  // ALWAYS reply in thread — for DMs use the message's own ts as thread anchor
  const replyThreadTs = historyAnchorTs;
  const cleanText = getCleanMessageText(event.text || '');

  try {
    const token = await getValidBotToken();

    console.log('Processing:', event.type, event.channel, 'thread:', historyAnchorTs, 'direct:', isDirectConversation);
    
    // Non-blocking reaction (don't fail if missing scope)
    addReaction(token, event.channel, event.ts, 'brain');
    await postSlackMessage(token, event.channel, PENDING_REPLY_TEXT, replyThreadTs);

    // Detect client from message text first, then from channel name
    let client = await detectClientFromText(cleanText);
    if (!client && !isDirectConversation) {
      client = await detectClientFromChannel(token, event.channel);
    }

    // If still no client from channel, check full conversation history for mentions
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

    // Build rich context with actual data
    let dataContext = '';
    if (client) {
      console.log('Detected client:', client.name, 'date range:', dateRange.from, '-', dateRange.to);
      const clientData = await getClientData(client.id, dateRange);
      dataContext = `\n--- CLIENT DATA FOR ${client.name.toUpperCase()} ---\n`;
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
- When the user mentions "billy" or "billy.com", that refers to the Billy.com client`;

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
