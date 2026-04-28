import { useMemo, useState } from 'react';
import { useShootBriefs } from '@/hooks/useShootBriefs';
import { useClient } from '@/contexts/ClientContext';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { STATUS_LABEL, STATUS_COLOR } from '@/types/production';
import { ShootBriefDetail } from './ShootBriefDetail';

export function ProductionCalendar() {
  const { data: briefs = [] } = useShootBriefs();
  const { clients } = useClient();
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [detailId, setDetailId] = useState<string | null>(null);

  const clientMap = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name])), [clients]);

  const { weeks, monthLabel } = useMemo(() => {
    const year = cursor.getFullYear(); const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: ({ date: Date; inMonth: boolean })[] = [];
    for (let i = 0; i < startDow; i++) {
      const d = new Date(year, month, -startDow + i + 1);
      cells.push({ date: d, inMonth: false });
    }
    for (let i = 1; i <= daysInMonth; i++) cells.push({ date: new Date(year, month, i), inMonth: true });
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].date;
      cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false });
    }
    const weeks: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return { weeks, monthLabel: cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' }) };
  }, [cursor]);

  const briefsByDate = useMemo(() => {
    const map: Record<string, typeof briefs> = {};
    briefs.forEach((b) => {
      if (b.shoot_date) (map[b.shoot_date] = map[b.shoot_date] || []).push(b);
    });
    return map;
  }, [briefs]);

  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = fmt(new Date());

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Production Calendar</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="text-sm font-medium w-40 text-center">{monthLabel}</div>
          <Button size="sm" variant="outline" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      <Card className="p-2">
        <div className="grid grid-cols-7 gap-1 text-xs font-medium text-muted-foreground text-center mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {weeks.flat().map((c, i) => {
            const key = fmt(c.date);
            const dayBriefs = briefsByDate[key] || [];
            return (
              <div key={i} className={`min-h-24 p-1 border rounded ${c.inMonth ? 'bg-background' : 'bg-slate-50/50'} ${key === today ? 'ring-2 ring-primary' : ''}`}>
                <div className={`text-xs ${c.inMonth ? 'font-medium' : 'text-muted-foreground'}`}>{c.date.getDate()}</div>
                <div className="space-y-0.5 mt-0.5">
                  {dayBriefs.slice(0, 3).map((b) => (
                    <button key={b.id} onClick={() => setDetailId(b.id)} className={`w-full text-left text-[10px] truncate px-1 py-0.5 rounded border ${STATUS_COLOR[b.status]}`} title={b.title}>
                      {b.title}
                    </button>
                  ))}
                  {dayBriefs.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayBriefs.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-3">
        <div className="text-xs font-medium text-muted-foreground mb-2">Status legend</div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(STATUS_LABEL).map(([k, v]) => <Badge key={k} variant="outline" className={`${STATUS_COLOR[k as keyof typeof STATUS_COLOR]} text-[10px]`}>{v}</Badge>)}
        </div>
      </Card>

      <ShootBriefDetail briefId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
