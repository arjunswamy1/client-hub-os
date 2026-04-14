import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SLACK_BOT_TOKEN = Deno.env.get('SLACK_BOT_TOKEN')!;
const SLACK_SIGNING_SECRET = Deno.env.get('SLACK_SIGNING_SECRET')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Verify Slack request signature using Web Crypto API
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
    const hashHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    const mySignature = `v0=${hashHex}`;
    return mySignature === signature;
  } catch (e) {
    console.error('Signature verification error:', e);
    return false;
  }
}

// Get conversation thread history for context
async function getThreadHistory(channel: string, threadTs: string): Promise<Array<{role: string; content: string}>> {
  const res = await fetch(`https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=20`, {
    headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok || !data.messages) return [];

  // Get bot user ID
  const authRes = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
  });
  const authData = await authRes.json();
  const botUserId = authData.user_id;

  return data.messages
    .filter((m: any) => !m.subtype)
    .map((m: any) => ({
      role: m.user === botUserId ? 'assistant' : 'user',
      content: m.text.replace(/<@[A-Z0-9]+>/g, '').trim(),
    }))
    .filter((m: any) => m.content.length > 0);
}

// Get client context from the channel name
async function getChannelContext(channelId: string): Promise<string> {
  // Look up channel name
  const chanRes = await fetch(`https://slack.com/api/conversations.info?channel=${channelId}`, {
    headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const chanData = await chanRes.json();
  const channelName = chanData.channel?.name || 'unknown';

  // Determine which client this relates to
  let clientSlug = '';
  const PATTERNS: Record<string, string[]> = {
    billy: ['billy', 'kwca'],
    'tinned-fish-club': ['tinned', 'tfc'],
    phantasmagorical: ['phantas', 'phant'],
  };

  for (const [slug, keywords] of Object.entries(PATTERNS)) {
    if (keywords.some(k => channelName.toLowerCase().includes(k))) {
      clientSlug = slug;
      break;
    }
  }

  let contextInfo = `Channel: #${channelName}\n`;

  if (clientSlug) {
    // Fetch recent context items for this client
    const { data: client } = await supabase
      .from('clients')
      .select('id, name')
      .eq('slug', clientSlug)
      .single();

    if (client) {
      contextInfo += `Client: ${client.name}\n`;

      // Get recent slack summaries
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

      // Get open tasks
      const { data: tasks } = await supabase
        .from('tasks')
        .select('title, status, priority, assignee_id')
        .eq('client_id', client.id)
        .in('status', ['todo', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(10);

      if (tasks?.length) {
        contextInfo += `\nOpen tasks (${tasks.length}):\n`;
        for (const t of tasks) {
          contextInfo += `- [${t.priority}] ${t.title} (${t.status})\n`;
        }
      }

      // Get recent campaign metrics
      const { data: metrics } = await supabase
        .from('ad_daily_metrics')
        .select('platform, spend, revenue, conversions, date')
        .eq('client_id', client.id)
        .order('date', { ascending: false })
        .limit(14);

      if (metrics?.length) {
        const totalSpend = metrics.reduce((s, m) => s + (m.spend || 0), 0);
        const totalRevenue = metrics.reduce((s, m) => s + (m.revenue || 0), 0);
        const totalConversions = metrics.reduce((s, m) => s + (m.conversions || 0), 0);
        contextInfo += `\nRecent metrics (last ${metrics.length} day-records): Spend $${totalSpend.toFixed(0)}, Revenue $${totalRevenue.toFixed(0)}, Conversions ${totalConversions}\n`;
      }
    }
  }

  return contextInfo;
}

// Resolve user display name
async function resolveUserName(userId: string): Promise<string> {
  const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
    headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  return data.user?.profile?.display_name || data.user?.real_name || 'Someone';
}

// Call Lovable AI
async function callAI(messages: Array<{role: string; content: string}>): Promise<string> {
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('AI error:', res.status, errText);
    if (res.status === 429) return "I'm being rate limited right now. Try again in a moment! 🕐";
    if (res.status === 402) return "AI credits have been exhausted. Please top up in Lovable settings.";
    return "Sorry, I hit an error generating a response. Please try again.";
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "I couldn't generate a response.";
}

// Send reply to Slack
async function sendSlackReply(channel: string, threadTs: string, text: string) {
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel,
      thread_ts: threadTs,
      text,
    }),
  });
}

// Add a reaction to indicate processing
async function addReaction(channel: string, timestamp: string, emoji: string) {
  await fetch('https://slack.com/api/reactions.add', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel, timestamp, name: emoji }),
  });
}

Deno.serve(async (req) => {
  // Slack sends url_verification as JSON
  const bodyText = await req.text();
  const timestamp = req.headers.get('x-slack-request-timestamp') || '';
  const slackSignature = req.headers.get('x-slack-signature') || '';

  // Parse body
  let body: any;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  // URL verification challenge (Slack setup)
  if (body.type === 'url_verification') {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify signature (skip during url_verification)
  if (!verifySlackSignature(bodyText, timestamp, slackSignature)) {
    console.error('Invalid Slack signature');
    return new Response('Unauthorized', { status: 401 });
  }

  // Handle events
  if (body.type === 'event_callback') {
    const event = body.event;

    // Ignore bot messages and message edits
    if (event.bot_id || event.subtype) {
      return new Response('ok', { status: 200 });
    }

    // Handle app_mention and direct messages
    if (event.type === 'app_mention' || (event.type === 'message' && event.channel_type === 'im')) {
      // Respond async - return 200 immediately to avoid Slack retry
      const processMessage = async () => {
        try {
          // Add thinking reaction
          await addReaction(event.channel, event.ts, 'brain');

          const userName = await resolveUserName(event.user);
          const channelContext = await getChannelContext(event.channel);

          // Get thread history if in a thread, otherwise just this message
          const threadTs = event.thread_ts || event.ts;
          let conversationHistory = await getThreadHistory(event.channel, threadTs);

          // If no thread history, use just this message
          if (conversationHistory.length === 0) {
            const cleanText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
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
- Keep responses under 2000 characters when possible`;

          const aiMessages = [
            { role: 'system', content: systemPrompt },
            ...conversationHistory,
          ];

          const response = await callAI(aiMessages);
          await sendSlackReply(event.channel, threadTs, response);
        } catch (err) {
          console.error('Error processing message:', err);
          await sendSlackReply(event.channel, event.thread_ts || event.ts, "Sorry, I hit an error. Please try again! 🔧");
        }
      };

      // Fire and forget - don't await
      processMessage();

      return new Response('ok', { status: 200 });
    }
  }

  return new Response('ok', { status: 200 });
});
