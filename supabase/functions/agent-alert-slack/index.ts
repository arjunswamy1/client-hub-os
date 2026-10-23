// DRAFT. Drains agent_alert_outbox (URGENT rollback_failed + overnight executions) to Charles as a Slack DM.
// Separate from the executor (agent-gateway / agent-gateway-write-exec never import slack-post.ts).
// DMs ONLY: the sole Slack call is a DM 'send' to a constant user id (drain.ts). No channel posts,
// replies, updates, file uploads or other bot-token use; slack_only_dm_test.ts enforces this on the source.
// Slack auth: the hub's existing bot token, resolved inside _shared/slack-post.ts (by name; never read or logged here).
// Schedule: every minute (Supabase cron → POST with the service-role key). Must be live and verified BEFORE the flag goes ON.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { postDirectMessage } from '../_shared/slack-post.ts';
import { drain, type DmSend } from './drain.ts';

const dmOnly: DmSend = async (o) => {
  if (o.kind !== 'send') return { ok: false, reason: 'dm_send_only' };
  const r = await postDirectMessage({ kind: 'send', userId: o.userId, text: o.text });
  return { ok: r.ok, ts: r.ts, slackError: r.slackError, reason: r.reason, error: r.ok ? undefined : 'send_failed' };
};

if (import.meta.main) Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`) return new Response('forbidden', { status: 403 });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  try {
    const results = await drain(db, dmOnly);
    return Response.json({ ok: true, sent: results.filter((r) => r.result === 'sent').length, retry: results.filter((r) => r.result === 'retry').length, failed: results.filter((r) => r.result === 'failed').length });
  } catch { console.error('agent-alert-slack: internal error'); return Response.json({ ok: false }, { status: 500 }); }
});
