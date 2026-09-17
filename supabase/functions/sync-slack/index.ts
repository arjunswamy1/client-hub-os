import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/cost-tracking.ts";
import { getValidBotToken } from "../_shared/slack-token.ts";
import { classifyMessage } from "../_shared/slack-message-class.ts";

// A first sync on a channel with no cursor is capped so it can never pull an
// entire multi-year history in one run.
const INITIAL_BACKFILL_DAYS = 90;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

// Channel name patterns → client slug mapping
// Channels containing these keywords get auto-mapped to the respective client
const CHANNEL_CLIENT_PATTERNS: Record<string, string[]> = {
  billy: ['billy', 'kwca'],
  'tinned-fish-club': ['tinned', 'tfc'],
  phantasmagorical: ['phantas', 'phant'],
};

// Channel name → purpose/context hints
const CHANNEL_CONTEXT: Record<string, string> = {
  cpm_malena: 'Creative design channel with Malena (designer)',
  cpm_core_marketing: 'Internal CPM core marketing discussions',
  cpm_jon: 'Channel with Jon',
  in_billy: 'Main internal Billy.com channel',
  in_billy_pest: 'Billy.com Pest Control vertical',
  in_billy_hvac: 'Billy.com HVAC vertical',
  in_billy_bathroom: 'Billy.com Bathroom Remodel vertical',
  in_billy_portapotty: 'Billy.com Porta Potty vertical',
  in_billy_flights: 'Billy.com Flights vertical',
  in_billy_updates: 'Billy.com updates and announcements',
  sales: 'Sales discussions',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');

    // Service-role callers and single-use cron nonces (ops / scheduled runs) are
    // trusted; anyone else must be a signed-in user.
    const bearer = (authHeader || '').replace('Bearer ', '').trim();
    let isServiceCall = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const cronNonce = req.headers.get('x-cron-nonce') || '';
    if (!isServiceCall && /^[0-9a-f-]{36}$/i.test(cronNonce)) {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: nonceRow } = await admin
        .from('cron_invocation_tokens')
        .delete()
        .eq('token', cronNonce)
        .gt('created_at', new Date(Date.now() - 5 * 60000).toISOString())
        .select('token')
        .maybeSingle();
      isServiceCall = !!nonceRow;
    }

    if (!isServiceCall && !authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isServiceCall) {
      const supabaseUser = createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader as string } } }
      );
      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    // One token path for the whole project: the rotating token in slack_tokens.
    // No fallback to the static env var — a stale token is the bug being fixed.
    let slackToken: string;
    try {
      slackToken = await getValidBotToken();
    } catch (e) {
      console.error('sync-slack: no usable Slack token —', e);
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'No Slack token' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { action = 'sync', client_id, channel_id, channel_name } = body;

    // ──── CLASSIFY CHANNELS ────
    // Records the flags Slack itself reports. Channel names are never used to
    // infer internal vs external. A channel the bot is not a member of is left
    // untouched, so it stays external (the safe default) and unpostable.
    if (action === 'classify_channels') {
      const channels = await listBotChannels(slackToken);
      const byId = new Map(channels.map((c: any) => [c.id, c]));

      const { data: rows } = await supabase
        .from('slack_channel_mappings')
        .select('id, channel_id, channel_name');

      const classified: any[] = [];
      const notMember: string[] = [];

      for (const row of rows || []) {
        const ch: any = byId.get(row.channel_id);
        if (!ch) { notMember.push(row.channel_name); continue; }
        const isExternal = (ch.is_ext_shared === true) || (ch.is_org_shared === true);
        await supabase.from('slack_channel_mappings').update({
          channel_name: ch.name,
          is_private: ch.is_private ?? null,
          is_shared: ch.is_shared ?? null,
          is_ext_shared: ch.is_ext_shared ?? null,
          is_org_shared: ch.is_org_shared ?? null,
          is_external: isExternal,
          classified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        classified.push({ channel: ch.name, channel_id: ch.id, is_external: isExternal,
          is_private: ch.is_private, is_shared: ch.is_shared,
          is_ext_shared: ch.is_ext_shared, is_org_shared: ch.is_org_shared });
      }

      const unmapped = channels
        .filter((c: any) => !(rows || []).some((r: any) => r.channel_id === c.id))
        .map((c: any) => ({ channel: c.name, channel_id: c.id,
          is_ext_shared: c.is_ext_shared, is_org_shared: c.is_org_shared }));

      return jsonResp({ classified, bot_not_member: notMember, unmapped_bot_channels: unmapped });
    }

    // ──── LIST CHANNELS ────
    if (action === 'list_channels') {
      const channels = await listBotChannels(slackToken);
      return jsonResp({ channels });
    }

    // ──── AUTO-MAP CHANNELS ────
    if (action === 'auto_map') {
      const { data: clients } = await supabase.from('clients').select('id, name, slug');
      const channels = await listBotChannels(slackToken);
      let mapped = 0;

      for (const ch of channels) {
        const clientSlug = detectClientFromChannel(ch.name);
        if (!clientSlug) continue;
        const client = (clients || []).find((c: any) => c.slug === clientSlug);
        if (!client) continue;

        await supabase.from('slack_channel_mappings').upsert(
          { client_id: client.id, channel_id: ch.id, channel_name: ch.name, sync_enabled: true },
          { onConflict: 'channel_id' }
        );
        mapped++;
      }

      return jsonResp({ mapped, total_channels: channels.length });
    }

    // ──── MAP / UNMAP CHANNEL ────
    if (action === 'map_channel') {
      if (!client_id || !channel_id || !channel_name) {
        return jsonResp({ error: 'Missing params' }, 400);
      }
      const { error } = await supabase.from('slack_channel_mappings').upsert(
        { client_id, channel_id, channel_name, sync_enabled: true },
        { onConflict: 'channel_id' }
      );
      if (error) return jsonResp({ error: error.message }, 500);
      return jsonResp({ success: true });
    }

    if (action === 'unmap_channel') {
      if (!channel_id) return jsonResp({ error: 'Missing channel_id' }, 400);
      await supabase.from('slack_channel_mappings').delete().eq('channel_id', channel_id);
      return jsonResp({ success: true });
    }

    // ──── SYNC + SUMMARIZE + EXTRACT TASKS ────
    if (action === 'sync') {
      if (!client_id) return jsonResp({ error: 'Missing client_id' }, 400);

      const { data: mappings } = await supabase
        .from('slack_channel_mappings')
        .select('*')
        .eq('client_id', client_id)
        .eq('sync_enabled', true);

      if (!mappings || mappings.length === 0) {
        return jsonResp({ synced: 0, tasks_created: 0, message: 'No mapped channels' });
      }

      // Load team members for task assignment matching
      const { data: teamMembers } = await supabase
        .from('team_members')
        .select('id, name, email')
        .eq('is_active', true);

      let totalSynced = 0;
      const allMessages: { channel: string; context: string; text: string; user: string; ts: string }[] = [];
      const userCache: Record<string, string> = {};

      for (const mapping of mappings) {
        const messages = await fetchChannelMessages(slackToken, mapping.channel_id, mapping.last_synced_ts);
        if (messages.length === 0) continue;

        const contextItems: any[] = [];

        for (const msg of messages) {
          if (msg.subtype === 'channel_join' || msg.subtype === 'channel_leave' || msg.subtype === 'bot_message') continue;
          if (!msg.text || msg.text.trim() === '') continue;

          const userName = await resolveUserName(slackToken, msg.user, userCache);
          const occurredAt = new Date(parseFloat(msg.ts) * 1000).toISOString();
          const resolvedText = await resolveUserMentions(slackToken, msg.text, userCache);

          const channelContext = CHANNEL_CONTEXT[mapping.channel_name] || `#${mapping.channel_name}`;

          contextItems.push({
            client_id,
            source: 'slack',
            source_id: `slack_${mapping.channel_id}_${msg.ts}`,
            content_type: 'message',
            title: `#${mapping.channel_name}`,
            content: resolvedText,
            occurred_at: occurredAt,
            participants: [userName],
            metadata: {
              channel_id: mapping.channel_id,
              channel_name: mapping.channel_name,
              channel_context: channelContext,
              slack_ts: msg.ts,
              thread_ts: msg.thread_ts || null,
              reactions: msg.reactions || [],
            },
          });

          // Collect for AI analysis
          allMessages.push({
            channel: mapping.channel_name,
            context: channelContext,
            text: resolvedText,
            user: userName,
            ts: occurredAt,
          });

        }

        // The cursor may only advance to the timestamp of the LAST SUCCESSFULLY
        // STORED message. A failed insert used to burn the cursor, which is how
        // messages got read and permanently skipped.
        if (contextItems.length > 0) {
          contextItems.sort((a, b) => Number(a.metadata.slack_ts) - Number(b.metadata.slack_ts));
          let lastStoredTs: string | null = null;
          let contiguous = true;

          for (const item of contextItems) {
            const { error: insertError } = await supabase
              .from('context_items')
              .upsert(item, { onConflict: 'source_id' });

            if (insertError) {
              // Skip the poison message and keep going, but freeze the cursor at
              // the last CONTIGUOUS success so nothing after it is lost.
              console.error(`Insert error for #${mapping.channel_name} @ ${item.metadata.slack_ts}:`, insertError);
              contiguous = false;
              continue;
            }
            totalSynced += 1;
            if (contiguous) lastStoredTs = item.metadata.slack_ts as string;
          }

          if (lastStoredTs) {
            await supabase.from('slack_channel_mappings')
              .update({ last_synced_ts: lastStoredTs, updated_at: new Date().toISOString() })
              .eq('id', mapping.id);
          }
        }
      }

      // ──── AI ANALYSIS: Summarize + Extract Tasks ────
      let summary = null;
      let tasksCreated = 0;

      if (allMessages.length > 0 && LOVABLE_API_KEY) {
        try {
          const aiResult = await analyzeSlackMessages(allMessages, teamMembers || [], client_id);

          // Store summary as a context item
          if (aiResult.summary) {
            summary = aiResult.summary;
            await supabase.from('context_items').upsert({
              client_id,
              source: 'slack',
              source_id: `slack_summary_${new Date().toISOString().split('T')[0]}`,
              content_type: 'ai_summary',
              title: `Slack Activity Summary — ${new Date().toLocaleDateString()}`,
              content: aiResult.summary,
              occurred_at: new Date().toISOString(),
              participants: [],
              metadata: {
                message_count: allMessages.length,
                channels: [...new Set(allMessages.map(m => m.channel))],
                key_topics: aiResult.key_topics || [],
              },
            }, { onConflict: 'source_id' });
          }

          // Create tasks from extracted action items
          if (aiResult.tasks && aiResult.tasks.length > 0) {
            // Channels whose action items should ONLY become creative briefs (never tasks)
            const CREATIVE_ONLY_CHANNELS = ['cpm_malena', '#cpm_malena'];

            for (const task of aiResult.tasks) {
              // Match assignee by name
              let assigneeId: string | null = null;
              if (task.assignee) {
                const match = (teamMembers || []).find((tm: any) =>
                  tm.name.toLowerCase().includes(task.assignee.toLowerCase()) ||
                  task.assignee.toLowerCase().includes(tm.name.toLowerCase())
                );
                if (match) assigneeId = match.id;
              }

              // Normalize channel name (strip leading #)
              const normalizedChannel = (task.channel || '').replace(/^#+/, '');
              const isCreativeOnly = CREATIVE_ONLY_CHANNELS.includes(normalizedChannel) ||
                                     CREATIVE_ONLY_CHANNELS.includes(task.channel);

              // ──── Creative-only channels (e.g. #cpm_malena): SKIP entirely ────
              // Briefs for Malena should only be created manually by Henry/Belu
              // via the Creative Production flow — not auto-generated from Slack.
              if (isCreativeOnly) {
                console.log('Skipping auto-creation for creative-only channel:', normalizedChannel, '—', task.title);
                continue;
              }

              // ──── Normal channel: create a task ────
              const { error: taskError } = await supabase.from('tasks').insert({
                client_id,
                title: task.title,
                description: `[Auto-created from Slack #${normalizedChannel}]\n\n${task.context}`,
                status: 'todo',
                priority: task.priority || 'medium',
                assignee_id: assigneeId,
                tags: ['slack-auto', normalizedChannel],
                position: 0,
              });

              if (!taskError) tasksCreated++;
              else console.error('Task creation error:', taskError);
            }
          }
        } catch (aiErr) {
          console.error('AI analysis error:', aiErr);
        }
      }

      // Log sync
      await supabase.from('context_sync_log').insert({
        client_id,
        source: 'slack',
        status: 'success',
        items_synced: totalSynced,
        last_sync_at: new Date().toISOString(),
      });

      // Log integration usage — 1 call per mapped channel synced
      if (mappings.length > 0) {
        await logIntegrationCall({
          client_id,
          service: "slack_api",
          surface: "sync-slack",
          calls: mappings.length,
          metadata: {
            channels: mappings.length,
            messages_synced: totalSynced,
            tasks_created: tasksCreated,
          },
        });
      }

      return jsonResp({ synced: totalSynced, tasks_created: tasksCreated, summary });
    }

    return jsonResp({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('Slack sync error:', err);
    return jsonResp({ error: err.message }, 500);
  }
});

// ──── AI Analysis ────
async function analyzeSlackMessages(
  messages: { channel: string; context: string; text: string; user: string; ts: string }[],
  teamMembers: { id: string; name: string; email: string }[],
  clientId: string
) {
  const teamNames = teamMembers.map(tm => tm.name).join(', ');

  // Truncate messages if too many — take last 100
  const recentMessages = messages.slice(-100);
  const messageBlock = recentMessages.map(m =>
    `[${m.ts}] #${m.channel} (${m.context}) — ${m.user}: ${m.text}`
  ).join('\n');

  const prompt = `Analyze these Slack messages from a digital advertising agency's internal channels for a specific client.

TEAM MEMBERS: ${teamNames}

MESSAGES:
${messageBlock}

Respond with JSON containing:
1. "summary" — A 3-5 sentence executive summary of what's happening. Focus on: campaign launches, performance discussions, creative requests, client feedback, and strategic decisions. Write in third person past tense.
2. "key_topics" — Array of 3-7 key topics discussed (short phrases).
3. "tasks" — Array of action items extracted from messages where someone is clearly assigned or volunteers to do something. Each task should have:
   - "title": Short actionable task title (imperative mood, e.g. "Set up tracking for pest control campaign")
   - "assignee": The name of the person assigned (must be one of the team members listed above, or null)
   - "channel": Which channel the task came from
   - "context": The relevant message text that indicates this task
   - "priority": "urgent", "high", "medium", or "low" based on context

Only extract REAL tasks — things like "set up a campaign", "add tracking", "create landing page", "send report", "update budget". Do NOT extract casual conversation, questions, or status updates as tasks.

4. "client_updates" — Array of items that would be relevant to share with the client in a meeting agenda. Things like campaign progress, creative status, results being discussed.`;

  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are an expert digital marketing operations analyst. Extract structured insights from Slack conversations. Be precise about action items — only flag genuine tasks, not casual chat.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

// ──── Helper: detect client from channel name ────
function detectClientFromChannel(channelName: string): string | null {
  const lower = channelName.toLowerCase();
  for (const [slug, patterns] of Object.entries(CHANNEL_CLIENT_PATTERNS)) {
    if (patterns.some(p => lower.includes(p))) return slug;
  }
  // CPM-prefixed channels are internal — associate with all clients or skip
  if (lower.startsWith('cpm_')) return null;
  return null;
}

// ──── Slack API helpers ────
async function listBotChannels(token: string) {
  const channels: any[] = [];
  let cursor = '';
  do {
    const url = `https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!data.ok) break;
    for (const ch of data.channels || []) {
      if (ch.is_member) {
        channels.push({
          id: ch.id,
          name: ch.name,
          is_private: ch.is_private,
          is_shared: ch.is_shared,
          is_ext_shared: ch.is_ext_shared,
          is_org_shared: ch.is_org_shared,
          topic: ch.topic?.value || '',
        });
      }
    }
    cursor = data.response_metadata?.next_cursor || '';
  } while (cursor);
  return channels;
}

async function fetchChannelMessages(token: string, channelId: string, oldest?: string | null) {
  const messages: any[] = [];
  let cursor = '';
  const params = new URLSearchParams({ channel: channelId, limit: '200' });
  if (oldest) params.set('oldest', oldest);

  do {
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`https://slack.com/api/conversations.history?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) break;
    messages.push(...(data.messages || []));
    cursor = data.response_metadata?.next_cursor || '';
  } while (cursor);

  return messages;
}

async function resolveUserName(token: string, userId: string, cache: Record<string, string>): Promise<string> {
  if (!userId) return 'Unknown';
  if (cache[userId]) return cache[userId];
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.ok && data.user) {
      const name = data.user.profile?.display_name || data.user.real_name || data.user.name || userId;
      cache[userId] = name;
      return name;
    }
  } catch (e) {
    console.warn('users.info failed, storing raw user id:', userId, e);
  }
  // Degrade gracefully: the raw Slack user id is stored rather than failing the
  // whole message insert.
  cache[userId] = userId;
  return userId;
}

async function resolveUserMentions(token: string, text: string, cache: Record<string, string>): Promise<string> {
  const mentionPattern = /<@([A-Z0-9]+)>/g;
  const matches = [...text.matchAll(mentionPattern)];
  let resolved = text;
  for (const match of matches) {
    const name = await resolveUserName(token, match[1], cache);
    resolved = resolved.replace(match[0], `@${name}`);
  }
  resolved = resolved.replace(/<#([A-Z0-9]+)\|([^>]+)>/g, '#$2');
  resolved = resolved.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)');
  resolved = resolved.replace(/<(https?:\/\/[^>]+)>/g, '$1');
  return resolved;
}

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
