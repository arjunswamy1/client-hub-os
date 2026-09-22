// Captures the team's replies and reactions to bot messages into `task_feedback`.
//
// Read-only against Slack: conversations.replies, reactions.get, chat.getPermalink.
// Nothing is posted. Nothing is written to `tasks`. Nothing is changed in the
// sync tables.
//
// Why a poller and not the event handlers: `slack-ai-bot` already handles
// `message` (thread replies) and `reaction_added`, but neither event has ever
// arrived — 9 digests posted, 0 acknowledged, and no rows in `slack_threads` for
// either team channel because `sync-slack` only walks mappings that have a
// client_id. So capture cannot depend on a subscription we do not receive. When
// AJ switches those subscriptions on, the live handlers and this poller converge
// on the same rows: `task_feedback` has a unique index on (slack_channel_id,
// slack_ts), so one message can only ever be captured once.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getValidBotToken } from '../_shared/slack-token.ts';
import { screenForInjection } from '../_shared/feedback-safety.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const LOOKBACK_DAYS = 14;

/** ✅ alignment · ✏️ edits coming in the thread · ❌ wrong / not mine */
const REACTION_MEANING: Record<string, 'aligned' | 'editing' | 'not_mine'> = {
  white_check_mark: 'aligned', heavy_check_mark: 'aligned', ballot_box_with_check: 'aligned', '+1': 'aligned', thumbsup: 'aligned',
  pencil2: 'editing', pencil: 'editing', writing_hand: 'editing', memo: 'editing',
  x: 'not_mine', heavy_multiplication_x: 'not_mine', negative_squared_cross_mark: 'not_mine', no_entry_sign: 'not_mine',
};

interface BotPost {
  kind: 'task_digest' | 'daily_update' | 'analyst';
  surface_target: string;
  channel_id: string;
  ts: string;
  digest_post_id: string | null;
  daily_update_id: string | null;
  team_member_id: string | null;
}

