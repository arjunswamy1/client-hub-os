// Agent Access Gateway: authenticate, check kill switches, grants and client scope,
// rate-limit, then run a named read-only action upstream with a secret resolved
// from 1Password at call time. Writes need an approver's decision (write-flow.ts)
// and the writes_enabled switch. Slack is excluded.
// Audit: every refusal, every write attempt and every hand-off in full;
// successful reads only as a daily count.
// Never log or persist the token, auth headers, params, or any secret value.
import type { SecretsProvider } from '../_shared/agent-secrets.ts';
import { ACTIONS, buildRequest, resolveAccount, scrub } from './actions.ts';
import { settingsFrom } from '../_shared/agent-write-actions.ts';
import { requestWrite, writeStatus } from '../_shared/agent-write-flow.ts';
import { requestedAccount, resolveAllAccounts } from '../_shared/agent-all-accounts.ts';

export interface GatewayDeps {
  db: any; // service-role client
  secrets: SecretsProvider;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface GatewayRequest {
  integration_id?: unknown; action?: unknown; scope?: unknown; target?: unknown; params?: unknown;
  handoff?: unknown; write?: unknown; request_id?: unknown; reason?: unknown; qa_ref?: unknown;
  acting_agent_id?: unknown;
}
export interface GatewayResult { status: number; body: Record<string, unknown> }

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION = /^[a-z0-9_.]{1,80}$/;
const MAX_BODY = 2_000_000;

// actingAgentHeader: the X-CPM-Agent header. Person keys (migration 0055) must name the bot they act for, with no default;
// per-agent keys may name only their own bot.
export async function handleGateway(deps: GatewayDeps, authHeader: string | null, req: GatewayRequest | null, actingAgentHeader: string | null = null): Promise<GatewayResult> {
  const { db, secrets } = deps;
  const doFetch = deps.fetch ?? fetch;
  const now = (deps.now ?? (() => new Date()))();
  const started = Date.now();
  const log: Record<string, unknown> = { grant_mode: null, resolved_account_id: null, connection_id: null, account_mapping: null };
  const audit = (event_type: string, outcome: string, detail?: string | null, extra: Record<string, unknown> = {}) =>
    db.from('agent_access_log').insert({ ...log, ...extra, event_type, outcome, detail: detail ?? null, duration_ms: Date.now() - started });
  const deny = async (status: number, outcome: string, detail?: string): Promise<GatewayResult> => {
    await audit('denied', outcome, detail);
    return { status, body: { ok: false, outcome, ...(detail ? { detail } : {}) } };
  };

  const handoff = req?.handoff === 'request' || req?.handoff === 'redeem' ? req.handoff : null;
  const writeStatusCall = !handoff && req?.write === 'status';
  const action = handoff ? `handoff.${handoff}` : writeStatusCall ? 'write.status' : typeof req?.action === 'string' && ACTION.test(req.action) ? req.action : null;
  const scope = handoff ? 'handoff' : writeStatusCall ? 'write_status' : req?.scope === 'write' ? 'write' : req?.scope === 'read' || req?.scope === undefined ? 'read' : null;
  const integrationId = typeof req?.integration_id === 'string' && UUID.test(req.integration_id) ? req.integration_id : null;
  const target = typeof req?.target === 'string' && req.target.length <= 200 ? req.target : null;
  log.action = action; log.scope = scope; log.integration_id = integrationId;
  log.connection_id = integrationId;
  log.request_fingerprint = req?.params === undefined ? null : await sha256Hex(JSON.stringify(req.params));

  // 1. Token.
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader ?? '');
  if (!m) return deny(401, 'denied_no_token');
  const { data: tok } = await db.from('agent_gateway_tokens')
    .select('id, agent_id, expires_at, revoked_at, audience, kind, owner_team_member_id, leaked').eq('token_hash', await sha256Hex(m[1])).maybeSingle();
  if (!tok) return deny(401, 'denied_bad_token');
  const keyKind: 'agent' | 'person' = tok.kind === 'person' ? 'person' : 'agent';
  log.key_kind = keyKind; log.key_owner_team_member_id = keyKind === 'person' ? tok.owner_team_member_id ?? null : null;
  // Hub keys open mcp-hub only, never the account gateway.
  if (tok.audience === 'hub') { log.token_id = tok.id; log.agent_id = tok.agent_id; return deny(401, 'denied_wrong_audience'); }
  log.token_id = tok.id; log.agent_id = tok.agent_id;
  if (tok.revoked_at) return deny(401, 'denied_token_revoked');
  if (new Date(tok.expires_at) <= now) return deny(401, 'denied_token_expired');

