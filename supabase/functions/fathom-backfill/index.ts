import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/cost-tracking.ts";
import { proposeFathomCandidates } from "../_shared/fathom-candidates.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1';

// Multiple Fathom accounts
const FATHOM_ACCOUNTS = [
  { label: "AJ's Fathom", apiKey: Deno.env.get('FATHOM_API_KEY_AJ') || Deno.env.get('FATHOM_API_KEY') },
  { label: "Charles' Fathom", apiKey: Deno.env.get('FATHOM_API_KEY_CHARLES') },
].filter(a => a.apiKey);

async function fathomGet(path: string, apiKey: string): Promise<any> {
  const res = await fetch(`${FATHOM_API_BASE}${path}`, {
    headers: { 'X-Api-Key': apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fathom API ${res.status}: ${text}`);
  }
  return res.json();
}

// Generate a dedup key from meeting title + start time (rounded to minute)
function dedupKey(title: string, startTime: string): string {
  const normalized = (title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const dateMinute = (startTime || '').slice(0, 16); // YYYY-MM-DDTHH:MM
  return `fathom_${normalized}_${dateMinute}`;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const clientSlug = body.client_slug || 'billy';
    const titleKeywords: string[] = body.title_keywords || ['billy', 'kwca', 'billy.com'];
    const maxPages = body.max_pages || 50;
    const accountFilter: string | null = body.account || null; // optional: "aj" or "charles"

    const { data: client, error: clientErr } = await supabase
      .from('clients').select('id, name').eq('slug', clientSlug).single();
    if (clientErr || !client) {
      return new Response(JSON.stringify({ error: `Client '${clientSlug}' not found` }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get existing source_ids for dedup
    const { data: existingItems } = await supabase
      .from('context_items')
      .select('source_id')
      .eq('client_id', client.id)
      .eq('source', 'fathom');
    const existingSourceIds = new Set((existingItems || []).map(i => i.source_id));

    let totalMeetings = 0;
    let matched = 0;
    let contextSaved = 0;
    let candidatesCreated = 0;
    const errors: string[] = [];
    const accountResults: any[] = [];

    // Filter accounts if requested
    const accounts = accountFilter
      ? FATHOM_ACCOUNTS.filter(a => a.label.toLowerCase().includes(accountFilter.toLowerCase()))
      : FATHOM_ACCOUNTS;

    for (const account of accounts) {
      let cursor: string | null = null;
      let page = 0;
      let acctMatched = 0;
      let acctSaved = 0;

      do {
        page++;
        if (page > maxPages) break;

        const params = new URLSearchParams({
          include_summary: 'true',
          include_action_items: 'true',
          include_transcript: 'false',
        });
        if (cursor) params.set('cursor', cursor);

        const data = await fathomGet(`/meetings?${params}`, account.apiKey!);
        const meetings = data.items || [];
        cursor = data.next_cursor || null;

        for (const meeting of meetings) {
          totalMeetings++;
          const title = (meeting.meeting_title || meeting.title || '').toLowerCase();
          const isMatch = titleKeywords.some(k => title.includes(k.toLowerCase()));
          if (!isMatch) continue;
          matched++;
          acctMatched++;

          const meetingDate = meeting.recording_start_time || meeting.created_at;
          const sourceId = dedupKey(meeting.meeting_title || meeting.title, meetingDate);

          // Skip if already exists (dedup across accounts)
          if (existingSourceIds.has(sourceId)) continue;

          const summaryText = meeting.default_summary?.markdown_formatted || '';
          const participants = (meeting.calendar_invitees || []).map((i: any) => i.email || i.name || '');

          const { error: ctxErr } = await supabase.from('context_items').insert({
            client_id: client.id,
            source: 'fathom',
            source_id: sourceId,
            content_type: 'meeting_recording',
            title: `📹 ${meeting.meeting_title || meeting.title}`,
            content: summaryText ? `## Summary\n${summaryText}` : 'No summary available.',
            occurred_at: meetingDate,
            participants,
            metadata: {
              recording_url: meeting.share_url || meeting.url,
              recording_id: meeting.recording_id,
              action_items_count: meeting.action_items?.length || 0,
              fathom_account: account.label,
            },
          });

          if (ctxErr) {
            errors.push(`Context: ${ctxErr.message}`);
          } else {
            contextSaved++;
            acctSaved++;
            existingSourceIds.add(sourceId); // prevent dups from next account
          }

          if (meeting.action_items?.length > 0) {
            const proposed = await proposeFathomCandidates(supabase, client.id, {
              sourceId,
              meetingTitle: meeting.meeting_title || meeting.title,
              meetingDate,
              shareLink: meeting.share_url || meeting.url || null,
              accountLabel: account.label,
            }, meeting.action_items.map((item: any) => {
              const desc = item.description || '';
              return {
                title: desc.length > 100 ? desc.slice(0, 97) + '...' : desc,
                description: `[Backfilled from ${account.label}: ${meeting.meeting_title || meeting.title}]\n\n${desc}${item.recording_playback_url ? `\n\n🎥 ${item.recording_playback_url}` : ''}`,
                ownerRaw: item.assignee?.name || item.assignee?.email || null,
              };
            }).filter((item: { title: string }) => item.title), Deno.env.get('LOVABLE_API_KEY') ?? '');
            candidatesCreated += proposed.candidates_created;
          }
        }
      } while (cursor);

      accountResults.push({ account: account.label, matched: acctMatched, saved: acctSaved, pages: page });
    }

    await supabase.from('context_sync_log').insert({
      client_id: client.id,
      source: 'fathom-backfill',
      status: errors.length > 0 ? 'partial' : 'success',
      items_synced: contextSaved + candidatesCreated,
      last_sync_at: new Date().toISOString(),
      error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
    });

    // Log integration usage — sum of pages fetched across all accounts
    const totalPages = accountResults.reduce((s: number, a: any) => s + (a.pages || 0), 0);
    if (totalPages > 0) {
      await logIntegrationCall({
        client_id: client.id,
        service: "fathom_api",
        surface: "fathom-backfill",
        calls: totalPages,
        metadata: { meetings_scanned: totalMeetings, matched },
      });
    }

    return new Response(JSON.stringify({
      client: client.name,
      accounts_processed: accountResults,
      total_meetings_scanned: totalMeetings,
      matched_to_client: matched,
      context_items_saved: contextSaved,
      candidates_created: candidatesCreated,
      errors: errors.slice(0, 10),
    }, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Backfill error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
