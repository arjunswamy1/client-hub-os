import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCreativeBriefs, useTimeEntries } from '@/hooks/useCreativeBriefs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  startOfMonth, endOfMonth, eachDayOfInterval, format, isSameDay,
  isSameMonth, addMonths, subMonths, startOfWeek, endOfWeek, isToday,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, Trash2, Plane, Upload, Pencil } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  teamMemberId?: string;
}

export function WorkCalendar({ teamMemberId }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const targetId = teamMemberId || teamMember?.id;
  const isOwn = !teamMemberId || teamMemberId === teamMember?.id;
  const { data: entries = [] } = useTimeEntries(null, targetId);
  const { data: briefs = [] } = useCreativeBriefs({ allClients: true });

  const [cursor, setCursor] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const monthEntries = entries.filter((e: any) => {
    const d = new Date(e.started_at);
    return d >= monthStart && d <= monthEnd;
  });
  const totalHours = monthEntries.reduce((s: number, e: any) => s + (e.duration_minutes || 0), 0) / 60;

  const entriesByDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    entries.forEach((e: any) => {
      const key = format(new Date(e.started_at), 'yyyy-MM-dd');
      (map[key] ||= []).push(e);
    });
    return map;
  }, [entries]);

  const exportCSV = () => {
    const rows = [['Date', 'Task / Note', 'Category', 'Hours']];
    monthEntries.forEach((e: any) => {
      rows.push([
        format(new Date(e.started_at), 'yyyy-MM-dd'),
        e.brief?.title || e.description || '',
        e.category || 'task',
        ((e.duration_minutes || 0) / 60).toFixed(2),
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${(c ?? '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `work-log-${format(cursor, 'yyyy-MM')}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="rounded-md bg-teal-600 text-white px-4 py-2">
          <p className="text-[10px] uppercase tracking-wider opacity-80">Time this month</p>
          <p className="text-2xl font-bold leading-tight">{totalHours.toFixed(1)} hrs</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => setCursor(subMonths(cursor, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="text-sm font-semibold min-w-[140px] text-center">{format(cursor, 'MMMM yyyy')}</div>
          <Button size="icon" variant="outline" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={() => setCursor(new Date())}>Today</Button>
          <Button size="sm" variant="outline" onClick={exportCSV}>Export CSV</Button>
        </div>
      </div>

      {/* Calendar */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
              <div key={d} className="text-[11px] font-medium text-muted-foreground text-center py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map(day => {
              const key = format(day, 'yyyy-MM-dd');
              const dayEntries = entriesByDay[key] || [];
              const dayHours = dayEntries.reduce((s, e) => s + (e.duration_minutes || 0), 0) / 60;
              const isOoo = dayEntries.some(e => e.category === 'ooo');
              const inMonth = isSameMonth(day, cursor);
              return (
                <button
                  key={key}
                  onClick={() => isOwn && setSelectedDay(day)}
                  disabled={!isOwn}
                  className={`group relative min-h-[92px] text-left rounded-md border p-1.5 transition-colors
                    ${inMonth ? 'bg-card' : 'bg-muted/30 opacity-60'}
                    ${isToday(day) ? 'border-primary ring-1 ring-primary/30' : 'border-border'}
                    ${isOwn ? 'hover:border-primary hover:bg-accent/40 cursor-pointer' : 'cursor-default'}
                    ${isOoo ? 'bg-orange-50 dark:bg-orange-950/20' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-medium ${isToday(day) ? 'text-primary' : ''}`}>{format(day, 'd')}</span>
                    {dayHours > 0 && <span className="text-[10px] font-semibold text-teal-700 dark:text-teal-400">{dayHours.toFixed(1)}h</span>}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {isOoo && <div className="text-[10px] rounded px-1 py-0.5 bg-orange-500 text-white flex items-center gap-1"><Plane className="h-2.5 w-2.5" /> Out of office</div>}
                    {dayEntries.filter(e => e.category !== 'ooo').slice(0, 3).map(e => (
                      <div key={e.id} className="text-[10px] truncate rounded px-1 py-0.5 bg-teal-100 dark:bg-teal-900/30 text-teal-900 dark:text-teal-100">
                        {e.brief?.title || e.description || (e.category || 'task')}
                      </div>
                    ))}
                    {dayEntries.filter(e => e.category !== 'ooo').length > 3 && (
                      <div className="text-[10px] text-muted-foreground">+{dayEntries.filter(e => e.category !== 'ooo').length - 3} more</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {selectedDay && (
        <DayDialog
          day={selectedDay}
          entries={entriesByDay[format(selectedDay, 'yyyy-MM-dd')] || []}
          briefs={briefs as any}
          teamMemberId={teamMember!.id}
          onClose={() => { setSelectedDay(null); queryClient.invalidateQueries({ queryKey: ['creative_time_entries'] }); }}
        />
      )}
    </div>
  );
}

// ---------- Day editor dialog ----------
interface DayProps {
  day: Date;
  entries: any[];
  briefs: { id: string; title: string; client_name?: string | null }[];
  teamMemberId: string;
  onClose: () => void;
}

function DayDialog({ day, entries, briefs, teamMemberId, onClose }: DayProps) {
  const queryClient = useQueryClient();
  const isOoo = entries.some(e => e.category === 'ooo');
  const oooEntry = entries.find(e => e.category === 'ooo');
  const workEntries = entries.filter(e => e.category !== 'ooo');

  const [task, setTask] = useState('');
  const [hours, setHours] = useState('');
  const [briefId, setBriefId] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['creative_time_entries'] });

  const upsertEntry = useMutation({
    mutationFn: async () => {
      const hrs = parseFloat(hours);
      if (!hrs || hrs <= 0) throw new Error('Enter hours greater than 0');
      if (!task.trim() && !briefId) throw new Error('Add a task description or pick a brief');
      const brief = briefs.find(b => b.id === briefId);
      const startedAt = new Date(day); startedAt.setHours(9, 0, 0, 0);
      const mins = Math.round(hrs * 60);
      const payload: any = {
        team_member_id: teamMemberId,
        brief_id: brief?.id || null,
        client_id: null,
        category: brief ? 'task' : 'other',
        started_at: startedAt.toISOString(),
        ended_at: new Date(startedAt.getTime() + mins * 60000).toISOString(),
        duration_minutes: mins,
        is_manual: true,
        description: task.trim() || null,
      };
      if (editingId) {
        const { error } = await supabase.from('creative_time_entries').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('creative_time_entries').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingId ? 'Entry updated' : 'Entry added');
      setTask(''); setHours(''); setBriefId(''); setEditingId(null);
      refresh();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const removeEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('creative_time_entries')
        .update({ deleted_at: new Date().toISOString() } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Entry deleted'); refresh(); },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleOoo = useMutation({
    mutationFn: async (on: boolean) => {
      if (on) {
        const startedAt = new Date(day); startedAt.setHours(9, 0, 0, 0);
        const { error } = await supabase.from('creative_time_entries').insert({
          team_member_id: teamMemberId,
          brief_id: null,
          client_id: null,
          category: 'ooo',
          started_at: startedAt.toISOString(),
          ended_at: startedAt.toISOString(),
          duration_minutes: 0,
          is_manual: true,
          description: 'Out of office',
        } as any);
        if (error) throw error;
      } else if (oooEntry) {
        const { error } = await supabase.from('creative_time_entries')
          .update({ deleted_at: new Date().toISOString() } as any).eq('id', oooEntry.id);
        if (error) throw error;
      }
    },
    onSuccess: refresh,
    onError: (err: any) => toast.error(err.message),
  });

  const startEdit = (e: any) => {
    setEditingId(e.id);
    setTask(e.description || '');
    setHours(((e.duration_minutes || 0) / 60).toString());
    setBriefId(e.brief_id || '');
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{format(day, 'EEEE, MMM d, yyyy')}</DialogTitle>
          <DialogDescription>Log your tasks and hours for the day.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm">
              <Plane className="h-4 w-4 text-orange-500" /> Out of office
            </div>
            <Switch checked={isOoo} onCheckedChange={(v) => toggleOoo.mutate(v)} />
          </div>

          {workEntries.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs">Entries</Label>
              {workEntries.map(e => (
                <div key={e.id} className="flex items-center gap-2 rounded border px-2 py-1.5 text-sm">
                  <span className="flex-1 truncate">{e.brief?.title || e.description || 'Untitled'}</span>
                  <span className="font-mono text-xs">{((e.duration_minutes || 0) / 60).toFixed(2)}h</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(e)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeEntry.mutate(e.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
          )}

          {!isOoo && (
            <div className="space-y-2 rounded-md border p-3">
              <Label className="text-xs">{editingId ? 'Edit entry' : 'Add entry'}</Label>
              <Textarea rows={2} placeholder="Write task here…" value={task} onChange={e => setTask(e.target.value)} />
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <Select value={briefId || 'none'} onValueChange={v => setBriefId(v === 'none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Link to a brief (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No brief</SelectItem>
                    {briefs.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.client_name ? `[${b.client_name}] ` : ''}{b.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" step="0.25" min="0" placeholder="Hours" value={hours} onChange={e => setHours(e.target.value)} />
              </div>
              <div className="flex gap-2 justify-end">
                {editingId && <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setTask(''); setHours(''); setBriefId(''); }}>Cancel</Button>}
                <Button size="sm" onClick={() => upsertEntry.mutate()} disabled={upsertEntry.isPending}>
                  <Plus className="h-3.5 w-3.5 mr-1" />{editingId ? 'Save' : 'Add'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
