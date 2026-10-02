// Delivers queued brief_notifications rows. Manual only — NOT on a cron.
//
// POST { action: 'deliver', brief_id }     any team member; sends pending rows for one brief
//                                          (the hub calls this after submit / accept)
// POST { action: 'retry', dry_run? }       admins; pending|failed rows with attempts < 5,
//                                          exponential backoff, same dedupe key → never a 2nd message
// POST { action: 'preview', brief_id }     any team member; the exact designer DM, never sent
//
// Live sending requires the BRIEF_DM_LIVE secret = "true". Otherwise everything is a dry run.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';
import { admin, deliverForBrief, deliverNotification, liveSendingEnabled, updateDesignerMessage } from '../_shared/brief-notify.ts';
import { designerAssignedBlocks, designerAssignedText, retryDue } from '../_shared/brief-messages.ts';
import { postDirectMessage } from '../_shared/slack-post.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({
  action: z.enum(['deliver', 'retry', 'preview']),
  brief_id: z.string().uuid().optional(),
  dry_run: z.boolean().optional(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const db = admin();

  // Auth: a signed-in team member, or a single-use cron nonce.
  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  const nonce = req.headers.get('x-cron-nonce') || '';
  let isAdmin = false, isMember = false;
  if (/^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data } = await db.from('cron_invocation_tokens').delete().eq('token', nonce)
      .gt('created_at', new Date(Date.now() - 5 * 60000).toISOString()).select('token').maybeSingle();
    if (data) { isAdmin = true; isMember = true; }
  }
  if (!isMember && bearer) {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: auth } = await asUser.auth.getUser();
    if (auth?.user) {
      const { data: tm } = await db.from('team_members').select('id, role').eq('user_id', auth.user.id).maybeSingle();
      isMember = !!tm;
      isAdmin = tm?.role === 'admin';
    }
  }
  if (!isMember) return json({ error: 'Unauthorized' }, 401);

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
  const { action, brief_id } = parsed.data;
  const live = liveSendingEnabled();
  const dryRun = !live || parsed.data.dry_run === true;

  if (action === 'preview') {
    if (!brief_id) return json({ error: 'brief_id required' }, 400);
    const { data: b } = await db.from('creative_briefs')
      .select('id, title, due_date, priority, assigned:team_members!creative_briefs_assigned_to_id_fkey(slack_user_id, name), owner:team_members!creative_briefs_created_by_id_fkey(name)')
      .eq('id', brief_id).maybeSingle();
    if (!b) return json({ error: 'not found' }, 404);
    const m = { id: b.id, title: b.title, owner_name: (b as any).owner?.name, due_date: b.due_date, priority: b.priority };
    const res = await postDirectMessage({ kind: 'send', userId: (b as any).assigned?.slack_user_id || '', text: designerAssignedText(m), blocks: designerAssignedBlocks(m), dryRun: true });
    return json({ live_sending: live, preview: res });
  }

  if (action === 'deliver') {
    if (!brief_id) return json({ error: 'brief_id required' }, 400);
    const deliveries = await deliverForBrief(db, brief_id, { dryRun });
    const designer_update = await updateDesignerMessage(db, brief_id, { dryRun });
    return json({ live_sending: live, dry_run: dryRun, deliveries, designer_update });
  }

  // retry
  if (!isAdmin) return json({ error: 'Admins only' }, 403);
  const { data: rows } = await db.from('brief_notifications').select('*')
    .in('status', ['pending', 'failed']).lt('attempts', 5).order('created_at').limit(100);
  const due = (rows ?? []).filter((r: any) => retryDue(r.attempts, r.updated_at));
  const results = [];
  for (const r of due) results.push(await deliverNotification(db, r, { dryRun }));
  return json({ live_sending: live, dry_run: dryRun, eligible: rows?.length ?? 0, due: due.length, results });
});
