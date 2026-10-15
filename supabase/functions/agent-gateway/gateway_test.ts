import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handleGateway, sha256Hex } from './gateway.ts';
import { OnePasswordProvider, type SecretsProvider } from '../_shared/agent-secrets.ts';
import { ACTIONS, buildRequest, scrub } from './actions.ts';

const TOKEN = 'agw_secret_value_123';
const SECRET = 'EAAB-super-secret-meta-key';
const IID = '11111111-1111-1111-1111-111111111111';
const HID = '22222222-2222-2222-2222-222222222222';

const okSecrets: SecretsProvider = { name: 'fake', resolve: async () => ({ ok: true, value: SECRET }), check: async () => ({ token_present: true, reachable: true }) };
const noSecrets = new OnePasswordProvider(undefined, async () => { throw new Error('must not be called'); });

interface Opts {
  enabled?: boolean; status?: string; scopes?: string[]; allowed?: boolean; revoked?: boolean; expired?: boolean; noGrant?: boolean;
  provider?: string; hosts?: string[]; kind?: string; clientId?: string | null; ownerRole?: string; assigned?: boolean;
  browser?: boolean; handoffGrant?: boolean; handoff?: any; allowList?: string[] | null; integAccount?: string | null;
}
async function fakeDb(o: Opts = {}) {
  const hash = await sha256Hex(TOKEN);
  const logs: any[] = []; const rpcs: any[] = []; const writes: any[] = [];
  const rows: Record<string, any> = {
    agent_gateway_tokens: { id: 't1', agent_id: 'a1', token_hash: hash, revoked_at: o.revoked ? '2026-01-01' : null, expires_at: o.expired ? '2020-01-01' : '2099-01-01' },
    agent_gateway_settings: { gateway_enabled: o.enabled ?? true },
    agents: { id: 'a1', status: o.status ?? 'active', kind: o.kind ?? 'ai_agent', owner_team_member_id: 'tm1' },
    integrations: { id: IID, provider: o.provider ?? 'meta_ads', enabled: true, op_secret_ref: 'op://CPM Bot Vault/meta/key', account_ref: o.integAccount === undefined ? '123' : o.integAccount, allowed_hosts: o.hosts ?? ['graph.facebook.com'], client_id: o.clientId ?? null, is_browser_login: o.browser ?? false },
    agent_grants: o.noGrant ? null : { id: 'g1', scopes: o.scopes ?? ['read'], account_ref: null, rate_per_minute: 5, rate_per_day: 10, expires_at: null, revoked_at: null, allow_browser_handoff: o.handoffGrant ?? false, allowed_account_refs: o.allowList ?? null },
    team_members: { role: o.ownerRole ?? 'designer' },
    client_assignments: o.assigned ? { id: 'ca1' } : null,
    agent_handoff_requests: o.handoff ?? null,
  };
  const q = (t: string) => {
    const filters: [string, unknown][] = [];
    let mode = 'select'; let payload: any = null;
    const b: any = {
      select: () => b,
      update: (p: any) => { mode = 'update'; payload = p; return b; },
      eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
      maybeSingle: async () => {
        if (mode === 'insert') return { data: { id: HID } };
        if (mode === 'update') { writes.push([t, payload]); return { data: rows[t] ? { id: rows[t].id } : null }; }
        if (t === 'agent_gateway_tokens' && filters.some(([k, v]) => k === 'token_hash' && v !== hash)) return { data: null };
        return { data: rows[t] };
      },
      insert: (row: any) => {
        if (t === 'agent_access_log') { logs.push(row); return Promise.resolve({}); }
        mode = 'insert'; writes.push([t, row]); return b;
      },
      then: (f: any) => { if (mode === 'update') writes.push([t, payload]); return f({}); },
    };
    return b;
  };
  return { logs, rpcs, writes, db: { from: q, rpc: async (n: string, a: any) => { rpcs.push([n, a]); return { data: { allowed: o.allowed ?? true } }; } } };
}

