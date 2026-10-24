// Person gateway keys (migration 0055): one key per person, each request names its acting bot.
// Mock DB answers by filter, so a lookup for the wrong bot returns that bot's rows, never the named one's.
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handleGateway, sha256Hex } from './gateway.ts';
import type { SecretsProvider } from '../_shared/agent-secrets.ts';

const PKEY = 'agp_test_person_key_value';
const AKEY = 'agw_test_agent_key_value';
const SECRET = 'EAAB-test-secret';
const IID = '11111111-1111-1111-1111-111111111111';
const A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const B = 'bbbbbbbb-0000-0000-0000-00000000000b';
const D = 'dddddddd-0000-0000-0000-00000000000d';
const P = 'tm-person-p';
const okSecrets: SecretsProvider = { name: 'fake', resolve: async () => ({ ok: true, value: SECRET }), check: async () => ({ token_present: true, reachable: true }) };

interface O { flag?: boolean; leaked?: boolean; holderActive?: boolean; holderService?: boolean; ownerA?: string; statusA?: string; keyAllowed?: boolean; allow?: string[] }
async function world(o: O = {}) {
  const ph = await sha256Hex(PKEY); const ah = await sha256Hex(AKEY);
  const tokens = [
    { id: 'tp', kind: 'person', agent_id: null, owner_team_member_id: P, token_hash: ph, revoked_at: null, expires_at: '2099-01-01', audience: 'gateway', leaked: o.leaked ?? false },
    { id: 'tb', kind: 'agent', agent_id: B, owner_team_member_id: null, token_hash: ah, revoked_at: null, expires_at: '2099-01-01', audience: 'gateway', leaked: false },
  ];
  const tables: Record<string, any[]> = {
    agent_gateway_tokens: tokens,
    agent_gateway_settings: [{ id: 1, gateway_enabled: true, person_keys_enabled: o.flag ?? true }],
    agent_gateway_token_agents: (o.allow ?? [A, B]).map((agent_id) => ({ token_id: 'tp', agent_id })),
    team_members: [{ id: P, is_active: o.holderActive ?? true, is_service_account: o.holderService ?? false, role: 'designer' }],
    agents: [
      { id: A, status: o.statusA ?? 'active', kind: 'ai_agent', owner_team_member_id: o.ownerA ?? P },
      { id: B, status: 'active', kind: 'ai_agent', owner_team_member_id: P },
      { id: D, status: 'active', kind: 'ai_agent', owner_team_member_id: P },
    ],
    integrations: [{ id: IID, provider: 'meta_ads', enabled: true, op_secret_ref: 'op://v/i/f', account_ref: '123', allowed_hosts: ['graph.facebook.com'], client_id: null, is_browser_login: false }],
    agent_grants: [
      { id: 'gA', agent_id: A, integration_id: IID, scopes: ['read'], account_ref: null, rate_per_minute: 5, rate_per_day: 10, expires_at: null, revoked_at: null, allow_browser_handoff: false, allowed_account_refs: null },
      { id: 'gB', agent_id: B, integration_id: IID, scopes: ['read'], account_ref: null, rate_per_minute: 7, rate_per_day: 70, expires_at: null, revoked_at: null, allow_browser_handoff: false, allowed_account_refs: null },
    ],
    agent_write_requests: [{ id: '99999999-9999-9999-9999-999999999999', agent_id: B, status: 'pending' }],
  };
  const logs: any[] = []; const rpcs: any[] = []; const queries: any[] = [];
  const from = (t: string) => {
    const f: [string, unknown][] = []; let mode = 'select';
    const pick = () => (tables[t] ?? []).find((r) => f.every(([k, v]) => r[k] === v)) ?? null;
    const b: any = {
      select: () => b, update: () => { mode = 'update'; return b; }, gte: () => b, in: () => b,
      eq: (k: string, v: unknown) => { f.push([k, v]); return b; },
      maybeSingle: async () => { queries.push([t, mode, [...f]]); return { data: mode === 'update' ? null : pick() }; },
      insert: (row: any) => { if (t === 'agent_access_log') logs.push(row); return Promise.resolve({}); },
      then: (res: any) => { queries.push([t, mode, [...f]]); return res({}); },
    };
    return b;
  };
  const rpc = async (n: string, a: any) => { rpcs.push([n, a]); if (n === 'agent_gateway_key_hit') return { data: { allowed: o.keyAllowed ?? true } }; return { data: { allowed: true } }; };
  return { db: { from, rpc }, logs, rpcs, queries };
}
const READ = { integration_id: IID, action: 'meta.insights.read', scope: 'read', params: { date_preset: 'yesterday' } };
async function go(o: O, key: string, header: string | null, body: any = READ) {
  const w = await world(o); const seen: string[] = [];
  const fetchFn = (async (u: string) => { seen.push(u); return new Response(JSON.stringify({ data: [] }), { status: 200 }); }) as any;
  const r = await handleGateway({ db: w.db, secrets: okSecrets, fetch: fetchFn }, `Bearer ${key}`, body, header);
  return { r, seen, ...w };
}
const noLeak = (x: unknown) => { const s = JSON.stringify(x); return !s.includes(PKEY) && !s.includes(AKEY) && !s.includes(SECRET); };

