import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FATHOM_API_KEY = Deno.env.get('FATHOM_API_KEY')!;
const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';

async function fathomGet(path: string): Promise<any> {
  const res = await fetch(`${FATHOM_API_BASE}${path}`, {
    headers: { 'X-Api-Key': FATHOM_API_KEY },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fathom API ${res.status}: ${text}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const clientSlug = body.client_slug || 'billy';
    const titleKeywords: string[] = body.title_keywords || ['billy', 'kwca', 'billy.com'];

    // Get client
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, name')
      .eq('slug', clientSlug)
      .single();

    if (clientErr || !client) {
      return new Response(JSON.stringify({ error: `Client '${clientSlug}' not found` }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get team members for assignee matching
    const { data: teamMembers } = await supabase
      .from('team_members')
      .select('id, name, email')
      .eq('is_active', true);

    const maxPages = body.max_pages || 50;
    const startCursor = body.cursor || null;
    let page = 0;
    let lastCursor: string | null = null;
    let tasksCreated = 0;
    const errors: string[] = [];

    const maxPages = body.max_pages || 5;
    let page = 0;

    // Paginate through meetings with summary + action items
    do {
      page++;
      if (page > maxPages) break;

      const params = new URLSearchParams({
        include_summary: 'true',
        include_action_items: 'true',
        include_transcript: 'false',
      });
      if (cursor) params.set('cursor', cursor);

      const data = await fathomGet(`/meetings?${params}`);
      const meetings = data.items || [];
      cursor = data.next_cursor || null;

      for (const meeting of meetings) {
        totalMeetings++;
        const title = (meeting.meeting_title || meeting.title || '').toLowerCase();
        const isMatch = titleKeywords.some(k => title.includes(k.toLowerCase()));

        if (!isMatch) continue;
        matched++;

        const sourceId = `fathom_${meeting.recording_id}`;

        // Check if already imported
        const { data: existing } = await supabase
          .from('context_items')
          .select('id')
          .eq('source_id', sourceId)
          .maybeSingle();

        if (existing) continue; // skip duplicates

        // Build summary content
        const summaryText = meeting.default_summary?.markdown_formatted || '';
        const contextContent = summaryText
          ? `## Summary\n${summaryText}`
          : 'No summary available.';

        const participants = (meeting.calendar_invitees || []).map((i: any) => i.email || i.name || '');
        const meetingDate = meeting.recording_start_time || meeting.created_at;

        // Save context item
        const { error: ctxErr } = await supabase.from('context_items').insert({
          client_id: client.id,
          source: 'fathom',
          source_id: sourceId,
          content_type: 'meeting_recording',
          title: `📹 ${meeting.meeting_title || meeting.title}`,
          content: contextContent,
          occurred_at: meetingDate,
          participants,
          metadata: {
            recording_url: meeting.share_url || meeting.url,
            recording_id: meeting.recording_id,
            scheduled_start: meeting.scheduled_start_time,
            scheduled_end: meeting.scheduled_end_time,
            action_items_count: meeting.action_items?.length || 0,
          },
        });

        if (ctxErr) {
          errors.push(`Context save error for ${sourceId}: ${ctxErr.message}`);
        } else {
          contextSaved++;
        }

        // Create tasks from action items
        if (meeting.action_items?.length > 0) {
          for (const item of meeting.action_items) {
            const desc = item.description || '';
            if (!desc) continue;

            let assigneeId: string | null = null;
            const assigneeName = item.assignee?.name || item.assignee?.email || null;
            if (assigneeName && teamMembers) {
              const match = teamMembers.find(tm =>
                tm.name.toLowerCase().includes(assigneeName.toLowerCase()) ||
                assigneeName.toLowerCase().includes(tm.name.toLowerCase()) ||
                (item.assignee?.email && tm.email.toLowerCase() === item.assignee.email.toLowerCase())
              );
              if (match) assigneeId = match.id;
            }

            const { error: taskErr } = await supabase.from('tasks').insert({
              client_id: client.id,
              title: desc.length > 100 ? desc.slice(0, 97) + '...' : desc,
              description: `[Backfilled from Fathom: ${meeting.meeting_title || meeting.title}]\n\n${desc}${item.recording_playback_url ? `\n\n🎥 ${item.recording_playback_url}` : ''}`,
              status: item.completed ? 'done' : 'todo',
              priority: 'medium',
              assignee_id: assigneeId,
              tags: ['fathom-backfill', 'meeting-action-item'],
              position: 0,
              completed_at: item.completed ? new Date().toISOString() : null,
            });

            if (!taskErr) tasksCreated++;
            else errors.push(`Task error: ${taskErr.message}`);
          }
        }
      }

      // Rate limiting: Fathom allows 60 req/min, be safe
      if (cursor) await new Promise(r => setTimeout(r, 1100));
    } while (cursor);

    // Log sync
    await supabase.from('context_sync_log').insert({
      client_id: client.id,
      source: 'fathom-backfill',
      status: errors.length > 0 ? 'partial' : 'success',
      items_synced: contextSaved + tasksCreated,
      last_sync_at: new Date().toISOString(),
      error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
    });

    return new Response(JSON.stringify({
      client: client.name,
      total_meetings_scanned: totalMeetings,
      matched_to_client: matched,
      context_items_saved: contextSaved,
      tasks_created: tasksCreated,
      errors: errors.slice(0, 10),
    }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Backfill error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
