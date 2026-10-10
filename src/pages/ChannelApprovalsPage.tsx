import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

interface Row {
  channel_id: string; channel_name: string | null; client_id: string | null; proposed_client_id: string | null; proposal_reason: string | null;
  sync_enabled: boolean; is_external: boolean | null; is_shared: boolean | null; is_ext_shared: boolean | null; is_org_shared: boolean | null; is_private: boolean | null;
  classified_at: string | null; sync_enabled_at: string | null; sync_enabled_by_id: string | null; channel_purpose: string | null;
}
interface Client { id: string; name: string }

export default function ChannelApprovalsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: r }, { data: c }, { data: m }] = await Promise.all([
      supabase.from('slack_channel_mappings').select('channel_id, channel_name, client_id, proposed_client_id, proposal_reason, sync_enabled, is_external, is_shared, is_ext_shared, is_org_shared, is_private, classified_at, sync_enabled_at, sync_enabled_by_id, channel_purpose').order('channel_name'),
      supabase.from('clients').select('id, name').order('name'),
      supabase.from('team_members').select('id, name'),
    ]);
    setRows((r ?? []) as Row[]);
    setClients((c ?? []) as Client[]);
    setMembers(Object.fromEntries((m ?? []).map((x: any) => [x.id, x.name])));
  };
  useEffect(() => { load(); }, []);

  const discover = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('sync-slack', { body: { action: 'discover_channels' } });
    setBusy(false);
    if (error) return toast({ title: 'Discovery failed', description: error.message, variant: 'destructive' });
    toast({ title: `Found ${data?.discovered ?? 0} channels`, description: 'Nothing was switched on.' });
    load();
  };

  const toggle = async (row: Row, on: boolean) => {
    const clientId = choice[row.channel_id] || row.client_id || null;
    if (on && !clientId) return toast({ title: 'Choose the client first', variant: 'destructive' });
    if (on && !window.confirm(`Start reading #${row.channel_name} into ${clients.find((c) => c.id === clientId)?.name}'s context?`)) return;
    const { error } = await supabase.rpc('set_channel_sync', { p_channel_id: row.channel_id, p_enabled: on, p_client_id: clientId });
    if (error) return toast({ title: 'Not changed', description: error.message, variant: 'destructive' });
    load();
  };

  const facing = (r: Row) => r.is_external || r.is_shared || r.is_ext_shared || r.is_org_shared;
  const name = (id: string | null) => (id ? clients.find((c) => c.id === id)?.name ?? '?' : null);
  const sorted = [...rows].sort((a, b) => Number(!!facing(b)) - Number(!!facing(a)));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Slack channels</h1>
          <p className="text-sm text-muted-foreground">Nothing reads a client-facing channel until you switch it on here, by name. Suggested clients are only suggestions.</p>
        </div>
        <Button onClick={discover} disabled={busy}>{busy ? 'Looking…' : 'Find channels'}</Button>
      </div>
      <Card>
        <CardHeader><CardTitle>{rows.length} channels</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {sorted.map((r) => (
            <div key={r.channel_id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-[220px] flex-1">
                <div className="font-medium">#{r.channel_name}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {facing(r) ? <Badge variant="destructive">Client-facing</Badge> : <Badge variant="secondary">Internal</Badge>}
                  {r.is_ext_shared && <Badge variant="outline">Shared with another company</Badge>}
                  {r.is_shared && !r.is_ext_shared && <Badge variant="outline">Shared</Badge>}
                  {r.is_org_shared && <Badge variant="outline">Org-shared</Badge>}
                  {r.is_private && <Badge variant="outline">Private</Badge>}
                  {!r.classified_at && <Badge variant="outline">Not checked yet</Badge>}
                </div>
                {r.sync_enabled_at && r.sync_enabled_by_id && (
                  <div className="text-xs text-muted-foreground mt-1">{r.sync_enabled ? 'Switched on' : 'Switched off'} by {members[r.sync_enabled_by_id] ?? 'unknown'} on {new Date(r.sync_enabled_at).toLocaleString()}</div>
                )}
              </div>
              <div className="w-56">
                <Select value={choice[r.channel_id] ?? r.client_id ?? ''} onValueChange={(v) => setChoice((c) => ({ ...c, [r.channel_id]: v }))}>
                  <SelectTrigger><SelectValue placeholder={r.proposed_client_id ? `Suggested: ${name(r.proposed_client_id)}` : 'Choose client'} /></SelectTrigger>
                  <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Read</span>
                <Switch checked={r.sync_enabled} onCheckedChange={(v) => toggle(r, v)} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