Deno.test('person key: refused while person_keys_enabled is OFF, nothing upstream', async () => {
  const { r, seen, logs } = await go({ flag: false }, PKEY, A);
  assertEquals(r.body.outcome, 'denied_person_keys_disabled'); assertEquals(seen.length, 0); assertEquals(logs[0].key_kind, 'person');
});
Deno.test('person key: acting bot is required, no default', async () => {
  const { r, seen } = await go({}, PKEY, null); assertEquals(r.status, 400); assertEquals(r.body.outcome, 'denied_agent_required'); assertEquals(seen.length, 0);
});
Deno.test('person key: bot not on the allowlist refused (default deny), even though the holder owns it', async () => {
  assertEquals((await go({}, PKEY, D)).r.body.outcome, 'denied_agent_not_allowlisted');
});
Deno.test('person key: allowlisted bot whose owner changed is refused live', async () => {
  assertEquals((await go({ ownerA: 'tm-someone-else' }, PKEY, A)).r.body.outcome, 'denied_agent_not_owned');
});
Deno.test('person key: offboarded holder (is_active false) refused', async () => {
  assertEquals((await go({ holderActive: false }, PKEY, A)).r.body.outcome, 'denied_key_holder_inactive');
});
Deno.test('person key: service-account holder refused', async () => {
  assertEquals((await go({ holderService: true }, PKEY, A)).r.body.outcome, 'denied_key_holder_inactive');
});
Deno.test('person key: leaked key refused', async () => {
  assertEquals((await go({ leaked: true }, PKEY, A)).r.body.outcome, 'denied_token_leaked');
});
Deno.test('person key: per-agent kill switch still applies', async () => {
  assertEquals((await go({ statusA: 'killed' }, PKEY, A)).r.body.outcome, 'denied_agent_killed');
});
Deno.test('person key: per-key rate limit refuses with 429', async () => {
  const { r } = await go({ keyAllowed: false }, PKEY, A); assertEquals(r.status, 429); assertEquals(r.body.outcome, 'key_rate_limited');
});
Deno.test('WRONG-BOT: request naming bot A uses only A\'s grant, A\'s limits and an audit row for A', async () => {
  const { r, rpcs, queries, logs } = await go({}, PKEY, A);
  assertEquals(r.body.outcome, 'ok');
  const grantQ = queries.find(([t]) => t === 'agent_grants');
  assertEquals(grantQ[2].find(([k]: any) => k === 'agent_id')[1], A);
  const hit = rpcs.find(([n]) => n === 'agent_gateway_hit');
  assertEquals(hit[1], { p_grant_id: 'gA', p_per_minute: 5, p_per_day: 10 });
  assert(rpcs.some(([n, a]) => n === 'agent_gateway_key_hit' && a.p_token_id === 'tp'));
  const cnt = rpcs.find(([n]) => n === 'agent_gateway_count_read'); assertEquals(cnt[1].p_agent_id, A);
  assert(!JSON.stringify(rpcs).includes(B) && !JSON.stringify(rpcs).includes('gB'), 'bot B never touched');
  const agentQ = queries.filter(([t]) => t === 'agents').map(([, , f]) => f.find(([k]: any) => k === 'id')[1]);
  assertEquals(agentQ, [A]);
  for (const l of logs) { assertEquals(l.agent_id, A); assertEquals(l.acting_agent_id, A); assertEquals(l.key_kind, 'person'); assertEquals(l.key_owner_team_member_id, P); }
  assert(noLeak({ r, rpcs, logs }));
});
Deno.test('WRONG-BOT: same key naming bot B uses B\'s grant and limits', async () => {
  const { rpcs } = await go({}, PKEY, B);
  assertEquals(rpcs.find(([n]) => n === 'agent_gateway_hit')[1], { p_grant_id: 'gB', p_per_minute: 7, p_per_day: 70 });
});
Deno.test('WRONG-BOT: denial for an unlisted bot is audited against the named bot and the person key', async () => {
  const { logs } = await go({}, PKEY, D);
  assertEquals(logs[0].agent_id, D); assertEquals(logs[0].token_id, 'tp'); assertEquals(logs[0].key_owner_team_member_id, P); assertEquals(logs[0].outcome, 'denied_agent_not_allowlisted');
});
Deno.test('WRONG-BOT: acting as A cannot read bot B\'s write request', async () => {
  const { r } = await go({}, PKEY, A, { integration_id: IID, write: 'status', request_id: '99999999-9999-9999-9999-999999999999' });
  assertEquals(r.body.outcome, 'denied_write_unknown');
});
Deno.test('header and body acting_agent_id must agree', async () => {
  assertEquals((await go({}, PKEY, A, { ...READ, acting_agent_id: B })).r.body.outcome, 'denied_agent_mismatch');
});
Deno.test('body acting_agent_id alone is accepted', async () => {
  assertEquals((await go({}, PKEY, null, { ...READ, acting_agent_id: A })).r.body.outcome, 'ok');
});
Deno.test('malformed X-CPM-Agent refused', async () => {
  assertEquals((await go({}, PKEY, 'not-a-uuid')).r.body.outcome, 'denied_bad_request');
});
Deno.test('per-agent key: naming another bot refused', async () => {
  assertEquals((await go({}, AKEY, A)).r.body.outcome, 'denied_agent_mismatch');
});
Deno.test('per-agent key: naming its own bot, or nothing, works as before (dual-run) and never calls the key limiter', async () => {
  const a = await go({}, AKEY, B); assertEquals(a.r.body.outcome, 'ok'); assert(!a.rpcs.some(([n]) => n === 'agent_gateway_key_hit'));
  const b = await go({ flag: false }, AKEY, null); assertEquals(b.r.body.outcome, 'ok');
  assertEquals(b.rpcs.find(([n]) => n === 'agent_gateway_hit')[1].p_grant_id, 'gB');
});