const READ = { integration_id: IID, action: 'meta.insights.read', scope: 'read', params: { date_preset: 'yesterday' } };
async function call(o: Opts, opts: { auth?: string | null; body?: any; secrets?: SecretsProvider; upstream?: (u: string, i: any) => Response } = {}) {
  const f = await fakeDb(o);
  const seen: { url: string; init: any }[] = [];
  const fetchFn = (async (u: string, i: any) => { seen.push({ url: u, init: i }); return opts.upstream ? opts.upstream(u, i) : new Response(JSON.stringify({ data: [{ spend: '10' }] }), { status: 200 }); }) as any;
  const r = await handleGateway({ db: f.db, secrets: opts.secrets ?? okSecrets, fetch: fetchFn }, opts.auth === undefined ? `Bearer ${TOKEN}` : opts.auth, opts.body ?? READ);
  return { r, ...f, seen };
}
const noLeak = (x: unknown) => { const s = JSON.stringify(x); return !s.includes(TOKEN) && !s.includes(SECRET); };

// Authentication and switches
Deno.test('missing token denied and audited as denied', async () => { const { r, logs } = await call({}, { auth: null }); assertEquals(r.body.outcome, 'denied_no_token'); assertEquals(logs[0].event_type, 'denied'); });
Deno.test('wrong token denied', async () => { assertEquals((await call({}, { auth: 'Bearer nope' })).r.body.outcome, 'denied_bad_token'); });
Deno.test('revoked token denied', async () => { assertEquals((await call({ revoked: true })).r.body.outcome, 'denied_token_revoked'); });
Deno.test('expired token denied', async () => { assertEquals((await call({ expired: true })).r.body.outcome, 'denied_token_expired'); });
Deno.test('gateway off refused and logged', async () => { const { r, logs } = await call({ enabled: false }); assertEquals(r.body.outcome, 'denied_gateway_disabled'); assertEquals(logs[0].event_type, 'denied'); });
Deno.test('killed agent refused and logged', async () => { const { logs } = await call({ status: 'killed' }); assertEquals(logs[0].outcome, 'denied_agent_killed'); });
Deno.test('no grant denied', async () => { assertEquals((await call({ noGrant: true })).r.body.outcome, 'denied_no_grant'); });
Deno.test('rate limit returns 429 and is logged', async () => { const { r, logs } = await call({ allowed: false }); assertEquals(r.status, 429); assertEquals(logs[0].outcome, 'rate_limited'); });

// v1 rules
Deno.test('write refused while the writes switch is off, even with a write grant, and logged', async () => {
  const { r, logs, seen } = await call({ scopes: ['read', 'write'] }, { body: { integration_id: IID, action: 'meta.adset.pause', scope: 'write', target: 'adset_1' } });
  assertEquals(r.body.outcome, 'denied_writes_disabled'); assertEquals(logs[0].event_type, 'denied'); assertEquals(seen.length, 0);
});
Deno.test('slack integration refused', async () => { assertEquals((await call({ provider: 'slack_bot' })).r.body.outcome, 'denied_slack_excluded'); });
Deno.test('unknown action refused, never a raw URL', async () => {
  const { r, seen } = await call({}, { body: { ...READ, action: 'https.evil.com' } });
  assertEquals(r.body.outcome, 'denied_unknown_action'); assertEquals(seen.length, 0);
});
Deno.test('host not on the integration allowlist refused', async () => { assertEquals((await call({ hosts: ['example.com'] })).r.body.outcome, 'denied_host_not_allowed'); });
Deno.test('action for another provider refused', async () => { assertEquals((await call({}, { body: { ...READ, action: 'roku.accounts.read' } })).r.body.outcome, 'denied_action_provider_mismatch'); });
Deno.test('unknown param refused', async () => { assertEquals((await call({}, { body: { ...READ, params: { url: 'x' } } })).r.body.outcome, 'denied_bad_params'); });
Deno.test('teammate agent refused on an unassigned client', async () => { assertEquals((await call({ kind: 'teammate_agent', clientId: 'c1' })).r.body.outcome, 'denied_client_scope'); });
Deno.test('teammate agent allowed on an assigned client', async () => { assertEquals((await call({ kind: 'teammate_agent', clientId: 'c1', assigned: true })).r.body.outcome, 'ok'); });

