// Approval-gated Meta writes: request -> approver decides (SQL) -> gateway executes once.
// State: pending -> approved|denied|expired; approved -> executing -> executed|failed; approved -> expired.
// Every transition is written to agent_access_log. No token or secret is ever stored or returned.
import type { SecretsProvider } from './agent-secrets.ts';
import {
  WRITE_ACTIONS, META_HOST, META_PROVIDER, type WriteSettings, parseWriteParams, objectFields, snapshot, planChange,
  drift, metaGet, metaPost, checkAdsManagement, stripAct, scrub, executionCheck, BUDGET_ACTIONS, BUDGET_COOLDOWN_MS,
  POST_TIMEOUT_MS, GET_TIMEOUT_MS, copyTag, copyLookupUrl, chicagoDayStart, outcomeUnknown, childCountUrl, decisionAuthority, SYNC_COPY_MAX_CHILDREN, isCopyTooLargeError,
} from './agent-write-actions.ts';

export interface WriteDeps { db: any; secrets: SecretsProvider; fetch: typeof fetch; now: Date }
type Res = { status: number; body: Record<string, unknown> };
type Audit = (event_type: string, outcome: string, detail?: string | null, extra?: Record<string, unknown>) => Promise<unknown>;

const OPEN = ['pending', 'approved', 'executing'];
const MAX_BODY = 200_000;

const logRow = (db: any, row: any, outcome: string, detail: string | null = null, extra: Record<string, unknown> = {}) =>
  db.from('agent_access_log').insert({
    agent_id: row.agent_id, integration_id: row.integration_id, grant_id: row.grant_id, action: row.action, scope: 'write',
    event_type: 'write', outcome, detail, target: row.id, ...extra,
  });

async function metaJson(doFetch: typeof fetch, url: string, secret: string): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const r = await doFetch(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(GET_TIMEOUT_MS) });
    const text = scrub((await r.text()).slice(0, MAX_BODY), secret);
    let data: any = null; try { data = JSON.parse(text); } catch { data = null; }
    return { ok: r.ok, status: r.status, data };
  } catch { return { ok: false, status: 0, data: null }; }
}

async function lookup(deps: WriteDeps, def: { objectType: any }, objectId: string, accountId: string, secret: string) {
  const obj = await metaJson(deps.fetch, metaGet(objectId, objectFields(def.objectType), secret).toString(), secret);
  if (!obj.ok || !obj.data) return { ok: false as const, status: obj.status };
  const acct = await metaJson(deps.fetch, metaGet(`act_${accountId}`, 'name,currency', secret).toString(), secret);
  return { ok: true as const, snap: snapshot(obj.data), acct: acct.ok && acct.data ? { name: acct.data.name ?? null, currency: acct.data.currency ?? null } : { name: null, currency: null } };
}

/** Last budget change on this object within the cooldown that executed, or whose Meta outcome is unknown. */
async function recentBudgetChange(db: any, objectId: string, now: Date, excludeId?: string): Promise<any | null> {
  const since = now.getTime() - BUDGET_COOLDOWN_MS;
  const { data } = await db.from('agent_write_requests').select('id, status, executed_at, execution_started_at, updated_at, failure_outcome, result')
    .eq('object_id', objectId).in('action', BUDGET_ACTIONS).in('status', ['executed', 'failed']);
  for (const r of data ?? []) {
    if (r.id === excludeId) continue;
    const at = r.status === 'executed' ? r.executed_at : (r.execution_started_at ?? r.updated_at);
    if (!at || new Date(at).getTime() < since) continue;
    if (r.status === 'executed') return { ...r, at, unknown: false };
    if (outcomeUnknown(r)) return { ...r, at, unknown: true };
  }
  return null;
}

