import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Copy } from 'lucide-react';

interface Member { id: string; name: string; role: string }
interface TokenRow { id: string; team_member_id: string; token_prefix: string; label: string; scopes: string[]; revoked_at: string | null; last_used_at: string | null; expires_at: string | null; created_at: string }

const ENDPOINT = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/mcp-hub`;

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `cpm_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export default function AgentTokensPage() {
  const { toast } = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [memberId, setMemberId] = useState('');
  const [label, setLabel] = useState('');
  const [draft, setDraft] = useState(true);
  const [creative, setCreative] = useState(false);
  const [days, setDays] = useState('90');
  const [shown, setShown] = useState<string | null>(null);

  const load = async () => {
    const [{ data: m }, { data: t }] = await Promise.all([
      supabase.from('team_members').select('id, name, role').eq('is_active', true).order('name'),
      supabase.from('agent_tokens').select('id, team_member_id, token_prefix, label, scopes, revoked_at, last_used_at, expires_at, created_at').order('created_at', { ascending: false }),
    ]);
    setMembers((m ?? []) as Member[]);
    setTokens((t ?? []) as TokenRow[]);
  };
  useEffect(() => { load(); }, []);

  const mint = async () => {
    if (!memberId || !label.trim()) return toast({ title: 'Pick a team member and a label', variant: 'destructive' });
    const token = newToken();
    const expires = days === 'never' ? null : new Date(Date.now() + Number(days) * 86400000).toISOString();
    const { error } = await supabase.from('agent_tokens').insert({
      team_member_id: memberId, label: label.trim(), token_hash: await sha256Hex(token), token_prefix: token.slice(0, 12),
      scopes: ['read', ...(draft ? ['draft'] : []), ...(creative ? ['creative_write'] : [])], expires_at: expires,
    });
    if (error) return toast({ title: 'Could not create token', description: error.message, variant: 'destructive' });
    setShown(token); setLabel('');
    load();
  };

  const revoke = async (id: string) => {
    const { error } = await supabase.from('agent_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    if (error) toast({ title: 'Could not revoke', description: error.message, variant: 'destructive' }); else load();
  };

  const name = (id: string) => members.find((m) => m.id === id)?.name ?? 'Unknown';

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Agent tokens</h1>
        <p className="text-sm text-muted-foreground">Keys for Claude agents to read the hub and write drafts. An agent reaches only the clients its team member is assigned to, and can never send anything.</p>
        <p className="mt-1 text-xs text-muted-foreground">Server address: <code className="rounded bg-muted px-1">{ENDPOINT}</code></p>
      </div>

      {shown && (
        <Card className="border-primary">
          <CardHeader><CardTitle className="text-base">Copy this token now — it will not be shown again</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-muted p-2 text-sm">{shown}</code>
            <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(shown); toast({ title: 'Copied' }); }}><Copy className="h-4 w-4" /></Button>
            <Button variant="ghost" onClick={() => setShown(null)}>Done</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">New token</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4 md:items-end">
          <Select value={memberId} onValueChange={setMemberId}>
            <SelectTrigger><SelectValue placeholder="Team member" /></SelectTrigger>
            <SelectContent>{members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name} ({m.role})</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Label, e.g. Jacuzzi agent" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Expires in 30 days</SelectItem>
              <SelectItem value="90">Expires in 90 days</SelectItem>
              <SelectItem value="365">Expires in 1 year</SelectItem>
              <SelectItem value="never">Never expires</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft} onCheckedChange={(v) => setDraft(v === true)} />Can write drafts</label>
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={creative} onCheckedChange={(v) => setCreative(v === true)} />Can change creative briefs</label>
            </div>
            <Button onClick={mint}>Create</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Issued tokens</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!tokens.length && <p className="text-sm text-muted-foreground">None yet.</p>}
          {tokens.map((t) => {
            const expired = t.expires_at && new Date(t.expires_at) < new Date();
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
                <code className="text-xs">{t.token_prefix}…</code>
                <span className="font-medium">{t.label}</span>
                <span className="text-muted-foreground">{name(t.team_member_id)}</span>
                {t.scopes.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
                {t.revoked_at ? <Badge variant="destructive">revoked</Badge> : expired ? <Badge variant="secondary">expired</Badge> : <Badge>active</Badge>}
                <span className="text-xs text-muted-foreground">
                  last used {t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'never'}{t.expires_at ? ` · expires ${new Date(t.expires_at).toLocaleDateString()}` : ''}
                </span>
                {!t.revoked_at && <Button className="ml-auto" variant="outline" size="sm" onClick={() => revoke(t.id)}>Revoke</Button>}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
