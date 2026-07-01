
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreativeBriefs, useDesignerCap, useTimeEntries } from '@/hooks/useCreativeBriefs';
import { startOfMonth, endOfMonth, format, eachDayOfInterval, isSameDay, subMonths, addMonths } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Download, Plus, Phone, Pencil, Clock, AlertTriangle, ChevronLeft, ChevronRight, Merge } from 'lucide-react';
import { LogTimeDialog } from './LogTimeDialog';
import { toast } from 'sonner';

interface Props {
  teamMemberId?: string;
}

export function HoursDashboard({ teamMemberId }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const targetId = teamMemberId || teamMember?.id;
  const isOwn = !teamMemberId || teamMemberId === teamMember?.id;
  const { data: cap } = useDesignerCap(targetId || null);
  const { data: entries = [] } = useTimeEntries(null, targetId);
  const { data: briefs = [] } = useCreativeBriefs({ allClients: true });
  const [logOpen, setLogOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<any | null>(null);

  // Month cursor — lets Malena review June/July separately
  const [cursor, setCursor] = useState(new Date());
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const capHours = (cap as any)?.cap_hours || 80;
  const now = new Date();

  // Build list of months present in entries for the picker
  const monthOptions = useMemo(() => {
    const set = new Map<string, Date>();
    entries.forEach((e: any) => {
      const d = startOfMonth(new Date(e.started_at));
      set.set(format(d, 'yyyy-MM'), d);
    });
    // always include current month
    set.set(format(startOfMonth(now), 'yyyy-MM'), startOfMonth(now));
    return Array.from(set.values()).sort((a, b) => b.getTime() - a.getTime());
  }, [entries]);

  // Monthly entries (based on cursor)
  const monthEntries = entries.filter((e: any) => {
    const d = new Date(e.started_at);
    return d >= monthStart && d <= monthEnd;
  });

  const totalMinutes = monthEntries.reduce((s: number, e: any) => s + (e.duration_minutes || 0), 0);
  const totalHours = totalMinutes / 60;
  const capPercent = Math.min(100, (totalHours / capHours) * 100);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);
  const todayEntries = entries.filter((e: any) => isSameDay(new Date(e.started_at), now));
  const weekEntries = entries.filter((e: any) => new Date(e.started_at) >= weekStart);
  const todayMinutes = todayEntries.reduce((s: number, e: any) => s + (e.duration_minutes || 0), 0);
  const weekMinutes = weekEntries.reduce((s: number, e: any) => s + (e.duration_minutes || 0), 0);
  const remainingHours = capHours - totalHours;

  // Hours by client (for selected month)
  const clientMap: Record<string, { name: string; minutes: number; color: string }> = {};
  monthEntries.forEach((e: any) => {
    const key = e.client_id || 'none';
    if (!clientMap[key]) clientMap[key] = { name: e.client?.name || (e.category && e.category !== 'task' ? (e.category[0].toUpperCase() + e.category.slice(1)) : 'Unassigned'), minutes: 0, color: e.client?.color || '#3B82F6' };
    clientMap[key].minutes += e.duration_minutes || 0;
  });
  const clientData = Object.values(clientMap)
    .map(c => ({ ...c, hours: +(c.minutes / 60).toFixed(1) }))
    .sort((a, b) => b.minutes - a.minutes);

  // Hours by day
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const dayData = days.map(day => {
    const mins = monthEntries
      .filter((e: any) => isSameDay(new Date(e.started_at), day))
      .reduce((s: number, e: any) => s + (e.duration_minutes || 0), 0);
    return { date: format(day, 'MMM d'), hours: +(mins / 60).toFixed(1) };
  });

  // Hours by brief
  const briefMap: Record<string, { title: string; minutes: number }> = {};
  monthEntries.forEach((e: any) => {
    const key = e.brief_id || `x-${e.id}`;
    if (!briefMap[key]) briefMap[key] = { title: e.brief?.title || e.description || (e.category ? e.category : 'Untitled'), minutes: 0 };
    briefMap[key].minutes += e.duration_minutes || 0;
  });
  const briefData = Object.entries(briefMap)
    .map(([id, v]) => ({ id, ...v, hours: +(v.minutes / 60).toFixed(1) }))
    .sort((a, b) => b.minutes - a.minutes);

  // Detect duplicates within the selected month (same brief_id + same day)
  const duplicateGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    monthEntries.forEach((e: any) => {
      if (!e.brief_id) return; // only merge task entries linked to a brief
      const key = `${e.brief_id}|${format(new Date(e.started_at), 'yyyy-MM-dd')}`;
      (groups[key] ||= []).push(e);
    });
    return Object.values(groups).filter(g => g.length > 1);
  }, [monthEntries]);
  const duplicateCount = duplicateGroups.reduce((s, g) => s + (g.length - 1), 0);

  const mergeDuplicates = useMutation({
    mutationFn: async () => {
      let merged = 0;
      for (const group of duplicateGroups) {
        // keep the earliest entry, sum minutes into it, concat notes, soft-delete the rest
        const sorted = [...group].sort((a: any, b: any) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
        const keeper = sorted[0];
        const extras = sorted.slice(1);
        const totalMins = sorted.reduce((s: number, e: any) => s + (e.duration_minutes || 0), 0);
        const notes = sorted.map((e: any) => e.description).filter(Boolean);
        const mergedNote = notes.length > 0 ? Array.from(new Set(notes)).join(' • ') : keeper.description;
        const startedAt = new Date(keeper.started_at);
        const endedAt = new Date(startedAt.getTime() + totalMins * 60000);

        const { error: upErr } = await supabase
          .from('creative_time_entries')
          .update({ duration_minutes: totalMins, ended_at: endedAt.toISOString(), description: mergedNote } as any)
          .eq('id', keeper.id);
        if (upErr) throw upErr;

        const { error: delErr } = await supabase
          .from('creative_time_entries')
          .update({ deleted_at: new Date().toISOString() } as any)
          .in('id', extras.map((e: any) => e.id));
        if (delErr) throw delErr;
        merged += extras.length;
      }
      return merged;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['creative_time_entries'] });
      toast.success(`Merged ${count} duplicate ${count === 1 ? 'entry' : 'entries'} — originals kept in trash and recoverable`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const exportCSV = () => {
    const rows = [['Date', 'Client', 'Brief', 'Duration (min)', 'Description']];
    monthEntries.forEach((e: any) => {
      rows.push([
        format(new Date(e.started_at), 'yyyy-MM-dd HH:mm'),
        e.client?.name || '',
        e.brief?.title || '',
        String(e.duration_minutes || 0),
        e.description || '',
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hours-${format(cursor, 'yyyy-MM')}.csv`;
    a.click();
  };

  const capColor = capPercent < 70 ? 'text-green-600' : capPercent < 90 ? 'text-yellow-600' : 'text-red-600';
  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Work Log</h2>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCursor(subMonths(cursor, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <Select value={format(cursor, 'yyyy-MM')} onValueChange={(v) => {
            const found = monthOptions.find(d => format(d, 'yyyy-MM') === v);
            if (found) setCursor(found);
          }}>
            <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map(d => (
                <SelectItem key={format(d, 'yyyy-MM')} value={format(d, 'yyyy-MM')}>{format(d, 'MMMM yyyy')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCursor(addMonths(cursor, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-2">
          {isOwn && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEditEntry(null); setLogOpen(true); }}>
                <Plus className="h-3 w-3" /> Log time
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEditEntry({ category: 'call', duration_minutes: '', started_at: new Date().toISOString() }); setLogOpen(true); }}>
                <Phone className="h-3 w-3" /> Log a call
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEditEntry({ category: 'admin', duration_minutes: '', started_at: new Date().toISOString(), description: 'Admin work — ' }); setLogOpen(true); }}>
                <Clock className="h-3 w-3" /> Log admin
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={exportCSV}>
            <Download className="h-3 w-3 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Month total + per-client breakdown for invoicing */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-baseline justify-between flex-wrap gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{format(cursor, 'MMMM yyyy')} total</p>
              <p className="text-3xl font-bold">{totalHours.toFixed(1)} <span className="text-base font-normal text-muted-foreground">hrs</span></p>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-end">
              {clientData.length === 0 && <span className="text-xs text-muted-foreground">No entries this month</span>}
              {clientData.map((c, i) => (
                <div key={c.name} className="rounded-md border px-2 py-1 text-xs flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">{c.hours}h</span>
                </div>
              ))}
            </div>
          </div>
          {duplicateCount > 0 && isOwn && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                Found {duplicateCount} duplicate {duplicateCount === 1 ? 'entry' : 'entries'} in {format(cursor, 'MMMM')} (same task, same day).
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={mergeDuplicates.isPending} onClick={() => mergeDuplicates.mutate()}>
                <Merge className="h-3.5 w-3.5" /> Merge duplicates
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Work log list */}
      {isOwn && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" /> Entries
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Today: {(todayMinutes / 60).toFixed(1)}h · Last 7 days: {(weekMinutes / 60).toFixed(1)}h · Showing {monthEntries.length} entries in {format(cursor, 'MMM yyyy')}
                </p>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEditEntry({ category: 'other', duration_minutes: '', started_at: new Date().toISOString(), description: 'Extra hours needed — ' }); setLogOpen(true); }}>
                <AlertTriangle className="h-3 w-3" /> Flag extra hours
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
              <div className="space-y-1.5">
                {monthEntries.slice(0, 30).map((e: any) => {
                  const label = e.brief?.title || (e.category && e.category !== 'task'
                    ? e.category.charAt(0).toUpperCase() + e.category.slice(1)
                    : (e.description || 'Untitled'));
                  return (
                    <div key={e.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm hover:bg-accent/40 transition-colors">
                      <Badge variant="outline" className="text-[10px] capitalize">{e.category || 'task'}</Badge>
                      <span className="flex-1 truncate">{label}</span>
                      <span className="text-xs text-muted-foreground">{format(new Date(e.started_at), 'MMM d')}</span>
                      <span className="font-mono text-xs font-medium">{e.duration_minutes}m</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditEntry(e); setLogOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  );
                })}
                {monthEntries.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No time logged in {format(cursor, 'MMMM yyyy')}</p>}
              </div>

              <div className="rounded-lg border p-3 text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Monthly cap</span>
                  <span className="font-medium">{capHours}h</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Logged</span>
                  <span className="font-medium">{totalHours.toFixed(1)}h</span>
                </div>
                <div className="flex items-center justify-between border-t pt-2">
                  <span className="text-muted-foreground">Remaining</span>
                  <span className={remainingHours < 0 ? 'font-medium text-red-600' : 'font-medium'}>{remainingHours.toFixed(1)}h</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className={`text-3xl font-bold ${capColor}`}>{totalHours.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">of {capHours} hrs ({capPercent.toFixed(0)}%)</p>
            <div className="h-2 rounded-full bg-muted mt-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${capPercent < 70 ? 'bg-green-500' : capPercent < 90 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${capPercent}%` }}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{clientData.length}</p>
            <p className="text-xs text-muted-foreground">Clients This Month</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold">{briefData.length}</p>
            <p className="text-xs text-muted-foreground">Briefs Worked On</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hours by day */}
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3">Hours by Day</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dayData}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="hours" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Hours by client */}
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-medium mb-3">Hours by Client</h3>
            {clientData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={clientData} dataKey="hours" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={80} label={({ name, hours }) => `${name} (${hours}h)`}>
                    {clientData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Hours by brief table */}
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-3">Hours by Brief</h3>
          <div className="space-y-1">
            {briefData.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                <span className="truncate">{b.title}</span>
                <span className="text-muted-foreground shrink-0 ml-4">{b.hours} hrs</span>
              </div>
            ))}
            {briefData.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No entries this month</p>}
          </div>
        </CardContent>
      </Card>

      <LogTimeDialog
        open={logOpen}
        onOpenChange={(o) => { setLogOpen(o); if (!o) setEditEntry(null); }}
        briefs={briefs as any}
        editEntry={editEntry}
      />
    </div>
  );
}
