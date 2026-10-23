// Pure outbox drain (no Slack import) so it can be unit-tested. DM-only by construction.

/** Charles's verified Slack user id. Source: team_members row 014fa04a-80a5-41ce-9368-d1a81f6d2eec (slack_user_id),
 *  read-only 2026-10-23 11:48 AM PT. A config constant: never looked up by name, never taken from outbox rows. */
export const CHARLES_SLACK_USER_ID = 'U05GE2QL4UC';
export const HUB_CHANGE_LOG_URL = 'https://hub.connectpaidmedia.com/admin/change-log'; // production hub domain (repo META_REDIRECT_URI; serves Client Hub)
export const PER_MINUTE_CAP = 10;

/** The only send shape allowed: a new DM to the constant recipient. No channel, thread, update or reply fields. */
export type DmSend = (o: { kind: 'send'; userId: typeof CHARLES_SLACK_USER_ID; text: string }) =>
  Promise<{ ok: boolean; ts?: string; slackError?: string; reason?: string; error?: string }>;

const clean = (v: unknown, max = 120) => (v === null || v === undefined ? '—' : String(v).replace(/[\u0000-\u001f<>`*~|]/g, ' ').slice(0, max));
const money = (v: unknown) => (/^\d+$/.test(String(v ?? '')) ? `$${(Number(v) / 100).toFixed(2)}/day` : clean(v));

/** DM text: action, account, object, old → new, hub link. Nothing else (no tokens, keys, params, reasons, request bodies). */
export function dmText(r: any): string {
  const head = r.kind === 'urgent_rollback_failed' ? ':rotating_light: URGENT: rename read-back rollback FAILED' : r.kind === 'test' ? 'Test alert (agent change log)' : ':crescent_moon: Agent change executed overnight (9 PM–7 AM CT)';
  const isBudget = String(r.action ?? '').endsWith('update_budget');
  return [head,
    `Action: ${clean(r.action, 60)}`,
    `Account: act_${clean(r.account_id, 30)}`,
    `Object: ${clean(r.object_type, 20)} ${clean(r.object_id, 30)}${r.object_name ? ` "${clean(r.object_name, 80)}"` : ''}`,
    `Change: ${isBudget ? money(r.old_value) : clean(r.old_value)} → ${isBudget ? money(r.new_value) : clean(r.new_value)}`,
    `Change log: ${HUB_CHANGE_LOG_URL}`].join('\n');
}

/** Claim (SKIP LOCKED, per-minute cap in SQL) → send → record result. Sent only after Slack ok; 5 tries then failed + hub alert (SQL). */
export async function drain(db: any, send: DmSend) {
  const { data: rows, error } = await db.rpc('agent_alert_outbox_claim', { p_per_minute: PER_MINUTE_CAP });
  if (error) throw new Error('claim_failed');
  const out: { id: number; result: string }[] = [];
  for (const r of rows ?? []) {
    let res: Awaited<ReturnType<DmSend>>;
    try { res = await send({ kind: 'send', userId: CHARLES_SLACK_USER_ID, text: dmText(r) }); }
    catch { res = { ok: false, error: 'send_threw' }; }
    const { data } = await db.rpc('agent_alert_outbox_result', { p_id: r.id, p_ok: res.ok === true,
      p_error: res.ok ? null : String(res.slackError ?? res.reason ?? res.error ?? 'send_failed').slice(0, 80), p_ts: res.ts ?? null });
    out.push({ id: r.id, result: String(data ?? 'unknown') });
  }
  return out;
}
