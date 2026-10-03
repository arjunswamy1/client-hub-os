// Delivery of queued brief_notifications rows. Rows are created by the database
// (trigger on the transition into submitted; accept_creative_brief_as on accept)
// BEFORE any Slack call — the unique dedupe_key is what guarantees exactly one
// message per intent. This module only sends a row that already exists, and
// only via postDirectMessage().
//
// Live sending is OFF unless the BRIEF_DM_LIVE secret is exactly "true". While
// off, every path runs as a dry run: rows stay pending and the would-be calls
// are returned.
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { postDirectMessage } from './slack-post.ts';
import {
  designerAssignedBlocks, designerAssignedText, designerAcceptedBlocks,
  ownerAcceptedBlocks, ownerAcceptedText, designerReassignedBlocks, designerReassignedText,
  designerDeclinedBlocks, declinedNotifyBlocks, declinedNotifyText, RETRY_STATUSES,
} from './brief-messages.ts';

export const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

export const liveSendingEnabled = () => Deno.env.get('BRIEF_DM_LIVE') === 'true';

async function loadBrief(db: SupabaseClient, briefId: string) {
  const { data, error } = await db
    .from('creative_briefs')
    .select(`id, title, due_date, priority, status, assigned_to_id, accepted_at, accepted_by_id, deleted_at,
      owner:team_members!creative_briefs_created_by_id_fkey(name),
      accepted_by:team_members!creative_briefs_accepted_by_id_fkey(name),
      assigned:team_members!creative_briefs_assigned_to_id_fkey(name)`)
    .eq('id', briefId)
    .maybeSingle();
  if (error) throw new Error(`brief lookup failed: ${error.message}`);
  return data as any;
}

export interface DeliveryReport {
  notification_id: string;
  kind: string;
  dedupe_key: string;
  result: 'sent' | 'failed' | 'stale_not_sent' | 'dry_run' | 'skipped';
  error?: string;
  would_call?: unknown;
}