  // 1b. Acting agent. Header and body field must agree; a per-agent key may only name its own bot.
  const hdr = typeof actingAgentHeader === 'string' && actingAgentHeader.trim() !== '' ? actingAgentHeader.trim() : null;
  const bodyAgent = req?.acting_agent_id === undefined || req?.acting_agent_id === null ? null : req.acting_agent_id;
  if ((hdr !== null && !UUID.test(hdr)) || (bodyAgent !== null && (typeof bodyAgent !== 'string' || !UUID.test(bodyAgent)))) return deny(400, 'denied_bad_request', 'X-CPM-Agent must be an agent uuid');
  if (hdr !== null && bodyAgent !== null && hdr.toLowerCase() !== (bodyAgent as string).toLowerCase()) return deny(400, 'denied_agent_mismatch');
  const named = (hdr ?? (bodyAgent as string | null))?.toLowerCase() ?? null;
  if (keyKind === 'agent' && named !== null && named !== String(tok.agent_id).toLowerCase()) return deny(403, 'denied_agent_mismatch');
  await db.from('agent_gateway_tokens').update({ last_used_at: now.toISOString() }).eq('id', tok.id);

  // 2. Kill switches: global, then (person keys) the person-key switch and holder, then per agent.
  const { data: settings } = await db.from('agent_gateway_settings').select('*').eq('id', 1).maybeSingle();
  if (!settings?.gateway_enabled) return deny(503, 'denied_gateway_disabled');
  let actingAgentId: string = tok.agent_id;
  if (keyKind === 'person') {
    if (settings?.person_keys_enabled !== true) return deny(403, 'denied_person_keys_disabled');
    if (tok.leaked) return deny(401, 'denied_token_leaked');
    if (!named) return deny(400, 'denied_agent_required', 'person keys must name the acting bot in the X-CPM-Agent header');
    log.agent_id = named; log.acting_agent_id = named;
    const { data: listed } = await db.from('agent_gateway_token_agents').select('agent_id').eq('token_id', tok.id).eq('agent_id', named).maybeSingle();
    if (!listed) return deny(403, 'denied_agent_not_allowlisted');
    const { data: holder } = await db.from('team_members').select('id, is_active, is_service_account').eq('id', tok.owner_team_member_id).maybeSingle();
    if (!holder || holder.is_active !== true || holder.is_service_account === true) return deny(403, 'denied_key_holder_inactive');
    actingAgentId = named;
  } else {
    log.acting_agent_id = tok.agent_id;
  }
  const { data: agent } = await db.from('agents').select('id, status, kind, owner_team_member_id').eq('id', actingAgentId).maybeSingle();
  if (!agent) return deny(403, 'denied_unknown_agent');
  // Ownership is checked live on every request, so an owner change detaches the bot from the old holder's key at once.
  if (keyKind === 'person' && agent.owner_team_member_id !== tok.owner_team_member_id) return deny(403, 'denied_agent_not_owned');
  if (agent.status === 'killed') return deny(403, 'denied_agent_killed');
  if (agent.status !== 'active') return deny(403, 'denied_agent_suspended');

  // 3. Request validity. Writes are refused outright in v1.
  if (!action || !scope || !integrationId) return deny(400, 'denied_bad_request', 'integration_id (uuid), action and scope (read) are required');
  const ws = settingsFrom(settings);
  if (scope === 'write' && !ws.writes_enabled) return deny(403, 'denied_writes_disabled');

