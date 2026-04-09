import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { X, Clock, MessageSquare, Send } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';

interface TaskDetailPanelProps {
  task: any;
  teamMembers: any[];
  onClose: () => void;
}

export function TaskDetailPanel({ task, teamMembers, onClose }: TaskDetailPanelProps) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');

  const { data: comments = [] } = useQuery({
    queryKey: ['task_comments', task.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_comments')
        .select('*, author:team_members!task_comments_author_id_fkey(*)')
        .eq('task_id', task.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: timeEntries = [] } = useQuery({
    queryKey: ['task_time_entries', task.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_time_entries')
        .select('*, team_member:team_members!task_time_entries_team_member_id_fkey(*)')
        .eq('task_id', task.id)
        .order('started_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateTask = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const { error } = await supabase.from('tasks').update(updates as any).eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const addComment = useMutation({
    mutationFn: async () => {
      if (!teamMember) throw new Error('Not authenticated');
      const { error } = await supabase.from('task_comments').insert({
        task_id: task.id,
        author_id: teamMember.id,
        content: comment,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task_comments', task.id] });
      setComment('');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleTimer = useMutation({
    mutationFn: async () => {
      if (!teamMember) throw new Error('Not authenticated');
      // Check for active timer
      const { data: active } = await supabase
        .from('task_time_entries')
        .select('id')
        .eq('task_id', task.id)
        .eq('team_member_id', teamMember.id)
        .is('ended_at', null)
        .maybeSingle();

      if (active) {
        const { error } = await supabase.from('task_time_entries')
          .update({ ended_at: new Date().toISOString() })
          .eq('id', active.id);
        if (error) throw error;
        toast.success('Timer stopped');
      } else {
        const { error } = await supabase.from('task_time_entries').insert({
          task_id: task.id,
          team_member_id: teamMember.id,
        });
        if (error) throw error;
        toast.success('Timer started');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task_time_entries', task.id] }),
  });

  const activeTimer = timeEntries.find((e: any) => !e.ended_at);

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l bg-card shadow-xl animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="text-[10px]"
            style={{ color: TASK_PRIORITY_CONFIG[task.priority as keyof typeof TASK_PRIORITY_CONFIG]?.color }}
          >
            {task.priority}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {TASK_STATUS_CONFIG[task.status as keyof typeof TASK_STATUS_CONFIG]?.label}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
        <h2 className="text-lg font-semibold">{task.title}</h2>

        {task.description && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
        )}

        {/* Meta */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Status</p>
            <Select
              value={task.status}
              onValueChange={(v) => updateTask.mutate({ status: v, completed_at: v === 'done' ? new Date().toISOString() : null })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TASK_STATUS_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Assignee</p>
            <Select
              value={task.assignee_id || ''}
              onValueChange={(v) => updateTask.mutate({ assignee_id: v || null })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                {teamMembers.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Time Tracking */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Time Tracking
            </p>
            <Button
              size="sm"
              variant={activeTimer ? 'destructive' : 'outline'}
              className="h-7 text-xs"
              onClick={() => toggleTimer.mutate()}
            >
              {activeTimer ? 'Stop Timer' : 'Start Timer'}
            </Button>
          </div>
          {timeEntries.length > 0 && (
            <div className="space-y-1">
              {timeEntries.slice(0, 5).map((entry: any) => (
                <div key={entry.id} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{entry.team_member?.name}</span>
                  <span>
                    {format(new Date(entry.started_at), 'MMM d, HH:mm')}
                    {entry.ended_at ? ` — ${format(new Date(entry.ended_at), 'HH:mm')}` : ' (active)'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Comments */}
        <div>
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 mb-2">
            <MessageSquare className="h-3 w-3" /> Comments ({comments.length})
          </p>
          <div className="space-y-3">
            {comments.map((c: any) => (
              <div key={c.id} className="flex gap-2">
                <Avatar className="h-6 w-6 shrink-0">
                  <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                    {c.author?.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{c.author?.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(c.created_at), 'MMM d, HH:mm')}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/80 mt-0.5">{c.content}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Comment input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Add a comment..."
            className="min-h-[60px] text-sm resize-none"
          />
          <Button
            size="icon"
            className="shrink-0 self-end"
            disabled={!comment.trim() || addComment.isPending}
            onClick={() => addComment.mutate()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