/** Prior duplicates of this campaign whose outcome is unknown; any tagged copy (any status, archived included) blocks. */
async function priorCopyCheck(deps: WriteDeps, objectId: string, action: string, accountId: string, secret: string, excludeId?: string): Promise<{ ok: true } | { ok: false; outcome: 'copy_lookup_failed' | 'prior_copy_exists'; detail?: string }> {
  const { data } = await deps.db.from('agent_write_requests').select('id, status, failure_outcome, result').eq('object_id', objectId).eq('action', action).eq('status', 'failed');
  for (const u of (data ?? []).filter((r: any) => r.id !== excludeId && outcomeUnknown(r))) {
    const f = await findTaggedCopy(deps, accountId, u.id, secret);
    if (!f.ok) return { ok: false, outcome: 'copy_lookup_failed' };
    if (f.id) return { ok: false, outcome: 'prior_copy_exists', detail: `copy ${f.id} from request ${u.id}` };
  }
  return { ok: true };
}

/** Child objects (ad sets + ads) of a campaign; null when unreadable. */
async function copyChildren(deps: WriteDeps, campaignId: string, secret: string): Promise<number | null> {
  let n = 0;
  for (const edge of ['adsets', 'ads'] as const) {
    const r = await metaJson(deps.fetch, childCountUrl(campaignId, edge, secret).toString(), secret);
    const c = Number(r.data?.summary?.total_count);
    if (!r.ok || !Number.isFinite(c)) return null;
    n += c;
  }
  return n;
}

/** Find a campaign copy carrying this request's tag (a copy whose response was lost). */
async function findTaggedCopy(deps: WriteDeps, accountId: string, requestId: string, secret: string): Promise<{ ok: boolean; id: string | null }> {
  const r = await metaJson(deps.fetch, copyLookupUrl(accountId, copyTag(requestId), secret).toString(), secret);
  if (!r.ok || !r.data || !Array.isArray(r.data.data)) return { ok: false, id: null };
  const hit = r.data.data.find((c: any) => typeof c?.name === 'string' && c.name.includes(copyTag(requestId)));
  return { ok: true, id: hit ? String(hit.id) : null };
}

/** Lazily persist expiry derived from timestamps. Returns the current row. */
export async function settle(db: any, row: any, now: Date): Promise<any> {
  const expired =
    (row.status === 'pending' && new Date(row.decision_expires_at) <= now) ||
    (row.status === 'approved' && (!row.approval_expires_at || new Date(row.approval_expires_at) <= now));
  if (!expired) return row;
  const { data } = await db.from('agent_write_requests').update({ status: 'expired', updated_at: now.toISOString() })
    .eq('id', row.id).eq('status', row.status).select('*').maybeSingle();
  if (data) { await logRow(db, row, 'write_expired'); return data; }
  const { data: cur } = await db.from('agent_write_requests').select('*').eq('id', row.id).maybeSingle();
  return cur ?? row;
}

export interface RequestCtx extends WriteDeps {
  agent: { id: string; owner_team_member_id: string | null };
  grant: { id: string; allowed_account_refs: string[] | null };
  integ: { id: string; provider: string; allowed_hosts: string[]; op_secret_ref: string | null };
  settings: WriteSettings; audit: Audit;
  deny: (status: number, outcome: string, detail?: string) => Promise<Res>;
}

