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

const db = supabase as any;
const ENDPOINT = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/agent-gateway`;
const OP_REF = /^op:\/\/[^/\s]+\/[^/\s]+(\/[^/\s]+)+$/;

async function sha256Hex(t: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const newToken = () => `agw_${[...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

export default function AgentAccessPage() {
  const { teamMember } = useAuth();
  const me = teamMember?.id ?? null;
  const [enabled, setEnabled] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [tokens, setTokens] = useState<any[]>([]);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [grants, setGrants] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [a, setA] = useState({ name: '', kind: 'ai_agent', team: 'ops' });
  const [t, setT] = useState({ agent_id: '', label: '', days: '90' });
  const [i, setI] = useState({ provider: '', label: '', account_ref: '', op_secret_ref: '', allowed_hosts: '' });
  const [g, setG] = useState({ agent_id: '', integration_id: '', write: false, per_min: '30', per_day: '2000', days: '' });

  const load = async () => {
    const [s, ag, tk, it, gr, lg] = await Promise.all([
      db.from('agent_gateway_settings').select('gateway_enabled').eq('id', 1).maybeSingle(),
      db.from('agents').select('*').order('created_at'),
      db.from('agent_gateway_tokens').select('id, agent_id, token_prefix, label, expires_at, revoked_at, last_used_at, created_at').order('created_at', { ascending: false }),
      db.from('integrations').select('*').order('created_at'),
      db.from('agent_grants').select('*').order('created_at'),
      Promise.resolve({ data: [] }),
    ]);
    setEnabled(!!s.data?.gateway_enabled); setAgents(ag.data ?? []); setTokens(tk.data ?? []);
    setIntegrations(it.data ?? []); setGrants(gr.data ?? []); setLogs(lg.data ?? []);
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
      expires_at: new Date(Date.now() + Number(t.days) * 86400000).toISOString(), created_by_id: me,
    });
    if (error) return toast.error(error.message);
    setShown(token); setT({ ...t, label: '' }); load();
  };
  const addIntegration = () => {
    if (!i.provider || !i.label) return toast.error('Provider and label are required');
    if (i.op_secret_ref && !OP_REF.test(i.op_secret_ref)) return toast.error('Reference must look like op://vault/item/field');
    run(db.from('integrations').insert({
      provider: i.provider.trim(), label: i.label.trim(), account_ref: i.account_ref || null, op_secret_ref: i.op_secret_ref || null,
      allowed_hosts: i.allowed_hosts.split(',').map((h) => h.trim()).filter(Boolean), created_by_id: me,
    }), 'Account added');
    setI({ provider: '', label: '', account_ref: '', op_secret_ref: '', allowed_hosts: '' });
  };
  const addGrant = () => {
    if (!g.agent_id || !g.integration_id) return toast.error('Pick an agent and an account');
    run(db.from('agent_grants').upsert({
      agent_id: g.agent_id, integration_id: g.integration_id, scopes: g.write ? ['read', 'write'] : ['read'],
      rate_per_minute: Number(g.per_min), rate_per_day: Number(g.per_day), revoked_at: null,
      expires_at: g.days ? new Date(Date.now() + Number(g.days) * 86400000).toISOString() : null, granted_by_id: me,
    }, { onConflict: 'agent_id,integration_id' }), 'Permission saved');
  };

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
      </div>

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
              <div className="ml-auto flex gap-2">
                {x.status === 'active'
                  ? <Button variant="destructive" size="sm" onClick={() => run(db.from('agents').update({ status: 'killed', killed_at: new Date().toISOString(), killed_by_id: me, killed_reason: 'admin kill switch' }).eq('id', x.id), 'Agent stopped')}>Kill switch</Button>
                  : <Button variant="outline" size="sm" onClick={() => run(db.from('agents').update({ status: 'active', killed_at: null, killed_by_id: null, killed_reason: null }).eq('id', x.id), 'Agent restored')}>Restore</Button>}
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="keys" className="space-y-4">
          <Card><CardContent className="grid gap-3 pt-6 md:grid-cols-4">
            <Select value={t.agent_id} onValueChange={(v) => setT({ ...t, agent_id: v })}><SelectTrigger><SelectValue placeholder="Agent" /></SelectTrigger>
              <SelectContent>{agents.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select>
            <Input placeholder="Label" value={t.label} onChange={(e) => setT({ ...t, label: e.target.value })} />
            <Select value={t.days} onValueChange={(v) => setT({ ...t, days: v })}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="30">Expires in 30 days</SelectItem><SelectItem value="90">Expires in 90 days</SelectItem><SelectItem value="365">Expires in 1 year</SelectItem></SelectContent></Select>
            <Button onClick={mint}>Create key</Button>
          </CardContent></Card>
          {tokens.map((x) => {
            const expired = new Date(x.expires_at) < new Date();
            return (
              <div key={x.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
                <code className="text-xs">{x.token_prefix}…</code><span className="font-medium">{agentName(x.agent_id)}</span><span className="text-muted-foreground">{x.label}</span>
                {x.revoked_at ? <Badge variant="destructive">revoked</Badge> : expired ? <Badge variant="secondary">expired</Badge> : <Badge>active</Badge>}
                <span className="text-xs text-muted-foreground">last used {x.last_used_at ? new Date(x.last_used_at).toLocaleString() : 'never'} · expires {new Date(x.expires_at).toLocaleDateString()}</span>
                {!x.revoked_at && <Button className="ml-auto" variant="outline" size="sm" onClick={() => run(db.from('agent_gateway_tokens').update({ revoked_at: new Date().toISOString(), revoked_by_id: me }).eq('id', x.id), 'Key revoked')}>Revoke</Button>}
              </div>
            );
          })}
        </TabsContent>

        <TabsContent value="accounts" className="space-y-4">
          <Card><CardContent className="grid gap-3 pt-6 md:grid-cols-3">
            <Input placeholder="Service, e.g. meta_ads" value={i.provider} onChange={(e) => setI({ ...i, provider: e.target.value })} />
            <Input placeholder="Label, e.g. Cannaball Meta" value={i.label} onChange={(e) => setI({ ...i, label: e.target.value })} />
            <Input placeholder="Account id (optional)" value={i.account_ref} onChange={(e) => setI({ ...i, account_ref: e.target.value })} />
            <Input placeholder="1Password reference: op://vault/item/field" value={i.op_secret_ref} onChange={(e) => setI({ ...i, op_secret_ref: e.target.value })} />
            <Input placeholder="Allowed hosts, comma separated" value={i.allowed_hosts} onChange={(e) => setI({ ...i, allowed_hosts: e.target.value })} />
            <Button onClick={addIntegration}>Add account</Button>
          </CardContent></Card>
          {integrations.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
              <span className="font-medium">{x.label}</span><Badge variant="outline">{x.provider}</Badge>
              <code className="text-xs text-muted-foreground">{x.op_secret_ref ?? 'no reference'}</code>
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
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={g.write} onCheckedChange={(v) => setG({ ...g, write: v === true })} />Can make changes</label>
            <Input type="number" placeholder="Per minute" value={g.per_min} onChange={(e) => setG({ ...g, per_min: e.target.value })} />
            <Input type="number" placeholder="Per day" value={g.per_day} onChange={(e) => setG({ ...g, per_day: e.target.value })} />
            <Button onClick={addGrant}>Save permission</Button>
          </CardContent></Card>
          {grants.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
              <span className="font-medium">{agentName(x.agent_id)}</span><span>→ {integName(x.integration_id)}</span>
              {x.scopes.map((s: string) => <Badge key={s} variant="outline">{s === 'read' ? 'view' : 'change'}</Badge>)}
              <span className="text-xs text-muted-foreground">{x.rate_per_minute}/min · {x.rate_per_day}/day{x.expires_at ? ` · until ${new Date(x.expires_at).toLocaleDateString()}` : ''}</span>
              {x.revoked_at ? <Badge variant="destructive">removed</Badge>
                : <Button className="ml-auto" variant="outline" size="sm" onClick={() => run(db.from('agent_grants').update({ revoked_at: new Date().toISOString() }).eq('id', x.id), 'Permission removed')}>Remove</Button>}
            </div>
          ))}
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
