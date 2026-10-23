import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { drain, dmText, CHARLES_SLACK_USER_ID, PER_MINUTE_CAP } from './drain.ts';

const row = (o: any = {}) => ({ id: 1, kind: 'overnight_execution', action: 'meta.adset.update_budget', account_id: '111', object_type: 'adset', object_id: '555', object_name: 'FE Adset', old_value: '10000', new_value: '12000', ...o });
function fakeDb(rows: any[]) {
  const calls: any[] = [];
  return { calls, rpc: async (n: string, a: any) => { calls.push([n, a]); return n === 'agent_alert_outbox_claim' ? { data: rows, error: null } : { data: a.p_ok ? 'sent' : 'retry', error: null }; } };
}
Deno.test('drain: DMs the constant Charles id (never from the row), marks sent only after ok', async () => {
  const db = fakeDb([row({ recipient: 'UATTACKER', slack_user_id: 'UATTACKER' })]); const sent: any[] = [];
  const out = await drain(db, async (o) => (sent.push(o), { ok: true, ts: '1.2' }));
  assertEquals(sent[0].userId, CHARLES_SLACK_USER_ID); assertEquals(sent[0].userId, 'U05GE2QL4UC'); assertEquals(sent[0].kind, 'send');
  assertEquals(db.calls[0], ['agent_alert_outbox_claim', { p_per_minute: PER_MINUTE_CAP }]);
  assertEquals(db.calls[1][1].p_ok, true); assertEquals(out[0].result, 'sent');
});
Deno.test('drain: Slack failure or throw -> result recorded not-ok (row stays retryable), error code only', async () => {
  const db = fakeDb([row(), row({ id: 2 })]); let i = 0;
  await drain(db, async () => { if (i++ === 0) return { ok: false, slackError: 'missing_scope' }; throw new Error('xoxb-secret-should-not-leak'); });
  assertEquals(db.calls[1][1], { p_id: 1, p_ok: false, p_error: 'missing_scope', p_ts: null });
  assertEquals(db.calls[2][1].p_error, 'send_threw'); assert(!JSON.stringify(db.calls).includes('xoxb'));
});
Deno.test('dmText: only action, account, object, old/new and hub link', () => {
  const t = dmText(row({ reason: 'secret reason', params: { access_token: 'EAAB' }, result: { data: 'raw' } }));
  assert(t.includes('meta.adset.update_budget') && t.includes('act_111') && t.includes('adset 555') && t.includes('$100.00/day → $120.00/day') && t.includes('/admin/change-log'));
  for (const bad of ['secret reason', 'EAAB', 'access_token', 'raw', 'qa_ref', 'Request']) assert(!t.includes(bad), bad);
  assertEquals(t.split('\n').length, 6);
});
Deno.test('dmText: urgent kind, markup stripped', () => {
  const t = dmText(row({ kind: 'urgent_rollback_failed', action: 'meta.ad.rename', old_value: 'Old <!channel>', new_value: '*New*' }));
  assert(t.startsWith(':rotating_light: URGENT')); assert(!t.includes('<!channel>')); assert(!t.includes('*New*'));
});
