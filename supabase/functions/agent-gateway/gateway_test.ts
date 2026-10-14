import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handleGateway, sha256Hex } from './gateway.ts';
import { OnePasswordProvider } from './secrets.ts';

const TOKEN = 'agw_secret_value_123';
const IID = '11111111-1111-1111-1111-111111111111';

async function fakeDb(o: { enabled?: boolean; status?: string; scopes?: string[]; allowed?: boolean; revoked?: boolean; expired?: boolean; noGrant?: boolean } = {}) {
  const hash = await sha256Hex(TOKEN);
  const logs: any[] = [];
  const rows: Record<string, any> = {
    agent_gateway_tokens: { id: 't1', agent_id: 'a1', token_hash: hash, revoked_at: o.revoked ? '2026-01-01' : null, expires_at: o.expired ? '2020-01-01' : '2099-01-01' },
    agent_gateway_settings: { gateway_enabled: o.enabled ?? true },
    agents: { id: 'a1', status: o.status ?? 'active' },
    integrations: { id: IID, enabled: true, op_secret_ref: 'op://CPM-Agents/meta/key' },
    agent_grants: o.noGrant ? null : { id: 'g1', scopes: o.scopes ?? ['read'], rate_per_minute: 5, rate_per_day: 10, expires_at: null, revoked_at: null },
  };
  const q = (t: string) => {
    const filters: [string, unknown][] = [];
    const b: any = {
      select: () => b, update: () => b,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
      maybeSingle: async () => {
        const r = rows[t];
        if (t === 'agent_gateway_tokens' && filters.some(([k, v]) => k === 'token_hash' && v !== hash)) return { data: null };
        return { data: r };
      },
      insert: async (row: any) => { logs.push(row); return {}; },
      then: (f: any) => f({}),
    };
    return b;
  };
  return { logs, db: { from: q, rpc: async () => ({ data: { allowed: o.allowed ?? true } }) } };
}
const call = async (o: any, auth: string | null = `Bearer ${TOKEN}`, body: any = { integration_id: IID, action: 'meta.insights.read', scope: 'read', params: { a: 1 } }) => {
  const f = await fakeDb(o);
  const r = await handleGateway({ db: f.db, secrets: new OnePasswordProvider() }, auth, body);
  return { r, logs: f.logs };
};

Deno.test('missing token denied and audited', async () => { const { r, logs } = await call({}, null); assertEquals(r.body.outcome, 'denied_no_token'); assertEquals(logs.length, 1); });
Deno.test('wrong token denied', async () => { const { r } = await call({}, 'Bearer nope'); assertEquals(r.body.outcome, 'denied_bad_token'); });
Deno.test('revoked token denied', async () => { assertEquals((await call({ revoked: true })).r.body.outcome, 'denied_token_revoked'); });
Deno.test('expired token denied', async () => { assertEquals((await call({ expired: true })).r.body.outcome, 'denied_token_expired'); });
Deno.test('global switch off denies', async () => { assertEquals((await call({ enabled: false })).r.body.outcome, 'denied_gateway_disabled'); });
Deno.test('killed agent denied', async () => { assertEquals((await call({ status: 'killed' })).r.body.outcome, 'denied_agent_killed'); });
Deno.test('no grant denied', async () => { assertEquals((await call({ noGrant: true })).r.body.outcome, 'denied_no_grant'); });
Deno.test('write without write scope denied', async () => {
  const { r } = await call({}, `Bearer ${TOKEN}`, { integration_id: IID, action: 'meta.adset.pause', scope: 'write' });
  assertEquals(r.body.outcome, 'denied_scope');
});
Deno.test('rate limit returns 429', async () => { const { r } = await call({ allowed: false }); assertEquals(r.status, 429); });
Deno.test('allowed call: secret stub not configured, nothing secret logged', async () => {
  const { r, logs } = await call({});
  assertEquals(r.body.outcome, 'allowed_secret_not_configured');
  const dump = JSON.stringify(logs) + JSON.stringify(r.body);
  assert(!dump.includes(TOKEN) && !dump.includes('Bearer') && !dump.includes('"a":1'));
});
