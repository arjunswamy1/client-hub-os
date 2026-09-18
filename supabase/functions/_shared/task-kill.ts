// Slack fast kill: ❌ on a posted task removes it and records why.
//
// Built now so it works the moment the morning post lands (Phase 4). It matches the
// reacted message against `tasks.type_data.slack_message_ts` — the morning post is
// expected to store that when it posts. Nothing is posted back from here; this module
// only reads Slack events and writes our own tables.

const KILL_REACTIONS = new Set([
  "x",
  "heavy_multiplication_x",
  "negative_squared_cross_mark",
  "no_entry_sign",
]);

/** Kill window in which a thread reply is still read as the reason for the ❌. */
const COMMENT_WINDOW_MS = 24 * 3600 * 1000;

export function isKillReaction(name: string | undefined): boolean {
  return !!name && KILL_REACTIONS.has(name);
}

async function teamMemberIdForSlackUser(supabase: any, slackUserId: string | undefined) {
  if (!slackUserId) return null;
  const { data } = await supabase
    .from("team_members")
    .select("id")
    .eq("slack_user_id", slackUserId)
    .eq("is_active", true)
    .maybeSingle();
  return data?.id ?? null;
}

async function tasksForMessage(supabase: any, channel: string, ts: string) {
  const { data } = await supabase
    .from("tasks")
    .select("id, title, description, status, type_data")
    .eq("type_data->>slack_message_ts", ts)
    .neq("status", "archived")
    .limit(20);
  return (data ?? []).filter((t: any) => {
    const ch = t.type_data?.slack_channel_id;
    return !ch || ch === channel;
  });
}

/**
 * Handle a `reaction_added` event. Returns how many tasks were rejected.
 * Unknown messages are a no-op — people react to plenty of things.
 */
export async function handleKillReaction(
  supabase: any,
  event: { reaction?: string; user?: string; item?: { channel?: string; ts?: string } },
): Promise<number> {
  if (!isKillReaction(event.reaction)) return 0;
  const channel = event.item?.channel ?? "";
  const ts = event.item?.ts ?? "";
  if (!channel || !ts) return 0;

  const tasks = await tasksForMessage(supabase, channel, ts);
  if (tasks.length === 0) return 0;

  const memberId = await teamMemberIdForSlackUser(supabase, event.user);
  let killed = 0;

  for (const task of tasks) {
    const { error } = await supabase.from("tasks").update({
      status: "archived",
      type_data: {
        ...(task.type_data ?? {}),
        archived_reason: "rejected_in_slack",
        rejected_at: new Date().toISOString(),
        rejected_by_slack_user: event.user ?? null,
      },
    }).eq("id", task.id);
    if (error) {
      console.error("task-kill: could not archive", task.id, error.message);
      continue;
    }

    await supabase.from("task_feedback").insert({
      task_id: task.id,
      candidate_id: task.type_data?.candidate_id ?? null,
      team_member_id: memberId,
      action: "not_a_task",
      original_text: task.description ?? task.title,
      surface: "slack",
    });
    killed++;
  }
  return killed;
}

/**
 * A reply in the thread of a message whose task was just killed is captured as the
 * reason. Returns true when the reply was recorded as feedback.
 */
export async function captureKillComment(
  supabase: any,
  event: { channel?: string; thread_ts?: string; ts?: string; text?: string; user?: string },
): Promise<boolean> {
  const threadTs = event.thread_ts;
  if (!threadTs || !event.text?.trim()) return false;

  const { data } = await supabase
    .from("tasks")
    .select("id, type_data")
    .eq("type_data->>slack_message_ts", threadTs)
    .eq("type_data->>archived_reason", "rejected_in_slack")
    .limit(5);

  const recent = (data ?? []).filter((t: any) => {
    const at = t.type_data?.rejected_at;
    return at && Date.now() - new Date(at).getTime() <= COMMENT_WINDOW_MS;
  });
  if (recent.length === 0) return false;

  const memberId = await teamMemberIdForSlackUser(supabase, event.user);
  for (const task of recent) {
    await supabase.from("task_feedback").insert({
      task_id: task.id,
      candidate_id: task.type_data?.candidate_id ?? null,
      team_member_id: memberId,
      action: "not_a_task",
      comment: event.text!.slice(0, 2000),
      surface: "slack",
    });
  }
  return true;
}
