import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { reviewWriteGrant, canSaveWriteGrant, type WriteGrantReview } from '@/lib/agentWriteGrantReview';

const db = supabase as any;
const ENDPOINT = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/agent-gateway`;
const PROVIDER_HOSTS: Record<string, string> = { meta_ads: 'graph.facebook.com', callgrid: 'api.callgrid.com', roku: 'api.ads.roku.com' };
const ACTION_NAMES: Record<string, string[]> = {
  meta_ads: ['meta.account.read', 'meta.campaigns.read', 'meta.insights.read'],
  callgrid: ['callgrid.calls.read'],
  roku: ['roku.accounts.read', 'roku.campaigns.read'],
};
function TestResult({ r }: { r: any }) {
  if (r.error) return <p className="text-sm text-destructive">Could not run the test: {r.error}</p>;
  const line = (ok: boolean | undefined, text: string) => <p className={ok ? 'text-sm' : 'text-sm text-destructive'}>{ok ? '✓' : '✗'} {text}</p>;
  return (
    <div className="space-y-1">
      {line(r.token_present, r.token_present ? '1Password key is saved in the hub' : '1Password key is not saved yet')}
      {r.token_present && line(r.reachable, r.reachable ? `1Password reachable (${r.vault_count ?? 0} vault${r.vault_count === 1 ? '' : 's'} visible)` : '1Password could not be reached')}
      {r.reference_resolves !== undefined && line(r.reference_resolves, r.reference_resolves ? 'That reference resolves' : 'That reference does not resolve')}
    </div>
  );
}
const OP_REF = /^op:\/\/[^/\t\r\n]+\/[^/\t\r\n]+(\/[^/\t\r\n]+)+$/;

async function sha256Hex(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const WRITE_OWNER = '1fdd684e-6cb7-447e-b616-7e1b9c598971'; // AJ: only person who may switch writes on or give a grant write scope (also enforced in the database)
const newToken = () => `agw_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

