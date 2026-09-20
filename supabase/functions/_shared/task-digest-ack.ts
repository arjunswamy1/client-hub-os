// The reaction gate on a morning digest message.
//
//   ✅ (👍 accepted as an alias)  aligned, starting        -> acknowledged
//   ✏️                            I have edits, see reply  -> wait for the thread reply
//   ❌                            not mine, or wrong       -> unassign, flag for AJ, feedback
//
// Built so it works the moment the `reaction_added` subscription is switched on.
// If the event never arrives nothing here runs and the digest is simply
// unacknowledged — the message itself is still useful.
//
// Nothing is posted from this module.

const ALIGNED = new Set(['white_check_mark', 'heavy_check_mark', 'ballot_box_with_check', '+1', 'thumbsup']);
const EDITING = new Set(['pencil2', 'pencil', 'writing_hand', 'memo', 'lower_left_ballpoint_pen']);
const NOT_MINE = new Set(['x', 'heavy_multiplication_x', 'negative_squared_cross_mark', 'no_entry_sign']);

export type AckKind = 'aligned' | 'editing' | 'not_mine';

export function ackKindForReaction(name: string | undefined): AckKind | null {
  if (!name) return null;
  const n = name.split('::')[0];
  if (ALIGNED.has(n)) return 'aligned';
  if (EDITING.has(n)) return 'editing';
  if (NOT_MINE.has(n)) return 'not_mine';
  return null;
}

async function digestForMessage(supabase: any, channel: string, ts: string) {
  const { data } = await supabase
    .from('task_digest_posts')
    .select('id, team_member_id, lane, task_ids, brief_ids, channel_id, slack_ts, acknowledged_at, ack_kind')
    .eq('channel_id', channel)
    .eq('slack_ts', ts)
    .maybeSingle();
  return data ?? null;
}

/**
 * Handle a `reaction_added` event on a digest message. Returns the recorded
 * acknowledgement kind, or null when the message is not one of ours (people
 * react to plenty of things).
 */
export async function handleDigestReaction(
  supabase: any,
  event: { reaction?: string; user?: string; item?: { channel?: string; ts?: string } },
): Promise<AckKind | null> {
  const kind = ackKindForReaction(event.reaction);
  if (!kind) return null;
  const channel = event.item?.channel ?? '';
  const ts = event.item?.ts ?? '';
  if (!channel || !ts) return null;

  const digest = await digestForMessage(supabase, channel, ts);
  if (!digest) return null;

  await supabase
    .from('task_digest_posts')
    .update({
      acknowledged_at: new Date().toISOString(),
      ack_kind: kind,
      ack_slack_user_id: event.user ?? null,
      ack_reaction: event.reaction ?? null,
    })
    .eq('id', digest.id);

  const taskIds: string[] = digest.task_ids ?? [];

  if (kind === 'not_mine' && taskIds.length > 0) {
    // Unassigned and flagged, never deleted: the work still exists, it just has
    // the wrong owner, and that is AJ's call to re-route.
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, description, type_data')
      .in('id', taskIds);
    for (const task of tasks ?? []) {
      await supabase
        .from('tasks')
        .update({
          assignee_id: null,
          type_data: {
            ...((task.type_data as Record<string, unknown>) ?? {}),
            needs_owner: true,
            flagged_for_review_by: 'slack_digest_reaction',
            disowned_at: new Date().toISOString(),
            disowned_by_slack_user: event.user ?? null,
            previous_assignee_id: digest.team_member_id,
          },
        })
        .eq('id', task.id);

      await supabase.from('task_feedback').insert({
        task_id: task.id,
        candidate_id: (task.type_data as Record<string, unknown> | null)?.candidate_id ?? null,
        team_member_id: digest.team_member_id,
        action: 'not_mine',
        original_text: task.description ?? task.title,
        surface: 'slack',
      });
    }
  }

  return kind;
}

/**
 * A thread reply under a digest that was marked ✏️ or ❌ is the correction. It is
 * stored verbatim against every task the digest listed and is deliberately NOT
 * fed into any prompt — corrections accumulate for a reviewed distillation.
 */
export async function captureDigestReply(
  supabase: any,
  event: { channel?: string; thread_ts?: string; text?: string; user?: string },
): Promise<boolean> {
  const threadTs = event.thread_ts;
  const text = event.text?.trim();
  if (!threadTs || !text || !event.channel) return false;

  const digest = await digestForMessage(supabase, event.channel, threadTs);
  if (!digest) return false;
  if (digest.ack_kind !== 'editing' && digest.ack_kind !== 'not_mine') return false;

  await supabase
    .from('task_digest_posts')
    .update({ correction_text: text.slice(0, 4000) })
    .eq('id', digest.id);

  const action = digest.ack_kind === 'editing' ? 'reworded' : 'not_mine';
  const taskIds: string[] = digest.task_ids ?? [];
  if (taskIds.length === 0) return true;

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, description, type_data')
    .in('id', taskIds);

  for (const task of tasks ?? []) {
    await supabase.from('task_feedback').insert({
      task_id: task.id,
      candidate_id: (task.type_data as Record<string, unknown> | null)?.candidate_id ?? null,
      team_member_id: digest.team_member_id,
      action,
      original_text: task.description ?? task.title,
      comment: text.slice(0, 2000),
      surface: 'slack',
    });
  }
  return true;
}
