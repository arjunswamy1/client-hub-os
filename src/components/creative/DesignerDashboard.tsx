
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Play, Pause, Square, Clock, Flame, Timer, Plus, Phone, Trash2, Pencil,
  TrendingUp, AlertTriangle, ChevronRight, Zap, Target
} from 'lucide-react';
import { format, differenceInDays, isPast, startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay, endOfDay, isSameDay } from 'date-fns';
import { useCreativeBriefs, useDesignerCap, useTimeEntries } from '@/hooks/useCreativeBriefs';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/types/creative';
import { toast } from 'sonner';
import { LogTimeDialog } from './LogTimeDialog';


interface Props {
  onBriefClick: (briefId: string) => void;
}

export function DesignerDashboard({ onBriefClick }: Props) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const { data: briefs = [] } = useCreativeBriefs({ allClients: true });
  const { data: cap } = useDesignerCap(teamMember?.id || null);
  const { data: allEntries = [] } = useTimeEntries(null, teamMember?.id);

  // ---- Timer state (supports pause/resume) ----
  // accumulatedSec = time logged in previous run segments (before current segment / pause)
  // segmentStart   = when the *current* running segment began; null when paused
  type TimerState = { briefId: string | null; accumulatedSec: number; segmentStart: string | null };
  const TIMER_KEY = teamMember?.id ? `creative_timer_v2_${teamMember.id}` : null;
  const [timer, setTimer] = useState<TimerState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<any | null>(null);

  // Re-hydrate
  useEffect(() => {
    if (!TIMER_KEY) return;
    try {
      const raw = localStorage.getItem(TIMER_KEY);
      if (raw) setTimer(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [TIMER_KEY]);

  // Persist
  useEffect(() => {
    if (!TIMER_KEY) return;
    if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer));
    else localStorage.removeItem(TIMER_KEY);
  }, [timer, TIMER_KEY]);

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

  // Calculate actual hours per brief
  const briefHoursMap = useMemo(() => {
    const map: Record<string, number> = {};
    allEntries.forEach((e: any) => {
      if (!e.brief_id) return;
      if (!map[e.brief_id]) map[e.brief_id] = 0;
      map[e.brief_id] += (e.duration_minutes || 0) / 60;
    });
    return map;
  }, [allEntries]);

  // Timer tick
  useEffect(() => {
    if (!timer) { setElapsed(0); return; }
    const compute = () => {
      const live = timer.segmentStart ? Math.floor((Date.now() - new Date(timer.segmentStart).getTime()) / 1000) : 0;
      setElapsed(timer.accumulatedSec + live);
    };
    compute();
    if (!timer.segmentStart) return; // paused — don't tick
    const interval = setInterval(compute, 1000);
    return () => clearInterval(interval);
  }, [timer]);

  const isPaused = !!timer && !timer.segmentStart;
  const isRunning = !!timer && !!timer.segmentStart;

  const startTimer = useCallback((briefId: string) => {
    if (timer && timer.briefId && timer.briefId !== briefId) {
      toast.error('Stop or save the current timer first');
      return;
    }
    // Resume or fresh start on this brief
    setTimer(prev => prev && prev.briefId === briefId
      ? { ...prev, segmentStart: new Date().toISOString() }
      : { briefId, accumulatedSec: 0, segmentStart: new Date().toISOString() });
    toast.info('Timer started');
  }, [timer]);

  const pauseTimer = useCallback(() => {
    setTimer(prev => {
      if (!prev || !prev.segmentStart) return prev;
      const liveSec = Math.floor((Date.now() - new Date(prev.segmentStart).getTime()) / 1000);
      return { ...prev, accumulatedSec: prev.accumulatedSec + liveSec, segmentStart: null };
    });
    toast.info('Paused');
  }, []);

  const resumeTimer = useCallback(() => {
    setTimer(prev => prev ? { ...prev, segmentStart: new Date().toISOString() } : prev);
  }, []);

  const stopTimer = useMutation({
    mutationFn: async () => {
      if (!timer || !teamMember) return;
      // Compute final seconds
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

  const discardTimer = useCallback(() => {
    setTimer(null);
    toast.info('Timer discarded');
  }, []);



  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Categorize briefs
  const activeStatuses = ['draft', 'submitted', 'in_design', 'ready_for_review', 'revision_requested'];
  const todayBriefs = briefs
    .filter((b: any) => activeStatuses.includes(b.status) && b.scheduled_date && isSameDay(new Date(b.scheduled_date), now));
  const revisionBriefs = briefs.filter((b: any) => b.status === 'revision_requested');
  const inDesignBriefs = briefs.filter((b: any) => b.status === 'in_design');
  const submittedBriefs = briefs.filter((b: any) => b.status === 'submitted');
  const overdueBriefs = briefs.filter((b: any) =>
    b.due_date && isPast(new Date(b.due_date)) && activeStatuses.includes(b.status)
  );

  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = teamMember?.name?.split(' ')[0] || 'Designer';

  return (
    <div className="space-y-6">
      {/* Hero greeting + active timer */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-background border p-6">
        <div className="relative z-10">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {greeting}, {firstName} 👋
              </h1>
              <p className="text-muted-foreground mt-1">
                {todayBriefs.length > 0
                  ? `You have ${todayBriefs.length} task${todayBriefs.length > 1 ? 's' : ''} scheduled today`
                  : 'No tasks scheduled for today — check your queue'}
              </p>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              {format(now, 'EEEE, MMMM d')}
            </div>
          </div>

          {/* Active timer banner */}
          {timer && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-card/80 backdrop-blur border border-primary/20 p-4">
              <div className={`h-3 w-3 rounded-full ${isRunning ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'}`} />
              <div className="flex-1 min-w-[160px]">
                <p className="text-xs text-muted-foreground">{isPaused ? 'Paused on' : 'Currently working on'}</p>
                <p className="font-medium text-sm">
                  {timer.briefId ? (briefs.find((b: any) => b.id === timer.briefId)?.title || 'Task') : 'Untitled timer'}
                </p>
              </div>
              <div className="font-mono text-2xl font-bold tabular-nums tracking-wider text-primary">
                {formatTime(elapsed)}
              </div>
              {isRunning ? (
                <Button variant="outline" size="sm" onClick={pauseTimer} className="gap-1.5">
                  <Pause className="h-3 w-3" /> Pause
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={resumeTimer} className="gap-1.5">
                  <Play className="h-3 w-3" /> Resume
                </Button>
              )}
              <Button variant="default" size="sm" onClick={() => stopTimer.mutate()} className="gap-1.5" disabled={stopTimer.isPending}>
                <Square className="h-3 w-3" /> Save & Stop
              </Button>
              <Button variant="ghost" size="sm" onClick={discardTimer} className="gap-1.5 text-muted-foreground">
                <Trash2 className="h-3 w-3" /> Discard
              </Button>
            </div>
          )}

          {/* Quick log actions */}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setEditEntry(null); setLogOpen(true); }}>
              <Plus className="h-3 w-3" /> Log time manually
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setEditEntry({ category: 'call', duration_minutes: '', started_at: new Date().toISOString() }); setLogOpen(true); }}>
              <Phone className="h-3 w-3" /> Log a call
            </Button>
          </div>

        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Timer className="h-4 w-4" />} label="Today" value={`${(dayMinutes / 60).toFixed(1)}h`} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="This Week" value={`${(weekMinutes / 60).toFixed(1)}h`} />
        <StatCard
          icon={<Target className="h-4 w-4" />}
          label="Monthly Cap"
          value={`${monthHours.toFixed(1)} / ${capHours}h`}
          extra={
            <Progress
              value={capPercent}
              className="h-1.5 mt-1.5"
            />
          }
          alert={capPercent >= 80}
        />
        <StatCard
          icon={<Flame className="h-4 w-4" />}
          label="Active Tasks"
          value={`${inDesignBriefs.length + submittedBriefs.length}`}
          alert={revisionBriefs.length > 0}
          alertText={revisionBriefs.length > 0 ? `${revisionBriefs.length} revision${revisionBriefs.length > 1 ? 's' : ''}` : undefined}
        />
      </div>

      {/* Overdue alert */}
      {overdueBriefs.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="text-destructive font-medium">
            {overdueBriefs.length} overdue task{overdueBriefs.length > 1 ? 's' : ''} — please prioritize
          </span>
        </div>
      )}

      {/* Revisions callout */}
      {revisionBriefs.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-orange-600 mb-2 flex items-center gap-2">
            <Zap className="h-4 w-4" /> Revisions Needed ({revisionBriefs.length})
          </h2>
          <div className="space-y-2">
            {revisionBriefs.map((brief: any) => (
              <TaskCard
                key={brief.id}
                brief={brief}
                actualHours={briefHoursMap[brief.id]}
                isTimerActive={activeTimer?.briefId === brief.id}
                onStart={() => startTimer(brief.id)}
                onStop={() => stopTimer.mutate()}
                onClick={() => onBriefClick(brief.id)}
                highlight="revision"
              />
            ))}
          </div>
        </div>
      )}

      {/* Today's tasks */}
      {todayBriefs.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" /> Today's Schedule
          </h2>
          <div className="space-y-2">
            {todayBriefs.filter((b: any) => b.status !== 'revision_requested').map((brief: any) => (
              <TaskCard
                key={brief.id}
                brief={brief}
                actualHours={briefHoursMap[brief.id]}
                isTimerActive={activeTimer?.briefId === brief.id}
                onStart={() => startTimer(brief.id)}
                onStop={() => stopTimer.mutate()}
                onClick={() => onBriefClick(brief.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Up next queue */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Up Next</h2>
        <div className="space-y-2">
          {[...inDesignBriefs, ...submittedBriefs]
            .filter((b: any) => !todayBriefs.some((t: any) => t.id === b.id) && b.status !== 'revision_requested')
            .sort((a: any, b: any) => {
              const priOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
              return (priOrder[a.priority] ?? 2) - (priOrder[b.priority] ?? 2);
            })
            .slice(0, 8)
            .map((brief: any) => (
              <TaskCard
                key={brief.id}
                brief={brief}
                actualHours={briefHoursMap[brief.id]}
                isTimerActive={activeTimer?.briefId === brief.id}
                onStart={() => startTimer(brief.id)}
                onStop={() => stopTimer.mutate()}
                onClick={() => onBriefClick(brief.id)}
              />
            ))}
          {inDesignBriefs.length + submittedBriefs.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              🎉 All caught up! No pending tasks.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, extra, alert, alertText }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  extra?: React.ReactNode;
  alert?: boolean;
  alertText?: string;
}) {
  return (
    <Card className={alert ? 'border-orange-300/50' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-lg font-bold">{value}</p>
        {extra}
        {alertText && (
          <p className="text-[10px] text-orange-600 mt-1 font-medium">{alertText}</p>
        )}
      </CardContent>
    </Card>
  );
}

function TaskCard({ brief, actualHours, isTimerActive, onStart, onStop, onClick, highlight }: {
  brief: any;
  actualHours?: number;
  isTimerActive: boolean;
  onStart: () => void;
  onStop: () => void;
  onClick: () => void;
  highlight?: 'revision';
}) {
  const statusConf = STATUS_CONFIG[brief.status] || STATUS_CONFIG.draft;
  const _priorityConf = PRIORITY_CONFIG[brief.priority] || PRIORITY_CONFIG.medium;
  const dueDate = brief.due_date ? new Date(brief.due_date) : null;
  const isOverdue = dueDate && isPast(dueDate) && !['approved', 'delivered'].includes(brief.status);
  const daysLeft = dueDate ? differenceInDays(dueDate, new Date()) : null;

  const estimatedHours = brief.estimated_hours || null;
  const actual = actualHours ? +actualHours.toFixed(1) : 0;
  const overEstimate = estimatedHours && actual > estimatedHours;

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md group ${
        highlight === 'revision' ? 'border-orange-300 bg-orange-50/30' : ''
      } ${isTimerActive ? 'ring-2 ring-primary/40 shadow-md' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-4 flex items-center gap-4">
        {/* Priority dot */}
        <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${
          brief.priority === 'urgent' ? 'bg-red-500' :
          brief.priority === 'high' ? 'bg-orange-500' :
          brief.priority === 'medium' ? 'bg-blue-500' : 'bg-gray-400'
        }`} />

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-sm font-medium truncate">{brief.title}</p>
            <Badge variant="secondary" className={`text-[9px] shrink-0 ${statusConf.color}`}>
              {statusConf.label}
            </Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {brief.client_name && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full inline-block" style={{ backgroundColor: brief.client_color }} />
                {brief.client_name}
              </span>
            )}
            {brief.platforms?.length > 0 && (
              <span>{brief.platforms.join(', ')}</span>
            )}
            {dueDate && (
              <span className={isOverdue ? 'text-destructive font-medium' : daysLeft !== null && daysLeft <= 2 ? 'text-orange-600 font-medium' : ''}>
                {isOverdue ? `⚠ Overdue by ${Math.abs(daysLeft!)}d` :
                 `Due ${format(dueDate, 'MMM d')}`}
              </span>
            )}
          </div>
        </div>

        {/* Time tracking comparison */}
        <div className="flex items-center gap-3 shrink-0">
          {(estimatedHours || actual > 0) && (
            <div className="text-right text-xs">
              <div className="flex items-center gap-1.5">
                <span className={`font-mono font-semibold ${overEstimate ? 'text-red-600' : 'text-foreground'}`}>
                  {actual}h
                </span>
                {estimatedHours && (
                  <>
                    <span className="text-muted-foreground">/</span>
                    <span className="text-muted-foreground font-mono">{estimatedHours}h</span>
                  </>
                )}
              </div>
              {estimatedHours && (
                <div className="w-16 h-1 rounded-full bg-muted mt-1 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      overEstimate ? 'bg-red-500' : actual / estimatedHours > 0.7 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, (actual / estimatedHours) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Timer button */}
          <Button
            size="sm"
            variant={isTimerActive ? 'destructive' : 'outline'}
            className={`gap-1.5 ${!isTimerActive ? 'opacity-0 group-hover:opacity-100 transition-opacity' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (isTimerActive) onStop();
              else onStart();
            }}
          >
            {isTimerActive ? (
              <><Square className="h-3 w-3" /> Stop</>
            ) : (
              <><Play className="h-3 w-3" /> Start</>
            )}
          </Button>
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </CardContent>
    </Card>
  );
}
