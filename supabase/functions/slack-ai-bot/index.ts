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
  // Try DB first
  const { data: row } = await supabase
    .from('slack_tokens')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (row) {
    const expiresAt = new Date(row.expires_at);
    const now = new Date();
    // Refresh if expiring in < 5 minutes
    if (expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
      return row.bot_access_token;
    }
    // Refresh the token
    console.log('Token expired or expiring soon, refreshing...');
    return await refreshToken(row.refresh_token, row.workspace_id);
  }

  // No row yet — try to exchange the static env token for a rotating pair
  const staticToken = Deno.env.get('SLACK_BOT_TOKEN');
  if (staticToken) {
    console.log('Exchanging static bot token for rotating tokens...');
    return await exchangeStaticToken(staticToken);
  }

  throw new Error('No Slack bot token available. Set SLACK_BOT_TOKEN or seed slack_tokens table.');
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
    // Fallback to static token if exchange fails (e.g. already exchanged)
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

  console.log('Token exchange successful, stored rotating tokens');
  return data.access_token;
}

async function refreshToken(refreshToken: string, workspaceId: string): Promise<string> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Token refresh failed: ${data.error}`);
  }
  const expiresAt = new Date(Date.now() + (data.expires_in || 43200) * 1000);

  await supabase.from('slack_tokens').upsert({
    workspace_id: workspaceId,
    bot_access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' });

  console.log('Token refreshed successfully');
  return data.access_token;
}

// ─── Slack helpers ─────────────────────────────────────────────────────────

async function verifySlackSignature(body: string, timestamp: string, signature: string): Promise<boolean> {
  try {
    const sigBasestring = `v0:${timestamp}:${body}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(SLACK_SIGNING_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
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
  const authRes = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const authData = await authRes.json();
  return authData.ok ? authData.user_id : null;
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

  const res = await fetch(endpoint, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.ok || !data.messages) return [];

  const botUserId = await getBotUserId(token);

  const orderedMessages = isDirectConversation ? [...data.messages].reverse() : data.messages;
  return mapSlackMessagesToConversation(orderedMessages, botUserId);
}

async function getChannelContext(token: string, channelId: string): Promise<string> {
  const chanRes = await fetch(`https://slack.com/api/conversations.info?channel=${channelId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const chanData = await chanRes.json();
  const channelName = chanData.channel?.name || 'unknown';

  let clientSlug = '';
  const PATTERNS: Record<string, string[]> = {
    billy: ['billy', 'kwca'],
    'tinned-fish-club': ['tinned', 'tfc'],
    phantasmagorical: ['phantas', 'phant'],
  };

  for (const [slug, keywords] of Object.entries(PATTERNS)) {
    if (keywords.some((k) => channelName.toLowerCase().includes(k))) {
      clientSlug = slug;
      break;
    }
  }

  let contextInfo = `Channel: #${channelName}\n`;

  if (!clientSlug) return contextInfo;

  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('slug', clientSlug)
    .maybeSingle();

  if (!client) return contextInfo;

  contextInfo += `Client: ${client.name}\n`;

  const { data: recentContext } = await supabase
    .from('context_items')
    .select('title, content, occurred_at')
    .eq('client_id', client.id)
    .eq('content_type', 'slack_summary')
    .order('occurred_at', { ascending: false })
    .limit(3);

  if (recentContext?.length) {
    contextInfo += '\nRecent activity summaries:\n';
    for (const item of recentContext) {
      contextInfo += `- ${item.title}: ${item.content?.substring(0, 300)}\n`;
    }
  }

  const { data: tasks } = await supabase
    .from('tasks')
    .select('title, status, priority')
    .eq('client_id', client.id)
    .in('status', ['todo', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (tasks?.length) {
    contextInfo += `\nOpen tasks (${tasks.length}):\n`;
    for (const task of tasks) {
      contextInfo += `- [${task.priority}] ${task.title} (${task.status})\n`;
    }
  }

  const { data: metrics } = await supabase
    .from('ad_daily_metrics')
    .select('spend, revenue, conversions')
    .eq('client_id', client.id)
    .order('date', { ascending: false })
    .limit(14);

  if (metrics?.length) {
    const totalSpend = metrics.reduce((sum, item) => sum + (item.spend || 0), 0);
    const totalRevenue = metrics.reduce((sum, item) => sum + (item.revenue || 0), 0);
    const totalConversions = metrics.reduce((sum, item) => sum + (item.conversions || 0), 0);
    contextInfo += `\nRecent metrics: Spend $${totalSpend.toFixed(0)}, Revenue $${totalRevenue.toFixed(0)}, Conversions ${totalConversions}\n`;
  }

  return contextInfo;
}

async function resolveUserName(token: string, userId: string): Promise<string> {
  const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  return data.user?.profile?.display_name || data.user?.real_name || 'Someone';
}

async function callAI(messages: Array<{ role: string; content: string }>): Promise<string> {
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('AI error:', res.status, errText);
    if (res.status === 429) return "I'm being rate limited right now. Try again in a moment! 🕐";
    if (res.status === 402) return 'AI credits have been exhausted. Please top up workspace usage.';
    return 'Sorry, I hit an error generating a response. Please try again.';
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "I couldn't generate a response.";
}

async function postSlackMessage(token: string, channel: string, text: string, threadTs?: string) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`chat.postMessage failed: ${data.error || 'unknown_error'}`);
  }

  return data as { ok: boolean; ts: string };
}