export default function AgentAccessPage() {
  const { teamMember } = useAuth();
  const me = teamMember?.id ?? null;
  const [enabled, setEnabled] = useState(false);
  const [vault, setVault] = useState('CPM Bot Vault');
  const [vaultDraft, setVaultDraft] = useState('CPM Bot Vault');
  const [agents, setAgents] = useState<any[]>([]);
  const [tokens, setTokens] = useState<any[]>([]);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [grants, setGrants] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [handoffs, setHandoffs] = useState<any[]>([]);
  const [ws, setWs] = useState<any>(null);
  const [writeReqs, setWriteReqs] = useState<any[]>([]);
  const [ownerHistory, setOwnerHistory] = useState<any[]>([]);
  const [grantReview, setGrantReview] = useState<{ grant: any; review: WriteGrantReview; confirmed: boolean } | null>(null);
  const [perm, setPerm] = useState<{ busy: boolean; result: any }>({ busy: false, result: null });
  const [test, setTest] = useState<{ ref: string; busy: boolean; result: any }>({ ref: '', busy: false, result: null });
  const [shown, setShown] = useState<string | null>(null);
  const [a, setA] = useState({ name: '', kind: 'ai_agent', team: 'ops' });
  const [t, setT] = useState({ agent_id: '', label: '', days: '90', audience: 'hub' });
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [scopes, setScopes] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [i, setI] = useState({ provider: '', label: '', account_ref: '', op_secret_ref: '', allowed_hosts: '', browser: false });
  const [g, setG] = useState({ agent_id: '', integration_id: '', handoff: false, per_min: '30', per_day: '2000', days: '' });

  const load = async () => {
    const [s, ag, tk, it, gr, lg, ho, cl, sc, tm, wr, oh] = await Promise.all([
      db.from('agent_gateway_settings').select('*').eq('id', 1).maybeSingle(),
      db.from('agents').select('*').order('created_at'),
      db.from('agent_gateway_tokens').select('id, agent_id, token_prefix, label, audience, expires_at, revoked_at, last_used_at, created_at').order('created_at', { ascending: false }),
      db.from('integrations').select('*').order('created_at'),
      db.from('agent_grants').select('*').order('created_at'),
      db.from('agent_access_log').select('agent_id, created_at').eq('event_type', 'denied').gte('created_at', new Date(Date.now() - 86400000).toISOString()).limit(2000),
      db.from('agent_handoff_requests').select('*').order('created_at', { ascending: false }).limit(100),
      db.from('clients').select('id, name').eq('status', 'active').order('name'),
      db.from('agent_client_scopes').select('id, agent_id, client_id'),
      db.from('team_members').select('id, name, is_active').eq('is_service_account', false).order('name'),
      db.from('agent_write_requests').select('*').order('requested_at', { ascending: false }).limit(100),
      db.from('agent_owner_history').select('*').order('changed_at'),
    ]);
    setOwnerHistory(oh.data ?? []);
    setWs(s.data ?? null); setWriteReqs(wr.data ?? []);
    setClientsList(cl.data ?? []); setScopes(sc.data ?? []); setMembers(tm.data ?? []);
    setEnabled(!!s.data?.gateway_enabled); setAgents(ag.data ?? []); setTokens(tk.data ?? []);
    const v = s.data?.default_vault ?? 'CPM Bot Vault'; setVault(v); setVaultDraft(v);
    setIntegrations(it.data ?? []); setGrants(gr.data ?? []); setLogs(lg.data ?? []); setHandoffs(ho.data ?? []);
  };
  useEffect(() => { load(); }, []);
  const run = async (p: Promise<{ error: any }>, ok: string) => { const { error } = await p; if (error) toast.error(error.message); else { toast.success(ok); load(); } };
  const agentName = (id: string) => agents.find((x) => x.id === id)?.name ?? '—';
  const integName = (id: string) => integrations.find((x) => x.id === id)?.label ?? '—';

  const mint = async () => {
    if (!t.agent_id) return toast.error('Pick an agent');
    const token = newToken();
    const { error } = await db.from('agent_gateway_tokens').insert({
      agent_id: t.agent_id, label: t.label || null, token_hash: await sha256Hex(token), token_prefix: token.slice(0, 12),
      expires_at: new Date(Date.now() + Number(t.days) * 86400000).toISOString(), created_by_id: me, audience: t.audience,
    });
    if (error) return toast.error(error.message);
    setShown(token); setT({ ...t, label: '' }); load();
  };
  const addIntegration = () => {
    if (!i.provider || !i.label) return toast.error('Service and label are required');
    if (/slack/i.test(i.provider)) return toast.error('Slack is not available through the gateway');
    if (i.op_secret_ref && !OP_REF.test(i.op_secret_ref)) return toast.error('Reference must look like op://vault/item/field');
    run(db.from('integrations').insert({
      provider: i.provider.trim(), label: i.label.trim(), account_ref: i.account_ref || null, op_secret_ref: i.op_secret_ref || null,
      allowed_hosts: (i.allowed_hosts || PROVIDER_HOSTS[i.provider.trim()] || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean), is_browser_login: i.browser, created_by_id: me,
    }), 'Account added');
    setI({ provider: '', label: '', account_ref: '', op_secret_ref: '', allowed_hosts: '', browser: false });
  };
  const addGrant = () => {
    if (!g.agent_id || !g.integration_id) return toast.error('Pick an agent and an account');
    run(db.from('agent_grants').upsert({
      agent_id: g.agent_id, integration_id: g.integration_id, scopes: ['read'], allow_browser_handoff: g.handoff,
      rate_per_minute: Number(g.per_min), rate_per_day: Number(g.per_day), revoked_at: null,
      expires_at: g.days ? new Date(Date.now() + Number(g.days) * 86400000).toISOString() : null, granted_by_id: me,
    }, { onConflict: 'agent_id,integration_id' }), 'Permission saved');
  };

  const testConnection = async (ref?: string) => {
    setTest((t) => ({ ...t, busy: true, result: null }));
    const { data, error } = await supabase.functions.invoke('agent-gateway-admin', { body: ref ? { reference: ref } : {} });
    setTest((t) => ({ ...t, busy: false, result: error ? { error: error.message } : data }));
  };
  const isOwner = me === WRITE_OWNER;
  const approvers: string[] = ws?.write_approver_team_member_ids ?? [];
  const memberName = (id: string) => members.find((x) => x.id === id)?.name ?? '—';
  const ownerOf = (agentId: string) => agents.find((x) => x.id === agentId)?.owner_team_member_id ?? null;
  const decideWrite = async (id: string, approve: boolean) => {
    const { data, error } = await db.rpc('decide_agent_write_request', { p_request_id: id, p_approve: approve });
    if (error) return toast.error(error.message);
    if (!data?.ok) return toast.error(`Not done: ${data?.outcome}`);
    if (approve) {
      const { data: ex, error: exErr } = await supabase.functions.invoke('agent-gateway-write-exec', { body: { request_id: id } });
      if (exErr) toast.error('Approved, but the change did not run yet; it will run when the bot checks back (within 30 minutes).');
      else toast.success(ex?.status === 'executed' ? 'Approved and made on Meta' : `Approved — ${ex?.status}${ex?.failure_outcome ? ` (${ex.failure_outcome})` : ''}`);
    } else toast.success('Denied');
    load();
  };
  const saveWriteScope = (x: any, give: boolean) => {
    const next = give ? [...new Set([...(x.scopes ?? []), 'write'])] : (x.scopes ?? []).filter((s: string) => s !== 'write');
    run(db.from('agent_grants').update({ scopes: next }).eq('id', x.id), give ? 'Changes allowed (each one still needs approval)' : 'Changes no longer allowed');
  };
  const toggleWriteScope = (x: any) => {
    const review = reviewWriteGrant(x, ownerOf(x.agent_id), ownerHistory);
    // Giving write scope (first time or again) always goes through an explicit owner confirmation.
    if (review.needsConfirm) return setGrantReview({ grant: x, review, confirmed: false });
    saveWriteScope(x, false);
  };
  const checkPerm = async () => {
    setPerm({ busy: true, result: null });
    const { data, error } = await supabase.functions.invoke('agent-gateway-admin', { body: { check_meta_write_permission: true } });
    setPerm({ busy: false, result: error ? { error: error.message } : data });
  };
  const pendingWrites = writeReqs.filter((w) => w.status === 'pending' && new Date(w.decision_expires_at) > new Date());
  const decide = (id: string, approve: boolean) => run(db.rpc('decide_agent_handoff', { p_request_id: id, p_approve: approve }), approve ? 'Approved for 15 minutes' : 'Denied');

  // Unusual activity: 5+ refusals in any 10 minutes, or 20+ in 24 hours (flag only, no messages).
  const flagged = agents.map((ag) => {
    const ts = logs.filter((l) => l.agent_id === ag.id).map((l) => new Date(l.created_at).getTime()).sort((a, b) => a - b);
    let burst = 0;
    for (let k = 0, j = 0; k < ts.length; k++) { while (ts[k] - ts[j] > 600000) j++; burst = Math.max(burst, k - j + 1); }
    return { agent: ag, total: ts.length, burst };
  }).filter((x) => x.burst >= 5 || x.total >= 20);
  const pending = handoffs.filter((h) => h.status === 'pending');

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agent access</h1>
          <p className="text-sm text-muted-foreground">Decide which agents may use which shared accounts. Passwords and keys stay in 1Password; this page only holds pointers.</p>
          <p className="mt-1 text-xs text-muted-foreground">Gateway address: <code className="rounded bg-muted px-1">{ENDPOINT}</code></p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          Gateway {enabled ? 'on' : 'off'}
          <Switch checked={enabled} onCheckedChange={(v) => run(db.from('agent_gateway_settings').update({ gateway_enabled: v, updated_by_id: me, updated_at: new Date().toISOString() }).eq('id', 1), v ? 'Gateway on' : 'Gateway off')} />
        </label>
        <label className="flex items-center gap-2 text-sm" title={isOwner ? '' : 'Only AJ can switch changes on or off'}>
          Changes {ws?.writes_enabled ? 'on' : 'off'}
          <Switch disabled={!isOwner} checked={!!ws?.writes_enabled} onCheckedChange={(v) => run(db.from('agent_gateway_settings').update({ writes_enabled: v, updated_by_id: me, updated_at: new Date().toISOString() }).eq('id', 1), v ? 'Agent changes on' : 'Agent changes off')} />
        </label>
      </div>

      {flagged.length > 0 && (
        <Card className="border-destructive">
          <CardHeader><CardTitle className="text-base">Unusual activity</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {flagged.map((x) => <p key={x.agent.id}><span className="font-medium">{x.agent.name}</span>: {x.total} refused calls in the last 24 hours (up to {x.burst} within 10 minutes). Check Activity, or use the kill switch.</p>)}
          </CardContent>
        </Card>
      )}

      {shown && (
        <Card className="border-primary">
          <CardHeader><CardTitle className="text-base">Copy this key now — it will not be shown again</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-muted p-2 text-sm">{shown}</code>
            <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(shown); toast.success('Copied'); }}><Copy className="h-4 w-4" /></Button>
            <Button variant="ghost" onClick={() => setShown(null)}>Done</Button>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="agents">
        <TabsList>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="keys">Keys</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="grants">Permissions</TabsTrigger>
          <TabsTrigger value="changes">Changes{pendingWrites.length ? ` (${pendingWrites.length})` : ''}</TabsTrigger>
          <TabsTrigger value="handoffs">Hand-offs{pending.length ? ` (${pending.length})` : ''}</TabsTrigger>
          <TabsTrigger value="log">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="agents" className="space-y-4">
          <Card><CardContent className="grid gap-3 pt-6 md:grid-cols-4">
            <Input placeholder="Agent name" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} />
            <Select value={a.kind} onValueChange={(v) => setA({ ...a, kind: v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="ai_agent">AI agent</SelectItem><SelectItem value="teammate_agent">Teammate's agent</SelectItem></SelectContent></Select>
            <Select value={a.team} onValueChange={(v) => setA({ ...a, team: v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{['media', 'creative', 'client', 'ops'].map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent></Select>
            <Button onClick={() => { if (!a.name.trim()) return toast.error('Name required'); run(db.from('agents').insert({ ...a, name: a.name.trim(), owner_team_member_id: me, created_by_id: me }), 'Agent added'); setA({ ...a, name: '' }); }}>Add agent</Button>
          </CardContent></Card>
          {agents.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
              <span className="font-medium">{x.name}</span><Badge variant="outline">{x.kind === 'ai_agent' ? 'AI agent' : "Teammate's agent"}</Badge><Badge variant="outline">{x.team}</Badge>
              <Badge variant={x.status === 'active' ? 'default' : 'destructive'}>{x.status}</Badge>
              <span className="text-xs text-muted-foreground">owner {members.find((m) => m.id === x.owner_team_member_id)?.name ?? 'none'}{members.find((m) => m.id === x.owner_team_member_id)?.is_active === false ? ' (inactive)' : ''}</span>
              <div className="flex w-full flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground">Hub clients:</span>
                {scopes.filter((s) => s.agent_id === x.id).map((s) => (
                  <Badge key={s.id} variant="secondary" className="cursor-pointer" title="Remove" onClick={() => run(db.from('agent_client_scopes').delete().eq('id', s.id), 'Client removed')}>{clientsList.find((c) => c.id === s.client_id)?.name ?? 'client'} ×</Badge>
                ))}
                <Select value="" onValueChange={(v) => run(db.from('agent_client_scopes').insert({ agent_id: x.id, client_id: v, created_by_id: me }), 'Client added')}>
                  <SelectTrigger className="h-7 w-40"><SelectValue placeholder="Add client" /></SelectTrigger>
                  <SelectContent>{clientsList.filter((c) => !scopes.some((s) => s.agent_id === x.id && s.client_id === c.id)).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="ml-auto flex gap-2">
                {x.status === 'active'
                  ? <Button variant="destructive" size="sm" onClick={() => run(db.from('agents').update({ status: 'killed', killed_at: new Date().toISOString(), killed_by_id: me, killed_reason: 'admin kill switch' }).eq('id', x.id), 'Agent stopped')}>Kill switch</Button>
                  : <Button variant="outline" size="sm" onClick={() => run(db.from('agents').update({ status: 'active', killed_at: null, killed_by_id: null, killed_reason: null }).eq('id', x.id), 'Agent restored')}>Restore</Button>}
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="keys" className="space-y-4">
          <Card><CardContent className="grid gap-3 pt-6 md:grid-cols-5">
            <Select value={t.agent_id} onValueChange={(v) => setT({ ...t, agent_id: v })}><SelectTrigger><SelectValue placeholder="Agent" /></SelectTrigger>
              <SelectContent>{agents.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select>
            <Input placeholder="Label" value={t.label} onChange={(e) => setT({ ...t, label: e.target.value })} />
            <Select value={t.audience} onValueChange={(v) => setT({ ...t, audience: v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="hub">Hub key (its clients only)</SelectItem><SelectItem value="gateway">Account gateway key</SelectItem></SelectContent></Select>
            <Select value={t.days} onValueChange={(v) => setT({ ...t, days: v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="30">Expires in 30 days</SelectItem><SelectItem value="90">Expires in 90 days</SelectItem><SelectItem value="365">Expires in 1 year</SelectItem></SelectContent></Select>
            <Button onClick={mint}>Create key</Button>
            <p className="text-xs text-muted-foreground md:col-span-5">Hub keys connect to the hub server at <code className="rounded bg-muted px-1">{`https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/mcp-hub`}</code> and see only the agent's hub clients its owner is assigned to.</p>
          </CardContent></Card>
          {tokens.map((x) => {
            const expired = new Date(x.expires_at) < new Date();
            return (
              <div key={x.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
                <code className="text-xs">{x.token_prefix}…</code><Badge variant="outline">{x.audience === 'hub' ? 'hub' : 'gateway'}</Badge><span className="font-medium">{agentName(x.agent_id)}</span><span className="text-muted-foreground">{x.label}</span>
                {x.revoked_at ? <Badge variant="destructive">revoked</Badge> : expired ? <Badge variant="secondary">expired</Badge> : <Badge>active</Badge>}
                <span className="text-xs text-muted-foreground">last used {x.last_used_at ? new Date(x.last_used_at).toLocaleString() : 'never'} · expires {new Date(x.expires_at).toLocaleDateString()}</span>
                {!x.revoked_at && <Button className="ml-auto" variant="outline" size="sm" onClick={() => run(db.from('agent_gateway_tokens').update({ revoked_at: new Date().toISOString(), revoked_by_id: me }).eq('id', x.id), 'Key revoked')}>Revoke</Button>}
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="accounts" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Test 1Password connection</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Input className="max-w-md" placeholder={`Optional: op://${vault}/item/field to check`} value={test.ref} onChange={(e) => setTest({ ...test, ref: e.target.value })} />
                <Button variant="outline" disabled={test.busy} onClick={() => testConnection(test.ref.trim() || undefined)}>{test.busy ? 'Testing…' : 'Test connection'}</Button>
              </div>
              {test.result && <TestResult r={test.result} />}
              <p className="text-xs text-muted-foreground">Only shows whether things work. Values are never shown.</p>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="text-sm">Default vault</span>
                <Input className="max-w-xs" value={vaultDraft} onChange={(e) => setVaultDraft(e.target.value)} />
                <Button variant="outline" size="sm" disabled={!vaultDraft.trim() || vaultDraft.trim() === vault || vaultDraft.includes('/')}
                  onClick={() => run(db.from('agent_gateway_settings').update({ default_vault: vaultDraft.trim() }).eq('id', 1), 'Default vault saved')}>Save</Button>
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">Read-only actions available: {Object.entries(ACTION_NAMES).map(([p, a]) => `${p}: ${a.join(', ')}`).join(' · ')}. Changes are switched off for now; Slack is not available here.</p>
          <Card><CardContent className="grid gap-3 pt-6 md:grid-cols-3">
            <Input placeholder="Service: meta_ads, callgrid or roku" value={i.provider} onChange={(e) => setI({ ...i, provider: e.target.value })} />
            <Input placeholder="Label, e.g. Cannaball Meta" value={i.label} onChange={(e) => setI({ ...i, label: e.target.value })} />
            <Input placeholder="Account id (optional)" value={i.account_ref} onChange={(e) => setI({ ...i, account_ref: e.target.value })} />
            <Input placeholder={`1Password reference: op://${vault}/item/field`} value={i.op_secret_ref} onChange={(e) => setI({ ...i, op_secret_ref: e.target.value })} />
            <Input placeholder={`Allowed hosts (default for ${i.provider || 'service'}: ${PROVIDER_HOSTS[i.provider.trim()] ?? 'none'})`} value={i.allowed_hosts} onChange={(e) => setI({ ...i, allowed_hosts: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={i.browser} onCheckedChange={(v) => setI({ ...i, browser: v === true })} />Browser login (hand-off only)</label>
            <Button onClick={addIntegration}>Add account</Button>
          </CardContent></Card>
          {integrations.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
              <span className="font-medium">{x.label}</span><Badge variant="outline">{x.provider}</Badge>
              <code className="text-xs text-muted-foreground">{x.op_secret_ref ?? 'no reference'}</code>
              {x.is_browser_login && <Badge variant="secondary">browser login</Badge>}
              {x.op_secret_ref && <Button variant="outline" size="sm" disabled={test.busy} onClick={() => { setTest({ ...test, ref: x.op_secret_ref }); testConnection(x.op_secret_ref); }}>Test</Button>}
              <label className="ml-auto flex items-center gap-2 text-xs">Enabled
                <Switch checked={x.enabled} onCheckedChange={(v) => run(db.from('integrations').update({ enabled: v }).eq('id', x.id), v ? 'Account enabled' : 'Account disabled')} /></label>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="grants" className="space-y-4">
          <Card><CardContent className="grid gap-3 pt-6 md:grid-cols-6 md:items-center">
            <Select value={g.agent_id} onValueChange={(v) => setG({ ...g, agent_id: v })}><SelectTrigger><SelectValue placeholder="Agent" /></SelectTrigger>
              <SelectContent>{agents.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select>
            <Select value={g.integration_id} onValueChange={(v) => setG({ ...g, integration_id: v })}><SelectTrigger><SelectValue placeholder="Account" /></SelectTrigger>
              <SelectContent>{integrations.map((x) => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}</SelectContent></Select>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={g.handoff} onCheckedChange={(v) => setG({ ...g, handoff: v === true })} />May request browser hand-off</label>
            <Input type="number" placeholder="Per minute" value={g.per_min} onChange={(e) => setG({ ...g, per_min: e.target.value })} />
            <Input type="number" placeholder="Per day" value={g.per_day} onChange={(e) => setG({ ...g, per_day: e.target.value })} />
            <Button onClick={addGrant}>Save permission</Button>
          </CardContent></Card>
          {grants.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
              <span className="font-medium">{agentName(x.agent_id)}</span><span>→ {integName(x.integration_id)}</span>
              {x.scopes.map((s: string) => <Badge key={s} variant="outline">{s === 'read' ? 'view' : 'change'}</Badge>)}
              {x.allow_browser_handoff && <Badge variant="outline">hand-off</Badge>}
              {isOwner && !x.revoked_at && integrations.find((it) => it.id === x.integration_id)?.provider === 'meta_ads' && (
                <Button variant="outline" size="sm" onClick={() => toggleWriteScope(x)}>{(x.scopes ?? []).includes('write') ? 'Stop changes' : 'Allow changes'}</Button>
              )}
              <span className="text-xs text-muted-foreground">{x.rate_per_minute}/min · {x.rate_per_day}/day{x.expires_at ? ` · until ${new Date(x.expires_at).toLocaleDateString()}` : ''}</span>
              {x.revoked_at ? <Badge variant="destructive">removed</Badge>
                : <Button className="ml-auto" variant="outline" size="sm" onClick={() => run(db.from('agent_grants').update({ revoked_at: new Date().toISOString() }).eq('id', x.id), 'Permission removed')}>Remove</Button>}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="changes" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Meta changes agents have asked for. Nothing happens on Meta until an approver approves; the hub then makes that exact change once, within {ws?.write_approval_ttl_minutes ?? 30} minutes.
            Approvers: {approvers.map(memberName).join(', ') || 'none'}. Nobody can approve requests from their own agent. Caps: ±{ws?.write_max_budget_change_pct ?? 50}% and ${ws?.write_max_daily_budget_usd ?? 1000}/day per budget change, {ws?.write_requests_per_day ?? 20} requests per agent per day.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={perm.busy} onClick={checkPerm}>Check Meta permission</Button>
            {perm.result && <span className="text-sm">{perm.result.error ? `Check failed: ${perm.result.error}` : perm.result.ads_management === true ? 'Meta key can make changes (ads_management: yes)' : perm.result.ads_management === false ? 'Meta key cannot make changes (ads_management: no)' : `Could not tell (${perm.result.reason})`}</span>}
          </div>
          {writeReqs.map((w) => {
            const reqOwner = w.agent_owner_team_member_id ?? null;
            const keyMine = !!me && w.token_created_by_id === me;
            const ownMine = reqOwner === me && me !== WRITE_OWNER;
            const canDecide = !!me && approvers.includes(me) && !ownMine && !keyMine && !!reqOwner && !!w.token_created_by_id;
            const open = w.status === 'pending' && new Date(w.decision_expires_at) > new Date();
            return (
              <div key={w.id} className="space-y-1 rounded border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{agentName(w.agent_id)}</span>
                  <code className="rounded bg-muted px-1 text-xs">{w.action}</code>
                  <Badge variant={w.status === 'pending' ? 'secondary' : ['denied', 'failed', 'expired'].includes(w.status) ? 'destructive' : 'outline'}>{open || w.status !== 'pending' ? w.status : 'expired'}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(w.requested_at).toLocaleString()}</span>
                  {open && (canDecide ? (
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" onClick={() => decideWrite(w.id, true)}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => decideWrite(w.id, false)}>Deny</Button>
                    </div>
                  ) : <span className="ml-auto text-xs text-muted-foreground">{keyMine ? 'You made the key this came in on — another approver must decide' : ownMine ? 'Your own agent — another approver must decide' : 'Waiting for an approver'}</span>)}
                </div>
                <p>{w.diff_text}</p>
                <p className="text-muted-foreground">Reason: “{w.reason}”{w.decided_by_id ? ` · decided by ${memberName(w.decided_by_id)}` : ''}{w.failure_outcome ? ` · ${w.failure_outcome}` : ''}</p>
              </div>
            );
          })}
          {!writeReqs.length && <p className="text-sm text-muted-foreground">No change requests yet.</p>}
        </TabsContent>
        <Dialog open={!!grantReview} onOpenChange={(o) => { if (!o) setGrantReview(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Allow {grantReview ? agentName(grantReview.grant.agent_id) : ''} to request Meta changes?</DialogTitle>
              <DialogDescription>Check who owns this agent before saving. Each change it asks for will still need approval.</DialogDescription>
            </DialogHeader>
            {grantReview && (
              <div className="space-y-2 text-sm">
                <p>Current owner: <span className="font-medium">{grantReview.review.currentOwnerId ? memberName(grantReview.review.currentOwnerId) : 'nobody'}</span></p>
                <p className="text-muted-foreground">{grantReview.review.lastHeldAt
                  ? `Last allowed changes until ${new Date(grantReview.review.lastHeldAt).toLocaleString()}, when the owner was ${grantReview.review.ownerAtLastHold ? memberName(grantReview.review.ownerAtLastHold) : 'nobody'}.`
                  : 'This permission has never allowed changes before.'}</p>
                <div>
                  <p className="font-medium">{grantReview.review.lastHeldAt ? 'Owner changes since then' : 'Owner changes'}</p>
                  {grantReview.review.changes.length ? (
                    <ul className="list-disc pl-5">{grantReview.review.changes.map((c) => (
                      <li key={c.changed_at + (c.new_owner_team_member_id ?? '')}>{new Date(c.changed_at).toLocaleString()}: {c.old_owner_team_member_id ? memberName(c.old_owner_team_member_id) : 'nobody'} → {c.new_owner_team_member_id ? memberName(c.new_owner_team_member_id) : 'nobody'}{c.changed_by_team_member_id ? ` (by ${memberName(c.changed_by_team_member_id)})` : ''}</li>
                    ))}</ul>
                  ) : <p className="text-muted-foreground">None recorded.</p>}
                </div>
                {grantReview.review.currentOwnerId ? (
                  <label className="flex items-center gap-2"><Checkbox checked={grantReview.confirmed} onCheckedChange={(v) => setGrantReview({ ...grantReview, confirmed: v === true })} />
                    I confirm {memberName(grantReview.review.currentOwnerId)} owns this agent and should have it request changes.</label>
                ) : <p className="text-destructive">This agent has no owner, so it cannot be allowed to request changes.</p>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setGrantReview(null)}>Cancel</Button>
              <Button disabled={!grantReview || !canSaveWriteGrant(grantReview.review, grantReview.confirmed ? grantReview.review.currentOwnerId : undefined)}
                onClick={() => { if (grantReview) { saveWriteScope(grantReview.grant, true); setGrantReview(null); } }}>Allow changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <TabsContent value="handoffs" className="space-y-2">
          <p className="text-sm text-muted-foreground">Agents asking to sign in to a website themselves. Approving lets that agent collect the login once, within 15 minutes.</p>
          {handoffs.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
              <span className="font-medium">{agentName(h.agent_id)}</span><span>→ {integName(h.integration_id)}</span>
              <span className="text-muted-foreground">“{h.reason}”</span>
              <Badge variant={h.status === 'pending' ? 'secondary' : h.status === 'denied' ? 'destructive' : 'outline'}>{h.status}</Badge>
              <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString()}</span>
              {h.status === 'pending' && (
                <div className="ml-auto flex gap-2">
                  <Button size="sm" onClick={() => decide(h.id, true)}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => decide(h.id, false)}>Deny</Button>
                </div>
              )}
            </div>
          ))}
          {!handoffs.length && <p className="text-sm text-muted-foreground">No requests yet.</p>}
        </TabsContent>

        <TabsContent value="log">
          <ActivityTab agents={agents} integrations={integrations} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ActivityTab({ agents, integrations }: { agents: any[]; integrations: any[] }) {
  const [view, setView] = useState<'events' | 'reads'>('events');
  const [f, setF] = useState({ type: 'write', agent: 'all', integ: 'all', outcome: '', from: '', to: '' });
  const [rows, setRows] = useState<any[]>([]);
  const [reads, setReads] = useState<any[]>([]);
  const agentName = (id: string) => agents.find((x) => x.id === id)?.name ?? 'unknown';
  const integName = (id: string) => integrations.find((x) => x.id === id)?.label ?? '—';

  useEffect(() => {
    (async () => {
      if (view === 'events') {
        let q = db.from('agent_access_log').select('*').order('created_at', { ascending: false }).limit(500);
        if (f.type !== 'all') q = q.eq('event_type', f.type);
        if (f.agent !== 'all') q = q.eq('agent_id', f.agent);
        if (f.integ !== 'all') q = q.eq('integration_id', f.integ);
        if (f.outcome.trim()) q = q.ilike('outcome', `%${f.outcome.trim()}%`);
        if (f.from) q = q.gte('created_at', new Date(`${f.from}T00:00:00`).toISOString());
        if (f.to) q = q.lt('created_at', new Date(new Date(`${f.to}T00:00:00`).getTime() + 86400000).toISOString());
        const { data, error } = await q; if (error) toast.error(error.message); setRows(data ?? []);
      } else {
        let q = db.from('agent_read_usage_daily').select('*').order('day', { ascending: false }).limit(500);
        if (f.agent !== 'all') q = q.eq('agent_id', f.agent);
        if (f.integ !== 'all') q = q.eq('integration_id', f.integ);
        if (f.from) q = q.gte('day', f.from);
        if (f.to) q = q.lte('day', f.to);
        const { data, error } = await q; if (error) toast.error(error.message); setReads(data ?? []);
      }
    })();
  }, [view, f]);

  return (
    <Card><CardContent className="space-y-4 pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={view === 'events' ? 'default' : 'outline'} onClick={() => setView('events')}>Changes, refusals and admin</Button>
        <Button size="sm" variant={view === 'reads' ? 'default' : 'outline'} onClick={() => setView('reads')}>Daily read usage</Button>
      </div>
      <div className="grid gap-2 md:grid-cols-6">
        {view === 'events' && (
          <Select value={f.type} onValueChange={(v) => setF({ ...f, type: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="write">Changes</SelectItem><SelectItem value="denied">Refused</SelectItem><SelectItem value="admin">Admin</SelectItem><SelectItem value="all">All</SelectItem></SelectContent></Select>
        )}
        <Select value={f.agent} onValueChange={(v) => setF({ ...f, agent: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All agents</SelectItem>{agents.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select>
        <Select value={f.integ} onValueChange={(v) => setF({ ...f, integ: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All accounts</SelectItem>{integrations.map((x) => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}</SelectContent></Select>
        {view === 'events' && <Input placeholder="Result contains…" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} />}
        <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
      </div>
      <div className="overflow-x-auto">
        {view === 'events' ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="p-2">When</th><th className="p-2">Type</th><th className="p-2">Agent</th><th className="p-2">Account</th><th className="p-2">Action</th><th className="p-2">Target</th><th className="p-2">Result</th><th className="p-2">By / approver</th><th className="p-2">Details</th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.id} className="border-t align-top">
                <td className="p-2 whitespace-nowrap">{new Date(x.created_at).toLocaleString()}</td>
                <td className="p-2"><Badge variant="outline">{x.event_type}</Badge></td>
                <td className="p-2">{x.agent_id ? agentName(x.agent_id) : '—'}</td>
                <td className="p-2">{x.integration_id ? integName(x.integration_id) : '—'}</td>
                <td className="p-2">{x.action ?? '—'}</td>
                <td className="p-2">{x.target ?? '—'}</td>
                <td className="p-2"><Badge variant={x.outcome.startsWith('allowed') || x.event_type === 'admin' ? 'default' : 'destructive'}>{x.outcome}</Badge></td>
                <td className="p-2 text-xs">{x.admin_team_member_id || x.approved_by_id ? <PersonName id={x.admin_team_member_id ?? x.approved_by_id} /> : '—'}</td>
                <td className="p-2 max-w-xs break-words text-xs text-muted-foreground">{x.detail ?? (x.request_fingerprint ? `request ${x.request_fingerprint.slice(0, 12)}…` : '')}</td>
              </tr>))}
              {!rows.length && <tr><td className="p-2 text-muted-foreground" colSpan={9}>Nothing matches these filters.</td></tr>}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground"><th className="p-2">Day</th><th className="p-2">Agent</th><th className="p-2">Account</th><th className="p-2">Action</th><th className="p-2">Reads</th><th className="p-2">Last used</th></tr></thead>
            <tbody>{reads.map((x) => (
              <tr key={`${x.agent_id}-${x.integration_id}-${x.action}-${x.day}`} className="border-t">
                <td className="p-2">{x.day}</td><td className="p-2">{agentName(x.agent_id)}</td><td className="p-2">{integName(x.integration_id)}</td>
                <td className="p-2">{x.action}</td><td className="p-2">{x.count}</td><td className="p-2">{new Date(x.last_used_at).toLocaleString()}</td>
              </tr>))}
              {!reads.length && <tr><td className="p-2 text-muted-foreground" colSpan={6}>No reads yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </CardContent></Card>
  );
}

const nameCache = new Map<string, string>();
function PersonName({ id }: { id: string }) {
  const [n, setN] = useState(nameCache.get(id) ?? '');
  useEffect(() => {
    if (nameCache.has(id)) return;
    db.from('team_members').select('name').eq('id', id).maybeSingle().then(({ data }: any) => { nameCache.set(id, data?.name ?? 'unknown'); setN(data?.name ?? 'unknown'); });
  }, [id]);
  return <>{n || '…'}</>;
}