export async function requestWrite(ctx: RequestCtx, action: string, params: unknown, reasonRaw: unknown): Promise<Res> {
  const { db, deny, settings, now } = ctx;
  const def = WRITE_ACTIONS[action];
  if (!def) return deny(400, 'denied_unknown_action');
  // A bot with no owner has nobody accountable for it; its writes are never approvable.
  if (!ctx.agent.owner_team_member_id) return deny(403, 'denied_ownerless_agent');
  if (ctx.integ.provider !== META_PROVIDER) return deny(403, 'denied_action_provider_mismatch');
  if (!(ctx.integ.allowed_hosts ?? []).map((h) => h.toLowerCase()).includes(META_HOST)) return deny(403, 'denied_host_not_allowed', META_HOST);
  const parsed = parseWriteParams(def, params);
  if (!parsed.ok) return deny(400, parsed.outcome, parsed.detail);
  const { input } = parsed;
  const list = (ctx.grant.allowed_account_refs ?? []).map(stripAct);
  if (!list.includes(input.account_id)) return deny(403, 'denied_account_not_allowed');
  const reason = typeof reasonRaw === 'string' ? reasonRaw.trim().slice(0, 500) : '';
  if (reason.length < 5) return deny(400, 'denied_bad_request', 'a reason of at least 5 characters is required');

  // Cheap pre-check (America/Chicago day); the authoritative count+insert is atomic in agent_write_request_create.
  const dayStart = chicagoDayStart(now).toISOString();
  const { count } = await db.from('agent_write_requests').select('id', { count: 'exact', head: true }).eq('agent_id', ctx.agent.id).gte('requested_at', dayStart);
  if ((count ?? 0) >= settings.per_day) return deny(429, 'write_rate_limited', `max ${settings.per_day} write requests per day`);

  const { data: open } = await db.from('agent_write_requests').select('id, status, diff_text, decision_expires_at')
    .eq('agent_id', ctx.agent.id).eq('action', action).eq('object_id', input.object_id).in('status', OPEN).maybeSingle();
  if (open) return { status: 202, body: { ok: true, outcome: 'write_pending_approval', request_id: open.id, status: open.status, diff: open.diff_text, decision_expires_at: open.decision_expires_at, duplicate: true } };

  const secret = ctx.integ.op_secret_ref ? await ctx.secrets.resolve(ctx.integ.op_secret_ref) : { ok: false as const, reason: 'not_configured' as const };
  if (!secret.ok) return deny(503, `secret_${secret.reason}`);
  const look = await lookup(ctx, def, input.object_id, input.account_id, secret.value);
  if (!look.ok) return deny(502, 'denied_object_lookup_failed', `status ${look.status}`);
  if (look.snap.account_id !== input.account_id) return deny(403, 'denied_object_not_in_account');
  const plan = planChange(def, input.object_id, look.snap, look.acct, input, settings);
  if (!plan.ok) return deny(400, plan.outcome, plan.detail);
  if (def.kind === 'budget') {
    const prior = await recentBudgetChange(db, input.object_id, now);
    if (prior) return deny(409, 'denied_budget_changed_recently', prior.unknown
      ? `a budget change at ${prior.at} has an unknown outcome (${prior.failure_outcome}); treated as applied; next change allowed 24h later`
      : `budget changed at ${prior.at}; next change allowed 24h later`);
  }
  if (def.kind === 'duplicate') {
    // A prior duplicate whose Meta outcome is unknown (timeout, stuck, 5xx) may already have made a copy.
    const pc = await priorCopyCheck(ctx, input.object_id, action, input.account_id, secret.value);
    if (!pc.ok) return pc.outcome === 'copy_lookup_failed' ? deny(502, 'denied_copy_lookup_failed') : deny(409, 'denied_prior_copy_exists', pc.detail);
    const kids = await copyChildren(ctx, input.object_id, secret.value);
    if (kids === null) return deny(502, 'denied_copy_size_unknown');
    if (kids > SYNC_COPY_MAX_CHILDREN) return deny(400, 'denied_copy_too_large', `campaign has ${kids} ad sets + ads; Meta's synchronous copy allows at most ${SYNC_COPY_MAX_CHILDREN}. Duplicate it in Ads Manager instead.`);
  }

  const decisionExpires = new Date(now.getTime() + settings.pending_ttl_min * 60_000).toISOString();
  const { data: created, error } = await db.rpc('agent_write_request_create', { p_per_day: settings.per_day, p_row: {
    agent_id: ctx.agent.id, grant_id: ctx.grant.id, integration_id: ctx.integ.id, action, account_id: input.account_id,
    account_name: look.acct.name, currency: look.acct.currency, object_type: def.objectType, object_id: input.object_id,
    object_name: look.snap.name, before: plan.before, after: plan.after, diff_text: plan.diff, reason,
    requested_at: now.toISOString(), decision_expires_at: decisionExpires,
  } });
  if (error || !created) return deny(500, 'error_write_request');
  if (created.ok === false) return deny(429, created.outcome ?? 'write_rate_limited', `max ${settings.per_day} write requests per day`);
  if (created.duplicate) return { status: 202, body: { ok: true, outcome: 'write_pending_approval', request_id: created.id, status: created.status, diff: created.diff_text, decision_expires_at: created.decision_expires_at, duplicate: true } };
  const row = { id: created.id as string };
  await ctx.audit('write', 'write_requested', null, { target: row.id });

  // In-hub notification to every approver allowed to decide this request.
  const recipients = settings.approvers.filter((id) => decisionAuthority(id, settings.approvers, ctx.agent.owner_team_member_id) === 'ok');
  if (recipients.length) {
    await db.from('notifications').insert(recipients.map((recipient_id) => ({
      recipient_id, type: 'agent_write_request', title: 'Agent change waiting for approval', message: `${plan.diff}. Reason: ${reason}`.slice(0, 1000),
    })));
  }
  return { status: 202, body: { ok: true, outcome: 'write_pending_approval', request_id: row.id, status: 'pending', diff: plan.diff, before: plan.before, after: plan.after, decision_expires_at: decisionExpires } };
}