async function addReaction(token: string, channel: string, timestamp: string, emoji: string) {
  const res = await fetch('https://slack.com/api/reactions.add', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, timestamp, name: emoji }),
  });
  const data = await res.json();
  if (!data.ok && data.error !== 'already_reacted') {
    console.error('reactions.add failed:', data.error);
  }
}

async function processSlackMessage(event: any) {
  const isDirectConversation = isDirectConversationEvent(event);
  const historyAnchorTs = event.thread_ts || event.ts;
  const replyThreadTs = isDirectConversation ? undefined : historyAnchorTs;
  const cleanText = getCleanMessageText(event.text || '');

  try {
    // Get a valid (possibly refreshed) bot token
    const token = await getValidBotToken();

    console.log('Processing Slack event:', event.type, event.channel, historyAnchorTs, 'channel_type:', event.channel_type, 'direct:', isDirectConversation);
    await addReaction(token, event.channel, event.ts, 'brain');
    await postSlackMessage(token, event.channel, PENDING_REPLY_TEXT, replyThreadTs);

    const userName = await resolveUserName(token, event.user);
    const channelContext = await getChannelContext(token, event.channel);
    let conversationHistory = await getConversationHistory(token, event.channel, historyAnchorTs, isDirectConversation);

    if (conversationHistory.length === 0 && cleanText) {
      conversationHistory = [{ role: 'user', content: cleanText }];
    }

    const systemPrompt = `You are CPM Bot, an AI assistant for Connect Paid Media (CPM), a digital advertising agency. You help the team with client management, campaign strategy, media buying insights, and task coordination.

You have access to the following context about the current conversation:
${channelContext}

The person talking to you is: ${userName}

Guidelines:
- Be concise and actionable in Slack — use bullet points and short paragraphs
- When discussing metrics, reference specific numbers from the context
- If asked about tasks, reference the open tasks list
- For campaign strategy questions, consider the client's verticals and current performance
- Use emoji sparingly but naturally 🎯
- If you don't have enough context, say so honestly
- Format responses for Slack (use *bold*, _italic_, \`code\`, and bullet points)
- Keep responses under 2000 characters when possible
- In direct messages or App Home chat, reply as a normal conversation and do not reference thread behavior`;

    const aiMessages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
    ];

    const response = await callAI(aiMessages);
    await postSlackMessage(token, event.channel, response, replyThreadTs);
    console.log('Reply sent successfully');
  } catch (error) {
    console.error('Error processing Slack event:', error);
    try {
      const fallbackToken = Deno.env.get('SLACK_BOT_TOKEN') || '';
      if (fallbackToken) {
        await postSlackMessage(fallbackToken, event.channel, 'Sorry, I hit an error while processing that. Please try again! 🔧', replyThreadTs);
      }
    } catch (replyError) {
      console.error('Failed to send Slack error message:', replyError);
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