// Secrets
Deno.test('secret not configured: refused, no upstream call, 1Password not touched', async () => {
  const { r, seen } = await call({}, { secrets: noSecrets }); assertEquals(r.body.outcome, 'secret_not_configured'); assertEquals(seen.length, 0);
});
Deno.test('1Password errors are never surfaced', async () => {
  const p = new OnePasswordProvider('tok', async () => ({ secrets: { resolve: async () => { throw new Error(`boom ${SECRET}`); } }, vaults: {} }));
  const res = await p.resolve('op://CPM Bot Vault/meta/key'); assertEquals(res, { ok: false, reason: 'unavailable' });
});
Deno.test('test connection reports reachability and resolution without values', async () => {
  const p = new OnePasswordProvider('tok', async () => ({ secrets: { resolve: async () => SECRET }, vaults: { list: async () => [{ id: 'v' }] } }));
  const res = await p.check('op://CPM Bot Vault/meta/key');
  assertEquals(res, { token_present: true, reachable: true, vault_count: 1, reference_resolves: true }); assert(noLeak(res));
});
Deno.test('test connection without a token says not configured', async () => { assertEquals((await noSecrets.check()).reason, 'not_configured'); });

// Successful read
Deno.test('successful read: no log row, daily count, secret only in the upstream request', async () => {
  const { r, logs, rpcs, seen } = await call({});
  assertEquals(r.body.outcome, 'ok'); assertEquals(logs.length, 0);
  assertEquals(rpcs.find(([n]) => n === 'agent_gateway_count_read')?.[1], { p_agent_id: 'a1', p_integration_id: IID, p_action: 'meta.insights.read' });
  assert(seen[0].url.startsWith('https://graph.facebook.com/v21.0/act_123/insights'));
  assert(noLeak(r.body));
});
Deno.test('secret echoed by upstream is scrubbed from the response', async () => {
  const { r, logs } = await call({}, { upstream: () => new Response(JSON.stringify({ error: `bad token ${SECRET}` }), { status: 400 }) });
  assertEquals(r.body.outcome, 'upstream_error'); assert(noLeak(r.body)); assert(noLeak(logs)); assertEquals(logs[0].detail, 'status 400');
});
Deno.test('callgrid uses bearer auth on its own host', () => {
  const b = buildRequest('callgrid.calls.read', ACTIONS['callgrid.calls.read'], { provider: 'callgrid', allowed_hosts: ['api.callgrid.com'] }, null, { startDate: '2026-10-01', endDate: '2026-10-02' }, SECRET);
  assert(b.ok && b.url.host === 'api.callgrid.com' && b.headers.Authorization === `Bearer ${SECRET}` && !b.url.toString().includes(SECRET));
});
Deno.test('scrub removes plain and URL-encoded secrets', () => { assertEquals(scrub(`a ${SECRET} b ${encodeURIComponent('x/y+z')}`, SECRET), 'a [redacted] b x%2Fy%2Bz'); });

