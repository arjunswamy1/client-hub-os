import { useState, useMemo } from 'react';
import { useShootBriefs, useDeleteBrief } from '@/hooks/useShootBriefs';
import { useClient } from '@/contexts/ClientContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Calendar as CalendarIcon, Users, MapPin, Film } from 'lucide-react';
import { STATUS_LABEL, STATUS_COLOR, type ShootBrief } from '@/types/production';
import { ShootBriefDialog } from './ShootBriefDialog';
import { ShootBriefDetail } from './ShootBriefDetail';

export function ShootBriefsList() {
  const { data: briefs = [], isLoading } = useShootBriefs();
  const { clients } = useClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState<ShootBrief | null>(null);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const deleteBrief = useDeleteBrief();

  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c])), [clients]);

  const filtered = useMemo(() => {
    return briefs.filter((b) =>
      (search === '' || b.title.toLowerCase().includes(search.toLowerCase())) &&
      (status === 'all' || b.status === status)
    );
  }, [briefs, search, status]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-semibold">Shoot Briefs</h2>
          <p className="text-sm text-muted-foreground">{filtered.length} briefs</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-2" />New brief</Button>
      </div>

      <Card className="p-4 grid sm:grid-cols-3 gap-2">
        <Input placeholder="Search briefs..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">No briefs yet. Create your first shoot brief.</Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {filtered.map((b) => {
            const briefClients = b.client_ids.map((id) => clientMap[id]?.name).filter(Boolean);
            return (
              <Card key={b.id} className="p-4 cursor-pointer hover:shadow-md transition" onClick={() => setDetailId(b.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{b.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {briefClients.length > 0 ? briefClients.join(' · ') : 'No client assigned'}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {b.verticals.slice(0, 3).map((v) => <Badge key={v} variant="outline" className="text-[10px]">{v}</Badge>)}
                      {b.branding === 'unbranded' && <Badge variant="secondary" className="text-[10px]">unbranded</Badge>}
                    </div>
                  </div>
                  <Badge variant="outline" className={`${STATUS_COLOR[b.status]} text-[10px] whitespace-nowrap`}>{STATUS_LABEL[b.status]}</Badge>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1"><Film className="h-3 w-3" />{b.num_scripts} scripts</div>
                  <div className="flex items-center gap-1"><Users className="h-3 w-3" />{b.num_actors} actors</div>
                  <div className="flex items-center gap-1"><MapPin className="h-3 w-3" />{b.location_confirmed ? 'Loc ✓' : 'Loc TBD'}</div>
                  <div className="flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{b.shoot_date || 'No date'}</div>
                </div>
                <div className="flex justify-end gap-1 mt-2">
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(b); }}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); if (confirm('Delete brief?')) deleteBrief.mutate(b.id); }}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ShootBriefDialog open={creating || !!editing} onOpenChange={(o) => { if (!o) { setCreating(false); setEditing(null); } }} brief={editing} />
      <ShootBriefDetail briefId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