  // 4. Integration, Slack exclusion, grant, client scope.
  const { data: integ } = await db.from('integrations')
    .select('id, provider, enabled, op_secret_ref, account_ref, allowed_hosts, client_id, is_browser_login, restricted_owner_team_member_id').eq('id', integrationId).maybeSingle();
  if (!integ) return deny(404, 'denied_unknown_integration');
  if (/slack/i.test(integ.provider ?? '')) return deny(403, 'denied_slack_excluded');
  if (!integ.enabled) return deny(403, 'denied_integration_disabled');
  if (integ.restricted_owner_team_member_id && integ.restricted_owner_team_member_id !== agent.owner_team_member_id) return deny(403, 'denied_restricted_account');
  const { data: grant } = await db.from('agent_grants')
    .select('id, scopes, account_ref, rate_per_minute, rate_per_day, expires_at, revoked_at, allow_browser_handoff, allowed_account_refs, all_accounts')
    .eq('agent_id', agent.id).eq('integration_id', integ.id).maybeSingle();
  if (!grant || grant.revoked_at) return deny(403, 'denied_no_grant');
  log.grant_id = grant.id;
  log.grant_mode = grant.all_accounts ? 'all_accounts' : grant.allowed_account_refs?.length ? 'explicit' : 'legacy';
  if (grant.expires_at && new Date(grant.expires_at) <= now) return deny(403, 'denied_grant_expired');
  if (scope !== 'handoff' && scope !== 'write_status' && !(grant.scopes ?? []).includes(scope)) return deny(403, 'denied_scope');
  if (agent.kind === 'teammate_agent' && integ.client_id) {
    const { data: owner } = await db.from('team_members').select('role').eq('id', agent.owner_team_member_id).maybeSingle();
    if (owner?.role !== 'admin') {
      const { data: asg } = await db.from('client_assignments').select('id')
        .eq('team_member_id', agent.owner_team_member_id).eq('client_id', integ.client_id).maybeSingle();
      if (!asg) return deny(403, 'denied_client_scope');
    }
  }

  // 5a. Write status poll: exempt from rate limits; may execute an approved request.
  if (scope === 'write_status') {
    const reqId = typeof req?.request_id === 'string' && UUID.test(req.request_id) ? req.request_id : null;
    if (!reqId) return deny(400, 'denied_bad_request', 'request_id is required');
    const out = await writeStatus({ db, secrets, fetch: doFetch, now, settings: ws }, agent.id, reqId);
    if (out.status === 404) return deny(404, 'denied_write_unknown');
    return out;
  }

  // 5. Rate limit (atomic counter).
  const { data: hit, error: hitErr } = await db.rpc('agent_gateway_hit', { p_grant_id: grant.id, p_per_minute: grant.rate_per_minute, p_per_day: grant.rate_per_day });
  if (hitErr) return deny(500, 'error_rate_limiter');
  if (!hit?.allowed) return deny(429, 'rate_limited');
  if (keyKind === 'person') {
    // Per-key ceiling (0055), in addition to the acting bot's per-grant limit above.
    const { data: khit, error: khErr } = await db.rpc('agent_gateway_key_hit', { p_token_id: tok.id });
    if (khErr) return deny(500, 'error_rate_limiter');
    if (!khit?.allowed) return deny(429, 'key_rate_limited');
  }

  // 6a. Browser hand-off: request -> admin approves in the hub -> single redeem within 15 minutes.
  if (handoff) {
    if (!integ.is_browser_login) return deny(403, 'denied_not_browser_login');
    if (!grant.allow_browser_handoff) return deny(403, 'denied_handoff_not_granted');
    if (handoff === 'request') {
      const reason = typeof req?.reason === 'string' ? req.reason.trim().slice(0, 500) : '';
      if (reason.length < 5) return deny(400, 'denied_bad_request', 'a reason of at least 5 characters is required');
      const { data: row, error } = await db.from('agent_handoff_requests')
        .insert({ agent_id: agent.id, integration_id: integ.id, grant_id: grant.id, reason }).select('id').maybeSingle();
      if (error || !row) return deny(500, 'error_handoff_request');
      await audit('handoff', 'handoff_requested', null, { target: row.id });
      return { status: 202, body: { ok: true, outcome: 'handoff_pending_approval', request_id: row.id } };
    }
    const reqId = typeof req?.request_id === 'string' && UUID.test(req.request_id) ? req.request_id : null;
    if (!reqId) return deny(400, 'denied_bad_request', 'request_id is required');
    log.target = reqId;
    const { data: h } = await db.from('agent_handoff_requests')
      .select('id, agent_id, integration_id, status, approval_expires_at, decided_by_id').eq('id', reqId).maybeSingle();
    if (!h || h.agent_id !== agent.id || h.integration_id !== integ.id) return deny(404, 'denied_handoff_unknown');
    if (h.status === 'pending') return { status: 202, body: { ok: false, outcome: 'handoff_pending_approval' } };
    if (h.status !== 'approved') return deny(403, `denied_handoff_${h.status}`);
    if (!h.approval_expires_at || new Date(h.approval_expires_at) <= now) {
      await db.from('agent_handoff_requests').update({ status: 'expired' }).eq('id', h.id).eq('status', 'approved');
      return deny(403, 'denied_handoff_expired');
    }
    const secret = integ.op_secret_ref ? await secrets.resolve(integ.op_secret_ref) : { ok: false as const, reason: 'not_configured' as const };
    if (!secret.ok) return deny(503, `secret_${secret.reason}`);
    const { data: used } = await db.from('agent_handoff_requests').update({ status: 'used', used_at: now.toISOString() })
      .eq('id', h.id).eq('status', 'approved').select('id').maybeSingle();
    if (!used) return deny(409, 'denied_handoff_already_used');
    await audit('handoff', 'handoff_redeemed', null, { target: h.id, approved_by_id: h.decided_by_id });
    return { status: 200, body: { ok: true, outcome: 'handoff_redeemed', credential: secret.value, single_use: true } };
  }

