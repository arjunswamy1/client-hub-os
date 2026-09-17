// The ONLY place in this codebase that is allowed to call a Slack write method.
//
// Posting is a fail-closed allowlist. A channel may be written to only when it
// has a `slack_channel_mappings` row, that row has been classified from Slack's
// own flags, and `is_external` is false. Unknown, unmapped or unclassified means
// refuse — a denylist would fail open on exactly the case that matters, a client
// Slack Connect channel nobody got round to flagging.
//
// Every refusal is recorded in `slack_post_refusals`.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getValidBotToken } from './slack-token.ts';

const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

export type SlackWriteMethod =
  | 'chat.postMessage'
  | 'chat.update'
  | 'chat.postEphemeral'
  | 'reactions.add'
  | 'files.upload';

export interface SlackPostResult {
  ok: boolean;
  refused?: boolean;
  reason?: string;
  ts?: string;
  error?: string;
}

export class SlackRefusedError extends Error {
  reason: string;
  constructor(reason: string, channel: string) {
    super(`Slack write refused for channel ${channel}: ${reason}`);
    this.reason = reason;
  }
}

async function logRefusal(channelId: string, channelName: string | null, method: string, reason: string, detail?: unknown) {
  console.error(`SLACK WRITE REFUSED [${method}] channel=${channelId} reason=${reason}`);
  try {
    await admin().from('slack_post_refusals').insert({
      channel_id: channelId,
      channel_name: channelName,
      method,
      reason,
      detail: detail ? (detail as Record<string, unknown>) : null,
    });
  } catch (e) {
    console.error('SLACK WRITE REFUSED: could not record refusal:', e);
  }
}

/**
 * Decide whether a channel may be written to. Returns the reason to refuse, or
 * null when the write is allowed.
 *
 * A DM (channel id starting with `D`) has no mapping row and never will, so it
 * is allowed only when the caller has verified the human on the other side is a
 * member of our own workspace and not a Slack Connect stranger.
 */
async function refusalReason(
  channelId: string,
  directMessageVerifiedInternal = false,
): Promise<{ reason: string | null; name: string | null }> {
  if (!channelId) return { reason: 'missing_channel_id', name: null };

  if (channelId.startsWith('D')) {
    return directMessageVerifiedInternal
      ? { reason: null, name: 'direct message' }
      : { reason: 'dm_user_not_verified_internal', name: 'direct message' };
  }

  const { data: row, error } = await admin()
    .from('slack_channel_mappings')
    .select('channel_id, channel_name, is_external, classified_at')
    .eq('channel_id', channelId)
    .maybeSingle();

  if (error) return { reason: `mapping_lookup_failed: ${error.message}`, name: null };
  if (!row) return { reason: 'channel_not_mapped', name: null };
  if (row.classified_at === null) return { reason: 'channel_not_classified', name: row.channel_name };
  if (row.is_external !== false) return { reason: 'channel_is_external', name: row.channel_name };
  return { reason: null, name: row.channel_name };
}

/** Fail-closed guard exposed for callers that want to check before doing work. */
export async function canPostToChannel(channelId: string, directMessageVerifiedInternal = false): Promise<boolean> {
  return (await refusalReason(channelId, directMessageVerifiedInternal)).reason === null;
}

interface PostOptions {
  channel: string;
  method?: SlackWriteMethod;
  text?: string;
  blocks?: unknown[];
  threadTs?: string;
  /** chat.update */
  ts?: string;
  /** chat.postEphemeral */
  user?: string;
  /** reactions.add */
  reactionName?: string;
  reactionTimestamp?: string;
  /** files.upload */
  file?: { bytes: Blob; filename: string; title: string };
  /** Throw instead of returning { refused: true }. */
  throwOnRefusal?: boolean;
  /** Throw on a Slack API error instead of returning it. */
  throwOnError?: boolean;
  /** Caller has verified this DM's human is an internal workspace member. */
  directMessageVerifiedInternal?: boolean;
}

