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
  /** Held in slack_outbox for Grokbot rather than posted. */
  queued?: boolean;
  outboxId?: string;
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
  /** Which job produced the post; recorded on outbox rows. */
  source?: string;
}

export interface BotSettings { cpm_bot_replies: boolean; outbound_sender: 'hub' | 'grokbot'; dm_username: string | null; dm_icon_url: string | null }

/** Changeover switches. Missing row or read failure keeps today's behaviour. */
export async function botSettings(): Promise<BotSettings> {
  const fallback: BotSettings = { cpm_bot_replies: true, outbound_sender: 'hub', dm_username: null, dm_icon_url: null };
  try {
    const { data } = await admin().from('bot_runtime_settings').select('cpm_bot_replies, outbound_sender, dm_username, dm_icon_url').eq('id', 1).maybeSingle();
    return data ? (data as BotSettings) : fallback;
  } catch { return fallback; }
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

  // Grokbot changeover: a cleared channel post waits in the outbox for Grokbot
  // to send instead of going out under the hub's bot. Only channels that passed
  // the allowlist above ever reach the outbox.
  if (!opts.channel.startsWith('D') && (await botSettings()).outbound_sender === 'grokbot') {
    const { data, error } = await admin().from('slack_outbox').insert({
      source: opts.source ?? 'hub', channel_id: opts.channel, channel_name: name,
      thread_ts: opts.threadTs ?? null, text: opts.text ?? null, blocks: opts.blocks ?? null,
    }).select('id').single();
    if (error) {
      const err = `outbox insert failed: ${error.message}`;
      if (opts.throwOnError) throw new Error(err);
      return { ok: false, error: err };
    }
    return { ok: true, queued: true, outboxId: data.id };
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

// ---------------------------------------------------------------------------
// postDirectMessage — the second (and only other) Slack write entrypoint.
//
// A DM channel never appears in slack_channel_mappings, so routing DMs through
// postToSlack() would mean weakening its allowlist. Instead this function has a
// STRUCTURAL guarantee: it accepts only a Slack USER id (U…/W…) and rejects any
// channel-shaped id outright. It opens the IM itself via conversations.open, so
// it cannot address a channel — and therefore cannot reach a client channel.
// The user id must also belong to a row in team_members.slack_user_id; anyone
// else (external or unknown) is refused and logged.
//
// Modes:
//   send              conversations.open → chat.postMessage
//   update            conversations.open → chat.update on a ts in THAT IM only
//   interaction_reply ephemeral reply to a button click via Slack's response_url
//                     (hooks.slack.com/actions/… only — Slack scopes it to the
//                     clicker; used for refusals, including unknown actors).
//
// dryRun returns the exact calls that would be made and touches nothing.
// ---------------------------------------------------------------------------

const USER_ID = /^[UW][A-Z0-9]{6,}$/;
const CHANNEL_SHAPED = /^[CGD][A-Z0-9]+$/;

export type DirectMessageOptions =
  | { kind: 'send'; userId: string; text: string; blocks?: unknown[]; dryRun?: boolean }
  | { kind: 'update'; userId: string; channel: string; ts: string; text: string; blocks?: unknown[]; dryRun?: boolean }
  | { kind: 'interaction_reply'; userId: string; responseUrl: string; text: string; dryRun?: boolean };

export interface DirectMessageResult {
  ok: boolean;
  refused?: boolean;
  reason?: string;
  error?: string;
  /** Slack error code, e.g. missing_scope — callers record it, never crash on it. */
  slackError?: string;
  channel?: string;
  ts?: string;
  dryRun?: boolean;
  wouldCall?: { method: string; body: Record<string, unknown> }[];
}

export async function postDirectMessage(opts: DirectMessageOptions): Promise<DirectMessageResult> {
  const method = `dm.${opts.kind}`;
  const userId = (opts.userId || '').trim();

  if (CHANNEL_SHAPED.test(userId)) {
    await logRefusal(userId, null, method, 'dm_target_is_channel_id');
    return { ok: false, refused: true, reason: 'dm_target_is_channel_id' };
  }
  if (!USER_ID.test(userId)) {
    await logRefusal(userId || '(empty)', null, method, 'dm_target_not_user_id');
    return { ok: false, refused: true, reason: 'dm_target_not_user_id' };
  }

  if (opts.kind === 'interaction_reply') {
    let host = '', path = '';
    try { const u = new URL(opts.responseUrl); host = u.hostname; path = u.pathname; } catch { /* invalid */ }
    if (host !== 'hooks.slack.com' || !path.startsWith('/actions/')) {
      await logRefusal(userId, null, method, 'response_url_not_slack_actions');
      return { ok: false, refused: true, reason: 'response_url_not_slack_actions' };
    }
    const body = { response_type: 'ephemeral', replace_original: false, text: opts.text };
    if (opts.dryRun) return { ok: true, dryRun: true, wouldCall: [{ method: 'response_url', body }] };
    const res = await fetch(opts.responseUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return res.ok ? { ok: true } : { ok: false, error: `response_url ${res.status}` };
  }

  const { data: member, error: memberErr } = await admin()
    .from('team_members').select('id, name').eq('slack_user_id', userId).eq('is_service_account', false).maybeSingle();
  if (memberErr) return { ok: false, error: `team_members lookup failed: ${memberErr.message}` };
  if (!member) {
    await logRefusal(userId, null, method, 'dm_user_not_internal_team_member');
    return { ok: false, refused: true, reason: 'dm_user_not_internal_team_member' };
  }

  const openBody = { users: userId };
  const writeMethod = opts.kind === 'send' ? 'chat.postMessage' : 'chat.update';
  const brand = await botSettings();
  const persona: Record<string, unknown> = opts.kind === 'send' && brand.dm_username
    ? { username: brand.dm_username, ...(brand.dm_icon_url ? { icon_url: brand.dm_icon_url } : {}) }
    : {};
  const writeBody: Record<string, unknown> = opts.kind === 'send'
    ? { channel: '<im from conversations.open>', text: opts.text, ...(opts.blocks ? { blocks: opts.blocks } : {}), unfurl_links: false, ...persona }
    : { channel: opts.channel, ts: opts.ts, text: opts.text, blocks: opts.blocks ?? [] };
  if (opts.dryRun) {
    return { ok: true, dryRun: true, wouldCall: [{ method: 'conversations.open', body: openBody }, { method: writeMethod, body: writeBody }] };
  }

  let token: string;
  try { token = await getValidBotToken(); } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const call = async (m: string, body: Record<string, unknown>) => {
    const res = await fetch(`https://slack.com/api/${m}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok === true, data, status: res.status };
  };

  const open = await call('conversations.open', openBody);
  if (!open.ok) {
    const code = open.data?.error || `http_${open.status}`;
    return { ok: false, slackError: code, error: `conversations.open failed: ${code}` };
  }
  const im = open.data.channel?.id as string;
  if (opts.kind === 'update' && im !== opts.channel) {
    await logRefusal(opts.channel, null, method, 'update_channel_is_not_this_users_im');
    return { ok: false, refused: true, reason: 'update_channel_is_not_this_users_im' };
  }
  const out = await call(writeMethod, { ...writeBody, channel: im });
  if (!out.ok) {
    const code = out.data?.error || `http_${out.status}`;
    return { ok: false, slackError: code, error: `${writeMethod} failed: ${code}`, channel: im };
  }
  return { ok: true, channel: im, ts: (out.data.ts as string) ?? (opts.kind === 'update' ? opts.ts : undefined) };
}
