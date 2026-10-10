// Grokbot outbox tools. The hub never sends: these read posts that already
// cleared the Slack allowlist in _shared/slack-post.ts and record what Grokbot
// did with them. Service accounts only. Never imports _shared/slack-post.ts.
import { ToolRefusal, type CreativeCaller } from './creative.ts';

const id = { type: 'string', description: 'Outbox row id.' };

export const OUTBOX_TOOLS = [
  { name: 'list_outbox', scope: 'draft', description: 'Channel posts the hub has cleared and is waiting for you to send (oldest first). Each row is re-checked against the channel allowlist; a channel that is no longer internal is withheld and marked skipped. Post text and blocks verbatim to channel_id (and thread_ts when set), then call mark_outbox_sent.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false } },
  { name: 'mark_outbox_sent', scope: 'draft', description: 'Record that you posted an outbox row, with the Slack message ts.', inputSchema: { type: 'object', properties: { outbox_id: id, slack_ts: { type: 'string' } }, required: ['outbox_id', 'slack_ts'], additionalProperties: false } },
  { name: 'mark_outbox_skipped', scope: 'draft', description: 'Record that you did not post an outbox row, and why.', inputSchema: { type: 'object', properties: { outbox_id: id, reason: { type: 'string', maxLength: 500 } }, required: ['outbox_id', 'reason'], additionalProperties: false } },
] as const;

export async function runOutboxTool(name: string, db: any, caller: CreativeCaller, args: Record<string, any>, now: Date) {
  if (!caller.isService) throw new ToolRefusal('refused_not_service_account', 'outbox tools are for the Grokbot service identity only');
  if (name === 'list_outbox') {
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
    const { data: rows, error } = await db.from('slack_outbox').select('id, created_at, source, channel_id, channel_name, thread_ts, text, blocks')
      .eq('status', 'pending').order('created_at').limit(limit);
    if (error) throw new Error(error.message);
    const ids = [...new Set((rows ?? []).map((r: any) => r.channel_id))];
    const { data: maps } = ids.length ? await db.from('slack_channel_mappings').select('channel_id, is_external, classified_at').in('channel_id', ids) : { data: [] };
    const ok = new Set((maps ?? []).filter((m: any) => m.classified_at && m.is_external === false).map((m: any) => m.channel_id));
    const ready = [], withheld = [];
    for (const r of rows ?? []) {
      if (ok.has(r.channel_id)) { ready.push(r); continue; }
      withheld.push(r.id);
      await db.from('slack_outbox').update({ status: 'skipped', skip_reason: 'channel no longer cleared as internal', handled_at: now.toISOString(), handled_by: caller.memberId }).eq('id', r.id).eq('status', 'pending');
    }
    return { payload: { pending: ready, withheld_count: withheld.length, note: 'Text is the hub\'s cleared draft; send it unchanged.' }, clientId: null, tables: ['slack_outbox', 'slack_channel_mappings'] };
  }
  const outboxId = String(args.outbox_id ?? '');
  const patch = name === 'mark_outbox_sent'
    ? { status: 'sent', sent_ts: String(args.slack_ts ?? '').slice(0, 64) }
    : { status: 'skipped', skip_reason: String(args.reason ?? '').slice(0, 500) };
  if (name === 'mark_outbox_sent' && !patch.sent_ts) throw new ToolRefusal('invalid_arguments', 'slack_ts is required');
  const { data, error } = await db.from('slack_outbox').update({ ...patch, handled_at: now.toISOString(), handled_by: caller.memberId })
    .eq('id', outboxId).eq('status', 'pending').select('id, status').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ToolRefusal('refused_not_pending', 'that outbox row does not exist or was already handled');
  return { payload: data, clientId: null, tables: ['slack_outbox'], audit: { outbox_id: outboxId, after: patch } };
}
