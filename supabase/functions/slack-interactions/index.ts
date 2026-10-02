// Slack Interactivity endpoint (public — Slack calls it unauthenticated).
//
// 1. Verify the signing secret over the RAW body + timestamp freshness, before parsing.
// 2. Acknowledge within 3 seconds; the work runs after the response via waitUntil.
// 3. Replay protection: the unique trigger_id on slack_interaction_log. A retried
//    delivery is logged as duplicate_retry and changes nothing.
// 4. Accept is ONE conditional UPDATE (accept_creative_brief_as). Zero rows → a
//    refusal, explained to the clicker with an ephemeral reply. Never silent.
// 5. On accept: rewrite the original DM (Accept button removed), then DM the owner.
//    An owner DM failure is recorded and retryable; the acceptance stands.
import { admin, deliverForBrief, liveSendingEnabled, updateDesignerMessage } from '../_shared/brief-notify.ts';
import { refusalText, type AcceptResult } from '../_shared/brief-messages.ts';
import { postDirectMessage } from '../_shared/slack-post.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const enc = new TextEncoder();

async function verifySlack(req: Request, raw: string): Promise<string | null> {
  const secret = Deno.env.get('SLACK_SIGNING_SECRET');
  if (!secret) return 'signing secret not configured';
  const ts = req.headers.get('x-slack-request-timestamp') || '';
  const sig = req.headers.get('x-slack-signature') || '';
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return 'stale or missing timestamp';
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`v0:${ts}:${raw}`)));
  const expected = 'v0=' + Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== sig.length) return 'bad signature';
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? null : 'bad signature';
}

async function handle(payload: any) {
  const db = admin();
  const dryRun = !liveSendingEnabled();
  const action = (payload.actions || [])[0] || {};
  if (action.action_id !== 'accept_brief') return; // View Brief is a URL button
  const triggerId: string | null = payload.trigger_id || null;
  const slackUser: string = payload.user?.id || '';
  const briefId: string = String(action.value || '');
  const responseUrl: string = payload.response_url || '';
  const validBrief = /^[0-9a-f-]{36}$/i.test(briefId);

  // Claim the trigger_id first. A conflict means Slack retried this exact click.
  // The unique index is partial (trigger_id IS NOT NULL), so ON CONFLICT cannot infer it — insert and read 23505.
  const { data: claim, error: claimErr } = await db.from('slack_interaction_log').insert({
    trigger_id: triggerId, action_id: action.action_id, actor_slack_user_id: slackUser,
    brief_id: validBrief ? briefId : null, outcome: 'error', detail: 'processing', raw_payload: payload,
  }).select('id').maybeSingle();
  if (claimErr?.code === '23505') {
    await db.from('slack_interaction_log').insert({
      trigger_id: null, action_id: action.action_id, actor_slack_user_id: slackUser,
      brief_id: validBrief ? briefId : null, outcome: 'duplicate_retry', detail: `retry of trigger ${triggerId}`,
    });
    return;
  }
  if (claimErr || !claim) throw new Error(`could not log interaction: ${claimErr?.message}`);
  const finish = (outcome: string, detail: string, actorId?: string | null) =>
    db.from('slack_interaction_log').update({ outcome, detail, actor_team_member_id: actorId ?? null }).eq('id', claim!.id);

  const reply = (r: AcceptResult) =>
    postDirectMessage({ kind: 'interaction_reply', userId: slackUser, responseUrl, text: refusalText(r), dryRun });

  try {
    const { data: actor } = await db.from('team_members').select('id, name').eq('slack_user_id', slackUser).maybeSingle();
    if (!actor) {
      const r: AcceptResult = { outcome: 'rejected_unknown_actor' };
      await finish(r.outcome, `slack user ${slackUser} has no team_members row`);
      await reply(r);
      return;
    }
    if (!validBrief) {
      const r: AcceptResult = { outcome: 'error', detail: 'invalid brief id' };
      await finish('error', 'invalid brief id in button value', actor.id);
      await reply(r);
      return;
    }

    const { data, error } = await db.rpc('accept_creative_brief_as', { p_brief_id: briefId, p_actor: actor.id, p_via: 'slack' });
    if (error) throw new Error(error.message);
    const r = data as AcceptResult;
    if (r.outcome !== 'accepted') {
      await finish(r.outcome, JSON.stringify(r), actor.id);
      await reply(r);
      return;
    }
    await finish('accepted', `accepted via slack at ${r.accepted_at}`, actor.id);
    // Acceptance is committed. Slack failures below are recorded, never rolled back.
    await updateDesignerMessage(db, briefId, { dryRun });
    await deliverForBrief(db, briefId, { dryRun });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('slack-interactions error:', msg);
    await finish('error', msg.slice(0, 500));
    await reply({ outcome: 'error' });
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const raw = await req.text();
  const bad = await verifySlack(req, raw);
  if (bad) {
    console.warn('slack-interactions rejected:', bad);
    return new Response('invalid request', { status: 401 });
  }
  let payload: any;
  try {
    payload = JSON.parse(new URLSearchParams(raw).get('payload') || '');
  } catch {
    return new Response('bad payload', { status: 400 });
  }
  if (payload?.type !== 'block_actions') return new Response('', { status: 200 });

  const work = handle(payload).catch((e) => console.error('slack-interactions handler crashed:', e));
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return new Response('', { status: 200 });
});
