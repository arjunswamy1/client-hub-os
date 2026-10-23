import { describe, it, expect } from 'vitest';
import { summarizeWriteAll } from '@/lib/agentWriteAll';

const now = new Date('2026-10-23T16:00:00Z');
const base = () => ({
  agent: { id: 'a', owner_team_member_id: 'o', status: 'active' },
  integrations: [{ id: 'm', provider: 'meta_ads', client_id: null, account_ref: null }, { id: 'r', provider: 'ringba' }],
  grants: [
    { id: 'g1', agent_id: 'a', integration_id: 'm', scopes: ['read'], allowed_account_refs: ['act_111', '222'] },
    { id: 'g2', agent_id: 'a', integration_id: 'r', scopes: ['read'] },
  ],
  tokens: [] as any[],
  activeClientIds: ['c1'],
  clientAdAccounts: [{ client_id: 'c1', account_id: '111' }, { client_id: 'off', account_id: '222' }],
  connections: [] as any[],
  now,
});

describe('Allow all changes summary', () => {
  it('only Meta grants without write are targets', () => {
    const s = summarizeWriteAll(base());
    expect(s.targets.map((g) => g.id)).toEqual(['g1']);
  });
  it('an account tied only to an inactive client is listed as unmapped', () => {
    expect(summarizeWriteAll(base()).unmapped).toEqual(['222']);
  });
  it('a key made before migration 0040 blocks', () => {
    const i = base(); i.tokens = [{ agent_id: 'a', created_at: '2026-10-14T00:00:00Z', expires_at: '2027-01-01' }];
    expect(summarizeWriteAll(i).blockers.length).toBe(1);
  });
  it('a leaked active key blocks; a revoked one does not', () => {
    const i = base(); i.tokens = [{ agent_id: 'a', created_at: '2026-10-20T00:00:00Z', expires_at: '2027-01-01', leaked: true }];
    expect(summarizeWriteAll(i).blockers.length).toBe(1);
    i.tokens[0].revoked_at = '2026-10-21';
    expect(summarizeWriteAll(i).blockers.length).toBe(0);
  });
  it('all_accounts targets are flagged separately', () => {
    const i = base(); i.grants[0].all_accounts = true;
    expect(summarizeWriteAll(i).allAccountsTargets.map((g) => g.id)).toEqual(['g1']);
  });
});
