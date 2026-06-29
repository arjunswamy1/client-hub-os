
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCreativeBriefs, useDesignerCap, useTimeEntries } from '@/hooks/useCreativeBriefs';
import { startOfMonth, endOfMonth, format, eachDayOfInterval, isSameDay } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Download, Plus, Phone, Pencil, Clock } from 'lucide-react';
import { LogTimeDialog } from './LogTimeDialog';

interface Props {
  teamMemberId?: string;
}

export function HoursDashboard({ teamMemberId }: Props) {
  const { teamMember } = useAuth();
  const targetId = teamMemberId || teamMember?.id;
  const isOwn = !teamMemberId || teamMemberId === teamMember?.id;
  const { data: cap } = useDesignerCap(targetId || null);
  const { data: entries = [] } = useTimeEntries(null, targetId);
  const { data: briefs = [] } = useCreativeBriefs({ allClients: true });
  const [logOpen, setLogOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<any | null>(null);

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const capHours = (cap as any)?.cap_hours || 80;

  // Monthly entries
  const monthEntries = entries.filter((e: any) => {
    const d = new Date(e.started_at);
    return d >= monthStart && d <= monthEnd;
  });

  const totalMinutes = monthEntries.reduce((s: number, e: any) => s + (e.duration_minutes || 0), 0);
  const totalHours = totalMinutes / 60;
  const capPercent = Math.min(100, (totalHours / capHours) * 100);

  // Hours by client
  const clientMap: Record<string, { name: string; minutes: number; color: string }> = {};
  monthEntries.forEach((e: any) => {
    const key = e.client_id;
    if (!clientMap[key]) clientMap[key] = { name: e.client?.name || 'Unknown', minutes: 0, color: e.client?.color || '#3B82F6' };
    clientMap[key].minutes += e.duration_minutes || 0;
  });
  const clientData = Object.values(clientMap).map(c => ({ ...c, hours: +(c.minutes / 60).toFixed(1) }));

  // Hours by day
  const days = eachDayOfInterval({ start: monthStart, end: now > monthEnd ? monthEnd : now });
  const dayData = days.map(day => {
    const mins = monthEntries
      .filter((e: any) => isSameDay(new Date(e.started_at), day))
      .reduce((s: number, e: any) => s + (e.duration_minutes || 0), 0);
    return { date: format(day, 'MMM d'), hours: +(mins / 60).toFixed(1) };
  });

  // Hours by brief
  const briefMap: Record<string, { title: string; minutes: number }> = {};
  monthEntries.forEach((e: any) => {
    const key = e.brief_id;
    if (!briefMap[key]) briefMap[key] = { title: e.brief?.title || 'Unknown', minutes: 0 };
    briefMap[key].minutes += e.duration_minutes || 0;
  });
  const briefData = Object.entries(briefMap)
    .map(([id, v]) => ({ id, ...v, hours: +(v.minutes / 60).toFixed(1) }))
    .sort((a, b) => b.minutes - a.minutes);

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
    a.download = `hours-${format(now, 'yyyy-MM')}.csv`;
    a.click();
  };

  const capColor = capPercent < 70 ? 'text-green-600' : capPercent < 90 ? 'text-yellow-600' : 'text-red-600';
  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Hours Dashboard — {format(now, 'MMMM yyyy')}</h2>
        <div className="flex items-center gap-2">
          {isOwn && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEditEntry(null); setLogOpen(true); }}>
                <Plus className="h-3 w-3" /> Log time
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setEditEntry({ category: 'call', duration_minutes: '', started_at: new Date().toISOString() }); setLogOpen(true); }}>
                <Phone className="h-3 w-3" /> Log a call
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={exportCSV}>
            <Download className="h-3 w-3 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

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
    </div>
  );
}
