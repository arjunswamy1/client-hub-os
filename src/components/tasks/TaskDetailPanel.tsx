import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { TASK_STATUS_CONFIG, TASK_PRIORITY_CONFIG } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { X, Clock, MessageSquare, Send, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { TASK_TYPE_CONFIG, TaskType } from './taskTypes';
import { MentionTextarea } from './MentionTextarea';
import { createNotification } from '@/hooks/useNotifications';

interface TaskDetailPanelProps {
  task: any;
  teamMembers: any[];
  onClose: () => void;
}

export function TaskDetailPanel({ task, teamMembers, onClose }: TaskDetailPanelProps) {
  const { teamMember } = useAuth();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);

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
        mentioned_ids: mentionIds,
      } as any);
      if (error) throw error;

      // Notify mentioned members (skip self)
      await Promise.all(
        mentionIds
          .filter(id => id !== teamMember.id)
          .map(id => createNotification({
            recipientId: id,
            type: 'task_mention',
            title: `${teamMember.name} mentioned you`,
            message: `On task "${task.title}": ${comment.slice(0, 140)}`,
          }))
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task_comments', task.id] });
      setComment('');
      setMentionIds([]);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleTimer = useMutation({
    mutationFn: async () => {
      if (!teamMember) throw new Error('Not authenticated');
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
  const taskType = (task.task_type || 'general') as TaskType;
  const typeData = task.type_data || {};
  const typeCfg = TASK_TYPE_CONFIG[taskType];

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l bg-card shadow-xl animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] gap-1">
            <span>{typeCfg.emoji}</span>{typeCfg.label}
          </Badge>
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

        {/* Type-specific details */}
        <TypeDetailsView taskType={taskType} data={typeData} />

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
                  <CommentBody content={c.content} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Comment input with @mentions */}
      <div className="border-t p-3">
        <div className="flex gap-2 items-end">
          <MentionTextarea
            value={comment}
            onChange={setComment}
            onMentionsChange={setMentionIds}
            members={teamMembers.map(m => ({ id: m.id, name: m.name }))}
            placeholder="Add a comment... type @ to mention"
            className="min-h-[60px] text-sm resize-none"
          />
          <Button
            size="icon"
            className="shrink-0"
            disabled={!comment.trim() || addComment.isPending}
            onClick={() => addComment.mutate()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {mentionIds.length > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Will notify {mentionIds.length} {mentionIds.length === 1 ? 'person' : 'people'}
          </p>
        )}
      </div>
    </div>
  );
}

/** Render comment text and highlight @Name tokens */
function CommentBody({ content }: { content: string }) {
  const parts = content.split(/(@[\w]+(?:\s[\w]+)?)/g);
  return (
    <p className="text-xs text-foreground/80 mt-0.5 whitespace-pre-wrap">
      {parts.map((p, i) =>
        p.startsWith('@')
          ? <span key={i} className="text-primary font-medium">{p}</span>
          : <span key={i}>{p}</span>
      )}
    </p>
  );
}

/** Read-only display of task_type-specific data */
function TypeDetailsView({ taskType, data }: { taskType: TaskType; data: any }) {
  if (taskType === 'general' || !data || Object.keys(data).length === 0) return null;

  if (taskType === 'landing_page') {
    return (
      <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Landing Page</p>
        {data.landing_page_url && (
          <Field label="URL">
            <a href={data.landing_page_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
              {data.landing_page_url} <ExternalLink className="h-3 w-3" />
            </a>
          </Field>
        )}
        <Field label="Tracking">
          <span className="inline-flex items-center gap-1">
            {data.tracking_confirmed
              ? <><CheckCircle2 className="h-3 w-3 text-primary" /> Confirmed</>
              : <><AlertCircle className="h-3 w-3 text-destructive" /> Not confirmed</>}
          </span>
        </Field>
        {!data.tracking_confirmed && data.tracking_notes && (
          <Field label="Tracking notes"><span className="whitespace-pre-wrap">{data.tracking_notes}</span></Field>
        )}
        {data.must_haves && (
          <Field label="Must-haves"><span className="whitespace-pre-wrap">{data.must_haves}</span></Field>
        )}
        {data.is_ab_test && data.variants?.length > 0 && (
          <div>
            <p className="text-muted-foreground mb-1">A/B Variants</p>
            <div className="space-y-1">
              {data.variants.map((v: any, i: number) => (
                <div key={i} className="rounded border bg-background p-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{v.label}</Badge>
                    {v.url && (
                      <a href={v.url} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate text-xs">
                        {v.url}
                      </a>
                    )}
                  </div>
                  {v.notes && <p className="text-[11px] text-muted-foreground mt-1">{v.notes}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (taskType === 'creative_brief') {
    return (
      <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Creative Brief</p>
        {data.briefs_needed && <Field label="Briefs"><span className="whitespace-pre-wrap">{data.briefs_needed}</span></Field>}
        {data.num_ads != null && <Field label="# Ads">{data.num_ads}</Field>}
        {data.deadline && <Field label="Deadline">{data.deadline}</Field>}
        {data.formats && <Field label="Formats">{data.formats}</Field>}
        {data.notes && <Field label="Notes"><span className="whitespace-pre-wrap">{data.notes}</span></Field>}
      </div>
    );
  }

  if (taskType === 'media_build') {
    return (
      <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Media Build</p>
        {data.platform && <Field label="Platform">{data.platform}</Field>}
        {data.vertical && <Field label="Vertical">{data.vertical}</Field>}
        {data.campaign_objective && <Field label="Objective">{data.campaign_objective}</Field>}
        {data.budget && <Field label="Budget">{data.budget}</Field>}
        {data.notes && <Field label="Notes"><span className="whitespace-pre-wrap">{data.notes}</span></Field>}
      </div>
    );
  }
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground/90">{children}</span>
    </div>
  );
}