// Browser hand-off
const HO_REQ = { integration_id: IID, handoff: 'request', reason: 'Need to check billing in Roku UI' };
Deno.test('hand-off refused on a non-browser account', async () => { assertEquals((await call({ handoffGrant: true }, { body: HO_REQ })).r.body.outcome, 'denied_not_browser_login'); });
Deno.test('hand-off refused without a hand-off grant', async () => { assertEquals((await call({ browser: true }, { body: HO_REQ })).r.body.outcome, 'denied_handoff_not_granted'); });
Deno.test('hand-off request creates a pending request and is logged', async () => {
  const { r, logs, writes } = await call({ browser: true, handoffGrant: true }, { body: HO_REQ });
  assertEquals(r.body.outcome, 'handoff_pending_approval'); assertEquals(logs[0].event_type, 'handoff');
  assert(writes.some(([t]) => t === 'agent_handoff_requests'));
});
Deno.test('hand-off redeem while pending returns nothing', async () => {
  const { r } = await call({ browser: true, handoffGrant: true, handoff: { id: HID, agent_id: 'a1', integration_id: IID, status: 'pending' } }, { body: { integration_id: IID, handoff: 'redeem', request_id: HID } });
  assertEquals(r.body.outcome, 'handoff_pending_approval'); assert(!('credential' in r.body));
});
Deno.test('approved hand-off redeems once and logs the approver', async () => {
  const { r, logs } = await call({ browser: true, handoffGrant: true, handoff: { id: HID, agent_id: 'a1', integration_id: IID, status: 'approved', approval_expires_at: '2099-01-01', decided_by_id: 'admin1' } }, { body: { integration_id: IID, handoff: 'redeem', request_id: HID } });
  assertEquals(r.body.outcome, 'handoff_redeemed'); assertEquals(logs[0].approved_by_id, 'admin1'); assert(noLeak(logs));
});
Deno.test('expired approval refused', async () => {
  const { r } = await call({ browser: true, handoffGrant: true, handoff: { id: HID, agent_id: 'a1', integration_id: IID, status: 'approved', approval_expires_at: '2020-01-01' } }, { body: { integration_id: IID, handoff: 'redeem', request_id: HID } });
  assertEquals(r.body.outcome, 'denied_handoff_expired');
});
Deno.test('denied hand-off refused', async () => {
  const { r } = await call({ browser: true, handoffGrant: true, handoff: { id: HID, agent_id: 'a1', integration_id: IID, status: 'denied' } }, { body: { integration_id: IID, handoff: 'redeem', request_id: HID } });
  assertEquals(r.body.outcome, 'denied_handoff_denied');
});

// Per-grant account allowlist
const withAcct = (account_id?: string) => ({ ...READ, params: { date_preset: 'yesterday', ...(account_id ? { account_id } : {}) } });
Deno.test('allowlist: listed account allowed and account_id not forwarded upstream', async () => {
  const { r, seen, logs } = await call({ allowList: ['111', '222'] }, { body: withAcct('222') });
  assertEquals(r.body.outcome, 'ok'); assert(seen[0].url.includes('/act_222/insights')); assert(!seen[0].url.includes('account_id')); assertEquals(logs.length, 0);
});
Deno.test('allowlist: account not in list refused 403, no upstream call', async () => {
  const { r, seen, logs } = await call({ allowList: ['111'] }, { body: withAcct('999') });
  assertEquals(r.status, 403); assertEquals(r.body.outcome, 'denied_account_not_allowed'); assertEquals(seen.length, 0);
  assert(!JSON.stringify(logs).includes('999'));
});
Deno.test('allowlist: missing account_id refused', async () => {
  const { r, seen } = await call({ allowList: ['111'] }, { body: withAcct() });
  assertEquals(r.body.outcome, 'denied_missing_account_ref'); assertEquals(seen.length, 0);
});
Deno.test('allowlist: act_ prefix is stripped', async () => {
  const { r, seen } = await call({ allowList: ['111'] }, { body: withAcct('act_111') });
  assertEquals(r.body.outcome, 'ok'); assert(seen[0].url.includes('/act_111/insights')); assert(!seen[0].url.includes('act_act_'));
});
Deno.test('allowlist: malformed account_id refused', async () => {
  assertEquals((await call({ allowList: ['111'] }, { body: withAcct('../x') })).r.body.outcome, 'denied_bad_params');
});
Deno.test('legacy account_ref: works without account_id', async () => {
  const { r, seen } = await call({}, { body: withAcct() }); assertEquals(r.body.outcome, 'ok'); assert(seen[0].url.includes('/act_123/'));
});
Deno.test('legacy account_ref: matching account_id accepted, differing refused', async () => {
  assertEquals((await call({}, { body: withAcct('act_123') })).r.body.outcome, 'ok');
  assertEquals((await call({}, { body: withAcct('456') })).r.body.outcome, 'denied_account_not_allowed');
});
Deno.test('no account_ref and no list: still denied_missing_account_ref', async () => {
  assertEquals((await call({ integAccount: null }, { body: withAcct() })).r.body.outcome, 'denied_missing_account_ref');
});
