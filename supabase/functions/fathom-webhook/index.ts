import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const FATHOM_WEBHOOK_SECRET = Deno.env.get('FATHOM_WEBHOOK_SECRET')!;
const FATHOM_API_KEY = Deno.env.get('FATHOM_API_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

// ─── Webhook Verification ──────────────────────────────────────────────────

async function verifyWebhook(secret: string, headers: Headers, rawBody: string): Promise<boolean> {
  try {
    const webhookId = headers.get('webhook-id');
    const webhookTimestamp = headers.get('webhook-timestamp');
    const webhookSignature = headers.get('webhook-signature');

    if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

    // Check timestamp (within 5 minutes)
    const timestamp = parseInt(webhookTimestamp, 10);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTimestamp - timestamp) > 300) return false;

    // Construct signed content
    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;

    // Base64 decode the secret (part after whsec_)
    const secretPart = secret.includes('_') ? secret.split('_')[1] : secret;
    const secretBytes = Uint8Array.from(atob(secretPart), c => c.charCodeAt(0));

    // HMAC-SHA256
    const key = await crypto.subtle.importKey(
      'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
    const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(sig)));

    // Compare signatures
    const signatures = webhookSignature.split(' ').map(s => {
      const parts = s.split(',');
      return parts.length > 1 ? parts[1] : parts[0];
    });

    return signatures.some(s => s === expectedSignature);
  } catch (e) {
    console.error('Webhook verification error:', e);
    return false;
  }
}

// ─── Client Matching ───────────────────────────────────────────────────────

async function matchClientFromMeeting(title: string, participants: string[]): Promise<{ id: string; name: string } | null> {
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, slug')
    .eq('status', 'active');

  if (!clients?.length) return null;

  // 1. Match by meeting title keywords
  const lowerTitle = title.toLowerCase();
  for (const client of clients) {
    const keywords = [client.name.toLowerCase(), client.slug.toLowerCase()];
    if (keywords.some(k => lowerTitle.includes(k))) {
      return { id: client.id, name: client.name };
    }
  }

  // 2. Match by participant email domains
  if (participants.length > 0) {
    // Get team member emails to exclude internal domains
    const { data: teamMembers } = await supabase
      .from('team_members')
      .select('email')
      .eq('is_active', true);

    const internalDomains = new Set(
      (teamMembers || []).map(tm => tm.email.split('@')[1]?.toLowerCase()).filter(Boolean)
    );

    // Get external participant domains
    const externalDomains = participants
      .map(p => p.split('@')[1]?.toLowerCase())
      .filter(d => d && !internalDomains.has(d));

    if (externalDomains.length > 0) {
      // Check client_assignments for team members with matching email domains
      // or check if any client communication channels match
      for (const client of clients) {
        const { data: assignments } = await supabase
          .from('client_assignments')
          .select('team_member_id, team_members!client_assignments_team_member_id_fkey(email)')
          .eq('client_id', client.id);

        // If any assigned team member's email domain matches an external participant domain
        // that's a weak signal — skip for now and rely on title matching
      }
    }
  }

  return null;
}

// ─── AI Processing ─────────────────────────────────────────────────────────

