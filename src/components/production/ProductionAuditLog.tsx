import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Upload, FileVideo, Wand2, FilePlus, Download } from 'lucide-react';
import { format } from 'date-fns';

type EventKind = 'brief_created' | 'footage_uploaded' | 'post_prod_handoff';

interface AuditEvent {
  id: string;
  kind: EventKind;
  occurred_at: string;
  actor_name: string | null;
  brief_id: string;
  brief_title: string;
  client_ids: string[];
  detail: string;
}

const KIND_LABEL: Record<EventKind, string> = {
  brief_created: 'Brief created',
  footage_uploaded: 'Footage uploaded',
  post_prod_handoff: 'Post-prod handoff',
};

const KIND_COLOR: Record<EventKind, string> = {
  brief_created: 'bg-slate-100 text-slate-700 border-slate-300',
  footage_uploaded: 'bg-blue-50 text-blue-700 border-blue-300',
  post_prod_handoff: 'bg-emerald-50 text-emerald-700 border-emerald-300',
};

const KIND_ICON: Record<EventKind, typeof Upload> = {
  brief_created: FilePlus,
  footage_uploaded: Upload,
  post_prod_handoff: Wand2,
};

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
}

export function ProductionAuditLog() {
  const [{ from, to }, setRange] = useState(defaultRange());
  const [clientId, setClientId] = useState<string>('all');
  const [kind, setKind] = useState<EventKind | 'all'>('all');

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-for-audit'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id,name').order('name');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['production-audit', from, to],
    queryFn: async () => {
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toIso = new Date(`${to}T23:59:59`).toISOString();

      // 1) Shoot briefs in window — both creation events and (when linked) post-prod handoff events
      const { data: briefs, error: bErr } = await supabase
        .from('shoot_briefs')
        .select('id,title,client_ids,created_at,updated_at,created_by_id,linked_creative_brief_id')
        .or(`created_at.gte.${fromIso},updated_at.gte.${fromIso}`)
        .lte('updated_at', toIso);
      if (bErr) throw bErr;

      // 2) Footage uploads in window
      const briefIds = (briefs || []).map((b) => b.id);
      const { data: allBriefsForFootage } = await supabase
        .from('shoot_briefs')
        .select('id,title,client_ids');

      const { data: footage, error: fErr } = await supabase
        .from('shoot_footage')
        .select('id,brief_id,file_name,uploaded_at,uploaded_by_id')
        .gte('uploaded_at', fromIso)
        .lte('uploaded_at', toIso);
      if (fErr) throw fErr;

      // Resolve actor names from team_members
      const memberIds = new Set<string>();
      (briefs || []).forEach((b) => b.created_by_id && memberIds.add(b.created_by_id));
      (footage || []).forEach((f) => f.uploaded_by_id && memberIds.add(f.uploaded_by_id));
      let memberMap = new Map<string, string>();
      if (memberIds.size > 0) {
        const { data: members } = await supabase
          .from('team_members')
          .select('id,name')
          .in('id', Array.from(memberIds));
        memberMap = new Map((members || []).map((m: any) => [m.id, m.name]));
      }

      // Resolve linked creative briefs (for handoff timestamp + assignee)
      const linkedIds = (briefs || [])
        .map((b) => b.linked_creative_brief_id)
        .filter(Boolean) as string[];
      let linkedMap = new Map<string, { created_at: string; assigned_to_id: string | null }>();
      if (linkedIds.length > 0) {
        const { data: linked } = await supabase
          .from('creative_briefs')
          .select('id,created_at,assigned_to_id')
          .in('id', linkedIds);
        linkedMap = new Map((linked || []).map((l: any) => [l.id, l]));
      }

      const briefById = new Map<string, { title: string; client_ids: string[] }>();
      (allBriefsForFootage || []).forEach((b: any) => briefById.set(b.id, { title: b.title, client_ids: b.client_ids || [] }));
      (briefs || []).forEach((b: any) => briefById.set(b.id, { title: b.title, client_ids: b.client_ids || [] }));

      const out: AuditEvent[] = [];

      (briefs || []).forEach((b: any) => {
        if (b.created_at >= fromIso && b.created_at <= toIso) {
          out.push({
            id: `brief-${b.id}`,
            kind: 'brief_created',
            occurred_at: b.created_at,
            actor_name: b.created_by_id ? memberMap.get(b.created_by_id) || null : null,
            brief_id: b.id,
            brief_title: b.title,
            client_ids: b.client_ids || [],
            detail: 'Shoot brief created',
          });
        }
        if (b.linked_creative_brief_id) {
          const link = linkedMap.get(b.linked_creative_brief_id);
          if (link && link.created_at >= fromIso && link.created_at <= toIso) {
            const assignee = link.assigned_to_id ? memberMap.get(link.assigned_to_id) : null;
            out.push({
              id: `handoff-${b.id}`,
              kind: 'post_prod_handoff',
              occurred_at: link.created_at,
              actor_name: b.created_by_id ? memberMap.get(b.created_by_id) || null : null,
              brief_id: b.id,
              brief_title: b.title,
              client_ids: b.client_ids || [],
              detail: assignee ? `Sent to editor: ${assignee}` : 'Sent to editor (unassigned)',
            });
          }
        }
      });

      (footage || []).forEach((f: any) => {
        const meta = briefById.get(f.brief_id);
        out.push({
          id: `footage-${f.id}`,
          kind: 'footage_uploaded',
          occurred_at: f.uploaded_at,
          actor_name: f.uploaded_by_id ? memberMap.get(f.uploaded_by_id) || null : null,
          brief_id: f.brief_id,
          brief_title: meta?.title || '(unknown brief)',
          client_ids: meta?.client_ids || [],
          detail: f.file_name || 'Video clip',
        });
      });

      out.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
      return out;
    },
  });

  const clientMap = useMemo(() => new Map(clients.map((c: any) => [c.id, c.name])), [clients]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (kind !== 'all' && e.kind !== kind) return false;
      if (clientId !== 'all' && !e.client_ids.includes(clientId)) return false;
      return true;
    });
  }, [events, kind, clientId]);

  const exportCsv = () => {
    const rows = [
      ['Timestamp', 'Event', 'Actor', 'Brief', 'Clients', 'Detail'],
      ...filtered.map((e) => [
        format(new Date(e.occurred_at), 'yyyy-MM-dd HH:mm:ss'),
        KIND_LABEL[e.kind],
        e.actor_name || '(system)',
        e.brief_title,
        e.client_ids.map((id) => clientMap.get(id) || id).join('; '),
        e.detail,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `production-audit-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground">From</label>
          <Input type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">To</label>
          <Input type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Client</label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Event type</label>
          <Select value={kind} onValueChange={(v) => setKind(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => (
                <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-3 w-3 mr-1" />Export CSV
          </Button>
        </div>
      </Card>

      <div className="text-xs text-muted-foreground">{filtered.length} event{filtered.length === 1 ? '' : 's'}</div>

      {isLoading ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No production activity in this window.</Card>
      ) : (
        <Card className="divide-y">
          {filtered.map((e) => {
            const Icon = KIND_ICON[e.kind];
            return (
              <div key={e.id} className="p-3 flex items-start gap-3 hover:bg-slate-50">
                <div className="mt-0.5"><Icon className="h-4 w-4 text-muted-foreground" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={KIND_COLOR[e.kind]}>{KIND_LABEL[e.kind]}</Badge>
                    <span className="text-sm font-medium truncate">{e.brief_title}</span>
                    {e.client_ids.map((id) => (
                      <Badge key={id} variant="secondary" className="text-[10px]">{clientMap.get(id) || id.slice(0, 6)}</Badge>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                    <span>{e.actor_name || '(system)'}</span>
                    <span>·</span>
                    <span>{format(new Date(e.occurred_at), 'MMM d, yyyy h:mm a')}</span>
                    <span>·</span>
                    <span className="truncate">{e.detail}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