const view = (r: any) => ({
  request_id: r.id, status: r.status, action: r.action, account_id: r.account_id, object_id: r.object_id, object_name: r.object_name,
  diff: r.diff_text, requested_at: r.requested_at, decision_expires_at: r.decision_expires_at, decided_at: r.decided_at ?? null,
  approval_expires_at: r.approval_expires_at ?? null, executed_at: r.executed_at ?? null, result: r.result ?? null, failure_outcome: r.failure_outcome ?? null,
});

export async function writeStatus(deps: WriteDeps & { settings: WriteSettings }, agentId: string, requestId: string): Promise<Res> {
  const { data: r0 } = await deps.db.from('agent_write_requests').select('*').eq('id', requestId).maybeSingle();
  if (!r0 || r0.agent_id !== agentId) return { status: 404, body: { ok: false, outcome: 'denied_write_unknown' } };
  if (r0.status === 'executing') {
    try { await deps.db.rpc('sweep_stuck_agent_writes'); } catch { /* the scheduled sweep covers it */ }
    const { data: fresh } = await deps.db.from('agent_write_requests').select('*').eq('id', requestId).maybeSingle();
    if (fresh) Object.assign(r0, fresh);
  }
  let r = await settle(deps.db, r0, deps.now);
  if (r.status === 'approved' && deps.settings.writes_enabled) r = await executeWrite(deps, r.id);
  return { status: 200, body: { ok: true, outcome: 'write_status', ...view(r) } };
}

