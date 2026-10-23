// Summary shown before AJ uses 'Allow all changes' on one agent. Mirrors grant_agent_write_scope_all
// and agent_write_arm_blocker (migration 0048); the database re-checks everything.
export const KEY_LOCK_CUTOFF = '2026-10-15T23:14:09.016Z'; // migration 0040: earlier key creators were backfilled
const norm = (id: string) => id.replace(/^act_/, '');

export interface WriteAllInput {
  agent: { id: string; owner_team_member_id: string | null; status: string };
  grants: any[];
  integrations: any[];
  tokens: any[];
  activeClientIds: string[];
  clientAdAccounts: { client_id: string; account_id: string; platform?: string }[];
  connections: { client_id: string | null; selected_ad_account_id?: string | null }[];
  now?: Date;
}

export function summarizeWriteAll(i: WriteAllInput) {
  const now = i.now ?? new Date();
  const active = new Set(i.activeClientIds);
  const meta = new Map(i.integrations.filter((x) => x.provider === 'meta_ads').map((x) => [x.id, x]));
  const live = i.grants.filter((g) => g.agent_id === i.agent.id && !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > now) && meta.has(g.integration_id));
  const hasWrite = (g: any) => (g.scopes ?? []).includes('write');
  const targets = live.filter((g) => !hasWrite(g));
  const mapped = new Set<string>([
    ...i.clientAdAccounts.filter((r) => (r.platform ?? 'meta') === 'meta' && active.has(r.client_id)).map((r) => norm(r.account_id)),
    ...i.connections.filter((c) => c.client_id && active.has(c.client_id) && c.selected_ad_account_id).map((c) => norm(c.selected_ad_account_id!)),
    ...[...meta.values()].filter((x) => x.client_id && active.has(x.client_id) && x.account_ref).map((x) => norm(x.account_ref)),
  ]);
  const accounts = new Set<string>();
  for (const g of targets) {
    for (const a of g.allowed_account_refs ?? []) accounts.add(norm(a));
    const ref = meta.get(g.integration_id)?.account_ref;
    if (ref && !(g.allowed_account_refs ?? []).length) accounts.add(norm(ref));
  }
  const keys = i.tokens.filter((t) => t.agent_id === i.agent.id && !t.revoked_at && new Date(t.expires_at) > now)
    .map((t) => ({ ...t, pre0040: new Date(t.created_at) < new Date(KEY_LOCK_CUTOFF), leaked: !!t.leaked }));
  const blockers: string[] = [];
  if (!i.agent.owner_team_member_id) blockers.push('This agent has no owner.');
  if (i.agent.status !== 'active') blockers.push('This agent is not active.');
  if (keys.some((k) => k.pre0040)) blockers.push('An active key was made before key creators were tracked. AJ must revoke it and make a new one.');
  if (keys.some((k) => k.leaked)) blockers.push('An active key is marked leaked. Revoke it first.');
  return {
    targets, skipped: live.length - targets.length,
    allAccountsTargets: targets.filter((g) => g.all_accounts),
    accounts: [...accounts], unmapped: [...accounts].filter((a) => !mapped.has(a)),
    keys, blockers,
  };
}