/**
 * The single Slack write entrypoint. Guarded, logged, and token-managed.
 */
export async function postToSlack(opts: PostOptions): Promise<SlackPostResult> {
  const method: SlackWriteMethod = opts.method ?? 'chat.postMessage';
  const { reason, name } = await refusalReason(opts.channel, opts.directMessageVerifiedInternal === true);
  if (reason) {
    await logRefusal(opts.channel, name, method, reason, {
      thread_ts: opts.threadTs ?? null,
      text_preview: typeof opts.text === 'string' ? opts.text.slice(0, 200) : null,
    });
    if (opts.throwOnRefusal) throw new SlackRefusedError(reason, opts.channel);
    return { ok: false, refused: true, reason };
  }

  let token: string;
  try {
    token = await getValidBotToken();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('SLACK WRITE ABORTED: no usable token —', message);
    if (opts.throwOnRefusal || opts.throwOnError) throw e;
    return { ok: false, error: message };
  }

  const call = async (m: string, body: Record<string, unknown>) => {
    const res = await fetch(`https://slack.com/api/${m}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let data: any = {};
    try { data = JSON.parse(raw); } catch { /* non-JSON */ }
    if (!res.ok || !data.ok) {
      const err = `Slack ${m} failed [${res.status}]: ${data.error || raw.slice(0, 200)}`;
      if (opts.throwOnError) throw new Error(err);
      console.error(err);
      return { ok: false, error: err } as SlackPostResult;
    }
    return { ok: true, ts: data.ts as string | undefined } as SlackPostResult;
  };

  if (method === 'reactions.add') {
    const out = await call('reactions.add', {
      channel: opts.channel,
      timestamp: opts.reactionTimestamp,
      name: opts.reactionName,
    });
    if (!out.ok && out.error?.includes('already_reacted')) return { ok: true };
    return out;
  }

  if (method === 'chat.update') {
    return await call('chat.update', {
      channel: opts.channel,
      ts: opts.ts,
      text: opts.text,
      ...(opts.blocks ? { blocks: opts.blocks } : {}),
    });
  }

  if (method === 'chat.postEphemeral') {
    return await call('chat.postEphemeral', {
      channel: opts.channel,
      user: opts.user,
      text: opts.text,
      ...(opts.blocks ? { blocks: opts.blocks } : {}),
    });
  }

  if (method === 'files.upload') {
    if (!opts.file) return { ok: false, error: 'files.upload requires a file' };
    return await uploadFile(token, opts);
  }

  return await call('chat.postMessage', {
    channel: opts.channel,
    text: opts.text,
    ...(opts.blocks ? { blocks: opts.blocks } : {}),
    ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
    unfurl_links: false,
  });
}

/** Slack's three-step external upload. Reached only after the guard passes. */
async function uploadFile(token: string, opts: PostOptions): Promise<SlackPostResult> {
  const file = opts.file!;
  const size = file.bytes.size;
  const getUrl = await fetch(
    `https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(file.filename)}&length=${size}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const getUrlData = await getUrl.json().catch(() => ({}));
  if (!getUrlData.ok) return { ok: false, error: `Slack upload URL failed: ${getUrlData.error || getUrl.status}` };

  const put = await fetch(getUrlData.upload_url, { method: 'POST', body: file.bytes });
  if (!put.ok) return { ok: false, error: `Slack upload PUT failed: ${put.status}` };

  const completeBody: Record<string, unknown> = {
    files: [{ id: getUrlData.file_id, title: file.title }],
    channel_id: opts.channel,
  };
  if (opts.threadTs) completeBody.thread_ts = opts.threadTs;

  const done = await fetch('https://slack.com/api/files.completeUploadExternal', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(completeBody),
  });
  const doneData = await done.json().catch(() => ({}));
  if (!doneData.ok) return { ok: false, error: `Slack upload completion failed: ${doneData.error || done.status}` };
  return { ok: true };
}