/** Execute one approved request exactly once. Safe to call repeatedly or concurrently. */
export async function executeWrite(deps: WriteDeps & { settings: WriteSettings }, requestId: string): Promise<any> {
  const { db, now } = deps;
  const { data: r0 } = await db.from('agent_write_requests').select('*').eq('id', requestId).maybeSingle();
  if (!r0) return null;
  const r1 = await settle(db, r0, now);
  if (r1.status !== 'approved' || !deps.settings.writes_enabled) return r1;
  const { data: row } = await db.from('agent_write_requests').update({ status: 'executing', execution_started_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('id', r1.id).eq('status', 'approved').gt('approval_expires_at', now.toISOString()).select('*').maybeSingle();
  if (!row) { const { data } = await db.from('agent_write_requests').select('*').eq('id', r1.id).maybeSingle(); return data ?? r1; }

  let secretValue: string | null = null;
  const fail = async (outcome: string, detail: string | null = null, result: unknown = null) => {
    const { data } = await db.from('agent_write_requests').update({ status: 'failed', failure_outcome: outcome, result, updated_at: now.toISOString() })
      .eq('id', row.id).eq('status', 'executing').select('*').maybeSingle();
    await logRow(db, row, outcome, detail ? scrub(detail, secretValue) : null, { approved_by_id: row.decided_by_id });
    return data ?? { ...row, status: 'failed', failure_outcome: outcome };
  };

  const def = WRITE_ACTIONS[row.action];
  if (!def) return fail('failed_unknown_action');
  const { data: grant } = await db.from('agent_grants').select('id, scopes, revoked_at, expires_at, allowed_account_refs').eq('id', row.grant_id).maybeSingle();
  if (!grant || grant.revoked_at || (grant.expires_at && new Date(grant.expires_at) <= now) || !(grant.scopes ?? []).includes('write')
      || !(grant.allowed_account_refs ?? []).map(stripAct).includes(row.account_id)) return fail('failed_grant_changed');
  const { data: integ } = await db.from('integrations').select('id, enabled, op_secret_ref, provider').eq('id', row.integration_id).maybeSingle();
  if (!integ?.enabled || integ.provider !== META_PROVIDER) return fail('failed_integration_disabled');
  const secret = integ.op_secret_ref ? await deps.secrets.resolve(integ.op_secret_ref) : { ok: false as const, reason: 'not_configured' as const };
  if (!secret.ok) return fail(`failed_secret_${secret.reason}`);
  secretValue = secret.value;

  const perm = await checkAdsManagement(deps.fetch, secret.value);
  if (perm === false) return fail('failed_missing_ads_management');
  if (perm === null) return fail('failed_permission_check');

  const look = await lookup(deps, def, row.object_id, row.account_id, secret.value);
  if (!look.ok) return fail('failed_object_lookup', `status ${look.status}`);
  const changed = drift(row.before, look.snap);
  if (changed.length) return fail('failed_drift', `changed: ${changed.join(',')}`, { drift: changed, live: { name: look.snap.name, status: look.snap.status, daily_budget: look.snap.daily_budget } });

  // Re-check rules against the live values just read: USD for every action, caps vs live budget, 24h budget cooldown.
  const bad = executionCheck(def, row.after, look.snap, look.acct, deps.settings);
  if (bad) return fail(bad, null, { live: { daily_budget: look.snap.daily_budget }, currency: look.acct.currency });
  if (def.kind === 'budget' && await recentBudgetChange(db, row.object_id, now, row.id)) return fail('failed_budget_changed_recently');

  if (def.kind === 'duplicate') {
    const pc = await priorCopyCheck(deps, row.object_id, row.action, row.account_id, secret.value, row.id);
    if (!pc.ok) return fail(pc.outcome === 'copy_lookup_failed' ? 'failed_copy_lookup' : 'failed_prior_copy_exists', pc.detail ?? null);
    const f = await findTaggedCopy(deps, row.account_id, row.id, secret.value);
    if (!f.ok) return fail('failed_copy_lookup');
    if (f.id) {
      const result = { reused_existing_copy: true, new_campaign_id: f.id };
      const { data: done } = await db.from('agent_write_requests').update({ status: 'executed', executed_at: now.toISOString(), result, updated_at: now.toISOString() })
        .eq('id', row.id).eq('status', 'executing').select('*').maybeSingle();
      await logRow(db, row, 'write_executed', 'existing tagged copy found; no new copy created', { approved_by_id: row.decided_by_id });
      return done ?? { ...row, status: 'executed', result };
    }
    const kids = await copyChildren(deps, row.object_id, secret.value);
    if (kids === null) return fail('failed_copy_size_unknown');
    if (kids > SYNC_COPY_MAX_CHILDREN) return fail('failed_copy_too_large', `${kids} child objects`);
  }

  const post = metaPost(def, row.object_id, row.after, secret.value, row.id);
  let res: Response;
  try { res = await deps.fetch(post.url, { method: 'POST', body: post.body, headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(POST_TIMEOUT_MS) }); }
  catch (e) { return fail((e as any)?.name === 'TimeoutError' ? 'failed_upstream_timeout' : 'failed_upstream_unreachable', 'Meta outcome unknown; verify the object'); }
  const text = scrub((await res.text()).slice(0, MAX_BODY), secret.value);
  let data: any = text; try { data = JSON.parse(text); } catch { /* keep text */ }
  if (def.kind === 'duplicate' && !res.ok && isCopyTooLargeError(data)) return fail('failed_copy_too_large', `status ${res.status}`, { upstream_status: res.status, data });
  if (!res.ok || (data && typeof data === 'object' && data.success === false)) return fail('failed_upstream', `status ${res.status}`, { upstream_status: res.status, data });

  const result = { upstream_status: res.status, data, ...(def.kind === 'duplicate' && data?.copied_campaign_id ? { new_campaign_id: String(data.copied_campaign_id) } : {}) };
  const { data: done } = await db.from('agent_write_requests').update({ status: 'executed', executed_at: now.toISOString(), result, updated_at: now.toISOString() })
    .eq('id', row.id).eq('status', 'executing').select('*').maybeSingle();
  await logRow(db, row, 'write_executed', null, { approved_by_id: row.decided_by_id });
  return done ?? { ...row, status: 'executed', result };
}
