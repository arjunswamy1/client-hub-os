// The morning task digest.
//
// One top-level message per person, per lane, into the two INTERNAL team
// channels. Every write goes through `postToSlack()` — the fail-closed allowlist
// that refuses any channel that is external, unmapped or unclassified. Neither
// channel carries a client_id; both are classified internal.
//
// Three modes, all on one hourly cron gated on the Eastern clock so the slots
// hold through daylight saving:
//   digest  9am ET weekdays  — the lists
//   nudge  12pm ET weekdays  — ONE in-thread nudge per unacknowledged digest
//   rollup  6pm ET weekdays  — what is still unacknowledged, to AJ, once
//
// One nudge, then visibility. Never a repeating nag.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { postToSlack } from '../_shared/slack-post.ts';
import {
  buildDigests,
  easternNow,
  isWeekday,
  LANE_CHANNELS,
  type DigestMessage,
} from '../_shared/task-digest.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** AJ Swamy — the rollup is addressed to him. */
const AJ_TEAM_MEMBER_ID = '1fdd684e-6cb7-447e-b616-7e1b9c598971';

type Mode = 'digest' | 'nudge' | 'rollup';

interface PostedRow {
  lane: string;
  channel: string;
  person: string;
  items: number;
  hidden: number;
  posted: boolean;
  slack_ts?: string | null;
  refused?: string | null;
  error?: string | null;
  text: string;
}