  // 6b. Write request: validated, checked live against Meta, then queued for approval (or executed at once in auto-execute mode).
  if (scope === 'write') {
    return requestWrite({ db, secrets, fetch: doFetch, now, agent, tokenId: tok.id, grant, integ, settings: ws, audit, deny,
      accountResolved: (account, mapping) => { log.resolved_account_id = account; log.account_mapping = mapping; },
    }, action, req?.params, req?.reason, req?.qa_ref);
  }

  // 6c. Named read action.
  const def = ACTIONS[action];
  if (!def) return deny(400, 'denied_unknown_action');
  let broad: { account: string; params: Record<string, unknown>; mapping: 'mapped' | 'unmapped' } | null = null;
  if (grant.all_accounts) {
    if (def.provider !== integ.provider || !def.needsAccount) return deny(403, 'denied_action_provider_mismatch');
    const input = requestedAccount(req?.params);
    if (!input.ok) return deny(400, input.outcome);
    log.resolved_account_id = input.account;
    const result = await resolveAllAccounts({ db, fetch: doFetch, now }, integ, input.account, secrets, integ.op_secret_ref, grant.expires_at);
    if (!result.ok) return deny(403, result.outcome);
    log.account_mapping = result.mapping;
    broad = { account: result.account, params: input.params, mapping: result.mapping };
  }
  const secret = integ.op_secret_ref ? await secrets.resolve(integ.op_secret_ref) : { ok: false as const, reason: 'not_configured' as const };
  if (!secret.ok) return deny(503, `secret_${secret.reason}`);
  const acct = broad ? { ok: true as const, account: broad.account, params: broad.params } : resolveAccount(def, grant.allowed_account_refs, grant.account_ref ?? integ.account_ref ?? null, req?.params);
  if (!acct.ok) return deny(acct.outcome === 'denied_account_not_allowed' ? 403 : 400, acct.outcome);
  log.resolved_account_id = acct.account?.replace(/^act_/, '') ?? null;
  const built = buildRequest(action, def, integ, acct.account, acct.params, secret.value);
  if (!built.ok) return deny(400, built.outcome, built.detail);

  let res: Response;
  try {
    res = await doFetch(built.url.toString(), { method: def.method, headers: built.headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  } catch {
    return deny(502, 'upstream_unreachable');
  }
  const text = scrub((await res.text()).slice(0, MAX_BODY), secret.value);
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* keep scrubbed text */ }
  if (!res.ok) {
    await audit('denied', 'upstream_error', `status ${res.status}`);
    return { status: 502, body: { ok: false, outcome: 'upstream_error', upstream_status: res.status, data } };
  }
  await db.rpc('agent_gateway_count_read', { p_agent_id: agent.id, p_integration_id: integ.id, p_action: action });
  if (broad) await audit('read', 'ok');
  return { status: 200, body: { ok: true, outcome: 'ok', upstream_status: res.status, target, data,
    ...(broad ? { account_mapping: broad.mapping, account_label: broad.mapping === 'unmapped' ? 'UNMAPPED' : null } : {}),
  } };
}