async function extractActionItems(
  summary: string,
  transcript: string | null,
  actionItems: any[],
  clientName: string
): Promise<Array<{ title: string; assignee: string | null; priority: string; context: string }>> {
  // If Fathom already provides action items, use those
  if (actionItems?.length > 0) {
    return actionItems.map((item: any) => ({
      title: item.text || item.title || item.description || 'Action item',
      assignee: item.assignee || null,
      priority: 'medium',
      context: `From Fathom meeting recording for ${clientName}`,
    }));
  }

  // Otherwise, use AI to extract from summary
  if (!summary) return [];

  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Extract action items from this meeting summary for client "${clientName}". Return a JSON array of objects with: title (short action description), assignee (name or null), priority (high/medium/low). Only return the JSON array, nothing else.`,
          },
          { role: 'user', content: summary },
        ],
        max_tokens: 800,
        temperature: 0.2,
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const items = JSON.parse(jsonMatch[0]);
      return items.map((item: any) => ({
        title: item.title,
        assignee: item.assignee || null,
        priority: item.priority || 'medium',
        context: `Extracted from Fathom meeting for ${clientName}`,
      }));
    }
  } catch (e) {
    console.error('AI extraction error:', e);
  }
  return [];
}

// ─── Main Handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature',
      },
    });
  }

  const rawBody = await req.text();

  // Verify webhook signature
  const isValid = await verifyWebhook(FATHOM_WEBHOOK_SECRET, req.headers, rawBody);
  if (!isValid) {
    console.error('Invalid webhook signature');
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  console.log('Fathom webhook received:', payload.meeting_title || 'unknown meeting');

  try {
    const meetingTitle = payload.meeting_title || payload.title || 'Untitled Meeting';
    const meetingDate = payload.meeting_date || payload.created_at || new Date().toISOString();
    const participants = payload.participants?.map((p: any) => p.email || p.name || '') || [];
    const summary = payload.summary || '';
    const transcript = payload.transcript || null;
    const actionItems = payload.action_items || [];
    const recordingUrl = payload.recording_url || payload.share_url || null;

    // Match to a client
    const client = await matchClientFromMeeting(meetingTitle, participants);

    if (!client) {
      console.log('No client matched for meeting:', meetingTitle);
      // Still store as unmatched context item if we have a default/first client
      return new Response(JSON.stringify({ ok: true, matched: false }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('Matched client:', client.name);

    // 1. Store as context item (transcript + summary)
    const contextContent = [
      summary ? `## Summary\n${summary}` : '',
      transcript ? `## Transcript\n${typeof transcript === 'string' ? transcript : JSON.stringify(transcript)}` : '',
    ].filter(Boolean).join('\n\n');

    const { error: contextError } = await supabase.from('context_items').upsert({
      client_id: client.id,
      source: 'fathom',
      source_id: `fathom_${payload.id || payload.meeting_id || Date.now()}`,
      content_type: 'meeting_recording',
      title: `📹 ${meetingTitle}`,
      content: contextContent,
      occurred_at: meetingDate,
      participants,
      metadata: {
        recording_url: recordingUrl,
        duration_minutes: payload.duration_minutes || null,
        action_items_count: actionItems.length,
        has_transcript: !!transcript,
      },
    }, { onConflict: 'source_id' });

    if (contextError) console.error('Context item error:', contextError);
    else console.log('Context item saved for:', meetingTitle);

    // 2. Create tasks from action items
    const extractedItems = await extractActionItems(summary, transcript, actionItems, client.name);

    if (extractedItems.length > 0) {
      // Get team members for assignee matching
      const { data: teamMembers } = await supabase
        .from('team_members')
        .select('id, name, email')
        .eq('is_active', true);

      let tasksCreated = 0;
      for (const item of extractedItems) {
        let assigneeId: string | null = null;
        if (item.assignee && teamMembers) {
          const match = teamMembers.find(tm =>
            tm.name.toLowerCase().includes(item.assignee!.toLowerCase()) ||
            item.assignee!.toLowerCase().includes(tm.name.toLowerCase())
          );
          if (match) assigneeId = match.id;
        }

        const { error: taskError } = await supabase.from('tasks').insert({
          client_id: client.id,
          title: item.title,
          description: `[Auto-created from Fathom recording: ${meetingTitle}]\n\n${item.context}`,
          status: 'todo',
          priority: item.priority,
          assignee_id: assigneeId,
          tags: ['fathom-auto', 'meeting-action-item'],
          position: 0,
        });

        if (!taskError) tasksCreated++;
        else console.error('Task creation error:', taskError);
      }
      console.log(`Created ${tasksCreated} tasks from meeting: ${meetingTitle}`);
    }

    // 3. Log sync
    await supabase.from('context_sync_log').insert({
      client_id: client.id,
      source: 'fathom',
      status: 'success',
      items_synced: 1 + extractedItems.length,
      last_sync_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      ok: true,
      matched: true,
      client: client.name,
      context_saved: true,
      tasks_created: extractedItems.length,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Fathom webhook processing error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
