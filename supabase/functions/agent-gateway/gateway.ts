// Agent Access Gateway (phase 1): authenticate, check kill switches and grants,
// rate-limit. Audit: every refusal and every write in full; successful reads
// only as a daily count. No upstream calls yet.
// Never log or persist the token, auth headers, params, or any secret value.
import type { SecretsProvider } from './secrets.ts';

export interface GatewayDeps {
  db: any; // service-role client
  secrets: SecretsProvider;
  now?: () => Date;
}

export interface GatewayRequest { integration_id?: unknown; action?: unknown; scope?: unknown; target?: unknown; params?: unknown }
export interface GatewayResult { status: number; body: Record<string, unknown> }

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION = /^[a-z0-9_.]{1,80}$/;

export async function handleGateway(deps: GatewayDeps, authHeader: string | null, req: GatewayRequest | null): Promise<GatewayResult> {
  const { db, secrets } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const started = Date.now();
  const log: Record<string, unknown> = {};
  const deny = async (status: number, outcome: string, detail?: string): Promise<GatewayResult> => {
    await db.from('agent_access_log').insert({ ...log, event_type: 'denied', outcome, detail: detail ?? null, duration_ms: Date.now() - started });
    return { status, body: { ok: false, outcome, ...(detail ? { detail } : {}) } };
  };

  // Request shape (validated before auth so the audit row can name it; values never stored).
  const action = typeof req?.action === 'string' && ACTION.test(req.action) ? req.action : null;
  const scope = req?.scope === 'write' ? 'write' : req?.scope === 'read' || req?.scope === undefined ? 'read' : null;
  const integrationId = typeof req?.integration_id === 'string' && UUID.test(req.integration_id) ? req.integration_id : null;
  const target = typeof req?.target === 'string' && req.target.length <= 200 ? req.target : null;
  log.action = action; log.scope = scope; log.integration_id = integrationId;
  log.request_fingerprint = req?.params === undefined ? null : await sha256Hex(JSON.stringify(req.params));

  // 1. Token.
  const m = /^Bearer\s+(\S+)$/i.exec(authHeader ?? '');
  if (!m) return deny(401, 'denied_no_token');
  const { data: tok } = await db.from('agent_gateway_tokens')
    .select('id, agent_id, expires_at, revoked_at').eq('token_hash', await sha256Hex(m[1])).maybeSingle();
  if (!tok) return deny(401, 'denied_bad_token');
  log.token_id = tok.id; log.agent_id = tok.agent_id;
  if (tok.revoked_at) return deny(401, 'denied_token_revoked');
  if (new Date(tok.expires_at) <= now) return deny(401, 'denied_token_expired');
  await db.from('agent_gateway_tokens').update({ last_used_at: now.toISOString() }).eq('id', tok.id);

  // 2. Kill switches: global, then per agent.
  const { data: settings } = await db.from('agent_gateway_settings').select('gateway_enabled').eq('id', 1).maybeSingle();
  if (!settings?.gateway_enabled) return deny(503, 'denied_gateway_disabled');
  const { data: agent } = await db.from('agents').select('id, status').eq('id', tok.agent_id).maybeSingle();
  if (!agent) return deny(403, 'denied_unknown_agent');
  if (agent.status === 'killed') return deny(403, 'denied_agent_killed');
  if (agent.status !== 'active') return deny(403, 'denied_agent_suspended');

  // 3. Request validity.
  if (!action || !scope || !integrationId) return deny(400, 'denied_bad_request', 'integration_id (uuid), action and scope (read|write) are required');

  // 4. Integration + grant.
  const { data: integ } = await db.from('integrations').select('id, enabled, op_secret_ref').eq('id', integrationId).maybeSingle();
  if (!integ) return deny(404, 'denied_unknown_integration');
  if (!integ.enabled) return deny(403, 'denied_integration_disabled');
  const { data: grant } = await db.from('agent_grants')
    .select('id, scopes, rate_per_minute, rate_per_day, expires_at, revoked_at')
    .eq('agent_id', agent.id).eq('integration_id', integ.id).maybeSingle();
  if (!grant || grant.revoked_at) return deny(403, 'denied_no_grant');
  log.grant_id = grant.id;
  if (grant.expires_at && new Date(grant.expires_at) <= now) return deny(403, 'denied_grant_expired');
  if (!(grant.scopes ?? []).includes(scope)) return deny(403, 'denied_scope');

  // 5. Rate limit (atomic counter).
  const { data: hit, error: hitErr } = await db.rpc('agent_gateway_hit', { p_grant_id: grant.id, p_per_minute: grant.rate_per_minute, p_per_day: grant.rate_per_day });
  if (hitErr) return deny(500, 'error_rate_limiter');
  if (!hit?.allowed) return deny(429, 'rate_limited');

  // 6. Secret resolution (stub in phase 1). The value is never logged or returned.
  const secret = integ.op_secret_ref ? await secrets.resolve(integ.op_secret_ref) : { ok: false as const, reason: 'not_configured' as const };
  const outcome = secret.ok ? 'allowed_no_upstream' : `allowed_secret_${secret.reason}`;
  if (scope === 'write') {
    // Every write-scope use is kept in full, permanently.
    await db.from('agent_access_log').insert({ ...log, event_type: 'write', target, approved_by_id: null, outcome, detail: `provider=${secrets.name}`, duration_ms: Date.now() - started });
  } else {
    // Successful reads are counted per day, not logged row by row.
    await db.rpc('agent_gateway_count_read', { p_agent_id: agent.id, p_integration_id: integ.id, p_action: action });
  }
  return { status: 200, body: { ok: true, outcome, authorized: true, upstream: 'not_implemented_phase_1' } };
}
