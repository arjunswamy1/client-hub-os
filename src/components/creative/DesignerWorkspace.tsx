
import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Play, Square, AlertTriangle, Calendar, Clock, User } from 'lucide-react';
import { format, differenceInDays, isPast, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay, endOfDay, addDays, isSameDay } from 'date-fns';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useCreativeBriefs, useDesignerCap, useTimeEntries } from '@/hooks/useCreativeBriefs';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/types/creative';
import { toast } from 'sonner';

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
  const [activeTimer, setActiveTimer] = useState<{ briefId: string; startedAt: Date } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');

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

  const updateSchedule = useMutation({
    mutationFn: async ({ briefId, date }: { briefId: string; date: string | null }) => {
      const { error } = await supabase.from('creative_briefs').update({ scheduled_date: date } as any).eq('id', briefId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creative_briefs'] });
    },
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

  // Filter and sort briefs
  const activeStatuses = ['submitted', 'in_design', 'ready_for_review', 'revision_requested', 'approved', 'delivered'];
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
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(startOfWeek(now, { weekStartsOn: 1 }), i);
      return d;
    });

    const activeBriefs = briefs.filter((b: any) => activeStatuses.includes(b.status));
    const unscheduled = activeBriefs.filter((b: any) => !b.scheduled_date);

    return (
      <DragDropContext onDragEnd={handlePlannerDragEnd}>
        <div className="space-y-4">
          {isAdminView && designers.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span>Viewing all designers' schedules</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-7 gap-3">
            {days.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const dayBriefs = activeBriefs.filter((b: any) =>
                b.scheduled_date && isSameDay(new Date(b.scheduled_date), day)
              );
              const totalHrs = dayBriefs.reduce((s: number, b: any) => s + ((b as any).estimated_hours || 0), 0);
              const isToday = isSameDay(day, now);

              return (
                <Droppable key={dateStr} droppableId={dateStr}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`rounded-lg border p-3 min-h-[200px] transition-colors ${
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
                        {totalHrs > 0 && (
                          <Badge variant="secondary" className="text-[10px]">{totalHrs}h</Badge>
                        )}
                      </div>
                      <div className="space-y-1.5">
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
                                />
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                        {dayBriefs.length === 0 && !snapshot.isDraggingOver && (
                          <p className="text-[10px] text-muted-foreground text-center py-4">No tasks</p>
                        )}
                      </div>
                    </div>
                  )}
                </Droppable>
              );
            })}
          </div>

          {/* Unscheduled briefs */}
          <Droppable droppableId="unscheduled" direction="horizontal">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`mt-4 transition-colors rounded-lg ${snapshot.isDraggingOver ? 'bg-accent/30' : ''}`}
              >
                <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  Unscheduled ({unscheduled.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {unscheduled.map((brief: any, index: number) => (
                    <Draggable key={brief.id} draggableId={brief.id} index={index}>
                      {(dragProvided, dragSnapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          {...dragProvided.dragHandleProps}
                          className={dragSnapshot.isDragging ? 'opacity-80 rotate-1' : ''}
                        >
                          <Card className="cursor-grab hover:shadow-md transition-all active:cursor-grabbing" onClick={() => onBriefClick(brief.id)}>
                            <CardContent className="p-3">
                              <div className="flex items-center gap-2 mb-1">
                                {brief.client_name && (
                                  <Badge variant="outline" className="text-[9px] shrink-0">{brief.client_name}</Badge>
                                )}
                                <p className="text-sm font-medium truncate">{brief.title}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className={`text-[9px] ${STATUS_CONFIG[brief.status]?.color}`}>
                                  {STATUS_CONFIG[brief.status]?.label}
                                </Badge>
                                <div className="flex items-center gap-1 ml-auto" onClick={e => e.stopPropagation()}>
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
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
                {unscheduled.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">All briefs are scheduled!</p>
                )}
              </div>
            )}
          </Droppable>
        </div>
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

function PlannerBriefCard({ brief, onClick, onEstimateChange }: {
  brief: any;
  onClick: () => void;
  onEstimateChange: (hrs: number | null) => void;
}) {
  const statusConf = STATUS_CONFIG[brief.status] || STATUS_CONFIG.draft;
  const priorityConf = PRIORITY_CONFIG[brief.priority] || PRIORITY_CONFIG.medium;

  return (
    <div
      className="rounded-md border bg-card p-2 cursor-pointer hover:shadow-sm transition-all text-xs"
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
      </div>
      <div className="flex items-center justify-between">
        <Badge variant="secondary" className={`text-[8px] px-1 py-0 ${statusConf.color}`}>{statusConf.label}</Badge>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
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
    </div>
  );
}
