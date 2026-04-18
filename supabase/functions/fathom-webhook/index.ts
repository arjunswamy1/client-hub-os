import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/cost-tracking.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

// Multiple webhook secrets for multiple Fathom accounts
const WEBHOOK_ACCOUNTS = [
  { label: "AJ's Fathom", secret: Deno.env.get('FATHOM_WEBHOOK_SECRET') },
  { label: "Charles' Fathom", secret: Deno.env.get('FATHOM_WEBHOOK_SECRET_CHARLES') },
].filter(a => a.secret);

// ─── Dedup Key ─────────────────────────────────────────────────────────────

function dedupKey(title: string, startTime: string): string {
  const normalized = (title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const dateMinute = (startTime || '').slice(0, 16);
  return `fathom_${normalized}_${dateMinute}`;
}

// ─── Webhook Verification ──────────────────────────────────────────────────

async function verifyWebhook(secret: string, headers: Headers, rawBody: string): Promise<boolean> {
  try {
    const webhookId = headers.get('webhook-id');
    const webhookTimestamp = headers.get('webhook-timestamp');
    const webhookSignature = headers.get('webhook-signature');
    if (!webhookId || !webhookTimestamp || !webhookSignature) return false;

    const timestamp = parseInt(webhookTimestamp, 10);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTimestamp - timestamp) > 300) return false;

    const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    const secretPart = secret.includes('_') ? secret.split('_')[1] : secret;
    const secretBytes = Uint8Array.from(atob(secretPart), c => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
      'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
    const expectedSignature = btoa(String.fromCharCode(...new Uint8Array(sig)));

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

// Try verifying against all accounts, return matching label
async function verifyAnyAccount(headers: Headers, rawBody: string): Promise<string | null> {
  for (const account of WEBHOOK_ACCOUNTS) {
    if (await verifyWebhook(account.secret!, headers, rawBody)) {
      return account.label;
    }
  }
  return null;
}

// ─── Client Matching ───────────────────────────────────────────────────────

async function matchClientFromMeeting(title: string, participants: string[]): Promise<{ id: string; name: string } | null> {
  const { data: clients } = await supabase
    .from('clients').select('id, name, slug').eq('status', 'active');
  if (!clients?.length) return null;

  const lowerTitle = title.toLowerCase();
  for (const client of clients) {
    const keywords = [client.name.toLowerCase(), client.slug.toLowerCase()];
    if (keywords.some(k => lowerTitle.includes(k))) {
      return { id: client.id, name: client.name };
    }
  }
  return null;
}

// ─── AI Processing ─────────────────────────────────────────────────────────

async function extractActionItems(
  summary: string, actionItems: any[], clientName: string
): Promise<Array<{ title: string; assignee: string | null; priority: string; context: string }>> {
  if (actionItems?.length > 0) {
    return actionItems.map((item: any) => ({
      title: item.text || item.title || item.description || 'Action item',
      assignee: item.assignee || null,
      priority: 'medium',
      context: `From Fathom meeting recording for ${clientName}`,
    }));
  }

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, webhook-id, webhook-timestamp, webhook-signature',
      },
    });
  }

  const rawBody = await req.text();

  // Verify against any configured account
  const accountLabel = await verifyAnyAccount(req.headers, rawBody);
  if (!accountLabel) {
    console.error('Invalid webhook signature (tried all accounts)');
    return new Response('Unauthorized', { status: 401 });
  }

  console.log(`Fathom webhook verified via: ${accountLabel}`);

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const meetingTitle = payload.meeting_title || payload.title || 'Untitled Meeting';
  console.log('Fathom webhook received:', meetingTitle);

  try {
    const meetingDate = payload.meeting_date || payload.created_at || new Date().toISOString();
    const participants = payload.participants?.map((p: any) => p.email || p.name || '') || [];
    const summary = payload.summary || '';
    const transcript = payload.transcript || null;
    const actionItems = payload.action_items || [];
    const recordingUrl = payload.recording_url || payload.share_url || null;

    const client = await matchClientFromMeeting(meetingTitle, participants);
    if (!client) {
      console.log('No client matched for meeting:', meetingTitle);
      return new Response(JSON.stringify({ ok: true, matched: false }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('Matched client:', client.name);

    // Dedup: check if this meeting already exists
    const sourceId = dedupKey(meetingTitle, meetingDate);
    const { data: existing } = await supabase
      .from('context_items').select('id').eq('source_id', sourceId).maybeSingle();

    if (existing) {
      console.log('Meeting already exists (dedup), skipping:', meetingTitle);
      return new Response(JSON.stringify({
        ok: true, matched: true, client: client.name,
        skipped: true, reason: 'duplicate',
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Store context item
    const contextContent = [
      summary ? `## Summary\n${summary}` : '',
      transcript ? `## Transcript\n${typeof transcript === 'string' ? transcript : JSON.stringify(transcript)}` : '',
    ].filter(Boolean).join('\n\n');

    const { error: contextError } = await supabase.from('context_items').upsert({
      client_id: client.id,
      source: 'fathom',
      source_id: sourceId,
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
        fathom_account: accountLabel,
      },
    }, { onConflict: 'source_id' });

    if (contextError) console.error('Context item error:', contextError);

    // Create tasks from action items
    const extractedItems = await extractActionItems(summary, actionItems, client.name);
    let tasksCreated = 0;

    if (extractedItems.length > 0) {
      const { data: teamMembers } = await supabase
        .from('team_members').select('id, name, email').eq('is_active', true);

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
          description: `[Auto-created from ${accountLabel}: ${meetingTitle}]\n\n${item.context}`,
          status: 'todo',
          priority: item.priority,
          assignee_id: assigneeId,
          tags: ['fathom-auto', 'meeting-action-item'],
          position: 0,
        });

        if (!taskError) tasksCreated++;
        else console.error('Task creation error:', taskError);
      }
    }

    await supabase.from('context_sync_log').insert({
      client_id: client.id,
      source: 'fathom',
      status: 'success',
      items_synced: 1 + tasksCreated,
      last_sync_at: new Date().toISOString(),
    });

    // Log integration usage (1 webhook event = 1 call)
    await logIntegrationCall({
      client_id: client.id,
      service: "fathom_api",
      surface: "fathom-webhook",
      calls: 1,
      metadata: { meeting: meetingTitle, tasks_created: tasksCreated },
    });

    return new Response(JSON.stringify({
      ok: true, matched: true, client: client.name,
      fathom_account: accountLabel,
      context_saved: true, tasks_created: tasksCreated,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Fathom webhook processing error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
