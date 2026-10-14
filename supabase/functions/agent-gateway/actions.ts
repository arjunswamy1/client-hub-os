// Named read-only actions. Agents call these by name; they never supply a URL.
// v1: read only. Slack is excluded from the gateway entirely.
export type AuthStyle = 'bearer' | 'query_access_token';

export interface ActionDef {
  provider: string;
  host: string;
  method: 'GET';
  auth: AuthStyle;
  /** Path with {account} placeholder filled from the grant/integration account_ref. */
  path: string;
  needsAccount: boolean;
  /** Fixed query params added to every call. */
  fixed?: Record<string, string>;
  /** Allowed caller params: name -> validator. Anything else is refused. */
  params: Record<string, RegExp>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SMALL_INT = /^(?:[1-9]\d?|100)$/;
const OFFSET = /^\d{1,4}$/;

export const ACTIONS: Record<string, ActionDef> = {
  'meta.account.read': {
    provider: 'meta_ads', host: 'graph.facebook.com', method: 'GET', auth: 'query_access_token',
    path: '/v21.0/act_{account}', needsAccount: true,
    fixed: { fields: 'id,name,account_status,currency,timezone_name,amount_spent' }, params: {},
  },
  'meta.campaigns.read': {
    provider: 'meta_ads', host: 'graph.facebook.com', method: 'GET', auth: 'query_access_token',
    path: '/v21.0/act_{account}/campaigns', needsAccount: true,
    fixed: { fields: 'id,name,status,effective_status,objective,daily_budget' }, params: { limit: SMALL_INT, after: /^[A-Za-z0-9_=-]{1,200}$/ },
  },
  'meta.insights.read': {
    provider: 'meta_ads', host: 'graph.facebook.com', method: 'GET', auth: 'query_access_token',
    path: '/v21.0/act_{account}/insights', needsAccount: true,
    fixed: { fields: 'date_start,date_stop,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,reach,clicks,cpm,ctr,frequency', time_increment: '1' },
    params: {
      since: DATE, until: DATE,
      date_preset: /^(today|yesterday|last_7d|last_14d|last_30d|this_month|last_month)$/,
      level: /^(account|campaign|adset|ad)$/, limit: SMALL_INT, after: /^[A-Za-z0-9_=-]{1,200}$/,
    },
  },
  'callgrid.calls.read': {
    provider: 'callgrid', host: 'api.callgrid.com', method: 'GET', auth: 'bearer',
    path: '/api/call', needsAccount: false,
    fixed: { reportTimeZone: 'US/Eastern' }, params: { startDate: DATE, endDate: DATE, maxItems: SMALL_INT },
  },
  'roku.accounts.read': {
    provider: 'roku', host: 'api.ads.roku.com', method: 'GET', auth: 'bearer',
    path: '/v1/developer/accounts', needsAccount: false, params: {},
  },
  'roku.campaigns.read': {
    provider: 'roku', host: 'api.ads.roku.com', method: 'GET', auth: 'bearer',
    path: '/v1/developer/campaigns', needsAccount: true, params: { limit: SMALL_INT, offset: OFFSET },
  },
};

export type BuildResult = { ok: true; url: URL; headers: Record<string, string> } | { ok: false; outcome: string; detail?: string };

const ACCOUNT_ID = /^(act_)?[0-9]{1,32}$/;
const stripAct = (s: string) => s.replace(/^act_/, '');

/**
 * Resolve which upstream account a call may use, and remove the caller's account_id
 * from params so it is never forwarded upstream.
 * Non-empty allowlist: account_id is required and must be in the list.
 * Empty/null allowlist: legacy single account_ref; any differing account_id is refused.
 */
export function resolveAccount(
  def: ActionDef, allowed: string[] | null | undefined, legacy: string | null, params: unknown,
): { ok: true; account: string | null; params: unknown } | { ok: false; outcome: string } {
  if (!params || typeof params !== 'object' || Array.isArray(params) || !('account_id' in params)) {
    if (def.needsAccount && allowed && allowed.length > 0) return { ok: false, outcome: 'denied_missing_account_ref' };
    return { ok: true, account: legacy, params };
  }
  const { account_id, ...rest } = params as Record<string, unknown>;
  if (!def.needsAccount) return { ok: false, outcome: 'denied_bad_params' };
  if (typeof account_id !== 'string' || !ACCOUNT_ID.test(account_id)) return { ok: false, outcome: 'denied_bad_params' };
  const id = stripAct(account_id);
  const list = (allowed ?? []).map(stripAct);
  if (list.length > 0) return list.includes(id) ? { ok: true, account: id, params: rest } : { ok: false, outcome: 'denied_account_not_allowed' };
  if (!legacy || stripAct(legacy) !== id) return { ok: false, outcome: 'denied_account_not_allowed' };
  return { ok: true, account: legacy, params: rest };
}


/** Build the upstream request. Pure: no secret is placed in anything returned on failure. */
export function buildRequest(
  name: string, def: ActionDef, integ: { provider: string; allowed_hosts: string[] },
  account: string | null, params: unknown, secret: string,
): BuildResult {
  if (def.provider !== integ.provider) return { ok: false, outcome: 'denied_action_provider_mismatch' };
  if (!(integ.allowed_hosts ?? []).map((h) => h.toLowerCase()).includes(def.host)) return { ok: false, outcome: 'denied_host_not_allowed', detail: def.host };
  if (def.needsAccount && !(account && /^[A-Za-z0-9_-]{1,64}$/.test(account))) return { ok: false, outcome: 'denied_missing_account_ref' };
  const p = (params ?? {}) as Record<string, unknown>;
  if (typeof p !== 'object' || Array.isArray(p)) return { ok: false, outcome: 'denied_bad_params' };
  for (const [k, v] of Object.entries(p)) {
    const re = def.params[k];
    if (!re) return { ok: false, outcome: 'denied_bad_params', detail: `unknown param ${k.slice(0, 40)}` };
    if (typeof v !== 'string' || !re.test(v)) return { ok: false, outcome: 'denied_bad_params', detail: `invalid ${k}` };
  }
  const url = new URL(`https://${def.host}${def.path.replace('{account}', account ?? '')}`);
  for (const [k, v] of Object.entries(def.fixed ?? {})) url.searchParams.set(k, v);
  for (const [k, v] of Object.entries(p)) url.searchParams.set(k, v as string);
  if (name.startsWith('roku.') && def.needsAccount) url.searchParams.set('account_uid', account!);
  if (name === 'meta.insights.read' && p.since && p.until) {
    url.searchParams.delete('since'); url.searchParams.delete('until');
    url.searchParams.set('time_range', JSON.stringify({ since: p.since, until: p.until }));
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (def.auth === 'bearer') headers.Authorization = `Bearer ${secret}`;
  else url.searchParams.set('access_token', secret);
  if (url.host !== def.host || url.protocol !== 'https:') return { ok: false, outcome: 'denied_host_not_allowed' };
  return { ok: true, url, headers };
}

/** Remove every occurrence of the secret (and its URL-encoded form) from text. */
export function scrub(text: string, secret: string | null): string {
  if (!secret) return text;
  let out = text;
  for (const s of new Set([secret, encodeURIComponent(secret)])) if (s.length >= 4) out = out.split(s).join('[redacted]');
  return out;
}
