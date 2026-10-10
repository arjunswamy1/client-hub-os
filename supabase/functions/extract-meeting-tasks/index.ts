// Recordings → tasks, only on an explicit spoken ask.
//
// A task is created only where someone on the call addresses CPM Bot or names
// the task tracker and asks for something to be added ("CPM Bot, add a task…",
// "put that in the task tracker"). Meeting summaries, "next steps" and
// everything else said on the call never create tasks.
//
// Rules: _shared/task-request-rules.ts. Writer: _shared/task-request.ts (deduped
// per meeting + line, so re-running is safe).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { findSpokenTaskRequests } from '../_shared/task-request-rules.ts';
import { createRequestedTask } from '../_shared/task-request.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  const nonce = req.headers.get('x-cron-nonce') || '';
  let authorized = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorized && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data: tokenRow } = await supabase.from('cron_invocation_tokens').delete().eq('token', nonce)
      .gt('created_at', new Date(Date.now() - 5 * 60000).toISOString()).select('token').maybeSingle();
    authorized = !!tokenRow;
  }
  if (!authorized && bearer) {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${bearer}` } } });
    const { data: auth } = await asUser.auth.getUser();
    authorized = !!auth?.user;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body.days) || 3, 1), 60);
    const dryRun = body.dry_run === true;
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const { data: meetings, error } = await supabase.from('context_items')
      .select('id, client_id, title, content, occurred_at, metadata')
      .in('source', ['wispr', 'fathom']).gte('occurred_at', since).order('occurred_at');
    if (error) throw error;

    const found: unknown[] = [];
    let created = 0, duplicates = 0, notTasks = 0;
    const failures: string[] = [];
    for (const m of meetings ?? []) {
      const link = typeof m.metadata?.share_link === 'string' ? m.metadata.share_link : null;
      for (const r of findSpokenTaskRequests(m.content ?? '')) {
        found.push({ meeting: m.title, date: m.occurred_at, quote: r.quote });
        if (dryRun) continue;
        const out = await createRequestedTask(supabase, {
          origin: 'recording', sourceRef: `recording:${m.id}:${r.line_index}`,
          text: `On the call "${m.title ?? 'meeting'}" (${String(m.occurred_at).slice(0, 10)}): ${r.context}`,
          quote: r.quote, requestedByMemberId: null, clientId: m.client_id, link,
          meetingDate: String(m.occurred_at).slice(0, 10), today: String(m.occurred_at).slice(0, 10),
        });
        if (out.ok && out.duplicate) duplicates++;
        else if (out.ok) created++;
        else if (out.error === 'not_a_task') notTasks++;
        else failures.push(`${m.id}: ${out.error}`);
      }
    }
    const summary = { meetings: (meetings ?? []).length, days, requests_found: found.length, created, duplicates, not_tasks: notTasks, failures, dry_run: dryRun, ...(dryRun ? { found } : {}) };
    console.log('extract-meeting-tasks:', JSON.stringify(summary));
    return json({ success: true, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('extract-meeting-tasks FAILED:', message);
    return json({ error: message }, 500);
  }
});
