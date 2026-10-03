import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logIntegrationCall } from "../_shared/cost-tracking.ts";
import { ownBotIdentity } from '../_shared/slack-identity.ts';
import { isOwnBotMessage } from '../_shared/daily-update-rules.ts';
import { getValidBotToken } from "../_shared/slack-token.ts";
import { classifyMessage } from "../_shared/slack-message-class.ts";
import type { MessageClass } from "../_shared/slack-message-class.ts";
import { classifyBatchWithAi, AI_BATCH_SIZE } from "../_shared/slack-classify-ai.ts";

// A first sync on a channel with no cursor is capped so it can never pull an
// entire multi-year history in one run.
const INITIAL_BACKFILL_DAYS = 90;

// A thread stays "open" (and therefore re-polled for late replies) while its
// parent is this recent, or for as long as it holds an unanswered question.
const OPEN_THREAD_DAYS = 14;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

// Channel name patterns → client slug mapping
// Channels containing these keywords get auto-mapped to the respective client
const CHANNEL_CLIENT_PATTERNS: Record<string, string[]> = {
  billy: ['billy', 'kwca'],
  'tinned-fish-club': ['tinned', 'tfc'],
  phantasmagorical: ['phantas', 'phant'],
};

// Channel name → purpose/context hints
const CHANNEL_CONTEXT: Record<string, string> = {
  cpm_malena: 'Creative design channel with Malena (designer)',
  cpm_core_marketing: 'Internal CPM core marketing discussions',
  cpm_jon: 'Channel with Jon',
  in_billy: 'Main internal Billy.com channel',
  in_billy_pest: 'Billy.com Pest Control vertical',
  in_billy_hvac: 'Billy.com HVAC vertical',
  in_billy_bathroom: 'Billy.com Bathroom Remodel vertical',
  in_billy_portapotty: 'Billy.com Porta Potty vertical',
  in_billy_flights: 'Billy.com Flights vertical',
  in_billy_updates: 'Billy.com updates and announcements',
  sales: 'Sales discussions',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');

    // Service-role callers and single-use cron nonces (ops / scheduled runs) are
    // trusted; anyone else must be a signed-in user.
    const bearer = (authHeader || '').replace('Bearer ', '').trim();
    let isServiceCall = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    const cronNonce = req.headers.get('x-cron-nonce') || '';
    if (!isServiceCall && /^[0-9a-f-]{36}$/i.test(cronNonce)) {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: nonceRow } = await admin
        .from('cron_invocation_tokens')
        .delete()
        .eq('token', cronNonce)
        .gt('created_at', new Date(Date.now() - 5 * 60000).toISOString())
        .select('token')
        .maybeSingle();
      isServiceCall = !!nonceRow;
    }

    if (!isServiceCall && !authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!isServiceCall) {
      const supabaseUser = createClient(
        Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader as string } } }
      );
      const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
      if (userError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    // One token path for the whole project: the rotating token in slack_tokens.
    // No fallback to the static env var — a stale token is the bug being fixed.
    let slackToken: string;
    try {
      slackToken = await getValidBotToken();
    } catch (e) {
      console.error('sync-slack: no usable Slack token —', e);
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'No Slack token' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { action = 'sync', client_id, channel_id, channel_name } = body;

    // ──── CLASSIFY CHANNELS ────
    // Records the flags Slack itself reports. Channel names are never used to
    // infer internal vs external. A channel the bot is not a member of is left
    // untouched, so it stays external (the safe default) and unpostable.
    if (action === 'classify_channels') {
      const channels = await listBotChannels(slackToken);
      const byId = new Map(channels.map((c: any) => [c.id, c]));

      const { data: rows } = await supabase
        .from('slack_channel_mappings')
        .select('id, channel_id, channel_name');

      const classified: any[] = [];
      const notMember: string[] = [];

      for (const row of rows || []) {
        const ch: any = byId.get(row.channel_id);
        if (!ch) { notMember.push(row.channel_name); continue; }
        const isExternal = (ch.is_ext_shared === true) || (ch.is_org_shared === true);
        await supabase.from('slack_channel_mappings').update({
          channel_name: ch.name,
          is_private: ch.is_private ?? null,
          is_shared: ch.is_shared ?? null,
          is_ext_shared: ch.is_ext_shared ?? null,
          is_org_shared: ch.is_org_shared ?? null,
          is_external: isExternal,
          classified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        classified.push({ channel: ch.name, channel_id: ch.id, is_external: isExternal,
          is_private: ch.is_private, is_shared: ch.is_shared,
          is_ext_shared: ch.is_ext_shared, is_org_shared: ch.is_org_shared });
      }

      const unmapped = channels
        .filter((c: any) => !(rows || []).some((r: any) => r.channel_id === c.id))
        .map((c: any) => ({ channel: c.name, channel_id: c.id,
          is_ext_shared: c.is_ext_shared, is_org_shared: c.is_org_shared }));

      return jsonResp({ classified, bot_not_member: notMember, unmapped_bot_channels: unmapped });
    }

    // ──── LIST CHANNELS ────
    if (action === 'list_channels') {
      const channels = await listBotChannels(slackToken);
      return jsonResp({ channels });
    }

    // ──── AUTO-MAP CHANNELS ────
    if (action === 'auto_map') {
      const { data: clients } = await supabase.from('clients').select('id, name, slug');
      const channels = await listBotChannels(slackToken);
      let mapped = 0;

      for (const ch of channels) {
        const clientSlug = detectClientFromChannel(ch.name);
        if (!clientSlug) continue;
        const client = (clients || []).find((c: any) => c.slug === clientSlug);
        if (!client) continue;

        await supabase.from('slack_channel_mappings').upsert(
          { client_id: client.id, channel_id: ch.id, channel_name: ch.name, sync_enabled: true },
          { onConflict: 'channel_id' }
        );
        mapped++;
      }

      return jsonResp({ mapped, total_channels: channels.length });
    }

    // ──── MAP / UNMAP CHANNEL ────
    if (action === 'map_channel') {
      if (!client_id || !channel_id || !channel_name) {
        return jsonResp({ error: 'Missing params' }, 400);
      }
      const { error } = await supabase.from('slack_channel_mappings').upsert(
        { client_id, channel_id, channel_name, sync_enabled: true },
        { onConflict: 'channel_id' }
      );
      if (error) return jsonResp({ error: error.message }, 500);
      return jsonResp({ success: true });
    }

    if (action === 'unmap_channel') {
      if (!channel_id) return jsonResp({ error: 'Missing channel_id' }, 400);
      await supabase.from('slack_channel_mappings').delete().eq('channel_id', channel_id);
      return jsonResp({ success: true });
    }

    // ──── SYNC + SUMMARIZE (never creates tasks) ────
    if (action === 'sync') {
      if (!client_id) return jsonResp({ error: 'Missing client_id' }, 400);

      const { data: mappings } = await supabase
        .from('slack_channel_mappings')
        .select('*')
        .eq('client_id', client_id)
        .eq('sync_enabled', true);

      if (!mappings || mappings.length === 0) {
        return jsonResp({ synced: 0, tasks_created: 0, message: 'No mapped channels' });
      }

      // Load team members: names for task assignment, slack_user_id for the
      // authoritative "is this person CPM?" check.
      const { data: teamMembers } = await supabase
        .from('team_members')
        .select('id, name, email, slack_user_id')
        .eq('is_active', true);

      // "CPM" = anyone on an ACTIVE team_members row, matched by Slack user id or
      // by email — regardless of email domain (contractor AMs on other domains
      // are CPM too). Unmatched stays client-side.
      const cpmSlackIds = new Set(
        (teamMembers || []).map((tm: any) => tm.slack_user_id).filter(Boolean)
      );
      const cpmEmails = new Set(
        (teamMembers || []).map((tm: any) => (tm.email || '').toLowerCase()).filter(Boolean)
      );

      const ownBot = await ownBotIdentity(slackToken);
      let ownBotSkipped = 0;
      let totalSynced = 0;
      let candidatesCreated = 0;

      let threadPolls = 0;
      const allMessages: { channel: string; context: string; text: string; user: string; ts: string }[] = [];
      const userCache: Record<string, string> = {};
      const cpmCache: Record<string, boolean> = {};

      for (const mapping of mappings) {
        // is_external is NEVER consulted here — it gates posting only. Reading
        // client-facing (externally shared) channels is the point of this sync.
        const messages = await fetchChannelMessages(slackToken, mapping.channel_id, mapping.last_synced_ts);

        const channelContext = CHANNEL_CONTEXT[mapping.channel_name] || `#${mapping.channel_name}`;

        interface Pending {
          msg: any;
          isThreadReply: boolean;
          threadRoot: string | null;
        }
        const pending: Pending[] = [];
        const seenTs = new Set<string>();

        const addPending = (msg: any, isThreadReply: boolean) => {
          if (msg.subtype === 'channel_join' || msg.subtype === 'channel_leave') return;
          // Our own posts (digests, daily drafts, DMs) must never come back in
          // as context. Bot-token posts carry no 'bot_message' subtype, which is
          // how 36 drafts got in — so we also match our bot user, bot and app ids.
          if (isOwnBotMessage(msg, ownBot)) { ownBotSkipped++; return; }
          if (!msg.text || msg.text.trim() === '') return;
          if (seenTs.has(msg.ts)) return;
          seenTs.add(msg.ts);
          pending.push({ msg, isThreadReply, threadRoot: msg.thread_ts || null });
        };

        // Threads seen in this history page, with Slack's own latest_reply so an
        // unchanged thread can be skipped without an API call.
        const seenThreads = new Map<string, { parent_occurred_at: string; latest_reply: string | null }>();

        // Candidate thread roots: every top-level message from the last 7 days,
        // whether or not it has replies yet. Without this, a question posted with
        // no replies is never tracked, the cursor moves past it, and a next-day
        // in-thread answer can never be ingested.
        const ROOT_CANDIDATE_DAYS = 7;
        const rootCutoffTs = (Date.now() - ROOT_CANDIDATE_DAYS * 86400000) / 1000;
        const rootCandidates = new Map<string, string>(); // ts → parent_occurred_at

        for (const msg of messages) {
          addPending(msg, false);
          if (msg.thread_ts && Number(msg.reply_count || 0) > 0) {
            seenThreads.set(msg.thread_ts, {
              parent_occurred_at: new Date(parseFloat(msg.thread_ts) * 1000).toISOString(),
              latest_reply: msg.latest_reply || null,
            });
          }
          const isTopLevel = !msg.thread_ts || msg.thread_ts === msg.ts;
          if (isTopLevel && parseFloat(msg.ts) >= rootCutoffTs) {
            rootCandidates.set(msg.ts, new Date(parseFloat(msg.ts) * 1000).toISOString());
          }
        }

        for (const [threadTs, info] of seenThreads) {
          await supabase.from('slack_threads').upsert({
            client_id,
            channel_id: mapping.channel_id,
            thread_ts: threadTs,
            parent_occurred_at: info.parent_occurred_at,
          }, { onConflict: 'channel_id,thread_ts' });
        }

        for (const [ts, occurredAt] of rootCandidates) {
          if (seenThreads.has(ts)) continue;
          await supabase.from('slack_threads').upsert({
            client_id,
            channel_id: mapping.channel_id,
            thread_ts: ts,
            parent_occurred_at: occurredAt,
          }, { onConflict: 'channel_id,thread_ts' });
        }

        // A thread is OPEN when its parent is within 14 days OR it still holds an
        // unanswered client_question of any age. Open threads are re-polled no
        // matter where last_synced_ts sits — Slack omits non-broadcast thread
        // replies from conversations.history, so a next-day answer would
        // otherwise never be ingested and the question would nag forever.
        const openCutoff = new Date(Date.now() - OPEN_THREAD_DAYS * 86400000).toISOString();
        const { data: openThreads } = await supabase
          .from('slack_threads')
          .select('id, thread_ts, last_reply_ts, last_polled_at, parent_occurred_at, has_unanswered_question')
          .eq('channel_id', mapping.channel_id)
          .or(`parent_occurred_at.gte.${openCutoff},has_unanswered_question.is.true`);

        const polledThreads: { id: string; thread_ts: string }[] = [];

        for (const t of (openThreads || []) as any[]) {
          const fresh = seenThreads.get(t.thread_ts);
          // Unchanged since the last poll → no call.
          if (fresh && fresh.latest_reply && t.last_reply_ts && fresh.latest_reply === t.last_reply_ts) continue;
          // Root seen in this very run with no replies at all → nothing to poll.
          if (!t.last_polled_at && rootCandidates.has(t.thread_ts) && !fresh) {
            await supabase.from('slack_threads')
              .update({ last_polled_at: new Date().toISOString() })
              .eq('id', t.id);
            continue;
          }

          const replies = await fetchThreadReplies(slackToken, mapping.channel_id, t.thread_ts);
          threadPolls += 1;

          let maxTs: string | null = t.last_reply_ts || null;
          for (const reply of replies) {
            // The parent may predate our first sync; store it, but never let its
            // old ts move the cursor — hence isThreadReply = true.
            addPending(reply, true);
            if (reply.ts !== t.thread_ts && (!maxTs || Number(reply.ts) > Number(maxTs))) maxTs = reply.ts;
          }

          await supabase.from('slack_threads').update({
            last_reply_ts: maxTs,
            last_polled_at: new Date().toISOString(),
          }).eq('id', t.id);
          // Polled even when empty, so has_unanswered_question is recomputed and
          // a stale-open thread can close instead of leaking API calls forever.
          polledThreads.push({ id: t.id, thread_ts: t.thread_ts });
        }



        // ── Resolve author + text once, then classify ──
        interface Prepared extends Pending {
          key: string;
          userName: string;
          text: string;
          isCpmAuthor: boolean;
          heuristic: MessageClass;
          finalClass: MessageClass;
          classifiedBy: 'llm' | 'heuristic';
        }
        const prepared: Prepared[] = [];

        for (const p of pending) {
          const userName = await resolveUserName(slackToken, p.msg.user, userCache);
          const text = await resolveUserMentions(slackToken, p.msg.text, userCache);
          const isCpmAuthor = await isCpmSlackUser(slackToken, p.msg.user, cpmSlackIds, cpmEmails, cpmCache);
          const heuristic = classifyMessage({ text, isCpmAuthor });
          prepared.push({
            ...p, key: p.msg.ts, userName, text, isCpmAuthor,
            heuristic, finalClass: heuristic, classifiedBy: 'heuristic',
          });
        }

        // Cheap pre-filter: CPM authors and obvious noise never cost a model call.
        const needsAi = prepared.filter((p) => !p.isCpmAuthor && p.heuristic !== 'noise');
        for (let i = 0; i < needsAi.length; i += AI_BATCH_SIZE) {
          const batch = needsAi.slice(i, i + AI_BATCH_SIZE);
          const answers = await classifyBatchWithAi(batch.map((p) => ({
            key: p.key,
            author: p.userName,
            isCpmAuthor: p.isCpmAuthor,
            text: p.text,
            threadContext: threadContextFor(prepared, p),
          })), LOVABLE_API_KEY);
          // A failed batch keeps the regex verdict — never drops the message.
          if (!answers) continue;
          for (const p of batch) {
            const cls = answers[p.key];
            if (cls) { p.finalClass = cls; p.classifiedBy = 'llm'; }
          }
        }

        // Every top-level client_question becomes a tracked thread root of ANY
        // age, so a late in-thread answer is always picked up and the question
        // stops being reported as unanswered.
        for (const p of prepared) {
          if (p.finalClass !== 'client_question') continue;
          if (p.isThreadReply) continue;
          const rootTs = p.msg.thread_ts || p.msg.ts;
          await supabase.from('slack_threads').upsert({
            client_id,
            channel_id: mapping.channel_id,
            thread_ts: rootTs,
            parent_occurred_at: new Date(parseFloat(rootTs) * 1000).toISOString(),
            has_unanswered_question: true,
          }, { onConflict: 'channel_id,thread_ts' });
        }


        const contextItems: any[] = [];
        // Slack's only task inflow: a client_request in an EXTERNAL client channel
        // becomes a CANDIDATE, never a task. Internal channels contribute nothing.
        const candidateRows: any[] = [];

        for (const p of prepared) {
          // Permalinks only for the classes a human will be shown (Tier 3 budget).
          let permalink: string | null = null;
          if (p.finalClass === 'client_question' || p.finalClass === 'escalation' || p.finalClass === 'client_request') {
            permalink = await getPermalink(slackToken, mapping.channel_id, p.msg.ts);
          }

          contextItems.push({
            client_id,
            source: 'slack',
            source_id: `slack_${mapping.channel_id}_${p.msg.ts}`,
            content_type: 'message',
            title: `#${mapping.channel_name}`,
            content: p.text,
            occurred_at: new Date(parseFloat(p.msg.ts) * 1000).toISOString(),
            participants: [p.userName],
            metadata: {
              channel_id: mapping.channel_id,
              channel_name: mapping.channel_name,
              channel_context: channelContext,
              slack_ts: p.msg.ts,
              thread_ts: p.msg.thread_ts || null,
              is_thread_reply: p.isThreadReply,
              slack_user_id: p.msg.user || null,
              is_cpm_author: p.isCpmAuthor,
              message_class: p.finalClass,
              classified_by: p.classifiedBy,
              heuristic_class: p.heuristic,
              permalink,
              reactions: p.msg.reactions || [],
            },
          });

          if (mapping.is_external === true && p.finalClass === 'client_request' && !p.isCpmAuthor) {
            candidateRows.push({
              client_id,
              source: 'slack_client_request',
              source_ref: {
                channel_id: mapping.channel_id,
                channel_name: mapping.channel_name,
                slack_ts: p.msg.ts,
                permalink,
                author: p.userName,
              },
              raw_text: p.text,
              proposed_title: p.text.replace(/\s+/g, ' ').trim().slice(0, 120),
              proposed_assignee_id: null,
              owner_raw: p.userName,
              owner_side: 'client',
              status: 'pending',
              dedupe_key: `slack:${mapping.channel_id}:${p.msg.ts}`,
            });
          }

          allMessages.push({
            channel: mapping.channel_name,
            context: channelContext,
            text: p.text,
            user: p.userName,
            ts: new Date(parseFloat(p.msg.ts) * 1000).toISOString(),
          });
        }

        if (candidateRows.length > 0) {
          // The dedupe index is partial, so ON CONFLICT cannot target it — skip keys
          // we already hold instead.
          const { data: dupes } = await supabase
            .from('task_candidates')
            .select('dedupe_key')
            .in('dedupe_key', candidateRows.map((r) => r.dedupe_key));
          const held = new Set((dupes ?? []).map((d: any) => d.dedupe_key));
          const fresh = candidateRows.filter((r) => !held.has(r.dedupe_key));
          if (fresh.length > 0) {
            const { data: cands, error: candErr } = await supabase
              .from('task_candidates').insert(fresh).select('id');
            if (candErr) console.error('candidate insert error:', candErr);
            else candidatesCreated += cands?.length ?? 0;
          }
        }



        // The cursor may only advance to the timestamp of the LAST SUCCESSFULLY
        // STORED message. A failed insert used to burn the cursor, which is how
        // messages got read and permanently skipped.
        if (contextItems.length > 0) {
          contextItems.sort((a, b) => Number(a.metadata.slack_ts) - Number(b.metadata.slack_ts));
          let lastStoredTs: string | null = null;
          let contiguous = true;

          for (const item of contextItems) {
            const { error: insertError } = await supabase
              .from('context_items')
              .upsert(item, { onConflict: 'source,source_id' });

            if (insertError) {
              // Skip the poison message and keep going, but freeze the cursor at
              // the last CONTIGUOUS success so nothing after it is lost.
              console.error(`Insert error for #${mapping.channel_name} @ ${item.metadata.slack_ts}:`, insertError);
              contiguous = false;
              continue;
            }
            totalSynced += 1;
            // Only top-level (history) messages may move the cursor — a reply's
            // ts must never carry the cursor past unread channel messages.
            if (contiguous && !item.metadata.is_thread_reply) {
              lastStoredTs = item.metadata.slack_ts as string;
            }
          }

          if (lastStoredTs && (!mapping.last_synced_ts || Number(lastStoredTs) > Number(mapping.last_synced_ts))) {
            await supabase.from('slack_channel_mappings')
              .update({ last_synced_ts: lastStoredTs, updated_at: new Date().toISOString() })
              .eq('id', mapping.id);
          }
        }

        // Does each polled thread still hold an unanswered client question?
        // Recomputed from STORED rows, so it also runs for threads that returned
        // nothing new — a thread flagged once would otherwise stay open and be
        // re-polled on every sync forever.
        for (const t of polledThreads) {
          const { data: threadRows } = await supabase
            .from('context_items')
            .select('metadata')
            .eq('client_id', client_id)
            .eq('source', 'slack')
            .or(`metadata->>thread_ts.eq.${t.thread_ts},metadata->>slack_ts.eq.${t.thread_ts}`);

          const rows = (threadRows || [])
            .map((r: any) => r.metadata)
            .filter((m: any) => m && m.channel_id === mapping.channel_id && m.slack_ts)
            .sort((a: any, b: any) => Number(a.slack_ts) - Number(b.slack_ts));

          const lastQuestion = [...rows].reverse().find((m: any) => m.message_class === 'client_question');
          const unanswered = !!lastQuestion && !rows.some(
            (m: any) => m.is_cpm_author && Number(m.slack_ts) > Number(lastQuestion.slack_ts)
          );
          await supabase.from('slack_threads')
            .update({ has_unanswered_question: unanswered, last_polled_at: new Date().toISOString() })
            .eq('id', t.id);
        }
      }


      // ──── AI ANALYSIS: Summarize only ────
      //
      // This function does NOT create tasks. It once extracted action items straight
      // into `tasks` with no dedupe; on a 15-minute schedule that produced 907 rows
      // from 314 distinct titles in 18 hours ("Create Facebook page for Timeshare
      // campaign" 47 times). Internal channels are where people think out loud —
      // commitments are made in meetings, and the meeting parser captures those.
      //
      // The only inflow from Slack is a `client_request` in an EXTERNAL client
      // channel, written to `task_candidates` above and gated before it can ever
      // become a task. Internal channels produce no candidates at all.
      let summary = null;

      if (allMessages.length > 0 && LOVABLE_API_KEY) {
        try {
          const aiResult = await analyzeSlackMessages(allMessages, teamMembers || [], client_id);

          // Store summary as a context item
          if (aiResult.summary) {
            summary = aiResult.summary;
            await supabase.from('context_items').upsert({
              client_id,
              source: 'slack',
              source_id: `slack_summary_${new Date().toISOString().split('T')[0]}`,
              content_type: 'ai_summary',
              title: `Slack Activity Summary — ${new Date().toLocaleDateString()}`,
              content: aiResult.summary,
              occurred_at: new Date().toISOString(),
              participants: [],
              metadata: {
                message_count: allMessages.length,
                channels: [...new Set(allMessages.map(m => m.channel))],
                key_topics: aiResult.key_topics || [],
              },
            }, { onConflict: 'source,source_id' });
          }
        } catch (aiErr) {
          console.error('AI analysis error:', aiErr);
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

      // Log integration usage — 1 call per mapped channel synced
      if (mappings.length > 0) {
        await logIntegrationCall({
          client_id,
          service: "slack_api",
          surface: "sync-slack",
          calls: mappings.length,
          metadata: {
            channels: mappings.length,
            messages_synced: totalSynced,
            candidates_created: candidatesCreated,
          },
        });
      }

      return jsonResp({
        synced: totalSynced,
        thread_polls: threadPolls,
        tasks_created: 0,
        candidates_created: candidatesCreated,
        summary,
      });

    }

    return jsonResp({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('Slack sync error:', err);
    return jsonResp({ error: err.message }, 500);
  }
});

// ──── AI Analysis ────
async function analyzeSlackMessages(
  messages: { channel: string; context: string; text: string; user: string; ts: string }[],
  teamMembers: { id: string; name: string; email: string }[],
  clientId: string
) {
  const teamNames = teamMembers.map(tm => tm.name).join(', ');

  // Truncate messages if too many — take last 100
  const recentMessages = messages.slice(-100);
  const messageBlock = recentMessages.map(m =>
    `[${m.ts}] #${m.channel} (${m.context}) — ${m.user}: ${m.text}`
  ).join('\n');

  const prompt = `Analyze these Slack messages from a digital advertising agency's internal channels for a specific client.

TEAM MEMBERS: ${teamNames}

MESSAGES:
${messageBlock}

Respond with JSON containing:
1. "summary" — A 3-5 sentence executive summary of what's happening. Focus on: campaign launches, performance discussions, creative requests, client feedback, and strategic decisions. Write in third person past tense.
2. "key_topics" — Array of 3-7 key topics discussed (short phrases).
3. "client_updates" — Array of items that would be relevant to share with the client in a meeting agenda. Things like campaign progress, creative status, results being discussed.

Do NOT extract action items or tasks. Task inflow is handled elsewhere, behind a review gate.`;


  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: 'You are an expert digital marketing operations analyst. Summarize Slack conversations for a client record. Do not propose tasks or action items.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content;
  const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}

// ──── Helper: detect client from channel name ────
function detectClientFromChannel(channelName: string): string | null {
  const lower = channelName.toLowerCase();
  for (const [slug, patterns] of Object.entries(CHANNEL_CLIENT_PATTERNS)) {
    if (patterns.some(p => lower.includes(p))) return slug;
  }
  // CPM-prefixed channels are internal — associate with all clients or skip
  if (lower.startsWith('cpm_')) return null;
  return null;
}

// ──── Slack API helpers ────
async function listBotChannels(token: string) {
  const channels: any[] = [];
  let cursor = '';
  do {
    const url = `https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!data.ok) break;
    for (const ch of data.channels || []) {
      if (ch.is_member) {
        channels.push({
          id: ch.id,
          name: ch.name,
          is_private: ch.is_private,
          is_shared: ch.is_shared,
          is_ext_shared: ch.is_ext_shared,
          is_org_shared: ch.is_org_shared,
          topic: ch.topic?.value || '',
        });
      }
    }
    cursor = data.response_metadata?.next_cursor || '';
  } while (cursor);
  return channels;
}

// Every read goes through here so 429s are honoured instead of failing the run.
// Slack sends Retry-After (seconds); conversations.replies and chat.getPermalink
// are Tier 3, so a small pause is also taken between calls by the callers.
async function slackRead(token: string, method: string, params: URLSearchParams, attempt = 0): Promise<any> {
  const res = await fetch(`https://slack.com/api/${method}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429 && attempt < 5) {
    const retryAfter = Number(res.headers.get('Retry-After') || '2');
    const waitMs = Math.min(Math.max(retryAfter, 1), 60) * 1000;
    console.warn(`Slack ${method} rate-limited, waiting ${waitMs}ms (attempt ${attempt + 1})`);
    await sleep(waitMs);
    return slackRead(token, method, params, attempt + 1);
  }

  const data = await res.json().catch(() => ({ ok: false, error: 'non_json_response' }));
  if (!data.ok && data.error === 'ratelimited' && attempt < 5) {
    await sleep(2000 * (attempt + 1));
    return slackRead(token, method, params, attempt + 1);
  }
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchChannelMessages(token: string, channelId: string, oldest?: string | null) {
  const messages: any[] = [];
  let cursor = '';
  const params = new URLSearchParams({ channel: channelId, limit: '200' });
  // No cursor yet = first sync on this channel: cap the backfill so a newly
  // enabled channel cannot pull years of history in one run.
  const effectiveOldest = oldest
    || String(Math.floor((Date.now() - INITIAL_BACKFILL_DAYS * 86400000) / 1000));
  params.set('oldest', effectiveOldest);

  do {
    if (cursor) params.set('cursor', cursor);
    const data = await slackRead(token, 'conversations.history', params);
    if (!data.ok) {
      console.error(`conversations.history failed for ${channelId}:`, data.error);
      break;
    }
    messages.push(...(data.messages || []));
    cursor = data.response_metadata?.next_cursor || '';
  } while (cursor);

  return messages;
}

async function fetchThreadReplies(token: string, channelId: string, threadTs: string) {
  const replies: any[] = [];
  let cursor = '';
  const params = new URLSearchParams({ channel: channelId, ts: threadTs, limit: '200' });

  do {
    if (cursor) params.set('cursor', cursor);
    const data = await slackRead(token, 'conversations.replies', params);
    if (!data.ok) {
      console.error(`conversations.replies failed for ${channelId}/${threadTs}:`, data.error);
      break;
    }
    replies.push(...(data.messages || []));
    cursor = data.response_metadata?.next_cursor || '';
    // Tier 3 courtesy pause between pages / threads.
    await sleep(1100);
  } while (cursor);

  return replies;
}

async function getPermalink(token: string, channelId: string, ts: string): Promise<string | null> {
  const data = await slackRead(token, 'chat.getPermalink', new URLSearchParams({ channel: channelId, message_ts: ts }));
  if (!data.ok) {
    console.warn('chat.getPermalink failed:', data.error);
    return null;
  }
  return data.permalink || null;
}

// "CPM-authored" rule, in order:
//   1. the Slack user id is on an ACTIVE team_members row (primary)
//   2. otherwise users.info reports an email that matches an active team member
//      — any domain, so contractor AMs (e.g. @flamingowl.co) count as CPM
//   3. anyone matching neither is treated as client-side (fail closed)
// Display names are never used.
async function isCpmSlackUser(
  token: string,
  userId: string | undefined,
  cpmSlackIds: Set<string>,
  cpmEmails: Set<string>,
  cache: Record<string, boolean>
): Promise<boolean> {
  if (!userId) return false;
  if (cpmSlackIds.has(userId)) return true;
  if (userId in cache) return cache[userId];

  let result = false;
  const data = await slackRead(token, 'users.info', new URLSearchParams({ user: userId }));
  if (data.ok && data.user) {
    const email = (data.user.profile?.email || '').toLowerCase();
    // A workspace member without a visible email stays client-side: fail closed.
    result = email !== '' && cpmEmails.has(email);
  } else {
    console.warn('users.info failed for CPM check, treating as client-side:', userId, data.error);
  }
  cache[userId] = result;
  return result;
}

// Surrounding thread text for the classifier: the parent and earlier replies, so
// the model can see whether a question is rhetorical or already answered.
function threadContextFor(
  all: { key: string; threadRoot: string | null; msg: any; userName: string; text: string }[],
  target: { key: string; threadRoot: string | null; msg: any },
): string | undefined {
  const root = target.msg.thread_ts || target.msg.ts;
  const earlier = all
    .filter((p) => (p.msg.thread_ts || p.msg.ts) === root && Number(p.key) < Number(target.key))
    .sort((a, b) => Number(a.key) - Number(b.key))
    .slice(-5);
  if (earlier.length === 0) return undefined;
  return earlier.map((p) => `${p.userName}: ${p.text.slice(0, 240)}`).join(' | ');
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
  } catch (e) {
    console.warn('users.info failed, storing raw user id:', userId, e);
  }
  // Degrade gracefully: the raw Slack user id is stored rather than failing the
  // whole message insert.
  cache[userId] = userId;
  return userId;
}

async function resolveUserMentions(token: string, text: string, cache: Record<string, string>): Promise<string> {
  const mentionPattern = /<@([A-Z0-9]+)>/g;
  const matches = [...text.matchAll(mentionPattern)];
  let resolved = text;
  for (const match of matches) {
    const name = await resolveUserName(token, match[1], cache);
    resolved = resolved.replace(match[0], `@${name}`);
  }
  resolved = resolved.replace(/<#([A-Z0-9]+)\|([^>]+)>/g, '#$2');
  resolved = resolved.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)');
  resolved = resolved.replace(/<(https?:\/\/[^>]+)>/g, '$1');
  return resolved;
}

function jsonResp(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
