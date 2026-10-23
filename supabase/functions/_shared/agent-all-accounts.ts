// The same fail-closed Meta account resolver is used at request and execution.
import type { SecretsProvider } from './agent-secrets.ts';

export interface AccountDeps { db: any; fetch?: typeof fetch; now: Date }
export type AccountResult = { ok: true; account: string; mapping: 'mapped' | 'unmapped' } | { ok: false; outcome: string };
const normalize = (id: string) => id.replace(/^act_/, '');
export function requestedAccount(params: unknown): { ok: true; account: string; params: Record<string, unknown> } | { ok: false; outcome: string } {
  if (!params || typeof params !== 'object' || Array.isArray(params) || !('account_id' in params)) return { ok: false, outcome: 'denied_missing_account_ref' };
  const { account_id, ...rest } = params as Record<string, unknown>;
  if (typeof account_id !== 'string' || !/^(act_)?[0-9]{1,32}$/.test(account_id)) return { ok: false, outcome: 'denied_bad_params' };
  return { ok: true, account: normalize(account_id), params: rest };
}

async function ownerNotification(db: any, type: string, title: string, message: string) {
  const { data: owner, error } = await db.rpc('agent_gateway_write_owner');
  if (!error && owner) await db.from('notifications').insert({ recipient_id: owner, type, title, message });
}
export async function alertUnmapped(db: any, agentId: string, integrationId: string, account: string) {
  const { data, error } = await db.from('gateway_unmapped_account_alerts').upsert({ agent_id: agentId, integration_id: integrationId, account_id: account }, { onConflict: 'agent_id,integration_id,account_id', ignoreDuplicates: true }).select('account_id');
  if (error) return false;
  if (data?.length) await ownerNotification(db, 'agent_gateway_unmapped_account', 'Unmapped Meta account write requested', `[UNMAPPED] Agent ${agentId}, integration ${integrationId}, account ${account}`);
  return true;
}
async function tokenExpired(deps: AccountDeps, integrationId: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(deps.now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  const { data, error } = await deps.db.from('gateway_token_expired_alerts').upsert({ integration_id: integrationId, alert_day: day }, { onConflict: 'integration_id,alert_day', ignoreDuplicates: true }).select('integration_id');
  if (!error && data?.length) await ownerNotification(deps.db, 'agent_gateway_token_expired', 'Meta account lookup token expired', `Integration ${integrationId} requires a renewed Meta token.`);
}

async function mapped(db: any, account: string): Promise<boolean | null> {
  // account_id on a Meta OAuth connection is a user id; selected_ad_account is the actual ad account.
  const { data: connections, error: ce } = await db.from('platform_connections').select('client_id,selected_ad_account,metadata').eq('platform', 'meta');
  const { data: integrations, error: ie } = await db.from('integrations').select('account_ref').eq('provider', 'meta_ads');
  const { data: grants, error: ge } = await db.from('agent_grants').select('allowed_account_refs,integration_id');
  if (ce || ie || ge) return null;
  return (connections ?? []).some((r: any) => {
    const selected = r.selected_ad_account;
    const refs = [selected?.id, selected?.account_id, ...(r.metadata?.ad_accounts ?? []).map((a: any) => a?.account_id ?? a?.id), ...(r.metadata?.sync_account_ids ?? [])];
    return refs.some((id: unknown) => typeof id === 'string' && normalize(id) === account);
  })
    || (integrations ?? []).some((r: any) => typeof r.account_ref === 'string' && normalize(r.account_ref) === account)
    || (grants ?? []).some((r: any) => (r.allowed_account_refs ?? []).some((id: string) => normalize(id) === account));
}

export async function resolveAllAccounts(deps: AccountDeps, integration: { id: string; provider: string; allowed_hosts?: string[] }, account: string, secrets: SecretsProvider, secretRef: string | null, expiresAt: string | null): Promise<AccountResult> {
  if (!expiresAt || new Date(expiresAt) <= deps.now) return { ok: false, outcome: 'denied_grant_expired' };
  if (integration.provider !== 'meta_ads') return { ok: false, outcome: 'denied_action_provider_mismatch' };
  if (!(integration.allowed_hosts ?? []).includes('graph.facebook.com')) return { ok: false, outcome: 'denied_host_not_allowed' };
  try {
    const { data: blocks, error: be } = await deps.db.from('gateway_account_blocklist').select('integration_id').eq('account_id', account);
    if (be) return { ok: false, outcome: 'denied_account_lookup_failed' };
    if ((blocks ?? []).some((b: any) => b.integration_id === null || b.integration_id === integration.id)) return { ok: false, outcome: 'denied_account_blocklisted' };
    // Resolve only after the unconditional blocklist check. Never persist the secret.
    const secret = secretRef ? await secrets.resolve(secretRef) : { ok: false as const };
    if (!secret.ok) return { ok: false, outcome: 'denied_account_lookup_failed' };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret.value));
    const fingerprint = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const { data: epoch, error: ee } = await deps.db.from('gateway_cache_epoch').select('epoch').eq('id', 1).maybeSingle();
    if (ee || !epoch) return { ok: false, outcome: 'denied_account_lookup_failed' };
    const { data: cache, error: cacheError } = await deps.db.from('gateway_visible_accounts_cache').select('account_ids,fetched_at,blocklist_epoch').eq('integration_id', integration.id).eq('token_fingerprint', fingerprint).maybeSingle();
    if (cacheError) return { ok: false, outcome: 'denied_account_lookup_failed' };
    let ids: string[] = [];
    if (cache && new Date(cache.fetched_at).getTime() > deps.now.getTime() - 15 * 60_000 && new Date(cache.fetched_at) <= deps.now && String(cache.blocklist_epoch) === String(epoch.epoch)) ids = cache.account_ids;
    else {
      let url: URL | null = new URL('https://graph.facebook.com/v21.0/me/adaccounts?fields=account_id&limit=500');
      for (let page = 0; url && page < 10; page++) {
        if (url.protocol !== 'https:' || url.host !== 'graph.facebook.com' || url.username || url.password || url.pathname !== '/v21.0/me/adaccounts') return { ok: false, outcome: 'denied_account_lookup_failed' };
        // Do not trust a token in paging.next; always use this integration's secret in a header.
        url.searchParams.delete('access_token');
        const res: Response = await (deps.fetch ?? fetch)(url.toString(), { headers: { Authorization: `Bearer ${secret.value}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
        const body: any = await res.json().catch(() => null);
        if (body?.error?.code === 190) await tokenExpired(deps, integration.id);
        if (!res.ok || body?.error || !Array.isArray(body?.data)) return { ok: false, outcome: 'denied_account_lookup_failed' };
        for (const row of body.data) if (typeof row.account_id === 'string' && /^[0-9]{1,32}$/.test(row.account_id)) ids.push(row.account_id);
        url = body.paging?.next ? new URL(body.paging.next) : null;
      }
      // A truncated listing is not a complete visible set.
      if (url || !ids.length) return { ok: false, outcome: 'denied_account_lookup_failed' };
      ids = [...new Set(ids)];
      const { error: saveError } = await deps.db.from('gateway_visible_accounts_cache').upsert({ integration_id: integration.id, token_fingerprint: fingerprint, account_ids: ids, fetched_at: deps.now.toISOString(), blocklist_epoch: epoch.epoch }, { onConflict: 'integration_id,token_fingerprint' });
      if (saveError) return { ok: false, outcome: 'denied_account_lookup_failed' };
      await deps.db.from('gateway_visible_accounts_cache').delete().eq('integration_id', integration.id).neq('token_fingerprint', fingerprint);
    }
    if (!ids.length) return { ok: false, outcome: 'denied_account_lookup_failed' };
    // Re-check in case the blocklist changed while the network request was running.
    const { data: latest, error: le } = await deps.db.from('gateway_account_blocklist').select('integration_id').eq('account_id', account);
    if (le) return { ok: false, outcome: 'denied_account_lookup_failed' };
    if ((latest ?? []).some((b: any) => b.integration_id === null || b.integration_id === integration.id)) return { ok: false, outcome: 'denied_account_blocklisted' };
    if (!ids.includes(account)) return { ok: false, outcome: 'denied_account_not_allowed' };
    const mapping = await mapped(deps.db, account);
    if (mapping === null) return { ok: false, outcome: 'denied_account_lookup_failed' };
    return { ok: true, account, mapping: mapping ? 'mapped' : 'unmapped' };
  } catch { return { ok: false, outcome: 'denied_account_lookup_failed' }; }
}