
import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Play, Pause, Square, AlertTriangle, Calendar, Clock, User, ChevronLeft, ChevronRight, Check, Pencil, Trash2 } from 'lucide-react';
import { format, differenceInDays, isPast, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay, endOfDay, addDays, isSameDay } from 'date-fns';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useCreativeBriefs, useDesignerCap, useTimeEntries } from '@/hooks/useCreativeBriefs';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/types/creative';
import { toast } from 'sonner';
import { LogTimeDialog } from './LogTimeDialog';

interface Props {
  onBriefClick: (briefId: string) => void;
  view?: 'queue' | 'planner';
  isAdminView?: boolean;
}

export function DesignerWorkspace({ onBriefClick, view = 'queue', isAdminView }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const { data: briefs = [] } = useCreativeBriefs({ allClients: true });
  const { data: cap } = useDesignerCap(teamMember?.id || null);
  const { data: allEntries = [] } = useTimeEntries(null, teamMember?.id);
  // Shared v2 timer (matches DesignerDashboard) — supports pause/resume across views.
  type TimerState = { briefId: string | null; accumulatedSec: number; segmentStart: string | null };
  const TIMER_KEY = teamMember?.id ? `creative_timer_v2_${teamMember.id}` : null;
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [weekOffset, setWeekOffset] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [logBriefId, setLogBriefId] = useState<string | null>(null);

  // Rehydrate + persist timer
  useEffect(() => {
    if (!TIMER_KEY) return;
    try { const raw = localStorage.getItem(TIMER_KEY); if (raw) setTimer(JSON.parse(raw)); } catch { /* ignore */ }
  }, [TIMER_KEY]);
  useEffect(() => {
    if (!TIMER_KEY) return;
    if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
    else localStorage.removeItem(TIMER_KEY);
  }, [timer, TIMER_KEY]);

  // For admin planner view, fetch all designers
  const { data: designers = [] } = useQuery({
    queryKey: ['designers_list'],
    queryFn: async () => {
      const { data } = await supabase.from('team_members').select('id, name, avatar_url').eq('role', 'designer').eq('is_active', true);
      return data || [];
    },
    enabled: isAdminView === true,
  });

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
    if (!timer) { setElapsed(0); return; }
    const compute = () => {
      const live = timer.segmentStart ? Math.floor((Date.now() - new Date(timer.segmentStart).getTime()) / 1000) : 0;
      setElapsed(timer.accumulatedSec + live);
    };
    compute();
    if (!timer.segmentStart) return;
    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [timer]);

  const isPaused = !!timer && !timer.segmentStart;
  const isRunning = !!timer && !!timer.segmentStart;

  const startTimer = useCallback((briefId: string) => {
    setTimer(prev => {
      if (prev && prev.briefId && prev.briefId !== briefId) {
        toast.error('Stop or save the current timer first');
        return prev;
      }
      if (prev && prev.briefId === briefId) {
        return { ...prev, segmentStart: new Date().toISOString() };
      }
      return { briefId, accumulatedSec: 0, segmentStart: new Date().toISOString() };
    });
    toast.info('Timer started');
  }, []);

  const pauseTimer = useCallback(() => {
    setTimer(prev => {
      if (!prev || !prev.segmentStart) return prev;
      const liveSec = Math.floor((Date.now() - new Date(prev.segmentStart).getTime()) / 1000);
      return { ...prev, accumulatedSec: prev.accumulatedSec + liveSec, segmentStart: null };
    });
    toast.info('Paused');
  }, []);

  const stopTimer = useMutation({
    mutationFn: async () => {
      if (!timer || !teamMember) return;
      const liveSec = timer.segmentStart ? Math.floor((Date.now() - new Date(timer.segmentStart).getTime()) / 1000) : 0;
      const totalSec = timer.accumulatedSec + liveSec;
      const duration = Math.max(1, Math.round(totalSec / 60));
      const startedAt = new Date(Date.now() - totalSec * 1000).toISOString();
      const brief = briefs.find((b: any) => b.id === timer.briefId);
      const { error } = await supabase.from('creative_time_entries').insert({
        brief_id: timer.briefId,
        team_member_id: teamMember.id,
        client_id: brief?.client_id ?? null,
        category: 'task',
        started_at: startedAt,
        ended_at: new Date().toISOString(),
        duration_minutes: duration,
        is_manual: false,
      });
      if (error) throw error;
      return duration;
    },
    onSuccess: (duration) => {
      setTimer(null);
      queryClient.invalidateQueries({ queryKey: ['creative_time_entries'] });
      toast.success(`Logged ${duration} min ✓`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const discardTimer = useCallback(() => { setTimer(null); toast.info('Timer discarded'); }, []);

  const markDone = useMutation({
    mutationFn: async (briefId: string) => {
      const { error } = await supabase.from('creative_briefs').update({ status: 'delivered' } as any).eq('id', briefId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
      toast.success('Marked as Done ✓');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateSchedule = useMutation({
    mutationFn: async ({ briefId, date }: { briefId: string; date: string | null }) => {
      const { error } = await supabase.from('creative_briefs').update({ scheduled_date: date } as any).eq('id', briefId);
      if (error) throw error;
      return { briefId, date };
    },
    onSuccess: ({ date }) => {
      queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
      toast.success(date ? `Scheduled for ${formatScheduleLabel(date)}` : 'Moved to unscheduled');
    },
    onError: (err: any) => toast.error(`Couldn't reschedule: ${err.message}`),
  });

  const updateEstimate = useMutation({
    mutationFn: async ({ briefId, hours }: { briefId: string; hours: number | null }) => {
      const { error } = await supabase.from('creative_briefs').update({ estimated_hours: hours } as any).eq('id', briefId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
      toast.success('Estimate updated');
    },
  });

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getScheduleKey = (date: string | null | undefined) => date?.slice(0, 10) || null;

  const formatScheduleLabel = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return format(new Date(year, month - 1, day), 'MMM d');
  };

  // Filter and sort briefs
  // Include 'draft' so designers see every brief assigned to them in one place — no task hides from Planner just because it hasn't been formally submitted yet.
  const activeStatuses = ['draft', 'submitted', 'in_design', 'ready_for_review', 'revision_requested', 'approved', 'delivered'];
  const statusMap: Record<string, string[]> = {
    todo: ['submitted'],
    in_progress: ['in_design'],
    awaiting: ['ready_for_review'],
    revisions: ['revision_requested'],
    all: activeStatuses,
  };
  const visibleStatuses = statusMap[statusFilter] || statusMap.all;
  const filtered = briefs
    .filter((b: any) => visibleStatuses.includes(b.status))
    .sort((a: any, b: any) => {
      const aOverdue = a.due_date && isPast(new Date(a.due_date)) ? 0 : 1;
      const bOverdue = b.due_date && isPast(new Date(b.due_date)) ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      const priOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
      return (priOrder[a.priority] ?? 2) - (priOrder[b.priority] ?? 2);
    });

  const capColor = capPercent < 70 ? 'bg-green-500' : capPercent < 90 ? 'bg-yellow-500' : 'bg-red-500';

  const handlePlannerDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    const briefId = result.draggableId;
    const destId = result.destination.droppableId;

    if (destId === 'unscheduled') {
      // Dragged back to unscheduled
      updateSchedule.mutate({ briefId, date: null });
    } else {
      // destId is an ISO date string
      updateSchedule.mutate({ briefId, date: destId });
    }
  }, [updateSchedule]);

  // Planner view: group by day
  if (view === 'planner') {
    const baseWeekStart = addDays(startOfWeek(now, { weekStartsOn: 1 }), weekOffset * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(baseWeekStart, i));
    const weekEndDay = addDays(baseWeekStart, 6);
    const weekLabel = weekOffset === 0
      ? 'This Week'
      : weekOffset === 1
      ? 'Next Week'
      : weekOffset === -1
      ? 'Last Week'
      : `${format(baseWeekStart, 'MMM d')} – ${format(weekEndDay, 'MMM d')}`;

    const activeBriefs = briefs.filter((b: any) => activeStatuses.includes(b.status));
    const unscheduled = activeBriefs.filter((b: any) => !getScheduleKey(b.scheduled_date));

    return (
      <DragDropContext onDragEnd={handlePlannerDragEnd}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            {isAdminView && designers.length > 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span>Viewing all designers' schedules</span>
              </div>
            ) : <div />}
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(o => o - 1)} aria-label="Previous week">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="px-3 text-sm font-medium min-w-[160px] text-center">
                {weekLabel}
                <div className="text-[10px] text-muted-foreground font-normal">
                  {format(baseWeekStart, 'MMM d')} – {format(weekEndDay, 'MMM d, yyyy')}
                </div>
              </div>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setWeekOffset(o => o + 1)} aria-label="Next week">
                <ChevronRight className="h-4 w-4" />
              </Button>
              {weekOffset !== 0 && (
                <Button variant="ghost" size="sm" className="h-8 ml-1" onClick={() => setWeekOffset(0)}>
                  Today
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
            {days.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const dayBriefs = activeBriefs.filter((b: any) => getScheduleKey(b.scheduled_date) === dateStr);
              const totalHrs = dayBriefs.reduce((s: number, b: any) => s + ((b as any).estimated_hours || 0), 0);
              const isToday = isSameDay(day, now);

              return (
                <Droppable key={dateStr} droppableId={dateStr}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`rounded-lg border p-3 min-h-[260px] flex flex-col transition-colors ${
                        isToday ? 'ring-2 ring-primary/30 bg-primary/5' : ''
                      } ${snapshot.isDraggingOver ? 'bg-accent/50 border-primary/40' : ''}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className={`text-xs font-semibold ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                            {format(day, 'EEE')}
                          </p>
                          <p className="text-sm font-medium">{format(day, 'MMM d')}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          {totalHrs > 0 && (
                            <Badge variant="secondary" className="text-[10px]">{totalHrs}h</Badge>
                          )}
                          {dayBriefs.length > 0 && (
                            <Badge variant="outline" className="text-[10px]">{dayBriefs.length}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5 flex-1">
                        {dayBriefs.map((brief: any, index: number) => (
                          <Draggable key={brief.id} draggableId={brief.id} index={index}>
                            {(dragProvided, dragSnapshot) => (
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                className={dragSnapshot.isDragging ? 'opacity-80 rotate-1' : ''}
                              >
                                <PlannerBriefCard
                                  brief={brief}
                                  onClick={() => onBriefClick(brief.id)}
                                  onEstimateChange={(hrs) => updateEstimate.mutate({ briefId: brief.id, hours: hrs })}
                                  onUnschedule={() => updateSchedule.mutate({ briefId: brief.id, date: null })}
                                  isTimerActive={timer?.briefId === brief.id}
                                  isRunning={isRunning && timer?.briefId === brief.id}
                                  elapsedLabel={timer?.briefId === brief.id ? formatTime(elapsed) : null}
                                  onStart={() => startTimer(brief.id)}
                                  onPause={pauseTimer}
                                  onStop={() => stopTimer.mutate()}
                                  onMarkDone={() => markDone.mutate(brief.id)}
                                  onLogTime={() => { setLogBriefId(brief.id); setLogOpen(true); }}
                                />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {/* Persistent drop hint that fills remaining space so multiple drops always land */}
                        <div
                          className={`flex-1 min-h-[60px] rounded-md border border-dashed transition-colors flex items-center justify-center ${
                            snapshot.isDraggingOver
                              ? 'border-primary/60 bg-primary/5'
                              : dayBriefs.length === 0
                              ? 'border-muted-foreground/20'
                              : 'border-transparent hover:border-muted-foreground/20'
                          }`}
                        >
                          <p className="text-[10px] text-muted-foreground">
                            {dayBriefs.length === 0 ? 'Drop tasks here' : '+ Drop more'}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>

          {/* Unscheduled briefs */}
          <div className="mt-4">
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              Unscheduled ({unscheduled.length})
              <span className="text-[10px] font-normal text-muted-foreground ml-2">
                Drag any card up to a day to schedule it
              </span>
            </h3>
            <Droppable droppableId="unscheduled">
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-2 rounded-lg border-2 border-dashed transition-colors ${
                    snapshot.isDraggingOver ? 'bg-accent/40 border-primary/50' : 'border-transparent'
                  }`}
                >
                  {unscheduled.map((brief: any, index: number) => (
                    <Draggable key={brief.id} draggableId={brief.id} index={index}>
                      {(dragProvided, dragSnapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          {...dragProvided.dragHandleProps}
                          className={dragSnapshot.isDragging ? 'opacity-80 rotate-1 shadow-lg' : ''}
                        >
                          <Card className="cursor-grab hover:shadow-md hover:border-primary/30 transition-all active:cursor-grabbing select-none">
                            <CardContent className="p-3">
                              <div
                                className="flex items-center gap-2 mb-1 cursor-pointer"
                                onClick={() => onBriefClick(brief.id)}
                              >
                                {brief.client_name && (
                                  <Badge variant="outline" className="text-[9px] shrink-0">{brief.client_name}</Badge>
                                )}
                                <p className="text-sm font-medium truncate">{brief.title}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="secondary" className={`text-[9px] ${STATUS_CONFIG[brief.status]?.color}`}>
                                  {STATUS_CONFIG[brief.status]?.label}
                                </Badge>
                                <div
                                  className="flex items-center gap-1 ml-auto"
                                  onClick={e => e.stopPropagation()}
                                  onMouseDown={e => e.stopPropagation()}
                                >
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  <Input
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    className="h-6 w-14 text-[10px] px-1"
                                    defaultValue={(brief as any).estimated_hours || ''}
                                    onBlur={e => updateEstimate.mutate({ briefId: brief.id, hours: e.target.value ? parseFloat(e.target.value) : null })}
                                    placeholder="hrs"
                                  />
                                  <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px] gap-1" onClick={() => startTimer(brief.id)} title="Start timer">
                                    <Play className="h-2.5 w-2.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1" onClick={() => { setLogBriefId(brief.id); setLogOpen(true); }} title="Log time manually">
                                    <Pencil className="h-2.5 w-2.5" />
                                  </Button>
                                  {brief.status !== 'delivered' && (
                                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1 text-green-700" onClick={() => markDone.mutate(brief.id)} title="Mark Done">
                                      <Check className="h-2.5 w-2.5" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  {unscheduled.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4 col-span-full">All briefs are scheduled!</p>
                  )}
                </div>
              )}
            </Droppable>
          </div>
        </div>
        <LogTimeDialog
          open={logOpen}
          onOpenChange={(o) => { setLogOpen(o); if (!o) setLogBriefId(null); }}
          briefs={briefs as any}
          editEntry={logBriefId ? { brief_id: logBriefId, category: 'task', started_at: new Date().toISOString(), duration_minutes: '' } : null}
        />
      </DragDropContext>
    );
  }

  // Queue view (default)
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
            {timer && (
              <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
                <div className={`h-2 w-2 rounded-full ${isRunning ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`} />
                <span className="text-sm font-mono font-medium">{formatTime(elapsed)}</span>
                {isRunning ? (
                  <Button size="sm" variant="outline" onClick={pauseTimer}><Pause className="h-3 w-3 mr-1" /> Pause</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => timer.briefId && startTimer(timer.briefId)}><Play className="h-3 w-3 mr-1" /> Resume</Button>
                )}
                <Button size="sm" variant="destructive" onClick={() => stopTimer.mutate()}>
                  <Square className="h-3 w-3 mr-1" /> Stop
                </Button>
                <Button size="sm" variant="ghost" onClick={discardTimer} title="Discard"><Trash2 className="h-3 w-3" /></Button>
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
          const isTimerActive = timer?.briefId === brief.id;

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
                    {brief.client_name && (
                      <Badge variant="outline" className="text-[9px] shrink-0">{brief.client_name}</Badge>
                    )}
                    <p className="text-sm font-medium truncate">{brief.title}</p>
                    <Badge variant="secondary" className={`text-[9px] shrink-0 ${statusConf.color}`}>{statusConf.label}</Badge>
                    <Badge variant="secondary" className={`text-[9px] shrink-0 ${priorityConf.color}`}>{priorityConf.label}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {brief.platforms?.length > 0 && (
                      <span>{brief.platforms.join(', ')}</span>
                    )}
                    {(brief as any).estimated_hours && (
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{(brief as any).estimated_hours}h est.</span>
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

function PlannerBriefCard({
  brief, onClick, onEstimateChange, onUnschedule,
  isTimerActive, isRunning, elapsedLabel,
  onStart, onPause, onStop, onMarkDone, onLogTime,
}: {
  brief: any;
  onClick: () => void;
  onEstimateChange: (hrs: number | null) => void;
  onUnschedule?: () => void;
  isTimerActive?: boolean;
  isRunning?: boolean;
  elapsedLabel?: string | null;
  onStart?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onMarkDone?: () => void;
  onLogTime?: () => void;
}) {
  const statusConf = STATUS_CONFIG[brief.status] || STATUS_CONFIG.draft;
  const priorityConf = PRIORITY_CONFIG[brief.priority] || PRIORITY_CONFIG.medium;
  const isDone = brief.status === 'delivered';

  const stop = (e: React.MouseEvent | React.PointerEvent) => { e.stopPropagation(); };

  return (
    <div
      className={`group rounded-md border bg-card p-2 cursor-pointer hover:shadow-sm transition-all text-xs relative ${isTimerActive ? 'ring-2 ring-primary/50' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-1.5 mb-1">
        <div className={`h-1.5 w-1.5 rounded-full mt-1 shrink-0 ${priorityConf.color.split(' ')[0]}`} />
        <div className="min-w-0 flex-1">
          {brief.client_name && (
            <p className="text-[9px] text-muted-foreground font-medium">{brief.client_name}</p>
          )}
          <p className="font-medium truncate">{brief.title}</p>
        </div>
        {onUnschedule && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUnschedule(); }}
            onMouseDown={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive text-[10px] leading-none px-1"
            title="Move back to unscheduled"
          >
            ✕
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-1">
        <Badge variant="secondary" className={`text-[8px] px-1 py-0 ${statusConf.color}`}>{statusConf.label}</Badge>
        <div
          className="flex items-center gap-1"
          onClick={stop}
          onMouseDown={stop as any}
        >
          <Clock className="h-2.5 w-2.5 text-muted-foreground" />
          <Input
            type="number"
            step="0.5"
            min="0"
            className="h-5 w-12 text-[10px] px-1"
            defaultValue={(brief as any).estimated_hours || ''}
            onBlur={e => onEstimateChange(e.target.value ? parseFloat(e.target.value) : null)}
            placeholder="hrs"
          />
        </div>
      </div>

      {/* Timer + done controls */}
      {(onStart || onMarkDone || onLogTime) && (
        <div
          className="mt-1.5 pt-1.5 border-t flex items-center gap-1 flex-wrap"
          onClick={stop}
          onMouseDown={stop as any}
        >
          {isTimerActive && elapsedLabel && (
            <span className={`font-mono text-[10px] ${isRunning ? 'text-primary' : 'text-muted-foreground'}`}>
              {elapsedLabel}
            </span>
          )}
          {!isTimerActive && onStart && !isDone && (
            <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px] gap-1" onClick={onStart}>
              <Play className="h-2.5 w-2.5" /> Start
            </Button>
          )}
          {isTimerActive && isRunning && onPause && (
            <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px] gap-1" onClick={onPause}>
              <Pause className="h-2.5 w-2.5" />
            </Button>
          )}
          {isTimerActive && !isRunning && onStart && (
            <Button size="sm" variant="outline" className="h-6 px-1.5 text-[10px] gap-1" onClick={onStart}>
              <Play className="h-2.5 w-2.5" />
            </Button>
          )}
          {isTimerActive && onStop && (
            <Button size="sm" variant="default" className="h-6 px-1.5 text-[10px] gap-1" onClick={onStop}>
              <Square className="h-2.5 w-2.5" /> Save
            </Button>
          )}
          {onLogTime && (
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1 ml-auto" onClick={onLogTime} title="Log time manually">
              <Pencil className="h-2.5 w-2.5" />
            </Button>
          )}
          {onMarkDone && !isDone && (
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1 text-green-700 hover:text-green-800 hover:bg-green-50" onClick={onMarkDone} title="Mark as Done">
              <Check className="h-2.5 w-2.5" /> Done
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
