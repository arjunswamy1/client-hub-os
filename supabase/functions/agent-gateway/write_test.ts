import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handleGateway, sha256Hex } from './gateway.ts';
import type { SecretsProvider } from '../_shared/agent-secrets.ts';
import { WRITE_ACTIONS, metaPost, parseWriteParams, planChange, settingsFrom, decisionAuthority, hasAdsManagement, snapshot } from '../_shared/agent-write-actions.ts';
import { executeWrite } from '../_shared/agent-write-flow.ts';

const TOKEN = 'agw_write_token_abc';
const SECRET = 'EAAB-meta-system-user-secret';
const IID = '55694453-95b2-4c49-829b-517a50952d7b';
const AJ = '1fdd684e-6cb7-447e-b616-7e1b9c598971';
const CHARLES = '014fa04a-80a5-41ce-9368-d1a81f6d2eec';
const secrets: SecretsProvider = { name: 'fake', resolve: async () => ({ ok: true, value: SECRET }), check: async () => ({ token_present: true, reachable: true }) };
const S = settingsFrom({ writes_enabled: true, write_approver_team_member_ids: [AJ, CHARLES] });

// ---------- In-memory database ----------
function memDb(tables: Record<string, any[]>) {
  let seq = 0;
  const from = (t: string) => {
    tables[t] ??= [];
    const f: ((r: any) => boolean)[] = [];
    let mode: 'select' | 'insert' | 'update' = 'select'; let payload: any; let head = false; let wantCount = false;
    const rows = () => tables[t].filter((r) => f.every((p) => p(r)));
    const exec = () => {
      if (mode === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map((r: any) => ({ id: r.id ?? `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, status: 'pending', ...r }));
        tables[t].push(...list); return { data: list, error: null };
      }
      if (mode === 'update') { const m = rows(); m.forEach((r) => Object.assign(r, payload)); return { data: m.map((r) => ({ ...r })), error: null }; }
      const m = rows(); return { data: head ? null : m.map((r) => ({ ...r })), count: wantCount ? m.length : null, error: null };
    };
    const b: any = {
      select: (_c?: string, o?: any) => { if (o?.count) wantCount = true; if (o?.head) head = true; return b; },
      insert: (p: any) => { mode = 'insert'; payload = p; return b; },
      update: (p: any) => { mode = 'update'; payload = p; return b; },
      eq: (k: string, v: any) => { f.push((r) => r[k] === v); return b; },
      in: (k: string, v: any[]) => { f.push((r) => v.includes(r[k])); return b; },
      gte: (k: string, v: any) => { f.push((r) => r[k] >= v); return b; },
      gt: (k: string, v: any) => { f.push((r) => r[k] > v); return b; },
      order: () => b, limit: () => b,
      maybeSingle: async () => { const r = exec(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }; },
      then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
    };
    return b;
  };
  return { from, rpc: async () => ({ data: { allowed: true } }), tables };
}

interface Opts { writes?: boolean; scopes?: string[]; allow?: string[] | null; perDay?: number; owner?: string }
async function world(o: Opts = {}) {
  const tables: Record<string, any[]> = {
    agent_gateway_tokens: [{ id: 't1', agent_id: 'a1', token_hash: await sha256Hex(TOKEN), expires_at: '2099-01-01', revoked_at: null, audience: 'gateway' }],
    agent_gateway_settings: [{ id: 1, gateway_enabled: true, writes_enabled: o.writes ?? true, write_approver_team_member_ids: [AJ, CHARLES], write_requests_per_day: o.perDay ?? 20 }],
    agents: [{ id: 'a1', status: 'active', kind: 'ai_agent', owner_team_member_id: o.owner ?? 'juan' }],
    integrations: [{ id: IID, provider: 'meta_ads', enabled: true, op_secret_ref: 'op://shared/meta/key', account_ref: null, allowed_hosts: ['graph.facebook.com'], client_id: null, is_browser_login: false }],
    agent_grants: [{ id: 'g1', agent_id: 'a1', integration_id: IID, scopes: o.scopes ?? ['read', 'write'], rate_per_minute: 30, rate_per_day: 2000, allowed_account_refs: o.allow === undefined ? ['111'] : o.allow }],
    agent_write_requests: [], agent_access_log: [], notifications: [],
  };
  return memDb(tables);
}

// ---------- Fake Meta ----------
function meta(state: { adset?: any; campaign?: any; ad?: any; account?: any; perms?: string[] | null } = {}) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const st = {
    adset: { id: '555', name: 'FE Adset', account_id: '111', status: 'ACTIVE', daily_budget: '10000', ...state.adset },
    campaign: { id: '777', name: 'FE Campaign', account_id: '111', status: 'ACTIVE', daily_budget: '20000', ...state.campaign },
    ad: { id: '999', name: 'FE Ad', account_id: '111', status: 'ACTIVE', ...state.ad },
    account: { name: 'Juan Acct', currency: 'USD', ...state.account },
    perms: state.perms === undefined ? ['ads_management', 'ads_read'] : state.perms,
  };
  const fn = (async (u: string, init: any) => {
    const url = new URL(u); const method = init?.method ?? 'GET';
    calls.push({ method, url: u, body: init?.body?.toString() });
    const j = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s });
    if (method === 'POST') {
      if (url.pathname.endsWith('/copies')) return j({ copied_campaign_id: '888' });
      const id = url.pathname.split('/').pop()!; const p = new URLSearchParams(init.body.toString());
      const obj = [st.adset, st.campaign, st.ad].find((x) => x.id === id);
      if (p.get('status')) obj.status = p.get('status'); if (p.get('daily_budget')) obj.daily_budget = p.get('daily_budget');
      return j({ success: true });
    }
    if (url.pathname.endsWith('/me/permissions')) return st.perms === null ? j({ error: 'x' }, 400) : j({ data: st.perms.map((permission) => ({ permission, status: 'granted' })) });
    if (url.pathname.includes('/act_')) return j(st.account);
    const id = url.pathname.split('/').pop();
    const obj = [st.adset, st.campaign, st.ad].find((x) => x.id === id);
    if (!obj) return j({ error: { message: 'not found' } }, 400);
    return j(id === '555' ? { ...obj, campaign: { id: '777', name: 'FE Campaign' } } : obj);
  }) as any;
  return { fn, calls, st, posts: () => calls.filter((c) => c.method === 'POST') };
}

const budgetReq = (usd: number | string = 120, extra: Record<string, unknown> = {}) => ({
  integration_id: IID, scope: 'write', action: 'meta.adset.update_budget', reason: 'scale winning ad set',
  params: { account_id: 'act_111', object_id: '555', new_daily_budget_usd: usd, ...extra },
});
const call = (db: any, m: any, body: any, now = new Date('2026-10-15T13:00:00Z')) =>
  handleGateway({ db, secrets, fetch: m.fn, now: () => now }, `Bearer ${TOKEN}`, body);
const noLeak = (x: unknown) => !JSON.stringify(x).includes(SECRET) && !JSON.stringify(x).includes(TOKEN);

// Approve as the SQL function would (authority rule tested separately).
const approve = (db: any, id: string, at = '2026-10-15T13:05:00Z', ttlMin = 30) => {
  const r = db.tables.agent_write_requests.find((x: any) => x.id === id);
  Object.assign(r, { status: 'approved', decided_by_id: AJ, decided_at: at, approval_expires_at: new Date(new Date(at).getTime() + ttlMin * 60000).toISOString() });
};

// ---------- Actions ----------
Deno.test('nine write actions, no delete/create/spend-cap/billing names', () => {
  assertEquals(Object.keys(WRITE_ACTIONS).length, 9);
  assert(!Object.keys(WRITE_ACTIONS).some((k) => /delete|create|spend_cap|billing|creative/.test(k)));
});
for (const [name, def] of Object.entries(WRITE_ACTIONS)) {
  Deno.test(`metaPost builds ${name}`, () => {
    const after = def.kind === 'status' ? { status: def.to } : def.kind === 'budget' ? { daily_budget: 15000 } : {};
    const p = metaPost(def, '123', after, SECRET);
    assert(p.url.startsWith('https://graph.facebook.com/v21.0/123')); assert(!p.url.includes(SECRET));
    if (def.kind === 'status') assertEquals(p.body.get('status'), def.to);
    if (def.kind === 'budget') assertEquals(p.body.get('daily_budget'), '15000');
    if (def.kind === 'duplicate') { assert(p.url.endsWith('/123/copies')); assertEquals(p.body.get('status_option'), 'PAUSED'); assertEquals(p.body.get('deep_copy'), 'true'); }
  });
}
Deno.test('unknown write action refused, no Meta call', async () => {
  const db = await world(); const m = meta();
  const r = await call(db, m, { ...budgetReq(), action: 'meta.campaign.delete' });
  assertEquals(r.body.outcome, 'denied_unknown_action'); assertEquals(m.calls.length, 0);
});
Deno.test('unknown param refused', () => {
  const r = parseWriteParams(WRITE_ACTIONS['meta.ad.pause'], { account_id: '1', object_id: '2', spend_cap: '9' });
  assertEquals(r.ok, false);
});

// ---------- Switches and scope ----------
Deno.test('writes switch off: refused and logged, reads unaffected', async () => {
  const db = await world({ writes: false }); const m = meta();
  const r = await call(db, m, budgetReq());
  assertEquals(r.body.outcome, 'denied_writes_disabled'); assertEquals(db.tables.agent_access_log[0].event_type, 'denied'); assertEquals(m.calls.length, 0);
});
Deno.test("grant without 'write' scope refused", async () => {
  const db = await world({ scopes: ['read'] }); assertEquals((await call(db, meta(), budgetReq())).body.outcome, 'denied_scope');
});

// ---------- Allowlist and ownership ----------
Deno.test('account not on the allowlist refused', async () => {
  const db = await world({ allow: ['222'] }); const m = meta();
  assertEquals((await call(db, m, budgetReq())).body.outcome, 'denied_account_not_allowed'); assertEquals(m.calls.length, 0);
});
Deno.test('empty allowlist refuses writes', async () => {
  const db = await world({ allow: null }); assertEquals((await call(db, meta(), budgetReq())).body.outcome, 'denied_account_not_allowed');
});
Deno.test('object owned by another account (per Meta) refused', async () => {
  const db = await world(); const m = meta({ adset: { account_id: '999' } });
  assertEquals((await call(db, m, budgetReq())).body.outcome, 'denied_object_not_in_account');
  assertEquals(db.tables.agent_write_requests.length, 0);
});

// ---------- Budget caps ----------
const snap = (o: any = {}) => snapshot({ account_id: '111', name: 'x', status: 'ACTIVE', daily_budget: '10000', ...o });
const plan = (usd: number, o: any = {}, acct: any = { currency: 'USD' }, s = S) =>
  planChange(WRITE_ACTIONS['meta.adset.update_budget'], '555', snap(o), acct, { account_id: '111', object_id: '555', new_cents: Math.round(usd * 100) }, s);
Deno.test('budget: +50% and -50% allowed, +51% and -51% refused', () => {
  assert(plan(150).ok); assert(plan(50).ok);
  assertEquals((plan(151) as any).outcome, 'denied_budget_change_too_large'); assertEquals((plan(49) as any).outcome, 'denied_budget_change_too_large');
});
Deno.test('budget: $1,000 cap exact allowed, above refused', () => {
  assert(plan(1000, { daily_budget: '80000' }).ok);
  assertEquals((plan(1000.01, { daily_budget: '80000' }) as any).outcome, 'denied_budget_over_cap');
});
Deno.test('budget: caps come from settings', () => {
  const s = settingsFrom({ write_max_budget_change_pct: 10, write_max_daily_budget_usd: 105 });
  assertEquals((plan(111, {}, { currency: 'USD' }, s) as any).outcome, 'denied_budget_over_cap');
  assertEquals((plan(104, {}, { currency: 'USD' }, settingsFrom({ write_max_budget_change_pct: 3 })) as any).outcome, 'denied_budget_change_too_large');
});
Deno.test('budget: zero/negative/bad amounts refused', () => {
  for (const v of [0, -5, 'abc', '1.234']) assertEquals(parseWriteParams(WRITE_ACTIONS['meta.adset.update_budget'], { account_id: '111', object_id: '5', new_daily_budget_usd: v }).ok, false);
});
Deno.test('budget: non-USD account refused', () => { assertEquals((plan(120, {}, { currency: 'EUR' }) as any).outcome, 'denied_non_usd_account'); });
Deno.test('budget: ad set under a CBO campaign refused', () => { assertEquals((plan(120, { campaign: { daily_budget: '50000' } }) as any).outcome, 'denied_cbo_campaign'); });
Deno.test('budget: lifetime budget refused', () => { assertEquals((plan(120, { daily_budget: null, lifetime_budget: '900000' }) as any).outcome, 'denied_budget_not_on_object'); });

// ---------- Rate limit ----------
Deno.test('21st write request in a day refused with 429', async () => {
  const db = await world({ perDay: 20 });
  for (let k = 0; k < 20; k++) db.tables.agent_write_requests.push({ id: `r${k}`, agent_id: 'a1', action: 'x', object_id: String(k), status: 'denied', requested_at: '2026-10-15T01:00:00.000Z' });
  const r = await call(db, meta(), budgetReq()); assertEquals(r.status, 429); assertEquals(r.body.outcome, 'write_rate_limited');
});

// ---------- Request -> approve -> execute ----------
Deno.test('write request returns 202 with a live diff, notifies approvers except the owner, no Meta write', async () => {
  const db = await world({ owner: CHARLES }); const m = meta();
  const r = await call(db, m, budgetReq(120));
  assertEquals(r.status, 202); assertEquals(r.body.outcome, 'write_pending_approval');
  assertEquals(r.body.diff, 'Account Juan Acct (act_111) · Ad set "FE Adset" (555): daily_budget $100.00 → $120.00');
  assertEquals(m.posts().length, 0);
  assertEquals(db.tables.notifications.map((n: any) => n.recipient_id), [AJ]);
  assertEquals(db.tables.agent_access_log.at(-1).outcome, 'write_requested'); assert(noLeak(r.body)); assert(noLeak(db.tables));
});
Deno.test('repeat request for the same object returns the open request', async () => {
  const db = await world(); const m = meta();
  const a = await call(db, m, budgetReq(120)); const b = await call(db, m, budgetReq(130));
  assertEquals(b.body.request_id, a.body.request_id); assertEquals(b.body.duplicate, true);
});
Deno.test('status poll while pending: no execution, not rate limited', async () => {
  const db = await world(); const m = meta();
  const a = await call(db, m, budgetReq(120));
  const s = await call(db, m, { integration_id: IID, write: 'status', request_id: a.body.request_id });
  assertEquals(s.body.status, 'pending'); assertEquals(m.posts().length, 0);
});
Deno.test('approved request executes exactly once on poll', async () => {
  const db = await world(); const m = meta();
  const a = await call(db, m, budgetReq(120)); approve(db, a.body.request_id as string);
  const t = new Date('2026-10-15T13:10:00Z');
  const s1 = await call(db, m, { integration_id: IID, write: 'status', request_id: a.body.request_id }, t);
  const s2 = await call(db, m, { integration_id: IID, write: 'status', request_id: a.body.request_id }, t);
  assertEquals(s1.body.status, 'executed'); assertEquals(s2.body.status, 'executed'); assertEquals(m.posts().length, 1);
  assertEquals(m.st.adset.daily_budget, '12000');
  assert(db.tables.agent_access_log.some((l: any) => l.outcome === 'write_executed' && l.approved_by_id === AJ)); assert(noLeak(s1.body)); assert(noLeak(db.tables));
});
Deno.test('concurrent executions make one Meta write', async () => {
  const db = await world(); const m = meta();
  const a = await call(db, m, budgetReq(120)); approve(db, a.body.request_id as string);
  const d = { db, secrets, fetch: m.fn, now: new Date('2026-10-15T13:10:00Z'), settings: S };
  await Promise.all([executeWrite(d, a.body.request_id as string), executeWrite(d, a.body.request_id as string)]);
  assertEquals(m.posts().length, 1);
});
Deno.test('duplicate executes as a paused deep copy and returns the new id', async () => {
  const db = await world(); const m = meta();
  const a = await call(db, m, { integration_id: IID, scope: 'write', action: 'meta.campaign.duplicate', reason: 'test new angle', params: { account_id: '111', object_id: '777' } });
  approve(db, a.body.request_id as string);
  const s = await call(db, m, { integration_id: IID, write: 'status', request_id: a.body.request_id }, new Date('2026-10-15T13:10:00Z'));
  assertEquals(s.body.status, 'executed'); assertEquals((s.body.result as any).new_campaign_id, '888');
});

// ---------- Expiry ----------
Deno.test('pending request expires after 24h and never executes', async () => {
  const db = await world(); const m = meta();
  const a = await call(db, m, budgetReq(120));
  const s = await call(db, m, { integration_id: IID, write: 'status', request_id: a.body.request_id }, new Date('2026-10-16T13:00:01Z'));
  assertEquals(s.body.status, 'expired'); assert(db.tables.agent_access_log.some((l: any) => l.outcome === 'write_expired'));
});
Deno.test('approved request expires 30 minutes after approval, no Meta write', async () => {
  const db = await world(); const m = meta();
  const a = await call(db, m, budgetReq(120)); approve(db, a.body.request_id as string);
  const s = await call(db, m, { integration_id: IID, write: 'status', request_id: a.body.request_id }, new Date('2026-10-15T13:35:01Z'));
  assertEquals(s.body.status, 'expired'); assertEquals(m.posts().length, 0);
});
Deno.test('approved but writes switched off: not executed', async () => {
  const db = await world(); const m = meta();
  const a = await call(db, m, budgetReq(120)); approve(db, a.body.request_id as string);
  db.tables.agent_gateway_settings[0].writes_enabled = false;
  const s = await call(db, m, { integration_id: IID, write: 'status', request_id: a.body.request_id }, new Date('2026-10-15T13:10:00Z'));
  assertEquals(s.body.status, 'approved'); assertEquals(m.posts().length, 0);
});

// ---------- Drift and permission ----------
Deno.test('drift: budget changed since request -> failed_drift, no Meta write', async () => {
  const db = await world(); const m = meta();
  const a = await call(db, m, budgetReq(120)); approve(db, a.body.request_id as string);
  m.st.adset.daily_budget = '11000';
  const s = await call(db, m, { integration_id: IID, write: 'status', request_id: a.body.request_id }, new Date('2026-10-15T13:10:00Z'));
  assertEquals(s.body.status, 'failed'); assertEquals(s.body.failure_outcome, 'failed_drift'); assertEquals(m.posts().length, 0);
});
Deno.test('token without ads_management -> failed_missing_ads_management, no write', async () => {
  const db = await world(); const m = meta({ perms: ['ads_read'] });
  const a = await call(db, m, budgetReq(120)); approve(db, a.body.request_id as string);
  const s = await call(db, m, { integration_id: IID, write: 'status', request_id: a.body.request_id }, new Date('2026-10-15T13:10:00Z'));
  assertEquals(s.body.failure_outcome, 'failed_missing_ads_management'); assertEquals(m.posts().length, 0);
});
Deno.test('write scope removed after approval -> failed_grant_changed', async () => {
  const db = await world(); const m = meta();
  const a = await call(db, m, budgetReq(120)); approve(db, a.body.request_id as string);
  db.tables.agent_grants[0].scopes = ['read'];
  const s = await call(db, m, { integration_id: IID, write: 'status', request_id: a.body.request_id }, new Date('2026-10-15T13:10:00Z'));
  assertEquals(s.body.failure_outcome, 'failed_grant_changed');
});
Deno.test('hasAdsManagement reads Meta permission lists', () => {
  assertEquals(hasAdsManagement({ data: [{ permission: 'ads_management', status: 'granted' }] }), true);
  assertEquals(hasAdsManagement({ data: [{ permission: 'ads_management', status: 'declined' }] }), false);
  assertEquals(hasAdsManagement({ error: {} }), null);
});

// ---------- Approval authority ----------
Deno.test('only listed approvers may decide; owners never decide their own agent', () => {
  assertEquals(decisionAuthority(AJ, [AJ, CHARLES], 'juan'), 'ok');
  assertEquals(decisionAuthority(CHARLES, [AJ, CHARLES], 'juan'), 'ok');
  assertEquals(decisionAuthority(CHARLES, [AJ, CHARLES], CHARLES), 'denied_self_approval');
  assertEquals(decisionAuthority('other-admin', [AJ, CHARLES], 'juan'), 'not_write_approver');
  assertEquals(decisionAuthority(null, [AJ, CHARLES], 'juan'), 'not_write_approver');
});
Deno.test('status poll for another agent\'s request is refused', async () => {
  const db = await world(); db.tables.agent_write_requests.push({ id: '00000000-0000-4000-8000-00000000abcd', agent_id: 'other', status: 'pending' });
  assertEquals((await call(db, meta(), { integration_id: IID, write: 'status', request_id: '00000000-0000-4000-8000-00000000abcd' })).body.outcome, 'denied_write_unknown');
});
