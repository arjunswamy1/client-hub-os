
import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Play, Square, AlertTriangle } from 'lucide-react';
import { format, differenceInDays, isPast, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay, endOfDay } from 'date-fns';
import { useCreativeBriefs, useDesignerCap, useTimeEntries } from '@/hooks/useCreativeBriefs';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/types/creative';
import { toast } from 'sonner';

interface Props {
  onBriefClick: (briefId: string) => void;
}

export function DesignerWorkspace({ onBriefClick }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const { data: briefs = [] } = useCreativeBriefs();
  const { data: cap } = useDesignerCap(teamMember?.id || null);
  const { data: allEntries = [] } = useTimeEntries(null, teamMember?.id);
  const [activeTimer, setActiveTimer] = useState<{ briefId: string; startedAt: Date } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');

  // Calculate hours
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  const calcMinutes = (entries: any[], from: Date, to: Date) =>
    entries.filter((e: any) => {
      const d = new Date(e.started_at);
      return d >= from && d <= to;
    }).reduce((sum: number, e: any) => sum + (e.duration_minutes || 0), 0);

  const monthMinutes = calcMinutes(allEntries, monthStart, monthEnd);
  const weekMinutes = calcMinutes(allEntries, weekStart, weekEnd);
  const dayMinutes = calcMinutes(allEntries, dayStart, dayEnd);
  const monthHours = monthMinutes / 60;
  const capHours = (cap as any)?.cap_hours || 80;
  const capPercent = Math.min(100, (monthHours / capHours) * 100);

  // Timer tick
  useEffect(() => {
    if (!activeTimer) { setElapsed(0); return; }
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - activeTimer.startedAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTimer]);

  const startTimer = useCallback((briefId: string) => {
    setActiveTimer({ briefId, startedAt: new Date() });
    toast.info('Timer started');
  }, []);

  const stopTimer = useMutation({
    mutationFn: async () => {
      if (!activeTimer || !teamMember) return;
      const brief = briefs.find((b: any) => b.id === activeTimer.briefId);
      const duration = Math.round(elapsed / 60);
      const { error } = await supabase.from('creative_time_entries').insert({
        brief_id: activeTimer.briefId,
        team_member_id: teamMember.id,
        client_id: brief?.client_id,
        started_at: activeTimer.startedAt.toISOString(),
        ended_at: new Date().toISOString(),
        duration_minutes: Math.max(1, duration),
        is_manual: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setActiveTimer(null);
      queryClient.invalidateQueries({ queryKey: ['creative_time_entries'] });
      toast.success(`Logged ${Math.round(elapsed / 60)} min`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Filter and sort briefs
  const statusMap: Record<string, string[]> = {
    todo: ['submitted'],
    in_progress: ['in_design'],
    awaiting: ['ready_for_review'],
    revisions: ['revision_requested'],
    all: ['submitted', 'in_design', 'ready_for_review', 'revision_requested', 'approved', 'delivered'],
  };
  const visibleStatuses = statusMap[statusFilter] || statusMap.all;
  const filtered = briefs
    .filter((b: any) => visibleStatuses.includes(b.status))
    .sort((a: any, b: any) => {
      // Overdue first
      const aOverdue = a.due_date && isPast(new Date(a.due_date)) ? 0 : 1;
      const bOverdue = b.due_date && isPast(new Date(b.due_date)) ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      // Then by priority
      const priOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
      const aPri = priOrder[a.priority] ?? 2;
      const bPri = priOrder[b.priority] ?? 2;
      if (aPri !== bPri) return aPri - bPri;
      // Then by due date
      return (a.due_date || '').localeCompare(b.due_date || '');
    });

  const capColor = capPercent < 70 ? 'bg-green-500' : capPercent < 90 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="space-y-4">
      {/* Hours summary bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex-1 min-w-48">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium">This Month</span>
                <span className="text-muted-foreground">{monthHours.toFixed(1)} / {capHours} hrs ({capPercent.toFixed(0)}%)</span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full transition-all ${capColor}`} style={{ width: `${capPercent}%` }} />
              </div>
              {capPercent >= 80 && (
                <div className="flex items-center gap-1 mt-1 text-xs text-warning">
                  <AlertTriangle className="h-3 w-3" />
                  {capPercent >= 100 ? 'Monthly cap reached!' : 'Approaching monthly cap'}
                </div>
              )}
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">{(weekMinutes / 60).toFixed(1)}</p>
              <p className="text-[10px] text-muted-foreground">This Week</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold">{(dayMinutes / 60).toFixed(1)}</p>
              <p className="text-[10px] text-muted-foreground">Today</p>
            </div>
            {/* Active timer */}
            {activeTimer && (
              <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
                <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-mono font-medium">{formatTime(elapsed)}</span>
                <Button size="sm" variant="destructive" onClick={() => stopTimer.mutate()}>
                  <Square className="h-3 w-3 mr-1" /> Stop
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Filter tabs */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          <TabsTrigger value="all">All ({briefs.filter((b: any) => statusMap.all.includes(b.status)).length})</TabsTrigger>
          <TabsTrigger value="todo">To Do ({briefs.filter((b: any) => b.status === 'submitted').length})</TabsTrigger>
          <TabsTrigger value="in_progress">In Progress ({briefs.filter((b: any) => b.status === 'in_design').length})</TabsTrigger>
          <TabsTrigger value="awaiting">Awaiting ({briefs.filter((b: any) => b.status === 'ready_for_review').length})</TabsTrigger>
          <TabsTrigger value="revisions" className="relative">
            Revisions ({briefs.filter((b: any) => b.status === 'revision_requested').length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Brief cards */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No briefs in this view.</p>
        )}
        {filtered.map((brief: any) => {
          const dueDate = brief.due_date ? new Date(brief.due_date) : null;
          const isOverdue = dueDate && isPast(dueDate) && !['approved', 'delivered'].includes(brief.status);
          const daysLeft = dueDate ? differenceInDays(dueDate, now) : null;
          const statusConf = STATUS_CONFIG[brief.status] || STATUS_CONFIG.draft;
          const priorityConf = PRIORITY_CONFIG[brief.priority] || PRIORITY_CONFIG.medium;
          const isTimerActive = activeTimer?.briefId === brief.id;

          return (
            <Card
              key={brief.id}
              className={`cursor-pointer transition-all hover:shadow-md ${
                brief.status === 'revision_requested' ? 'ring-1 ring-orange-300' : ''
              } ${isTimerActive ? 'ring-2 ring-primary/40' : ''}`}
              onClick={() => onBriefClick(brief.id)}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium truncate">{brief.title}</p>
                    <Badge variant="secondary" className={`text-[9px] shrink-0 ${statusConf.color}`}>{statusConf.label}</Badge>
                    <Badge variant="secondary" className={`text-[9px] shrink-0 ${priorityConf.color}`}>{priorityConf.label}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {brief.platforms?.length > 0 && (
                      <span>{brief.platforms.join(', ')}</span>
                    )}
                    {dueDate && (
                      <span className={isOverdue ? 'text-destructive font-medium' : daysLeft !== null && daysLeft <= 2 ? 'text-warning font-medium' : ''}>
                        {isOverdue ? `Overdue by ${Math.abs(daysLeft!)}d` :
                         daysLeft !== null && daysLeft <= 2 ? `Due in ${daysLeft}d` :
                         `Due ${format(dueDate, 'MMM d')}`}
                      </span>
                    )}
                  </div>
                </div>

                <Button
                  size="sm"
                  variant={isTimerActive ? 'destructive' : 'outline'}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isTimerActive) stopTimer.mutate();
                    else startTimer(brief.id);
                  }}
                >
                  {isTimerActive ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