export async function deliverNotification(db: SupabaseClient, row: any, opts: { dryRun: boolean }): Promise<DeliveryReport> {
  const base = { notification_id: row.id, kind: row.kind, dedupe_key: row.dedupe_key };
  if (row.status === 'sent' || row.status === 'stale' || row.status === 'skipped_no_slack_mapping') return { ...base, result: 'skipped' };

  const brief = await loadBrief(db, row.brief_id);
  if (!brief || brief.deleted_at) return markStale(db, row, 'brief deleted');

  let text: string, blocks: unknown[];
  if (row.kind === 'designer_assigned') {
    // Never send a stale assignment: the brief must still be submitted, unaccepted, and assigned to this recipient.
    if (brief.status !== 'submitted' || brief.accepted_at || brief.assigned_to_id !== row.recipient_team_member_id) {
      return markStale(db, row, `stale: status=${brief.status}, accepted=${!!brief.accepted_at}, assignee_changed=${brief.assigned_to_id !== row.recipient_team_member_id}`);
    }
    const m = { id: brief.id, title: brief.title, owner_name: brief.owner?.name, due_date: brief.due_date, priority: brief.priority };
    text = designerAssignedText(m);
    blocks = designerAssignedBlocks(m);
  } else if (row.kind === 'designer_declined') {
    // dedupe_key = brief:<id>:designer_declined:<assignee_id>[:creative_lead:<id>]
    const decliner = String(row.dedupe_key).split(':')[3];
    if (brief.accepted_at || brief.status !== 'submitted' || brief.assigned_to_id !== decliner) {
      return markStale(db, row, 'stale: brief already reassigned, accepted or moved on');
    }
    const { data: d } = await db.from('team_members').select('name').eq('id', decliner).maybeSingle();
    text = declinedNotifyText(d?.name, brief.title, row.created_at);
    blocks = declinedNotifyBlocks(brief.id, d?.name, brief.title, row.created_at);
  } else {
    if (!brief.accepted_at) return markStale(db, row, 'stale: brief not accepted');
    text = ownerAcceptedText(brief.accepted_by?.name, brief.title, brief.accepted_at);
    blocks = ownerAcceptedBlocks(brief.id, brief.accepted_by?.name, brief.title, brief.accepted_at);
  }

  const res = await postDirectMessage({ kind: 'send', userId: row.recipient_slack_user_id || '', text, blocks, dryRun: opts.dryRun });
  if (opts.dryRun) return { ...base, result: 'dry_run', would_call: res.wouldCall ?? res };

  if (res.ok) {
    await db.from('brief_notifications').update({
      status: 'sent', slack_channel_id: res.channel, slack_ts: res.ts, message_text: text,
      attempts: (row.attempts ?? 0) + 1, last_error: null, updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    return { ...base, result: 'sent' };
  }
  // A recorded, retryable failure — including missing_scope while im:write is not granted.
  const err = res.reason ? `refused: ${res.reason}` : (res.error || 'unknown error');
  await db.from('brief_notifications').update({
    status: 'failed', attempts: (row.attempts ?? 0) + 1, last_error: err.slice(0, 500),
    message_text: text, updated_at: new Date().toISOString(),
  }).eq('id', row.id);
  return { ...base, result: 'failed', error: err };
}

/** A notification correctly withheld is not a failure: status 'stale', attempts untouched. */
export async function markStale(db: SupabaseClient, row: any, why: string): Promise<DeliveryReport> {
  await db.from('brief_notifications').update({
    status: 'stale', last_error: `not sent — ${why}`, updated_at: new Date().toISOString(),
  }).eq('id', row.id);
  return { notification_id: row.id, kind: row.kind, dedupe_key: row.dedupe_key, result: 'stale_not_sent', error: why };
}

/** Deliver every pending/failed row for one brief (called after submit / accept). */
export async function deliverForBrief(db: SupabaseClient, briefId: string, opts: { dryRun: boolean }) {
  const { data: rows } = await db.from('brief_notifications').select('*')
    .eq('brief_id', briefId).in('status', [...RETRY_STATUSES]).lt('attempts', 5);
  const out: any[] = await rewriteSupersededDesignerMessages(db, briefId, opts);
  for (const row of rows ?? []) out.push(await deliverNotification(db, row, opts));
  return out;
}

/** After an accept: rewrite the designer's original DM and drop the Accept button. */
export async function updateDesignerMessage(db: SupabaseClient, briefId: string, opts: { dryRun: boolean }) {
  const brief = await loadBrief(db, briefId);
  if (!brief?.accepted_at || !brief.accepted_by_id) return { updated: false, reason: 'not accepted' };
  const { data: row } = await db.from('brief_notifications').select('*')
    .eq('dedupe_key', `brief:${briefId}:designer_assigned:${brief.accepted_by_id}`).maybeSingle();
  if (!row?.slack_channel_id || !row?.slack_ts) return { updated: false, reason: 'no delivered designer message to update' };
  const m = { id: brief.id, title: brief.title, owner_name: brief.owner?.name, due_date: brief.due_date, priority: brief.priority };
  const res = await postDirectMessage({
    kind: 'update', userId: row.recipient_slack_user_id, channel: row.slack_channel_id, ts: row.slack_ts,
    text: `${designerAssignedText(m)}\n\nAccepted.`, blocks: designerAcceptedBlocks(m, brief.accepted_at), dryRun: opts.dryRun,
  });
  return { updated: res.ok && !opts.dryRun, ...res };
}

/**
 * After a reassignment: any delivered designer_assigned DM whose recipient is no longer the
 * assignee is rewritten (Accept/Decline removed, "reassigned to X") and marked stale.
 * Undelivered rows for the old assignee are marked stale by deliverNotification and never sent.
 */
export async function rewriteSupersededDesignerMessages(db: SupabaseClient, briefId: string, opts: { dryRun: boolean }) {
  const brief = await loadBrief(db, briefId);
  if (!brief) return [];
  const { data: rows } = await db.from('brief_notifications').select('*')
    .eq('brief_id', briefId).eq('kind', 'designer_assigned').eq('status', 'sent');
  const out: any[] = [];
  for (const row of rows ?? []) {
    if (row.recipient_team_member_id === brief.assigned_to_id) continue;
    if (row.recipient_team_member_id === brief.accepted_by_id) continue;
    const m = { id: brief.id, title: brief.title, owner_name: brief.owner?.name, due_date: brief.due_date, priority: brief.priority };
    const newName = brief.assigned?.name ?? null;
    if (!row.slack_channel_id || !row.slack_ts) {
      await markStale(db, row, 'superseded by reassignment; no delivered message');
      out.push({ notification_id: row.id, kind: 'reassigned_rewrite', result: 'stale_not_sent' });
      continue;
    }
    const res = await postDirectMessage({
      kind: 'update', userId: row.recipient_slack_user_id, channel: row.slack_channel_id, ts: row.slack_ts,
      text: designerReassignedText(m, newName), blocks: designerReassignedBlocks(m, newName), dryRun: opts.dryRun,
    });
    if (opts.dryRun) { out.push({ notification_id: row.id, kind: 'reassigned_rewrite', result: 'dry_run', would_call: res.wouldCall }); continue; }
    if (res.ok) {
      await markStale(db, row, `reassigned to ${newName ?? 'nobody'}; original DM rewritten`);
      out.push({ notification_id: row.id, kind: 'reassigned_rewrite', result: 'sent' });
    } else {
      // Row stays 'sent' so the next sweep tries the rewrite again.
      out.push({ notification_id: row.id, kind: 'reassigned_rewrite', result: 'failed', error: res.reason || res.error });
    }
  }
  return out;
}

/** Sweep every brief with a delivered designer DM that may now be superseded. */
export async function sweepSuperseded(db: SupabaseClient, opts: { dryRun: boolean }) {
  const { data } = await db.from('brief_notifications').select('brief_id')
    .eq('kind', 'designer_assigned').eq('status', 'sent').limit(500);
  const ids = [...new Set((data ?? []).map((r: any) => r.brief_id))];
  const out: any[] = [];
  for (const id of ids) out.push(...await rewriteSupersededDesignerMessages(db, id, opts));
  return out;
}

/** After a decline: rewrite the decliner's DM with both buttons removed. */
export async function markDesignerMessageDeclined(db: SupabaseClient, briefId: string, actorId: string, declinedAtIso: string, opts: { dryRun: boolean }) {
  const brief = await loadBrief(db, briefId);
  const { data: row } = await db.from('brief_notifications').select('*')
    .eq('dedupe_key', `brief:${briefId}:designer_assigned:${actorId}`).maybeSingle();
  if (!brief || !row?.slack_channel_id || !row?.slack_ts) return { updated: false, reason: 'no delivered designer message to update' };
  const m = { id: brief.id, title: brief.title, owner_name: brief.owner?.name, due_date: brief.due_date, priority: brief.priority };
  const res = await postDirectMessage({
    kind: 'update', userId: row.recipient_slack_user_id, channel: row.slack_channel_id, ts: row.slack_ts,
    text: `${designerAssignedText(m)}\n\nDeclined.`, blocks: designerDeclinedBlocks(m, declinedAtIso), dryRun: opts.dryRun,
  });
  return { updated: res.ok && !opts.dryRun, ...res };
}
