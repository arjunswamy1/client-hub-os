// COST AND ABUSE CONTROLS for the Slack bot.
//
// Slack retries a delivery it thinks failed; answering twice is both confusing
// and paid for twice. A per-person and per-channel throttle bounds a runaway
// loop, and a daily token ceiling degrades to a plain "ask me again tomorrow"
// instead of failing oddly.

export const LIMITS = {
  perUserPerHour: 20,
  perChannelPerHour: 40,
  dailyTokenCeiling: 600_000,
};

/** Event keys already handled in this isolate — the cheap first line against retries. */
const seenEvents = new Set<string>();

export function isDuplicateDelivery(req: Request, eventKey: string): boolean {
  const retryNum = Number(req.headers.get('x-slack-retry-num') || '0');
  if (retryNum > 0) return true;
  if (!eventKey) return false;
  if (seenEvents.has(eventKey)) return true;
  seenEvents.add(eventKey);
  if (seenEvents.size > 500) {
    for (const k of Array.from(seenEvents).slice(0, 250)) seenEvents.delete(k);
  }
  return false;
}

export interface ThrottleVerdict {
  allowed: boolean;
  reason?: string;
  /** Message to post when not allowed. Never a raw error. */
  message?: string;
}

/**
 * A persisted check against bot_qa_log, so it survives isolate recycling.
 * A logging failure must never block an answer, so any error here allows.
 */
export async function checkThrottle(
  supabase: any,
  opts: { slackUserId?: string | null; channelId?: string | null },
): Promise<ThrottleVerdict> {
  try {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const dayStart = new Date(Date.now() - 86400_000).toISOString();

    const [userRes, channelRes, tokenRes] = await Promise.all([
      opts.slackUserId
        ? supabase.from('bot_qa_log').select('id', { count: 'exact', head: true })
            .eq('asked_by_slack_id', opts.slackUserId).gte('created_at', hourAgo)
        : Promise.resolve({ count: 0 }),
      opts.channelId
        ? supabase.from('bot_qa_log').select('id', { count: 'exact', head: true })
            .eq('channel_id', opts.channelId).gte('created_at', hourAgo)
        : Promise.resolve({ count: 0 }),
      supabase.from('bot_qa_log').select('tokens_in, tokens_out').gte('created_at', dayStart).limit(2000),
    ]);

    if ((userRes.count || 0) >= LIMITS.perUserPerHour) {
      return {
        allowed: false, reason: 'per_user_hourly',
        message: `That's ${LIMITS.perUserPerHour} questions from you in the last hour, which is my limit per person. Give it a few minutes and ask again. 🕐`,
      };
    }
    if ((channelRes.count || 0) >= LIMITS.perChannelPerHour) {
      return {
        allowed: false, reason: 'per_channel_hourly',
        message: `This channel has hit my hourly question limit (${LIMITS.perChannelPerHour}). I'll pick things up shortly. 🕐`,
      };
    }
    const tokensToday = (tokenRes.data || []).reduce(
      (sum: number, r: any) => sum + (Number(r.tokens_in) || 0) + (Number(r.tokens_out) || 0), 0);
    if (tokensToday >= LIMITS.dailyTokenCeiling) {
      return {
        allowed: false, reason: 'daily_token_ceiling',
        message: "I've used up my thinking budget for today, so I'm going quiet rather than answering badly. Ask me again tomorrow. 🌙",
      };
    }
    return { allowed: true };
  } catch (e) {
    console.warn('[bot-guard] throttle check failed, allowing:', e instanceof Error ? e.message : e);
    return { allowed: true };
  }
}

export interface QaLogRow {
  asked_by_slack_id?: string | null;
  team_member_id?: string | null;
  channel_id?: string | null;
  channel_name?: string | null;
  thread_ts?: string | null;
  question: string;
  resolved_client_id?: string | null;
  answer?: string | null;
  metrics_used?: string[];
  sql_used?: string | null;
  had_uncaptured_data?: boolean | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  latency_ms?: number | null;
  error?: string | null;
}

export async function logQa(supabase: any, row: QaLogRow): Promise<void> {
  try {
    const { error } = await supabase.from('bot_qa_log').insert({ ...row, metrics_used: row.metrics_used ?? [] });
    if (error) console.error('[bot-guard] qa log insert failed:', error.message);
  } catch (e) {
    console.error('[bot-guard] qa log exception:', e instanceof Error ? e.message : e);
  }
}

/** Resolve a Slack user to one of our own team members. */
export async function resolveTeamMember(supabase: any, slackUserId?: string | null): Promise<{ id: string; name: string; role: string } | null> {
  if (!slackUserId) return null;
  const { data } = await supabase
    .from('team_members')
    .select('id, name, role')
    .eq('slack_user_id', slackUserId)
    .eq('is_active', true)
    .maybeSingle();
  return data || null;
}