async function slackRead(token: string, method: string, params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get('Retry-After') ?? 2);
      await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!body) return { ok: false, error: `non_json_${res.status}` } as Record<string, any>;
    return body as Record<string, any>;
  }
  return { ok: false, error: 'rate_limited' } as Record<string, any>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Same authorisation shape as the other scheduled jobs.
  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  const nonce = req.headers.get('x-cron-nonce') || '';
  let authorized = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorized && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data: tokenRow } = await supabase.from('cron_invocation_tokens')
      .delete().eq('token', nonce)
      .gt('created_at', new Date(Date.now() - 5 * 60000).toISOString())
      .select('token').maybeSingle();
    authorized = !!tokenRow;
  }
  if (!authorized && bearer) {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: auth } = await asUser.auth.getUser();
    authorized = !!auth?.user;
  }
  if (!authorized) return json({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* cron sends {} */ }
  const dryRun = body.dry_run === true;
  const since = new Date(Date.now() - Number(body.lookback_days ?? LOOKBACK_DAYS) * 86400000).toISOString();

  try {
    const token = await getValidBotToken();

    // ── the set of messages we know we posted ──────────────────────────────
    const posts: BotPost[] = [];

    const { data: digests } = await supabase.from('task_digest_posts')
      .select('id, channel_id, slack_ts, team_member_id, created_at')
      .gte('created_at', since).not('slack_ts', 'is', null);
    for (const d of digests ?? []) {
      posts.push({
        kind: 'task_digest', surface_target: 'task_digest',
        channel_id: d.channel_id, ts: d.slack_ts,
        digest_post_id: d.id, daily_update_id: null, team_member_id: d.team_member_id,
      });
    }

    const { data: updates } = await supabase.from('client_daily_updates')
      .select('id, slack_channel_id, slack_ts, created_at')
      .gte('created_at', since).not('slack_ts', 'is', null);
    for (const u of updates ?? []) {
      posts.push({
        kind: 'daily_update', surface_target: 'daily_update_drafter',
        channel_id: u.slack_channel_id, ts: u.slack_ts,
        digest_post_id: null, daily_update_id: u.id, team_member_id: null,
      });
    }

    const { data: analystRows } = await supabase.from('cannaball_daily_metrics')
      .select('slack_channel_id, slack_ts, created_at')
      .gte('created_at', since).not('slack_ts', 'is', null);
    for (const a of (analystRows ?? []) as any[]) {
      if (!a.slack_channel_id || !a.slack_ts) continue;
      if (posts.some((p) => p.channel_id === a.slack_channel_id && p.ts === a.slack_ts)) continue;
      posts.push({
        kind: 'analyst', surface_target: 'cannaball_analyst',
        channel_id: a.slack_channel_id, ts: a.slack_ts,
        digest_post_id: null, daily_update_id: null, team_member_id: null,
      });
    }

    // Slack user id → team member. Feedback is only ever attributed to the person
    // who actually wrote it; an unmatched author stays a raw Slack id.
    const { data: members } = await supabase.from('team_members').select('id, name, slack_user_id');
    const bySlack = new Map<string, { id: string; name: string }>();
    for (const m of members ?? []) if (m.slack_user_id) bySlack.set(m.slack_user_id, { id: m.id, name: m.name });

    const captured: Array<Record<string, unknown>> = [];
    const skipped: Array<Record<string, unknown>> = [];

    console.log(`capture-slack-feedback: examining ${posts.length} bot posts`);
    for (const post of posts) {
      if (!post.channel_id || !post.ts) continue;

      // ── thread replies ──────────────────────────────────────────────────
      const replies = await slackRead(token, 'conversations.replies', {
        channel: post.channel_id, ts: post.ts, limit: '100',
      });
      if (!replies.ok) {
        skipped.push({ channel: post.channel_id, ts: post.ts, method: 'conversations.replies', error: replies.error });
      } else {
        for (const msg of (replies.messages ?? []) as any[]) {
          if (msg.ts === post.ts) continue;              // the root is our own post
          if (msg.bot_id || msg.subtype) continue;       // humans only
          const text = String(msg.text ?? '').trim();
          if (!text) continue;
          const member = msg.user ? bySlack.get(msg.user) : undefined;
          const screen = screenForInjection(text);
          // Permalinks are one extra read per reply; skipped on a dry run so the
          // check stays fast.
          const link = dryRun
            ? { ok: false as boolean, permalink: null as string | null }
            : await slackRead(token, 'chat.getPermalink', { channel: post.channel_id, message_ts: msg.ts });
          captured.push({
            action: 'feedback',
            surface: 'slack',
            source_kind: 'thread_reply',
            surface_target: post.surface_target,
            original_text: text.slice(0, 4000),
            comment: null,
            team_member_id: member?.id ?? null,
            slack_user_id: msg.user ?? null,
            slack_channel_id: post.channel_id,
            slack_ts: msg.ts,
            slack_thread_ts: post.ts,
            permalink: link.ok ? link.permalink : null,
            digest_post_id: post.digest_post_id,
            daily_update_id: post.daily_update_id,
            injection_suspected: screen.suspected,
            injection_signals: screen.signals.length ? screen.signals : null,
            captured_at: new Date().toISOString(),
            author_name: member?.name ?? null,
          });
        }
      }

      // ── reactions ───────────────────────────────────────────────────────
      const reactions = await slackRead(token, 'reactions.get', {
        channel: post.channel_id, timestamp: post.ts, full: 'true',
      });
      if (!reactions.ok) {
        skipped.push({ channel: post.channel_id, ts: post.ts, method: 'reactions.get', error: reactions.error });
        continue;
      }
      for (const r of (reactions.message?.reactions ?? []) as any[]) {
        const meaning = REACTION_MEANING[String(r.name).split('::')[0]];
        if (!meaning) continue;
        for (const user of (r.users ?? []) as string[]) {
          const member = bySlack.get(user);
          captured.push({
            action: meaning === 'not_mine' ? 'not_mine' : meaning === 'editing' ? 'reworded' : 'confirmed',
            surface: 'slack',
            source_kind: 'reaction',
            surface_target: post.surface_target,
            original_text: `:${r.name}:`,
            comment: meaning === 'aligned' ? 'reacted aligned' : meaning === 'editing' ? 'reacted: edits coming in the thread' : 'reacted: not mine / wrong',
            team_member_id: member?.id ?? null,
            slack_user_id: user,
            slack_channel_id: post.channel_id,
            // A reaction is not a message, so it gets its own synthetic key under the
            // same unique index — one reaction per person per emoji per message.
            slack_ts: `${post.ts}:reaction:${r.name}:${user}`,
            slack_thread_ts: post.ts,
            permalink: null,
            digest_post_id: post.digest_post_id,
            daily_update_id: post.daily_update_id,
            injection_suspected: false,
            injection_signals: null,
            captured_at: new Date().toISOString(),
            // ✅ is alignment: recorded, never distilled into a proposal.
            category: meaning === 'aligned' ? 'acknowledgement' : null,
            author_name: member?.name ?? null,
          });
        }
      }
    }

    // ── @-mentions that are feedback rather than a question ───────────────
    // Only carried forward as *uncategorised* feedback; the distiller decides whether
    // it is feedback at all, and `unclear` is a normal outcome.
    const { data: mentions } = await supabase.from('bot_qa_log')
      .select('id, question, channel_id, thread_ts, asked_by_slack_id, team_member_id, created_at')
      .gte('created_at', since);
    for (const m of mentions ?? []) {
      const text = String(m.question ?? '').trim();
      if (!text) continue;
      const screen = screenForInjection(text);
      captured.push({
        action: 'feedback',
        surface: 'slack',
        source_kind: 'mention',
        surface_target: 'qa_bot',
        original_text: text.slice(0, 4000),
        team_member_id: m.team_member_id ?? null,
        slack_user_id: m.asked_by_slack_id ?? null,
        slack_channel_id: m.channel_id,
        slack_ts: `qa:${m.id}`,
        slack_thread_ts: m.thread_ts,
        permalink: null,
        digest_post_id: null,
        daily_update_id: null,
        injection_suspected: screen.suspected,
        injection_signals: screen.signals.length ? screen.signals : null,
        captured_at: new Date().toISOString(),
        author_name: null,
      });
    }

    if (dryRun) {
      return json({
        ok: true, dry_run: true, bot_posts_examined: posts.length,
        would_capture: captured.length, skipped, sample: captured.slice(0, 10),
      });
    }

    let inserted = 0;
    for (const row of captured) {
      const { author_name: _drop, ...insertable } = row as Record<string, unknown>;
      const { error } = await supabase.from('task_feedback')
        .upsert(insertable, { onConflict: 'slack_channel_id,slack_ts', ignoreDuplicates: true });
      if (!error) inserted++;
      else console.error('capture-slack-feedback: insert failed —', error.message);
    }

    return json({ ok: true, bot_posts_examined: posts.length, captured: captured.length, inserted, skipped });
  } catch (e) {
    console.error('capture-slack-feedback failed:', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
