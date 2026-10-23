import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handleGateway, sha256Hex } from './gateway.ts';
import { executeWrite } from '../_shared/agent-write-flow.ts';
import { settingsFrom } from '../_shared/agent-write-actions.ts';
import type { SecretsProvider } from '../_shared/agent-secrets.ts';

const IID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-23T15:00:00Z');
const key = 'mock-gateway-key';
function mockDb(tables: Record<string, any[]>) {
  const calls: string[] = [];
  const from = (table: string) => {
    tables[table] ??= [];
    const filters: ((r: any) => boolean)[] = [];
    let mode = 'select', payload: any, ignore = false, conflict: string[] = [];
    const run = () => {
      calls.push(table);
      let rows = tables[table].filter((r) => filters.every((f) => f(r)));
      if (mode === 'delete') { tables[table] = tables[table].filter((r) => !rows.includes(r)); return { data: rows, error: null }; }
      if (mode === 'update') rows.forEach((r) => Object.assign(r, payload));
      if (mode === 'insert' || mode === 'upsert') {
        rows = [];
        for (const p of Array.isArray(payload) ? payload : [payload]) {
          const existing = mode === 'upsert' ? tables[table].find((r) => conflict.every((k) => r[k] === p[k])) : null;
          if (existing && ignore) continue;
          if (existing) { Object.assign(existing, p); rows.push(existing); }
          else { const r = { id: `row-${tables[table].length}`, ...p }; tables[table].push(r); rows.push(r); }
        }
      }
      return { data: rows, error: null, count: rows.length };
    };
    const q: any = {
      select: () => q, eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
      in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
      gt: (k: string, v: any) => { filters.push((r) => r[k] > v); return q; },
      gte: (k: string, v: any) => { filters.push((r) => r[k] >= v); return q; },
      insert: (p: any) => { payload = p; mode = 'insert'; return q; },
      upsert: (p: any, o: any) => { payload = p; mode = 'upsert'; ignore = o?.ignoreDuplicates; conflict = o.onConflict.split(','); return q; },
      update: (p: any) => { payload = p; mode = 'update'; return q; }, delete: () => { mode = 'delete'; return q; },
      maybeSingle: async () => { const r = run(); return { ...r, data: r.data[0] ?? null }; },
      then: (yes: any, no: any) => Promise.resolve(run()).then(yes, no),
    }; return q;
  };
  return { from, tables, calls, rpc: async (name: string, args: any) => {
    if (name === 'agent_gateway_write_owner') return { data: 'aj', error: null };
    if (name === 'agent_write_request_create') {
      const row = { ...args.p_row, id: 'request-1', status: 'pending', token_created_by_id: 'aj' };
      (tables.agent_write_requests ??= []).push(row);
      return { data: { ok: true, id: row.id, token_created_by_id: 'aj' } };
    }
    return { data: { allowed: true } };
  } };
}
async function world() {
  const tables: Record<string, any[]> = {
    agent_gateway_tokens: [{ id: 'key1', agent_id: 'agent1', token_hash: await sha256Hex(key), expires_at: '2099-01-01', audience: 'gateway' }],
    agent_gateway_settings: [{ id: 1, gateway_enabled: true, writes_enabled: true, write_approver_team_member_ids: ['aj'] }],
    agents: [{ id: 'agent1', status: 'active', kind: 'ai_agent', owner_team_member_id: 'juan' }],
    integrations: [{ id: IID, provider: 'meta_ads', enabled: true, allowed_hosts: ['graph.facebook.com'], op_secret_ref: 'op://shared/mock/key' }],
    agent_grants: [{ id: 'grant1', agent_id: 'agent1', integration_id: IID, all_accounts: true, expires_at: '2026-12-01', scopes: ['read', 'write'], allowed_account_refs: [], rate_per_minute: 30, rate_per_day: 100 }],
    gateway_cache_epoch: [{ id: 1, epoch: 0 }], platform_connections: [], agent_write_requests: [], notifications: [],
  };
  const db = mockDb(tables);
  let secretValue = 'mock-meta-secret', visible = ['111'], fail: string | null = null;
  const network: string[] = [];
  const secrets: SecretsProvider = { name: 'mock', resolve: async () => ({ ok: true, value: secretValue }), check: async () => ({ token_present: true }) };
  const doFetch: typeof fetch = async (u) => {
    const path = new URL(String(u)).pathname; network.push(path);
    if (path.endsWith('/me/adaccounts')) {
      if (fail === 'network') throw new Error('mock network');
      if (fail === '190') return Response.json({ error: { code: 190 } }, { status: 400 });
      if (fail === '500') return Response.json({ error: {} }, { status: 500 });
      if (fail === 'host') return Response.json({ data: [{ account_id: '111' }], paging: { next: 'https://evil.example/me/adaccounts' } });
      return Response.json({ data: visible.map((account_id) => ({ account_id })) });
    }
    if (path.endsWith('/555')) return Response.json({ id: '555', name: 'Mock campaign', account_id: '111', status: 'ACTIVE', daily_budget: '10000' });
    if (path.endsWith('/permissions')) return Response.json({ data: [{ permission: 'ads_management', status: 'granted' }] });
    return Response.json({ name: 'Mock account', currency: 'USD' });
  };
  const call = (params: any = { account_id: 'act_111' }, write = false) => handleGateway({ db, secrets, fetch: doFetch, now: () => NOW }, `Bearer ${key}`, { integration_id: IID, action: write ? 'meta.campaign.pause' : 'meta.account.read', scope: write ? 'write' : 'read', reason: 'Pause requested by operator', params: write ? { ...params, object_id: '555' } : params });
  return { db, tables, network, call, secrets, doFetch, rotate: () => { secretValue = 'rotated-mock-secret'; }, fail: (v: string) => { fail = v; }, visible: (v: string[]) => { visible = v; } };
}
Deno.test('all_accounts: visible account allowed, unmapped read labelled and audit metadata recorded', async () => {
  const w = await world(); const r = await w.call(); assertEquals(r.body.account_label, 'UNMAPPED'); assertEquals(r.body.account_mapping, 'unmapped');
  assertEquals(w.tables.agent_access_log[0].grant_mode, 'all_accounts'); assertEquals(w.tables.agent_access_log[0].resolved_account_id, '111');
  assert(!JSON.stringify(w.tables).includes('mock-meta-secret')); assert(!JSON.stringify(r).includes('mock-meta-secret'));
});
Deno.test('all_accounts: nonvisible denied', async () => { const w = await world(); assertEquals((await w.call({ account_id: '222' })).body.outcome, 'denied_account_not_allowed'); });
Deno.test('all_accounts: global block beats warm visible cache', async () => { const w = await world(); await w.call(); w.tables.gateway_account_blocklist.push({ account_id: '111', integration_id: null }); assertEquals((await w.call()).body.outcome, 'denied_account_blocklisted'); assertEquals(w.network.filter((p) => p.endsWith('/me/adaccounts')).length, 1); });
Deno.test('all_accounts: integration block scoped correctly', async () => { const w = await world(); w.tables.gateway_account_blocklist = [{ account_id: '111', integration_id: 'other' }]; assertEquals((await w.call()).body.outcome, 'ok'); w.tables.gateway_account_blocklist.push({ account_id: '111', integration_id: IID }); assertEquals((await w.call()).body.outcome, 'denied_account_blocklisted'); });
Deno.test('all_accounts: token rotation refetches and deletes old fingerprint', async () => { const w = await world(); await w.call(); w.rotate(); await w.call(); assertEquals(w.network.filter((p) => p.endsWith('/me/adaccounts')).length, 2); assertEquals(w.tables.gateway_visible_accounts_cache.length, 1); });
Deno.test('all_accounts: epoch change refetches', async () => { const w = await world(); await w.call(); w.tables.gateway_cache_epoch[0].epoch++; await w.call(); assertEquals(w.network.filter((p) => p.endsWith('/me/adaccounts')).length, 2); });
for (const failure of ['network', '500', 'host']) Deno.test(`all_accounts: ${failure} fails closed`, async () => { const w = await world(); w.fail(failure); assertEquals((await w.call()).body.outcome, 'denied_account_lookup_failed'); });
Deno.test('all_accounts: empty visible set fails closed', async () => { const w = await world(); w.visible([]); assertEquals((await w.call()).body.outcome, 'denied_account_lookup_failed'); });
Deno.test('all_accounts: code 190 alerts exactly once across two calls in Los Angeles day', async () => { const w = await world(); w.fail('190'); for (let i = 0; i < 2; i++) assertEquals((await w.call()).body.outcome, 'denied_account_lookup_failed'); assertEquals(w.tables.gateway_token_expired_alerts.length, 1); assertEquals(w.tables.gateway_token_expired_alerts[0].alert_day, '2026-10-23'); assertEquals(w.tables.notifications.filter((n) => n.type === 'agent_gateway_token_expired').length, 1); });
Deno.test('all_accounts: unmapped write row and notification labelled, alert once', async () => { const w = await world(); const r = await w.call(undefined, true); assertEquals(r.body.account_label, 'UNMAPPED'); assertEquals(w.tables.agent_write_requests[0].account_label, 'UNMAPPED'); assert(w.tables.notifications.find((n) => n.type === 'agent_write_request')?.message.startsWith('[UNMAPPED] ')); w.tables.agent_write_requests = []; await w.call(undefined, true); assertEquals(w.tables.gateway_unmapped_account_alerts.length, 1); assertEquals(w.tables.notifications.filter((n) => n.type === 'agent_gateway_unmapped_account').length, 1); });
Deno.test('all_accounts: expired grant denied before lookup', async () => { const w = await world(); w.tables.agent_grants[0].expires_at = '2026-10-22'; assertEquals((await w.call()).body.outcome, 'denied_grant_expired'); assertEquals(w.network.length, 0); });
Deno.test('all_accounts: missing account denied without default', async () => { const w = await world(); w.tables.integrations[0].account_ref = '111'; assertEquals((await w.call({})).body.outcome, 'denied_missing_account_ref'); assertEquals((await w.call({}, true)).body.outcome, 'denied_missing_account_ref'); });
Deno.test('all_accounts: selected Meta account maps but OAuth user id does not', async () => { const w = await world(); w.tables.platform_connections.push({ platform: 'meta', client_id: 'client1', account_id: '222', selected_ad_account: { id: 'act_111' } }); assertEquals((await w.call()).body.account_mapping, 'mapped'); });
Deno.test('explicit grant regression unchanged and no visible lookup', async () => { const w = await world(); Object.assign(w.tables.agent_grants[0], { all_accounts: false, allowed_account_refs: ['111'] }); assertEquals((await w.call()).body.outcome, 'ok'); assertEquals((await w.call({ account_id: '222' })).body.outcome, 'denied_account_not_allowed'); assertEquals((await w.call({})).body.outcome, 'denied_missing_account_ref'); assert(!w.network.some((p) => p.endsWith('/me/adaccounts'))); });
Deno.test('legacy account_ref regression unchanged', async () => { const w = await world(); w.tables.agent_grants[0].all_accounts = false; w.tables.integrations[0].account_ref = '111'; assertEquals((await w.call({})).body.outcome, 'ok'); assertEquals((await w.call({ account_id: '222' })).body.outcome, 'denied_account_not_allowed'); assert(!w.network.some((p) => p.endsWith('/me/adaccounts'))); });
Deno.test('all_accounts: execution rechecks blocklist before Meta POST', async () => { const w = await world(); await w.call(undefined, true); Object.assign(w.tables.agent_write_requests[0], { status: 'approved', approval_expires_at: '2026-10-23T15:30:00Z' }); w.tables.gateway_account_blocklist.push({ account_id: '111', integration_id: null }); const r = await executeWrite({ db: w.db, secrets: w.secrets, fetch: w.doFetch, now: NOW, settings: settingsFrom({ writes_enabled: true }) }, 'request-1'); assertEquals(r.failure_outcome, 'failed_account_blocklisted'); });