/** Post one person's list and record it, so the reaction gate can find it later. */
async function postDigest(
  supabase: any,
  msg: DigestMessage,
  digestDate: string,
  dryRun: boolean,
  onlyMemberIds: string[] | null,
): Promise<PostedRow> {
  const row: PostedRow = {
    lane: msg.lane,
    channel: `#${msg.channel_name}`,
    person: msg.member.name,
    items: msg.items.length,
    hidden: msg.hidden_count,
    posted: false,
    text: msg.text,
  };

  if (dryRun || (onlyMemberIds && !onlyMemberIds.includes(msg.member.id))) return row;

  const res = await postToSlack({ channel: msg.channel_id, text: msg.text });
  if (res.refused) {
    row.refused = res.reason ?? 'refused';
    return row;
  }
  if (!res.ok) {
    row.error = res.error ?? 'unknown error';
    return row;
  }
  row.posted = true;
  row.slack_ts = res.ts ?? null;

  const { error } = await supabase.from('task_digest_posts').upsert(
    {
      digest_date: digestDate,
      team_member_id: msg.member.id,
      lane: msg.lane,
      channel_id: msg.channel_id,
      channel_name: msg.channel_name,
      slack_ts: res.ts ?? null,
      message_text: msg.text,
      task_ids: msg.shown.filter((i) => i.kind === 'task').map((i) => i.id),
      brief_ids: msg.shown.filter((i) => i.kind === 'brief').map((i) => i.id),
      shown_count: msg.shown.length,
      hidden_count: msg.hidden_count,
    },
    { onConflict: 'digest_date,team_member_id,lane' },
  );
  if (error) row.error = `posted but not recorded: ${error.message}`;
  return row;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const bearer = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  const nonce = req.headers.get('x-cron-nonce') || '';
  let authorized = bearer !== '' && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authorized && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data: tokenRow } = await supabase
      .from('cron_invocation_tokens')
      .delete()
      .eq('token', nonce)
      .gt('created_at', new Date(Date.now() - 5 * 60000).toISOString())
      .select('token')
      .maybeSingle();
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

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const dryRun = body.dry_run === true;
    const force = body.force === true;
    const requestedMode = typeof body.mode === 'string' ? (body.mode as Mode) : null;
    // A deliberately narrow live test: post for these people only.
    const onlyMemberIds = Array.isArray(body.only_team_member_ids)
      ? (body.only_team_member_ids as string[])
      : null;
    const onlyLane = body.lane === 'media' || body.lane === 'creative' ? (body.lane as 'media' | 'creative') : null;

    const et = easternNow();
    let mode: Mode | null = requestedMode;
    if (!mode) {
      if (et.hour === 9) mode = 'digest';
      else if (et.hour === 12) mode = 'nudge';
      else if (et.hour === 18) mode = 'rollup';
    }
    if (!force && !dryRun) {
      if (!isWeekday(et.weekdayShort) || !mode) {
        return json({
          skipped: true,
          reason: `no digest slot right now (currently ${et.weekdayShort} ${et.hour}:00 ET; slots are 9am, 12pm and 6pm ET on weekdays)`,
        });
      }
    }
    mode = mode ?? 'digest';

    // ---------------------------------------------------------------- digest
    if (mode === 'digest') {
      const { messages, escalations, skipped, excluded } = await buildDigests(supabase, et.date, et.weekdayLong);
      const scoped = onlyLane ? messages.filter((m) => m.lane === onlyLane) : messages;
      const posted: PostedRow[] = [];
      for (const msg of scoped) {
        posted.push(await postDigest(supabase, msg, et.date, dryRun, onlyMemberIds));
      }
      // One escalation per item, ever. Recorded only after a real post, so a dry
      // run or a refused post leaves the item eligible next time.
      const escalationRows: Record<string, unknown>[] = [];
      for (const esc of onlyLane ? escalations.filter((e) => e.lane === onlyLane) : escalations) {
        const row: Record<string, unknown> = {
          channel: `#${esc.channel_name}`, lead: esc.lead.name, items: esc.items.length, posted: false, text: esc.text,
        };
        if (!dryRun && (!onlyMemberIds || onlyMemberIds.includes(esc.lead.id))) {
          const res = await postToSlack({ channel: esc.channel_id, text: esc.text });
          row.posted = res.ok === true;
          row.refused = res.refused ? res.reason : null;
          if (res.ok) {
            const { error } = await supabase.from('task_digest_escalations').upsert(
              esc.items.map((i) => ({
                item_kind: i.kind, item_id: i.id, escalated_to_id: esc.lead.id,
                days_late: i.late_days ?? 0, digest_date: et.date, slack_ts: res.ts ?? null,
              })),
              { onConflict: 'item_kind,item_id', ignoreDuplicates: true },
            );
            if (error) row.error = `posted but not recorded: ${error.message}`;
          }
        }
        escalationRows.push(row);
      }
      const grouped: Record<string, PostedRow[]> = {};
      for (const row of posted) (grouped[row.channel] ??= []).push(row);
      return json({
        ok: true,
        mode,
        dry_run: dryRun,
        eastern: `${et.weekdayLong} ${et.date} ${et.hour}:00 ET`,
        people: new Set(posted.map((p) => p.person)).size,
        messages: posted.length,
        posted_count: posted.filter((p) => p.posted).length,
        by_channel: grouped,
        escalations: escalationRows,
        skipped_people: skipped,
        excluded_items: excluded.length,
        excluded_detail: dryRun ? excluded : undefined,
      });
    }

    // ----------------------------------------------------------------- nudge
    // Exactly one in-thread nudge, @-ing the person, for a digest with no
    // acknowledgement by midday. `nudged_at` makes it once and only once.
    if (mode === 'nudge') {
      const { data: pending, error } = await supabase
        .from('task_digest_posts')
        .select('id, team_member_id, lane, channel_id, channel_name, slack_ts, digest_date')
        .eq('digest_date', et.date)
        .is('acknowledged_at', null)
        .is('nudged_at', null)
        .not('slack_ts', 'is', null);
      if (error) throw error;

      const { data: members } = await supabase.from('team_members').select('id, name, slack_user_id').eq('is_service_account', false);
      const memberById = new Map((members ?? []).map((m: any) => [m.id, m]));

      const nudges: Record<string, unknown>[] = [];
      for (const row of pending ?? []) {
        const member: any = memberById.get(row.team_member_id);
        const text = `${member?.slack_user_id ? `<@${member.slack_user_id}>` : member?.name ?? 'there'} — still unacknowledged. ✅ if this is right, ✏️ if you have edits, ❌ if it is not yours.`;
        if (dryRun) {
          nudges.push({ person: member?.name, channel: `#${row.channel_name}`, text, posted: false });
          continue;
        }
        const res = await postToSlack({ channel: row.channel_id, text, threadTs: row.slack_ts });
        if (res.ok) await supabase.from('task_digest_posts').update({ nudged_at: new Date().toISOString() }).eq('id', row.id);
        nudges.push({
          person: member?.name,
          channel: `#${row.channel_name}`,
          text,
          posted: res.ok === true,
          refused: res.refused ? res.reason : null,
          error: res.error ?? null,
        });
      }
      return json({ ok: true, mode, dry_run: dryRun, nudges });
    }

    // ---------------------------------------------------------------- rollup
    // End of day: what is still unacknowledged, once, to AJ. Visibility, not a nag.
    const { data: stale, error: staleErr } = await supabase
      .from('task_digest_posts')
      .select('id, team_member_id, lane, shown_count, hidden_count, nudged_at, channel_name')
      .eq('digest_date', et.date)
      .is('acknowledged_at', null)
      .is('rolled_up_at', null);
    if (staleErr) throw staleErr;

    if ((stale ?? []).length === 0) {
      return json({ ok: true, mode, dry_run: dryRun, rollup: null, reason: 'everything acknowledged' });
    }

    const { data: members } = await supabase.from('team_members').select('id, name, slack_user_id').eq('is_service_account', false);
    const memberById = new Map((members ?? []).map((m: any) => [m.id, m]));
    const aj: any = memberById.get(AJ_TEAM_MEMBER_ID);

    const lines = [
      `${aj?.slack_user_id ? `<@${aj.slack_user_id}>` : 'AJ'} — unacknowledged today (${et.weekdayLong})`,
      '',
      ...(stale ?? []).map((r: any) => {
        const m: any = memberById.get(r.team_member_id);
        return `  • ${m?.name ?? 'unknown'} · ${r.lane} · ${r.shown_count + r.hidden_count} item${r.shown_count + r.hidden_count === 1 ? '' : 's'}${r.nudged_at ? ' · nudged at midday' : ''}`;
      }),
    ];
    const text = lines.join('\n');

    if (dryRun) return json({ ok: true, mode, dry_run: true, rollup: { channel: '#media-team-tasks', text } });

    const res = await postToSlack({ channel: LANE_CHANNELS.media.id, text });
    if (res.ok) {
      await supabase
        .from('task_digest_posts')
        .update({ rolled_up_at: new Date().toISOString() })
        .in('id', (stale ?? []).map((r: any) => r.id));
    }
    return json({
      ok: true,
      mode,
      dry_run: false,
      rollup: { channel: '#media-team-tasks', text, posted: res.ok === true, refused: res.refused ? res.reason : null, error: res.error ?? null },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('post-task-digest failed:', message);
    return json({ error: message }, 500);
  }
});
