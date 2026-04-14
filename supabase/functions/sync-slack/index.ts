import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const slackToken = Deno.env.get('SLACK_BOT_TOKEN');
    if (!slackToken) {
      return new Response(JSON.stringify({ error: 'SLACK_BOT_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { action = 'sync', client_id, channel_id, channel_name } = body;

    // Action: list channels the bot is in
    if (action === 'list_channels') {
      const channels = await listBotChannels(slackToken);
      return new Response(JSON.stringify({ channels }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: map a channel to a client
    if (action === 'map_channel') {
      if (!client_id || !channel_id || !channel_name) {
        return new Response(JSON.stringify({ error: 'Missing client_id, channel_id, or channel_name' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { error } = await supabase
        .from('slack_channel_mappings')
        .upsert(
          { client_id, channel_id, channel_name, sync_enabled: true },
          { onConflict: 'channel_id' }
        );

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: unmap a channel
    if (action === 'unmap_channel') {
      if (!channel_id) {
        return new Response(JSON.stringify({ error: 'Missing channel_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await supabase
        .from('slack_channel_mappings')
        .delete()
        .eq('channel_id', channel_id);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: sync — pull messages from mapped channels for a client
    if (action === 'sync') {
      if (!client_id) {
        return new Response(JSON.stringify({ error: 'Missing client_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: mappings } = await supabase
        .from('slack_channel_mappings')
        .select('*')
        .eq('client_id', client_id)
        .eq('sync_enabled', true);

      if (!mappings || mappings.length === 0) {
        return new Response(JSON.stringify({ synced: 0, message: 'No mapped channels for this client' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let totalSynced = 0;

      for (const mapping of mappings) {
        const messages = await fetchChannelMessages(slackToken, mapping.channel_id, mapping.last_synced_ts);

        if (messages.length === 0) continue;

        // Resolve user IDs to display names
        const userCache: Record<string, string> = {};

        const contextItems = [];
        let latestTs = mapping.last_synced_ts || '0';

        for (const msg of messages) {
          // Skip bot join/leave messages and channel join messages
          if (msg.subtype === 'channel_join' || msg.subtype === 'channel_leave' || msg.subtype === 'bot_message') continue;
          if (!msg.text || msg.text.trim() === '') continue;

          const userName = await resolveUserName(slackToken, msg.user, userCache);
          const occurredAt = new Date(parseFloat(msg.ts) * 1000).toISOString();

          // Resolve @mentions in text
          const resolvedText = await resolveUserMentions(slackToken, msg.text, userCache);

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
              slack_ts: msg.ts,
              thread_ts: msg.thread_ts || null,
              reactions: msg.reactions || [],
            },
          });

          if (msg.ts > latestTs) latestTs = msg.ts;
        }

        if (contextItems.length > 0) {
          // Upsert to avoid duplicates
          const { error: insertError } = await supabase
            .from('context_items')
            .upsert(contextItems, { onConflict: 'source_id' });

          if (insertError) {
            console.error(`Insert error for channel ${mapping.channel_name}:`, insertError);
          } else {
            totalSynced += contextItems.length;
          }

          // Update watermark
          await supabase
            .from('slack_channel_mappings')
            .update({ last_synced_ts: latestTs, updated_at: new Date().toISOString() })
            .eq('id', mapping.id);
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

      return new Response(JSON.stringify({ synced: totalSynced }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Slack sync error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function listBotChannels(token: string) {
  const channels: any[] = [];
  let cursor = '';
  do {
    const url = `https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('conversations.list error:', data.error);
      break;
    }
    for (const ch of data.channels || []) {
      if (ch.is_member) {
        channels.push({ id: ch.id, name: ch.name, is_private: ch.is_private, topic: ch.topic?.value || '' });
      }
    }
    cursor = data.response_metadata?.next_cursor || '';
  } while (cursor);
  return channels;
}

async function fetchChannelMessages(token: string, channelId: string, oldest?: string | null) {
  const messages: any[] = [];
  let cursor = '';
  const params = new URLSearchParams({
    channel: channelId,
    limit: '200',
  });
  if (oldest) {
    params.set('oldest', oldest);
  }

  do {
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`https://slack.com/api/conversations.history?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`conversations.history error for ${channelId}:`, data.error);
      break;
    }
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
  } catch (err) {
    console.error('Error resolving user:', err);
  }

  cache[userId] = userId;
  return userId;
}

async function resolveUserMentions(token: string, text: string, cache: Record<string, string>): Promise<string> {
  const mentionPattern = /<@([A-Z0-9]+)>/g;
  const matches = [...text.matchAll(mentionPattern)];

  let resolved = text;
  for (const match of matches) {
    const userId = match[1];
    const name = await resolveUserName(token, userId, cache);
    resolved = resolved.replace(match[0], `@${name}`);
  }

  // Also resolve channel mentions
  resolved = resolved.replace(/<#([A-Z0-9]+)\|([^>]+)>/g, '#$2');
  // Clean up link formatting
  resolved = resolved.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)');
  resolved = resolved.replace(/<(https?:\/\/[^>]+)>/g, '$1');

  return resolved;
}
