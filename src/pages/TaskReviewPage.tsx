/**
 * Task review queue — the gate between an extractor and someone's board.
 *
 * Nothing becomes a task without passing here or clearing all three gates
 * automatically. Each pending candidate shows the raw extracted text, the proposed
 * title, a link back to the sentence that produced it, and the gate's own reasoning —
 * that reasoning is what tells a human why the item is in front of them. A near
 * duplicate is shown beside the existing task it resembles, so "merge" is a judgement
 * rather than a guess.
 *
 * Every action writes `task_feedback` with the original text. Feedback is never fed
 * back into the prompt automatically; it is the raw material for a reviewed rule.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Check, X, Loader2, ExternalLink, GitMerge, Pencil, Inbox, AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface Candidate {
  id: string;
  client_id: string | null;
  source: string;
  source_ref: Record<string, any> | null;
  raw_text: string;
  proposed_title: string;
  proposed_assignee_id: string | null;
  owner_raw: string | null;
  owner_side: string | null;
  confidence: number | null;
  gate_results: Record<string, any> | null;
  created_at: string;
}

const BLOCK_LABEL: Record<string, string> = {
  not_a_task: 'Not a task',
  low_confidence: 'Model unsure',
  duplicate: 'Duplicate',
  near_duplicate: 'Looks like an existing task',
  appears_completed: 'May already be done',
  owner_not_cpm: 'Owner is not on our team',
  no_owner: 'No owner identified',
};

export default function TaskReviewPage() {
  const queryClient = useQueryClient();
  const { teamMember } = useAuth() as any;
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [rejecting, setRejecting] = useState<Candidate | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const clients = useQuery({
    queryKey: ['clients', 'review'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id, name');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const members = useQuery({
    queryKey: ['team_members', 'review'],
    queryFn: async () => {
      const { data, error } = await supabase.from('team_members').select('id, name').eq('is_active', true);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const candidates = useQuery({
    queryKey: ['task_candidates', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_candidates')
        .select('id, client_id, source, source_ref, raw_text, proposed_title, proposed_assignee_id, owner_raw, owner_side, confidence, gate_results, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Candidate[];
    },
  });

  const clientName = (id: string | null) =>
    id ? (clients.data ?? []).find((c: any) => c.id === id)?.name ?? 'Unknown client' : 'Agency / internal';

  const memberName = (id: string | null) =>
    id ? (members.data ?? []).find((m: any) => m.id === id)?.name ?? 'Unknown' : null;

  const grouped = useMemo(() => {
    const map = new Map<string, Candidate[]>();
    for (const c of candidates.data ?? []) {
      const key = String(c.client_id);
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()];
  }, [candidates.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['task_candidates'] });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  const logFeedback = async (
    c: Candidate,
    action: 'not_a_task' | 'duplicate' | 'reworded' | 'confirmed',
    extra: { corrected_text?: string; comment?: string; task_id?: string | null } = {},
  ) => {
    await supabase.from('task_feedback').insert({
      candidate_id: c.id,
      task_id: extra.task_id ?? null,
      team_member_id: teamMember?.id ?? null,
      action,
      original_text: c.raw_text,
      corrected_text: extra.corrected_text ?? null,
      comment: extra.comment ?? null,
      surface: 'hub',
    });
  };

  /** Approve — copies the candidate into tasks and links both rows. */
  const approve = useMutation({
    mutationFn: async ({ c, title, assigneeId }: { c: Candidate; title: string; assigneeId: string | null }) => {
      const ref = c.source_ref ?? {};
      const meetingDate = typeof ref.meeting_date === 'string' ? ref.meeting_date : null;
      const base = meetingDate ? new Date(meetingDate) : new Date();
      const { data: task, error } = await supabase.from('tasks').insert({
        client_id: c.client_id,
        title,
        description: c.raw_text,
        task_type: 'general',
        status: 'todo',
        priority: 'medium',
        assignee_id: assigneeId,
        created_by_id: teamMember?.id ?? null,
        due_date: new Date(base.getTime() + 7 * 86400000).toISOString().slice(0, 10),
        type_data: {
          ...ref,
          source: c.source,
          owner_raw: c.owner_raw,
          owner_side: c.owner_side,
          candidate_id: c.id,
          approved_in_review: true,
          gate_results: c.gate_results ?? {},
        },
      }).select('id').maybeSingle();
      if (error) throw new Error(error.message);

      const { error: updErr } = await supabase.from('task_candidates').update({
        status: 'promoted',
        promoted_task_id: task?.id ?? null,
        reviewed_by_id: teamMember?.id ?? null,
        reviewed_at: new Date().toISOString(),
      }).eq('id', c.id);
      if (updErr) throw new Error(updErr.message);

      const reworded = title.trim() !== c.proposed_title.trim();
      await logFeedback(c, reworded ? 'reworded' : 'confirmed', {
        corrected_text: reworded ? title : undefined,
        task_id: task?.id ?? null,
      });
    },
    onSuccess: () => { toast.success('Added to the board'); setEditing(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async ({ c, reason }: { c: Candidate; reason: string }) => {
      const { error } = await supabase.from('task_candidates').update({
        status: 'rejected',
        rejected_reason: reason || 'rejected_in_review',
        reviewed_by_id: teamMember?.id ?? null,
        reviewed_at: new Date().toISOString(),
      }).eq('id', c.id);
      if (error) throw new Error(error.message);
      await logFeedback(c, 'not_a_task', { comment: reason || undefined });
    },
    onSuccess: () => { toast.success('Rejected'); setRejecting(null); setRejectReason(''); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const merge = useMutation({
    mutationFn: async ({ c, taskId }: { c: Candidate; taskId: string }) => {
      const { error } = await supabase.from('task_candidates').update({
        status: 'merged',
        duplicate_of_task_id: taskId,
        reviewed_by_id: teamMember?.id ?? null,
        reviewed_at: new Date().toISOString(),
      }).eq('id', c.id);
      if (error) throw new Error(error.message);
      await logFeedback(c, 'duplicate', { task_id: taskId });
    },
    onSuccess: () => { toast.success('Merged into the existing task'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = approve.isPending || reject.isPending || merge.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Task Review</h1>
        <p className="text-sm text-muted-foreground">
          Everything extracted from meetings and client channels waits here until it passes the quality check or a
          person approves it. Nothing reaches a board unreviewed.
        </p>
      </div>

      {candidates.isLoading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : candidates.error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {(candidates.error as Error).message}
        </div>
      ) : (candidates.data ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Inbox className="mb-3 h-12 w-12 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">Nothing waiting for review</p>
        </div>
      ) : (
        grouped.map(([clientId, rows]) => (
          <div key={clientId} className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">{clientName(clientId === 'null' ? null : clientId)}</h2>
              <Badge variant="secondary">{rows.length}</Badge>
            </div>

            {rows.map((c) => {
              const gate = c.gate_results ?? {};
              const blocks: string[] = Array.isArray(gate.blocked_by) ? gate.blocked_by : [];
              const reason = gate.gate_a?.is_task_reason as string | undefined;
              const dupTitle = gate.gate_b?.match_title as string | undefined;
              const dupId = gate.gate_b?.duplicate_of_task_id as string | undefined;
              const sim = gate.gate_b?.similarity as number | undefined;
              const link = (c.source_ref?.share_link ?? c.source_ref?.permalink) as string | undefined;

              return (
                <Card key={c.id}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {c.source === 'wispr' ? 'Meeting' : 'Client channel'}
                      </Badge>
                      {c.owner_raw && (
                        <Badge variant="secondary" className="text-[10px]">{c.owner_raw}</Badge>
                      )}
                      {typeof c.confidence === 'number' && (
                        <Badge variant="outline" className="text-[10px]">
                          confidence {Math.round(c.confidence * 100)}%
                        </Badge>
                      )}
                      {blocks.map((b) => (
                        <Badge key={b} variant="outline" className="text-[10px] text-amber-700">
                          {BLOCK_LABEL[b] ?? b}
                        </Badge>
                      ))}
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {format(new Date(c.created_at), 'MMM d, HH:mm')}
                      </span>
                    </div>

                    <div>
                      <p className="text-sm font-medium">{c.proposed_title}</p>
                      {c.raw_text.trim() !== c.proposed_title.trim() && (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{c.raw_text}</p>
                      )}
                      {memberName(c.proposed_assignee_id) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Suggested owner: {memberName(c.proposed_assignee_id)}
                        </p>
                      )}
                    </div>

                    {reason && (
                      <p className="flex gap-2 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {reason}
                      </p>
                    )}

                    {dupTitle && (
                      <div className="grid gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:bg-amber-950/20 sm:grid-cols-2">
                        <div>
                          <p className="font-medium">Proposed</p>
                          <p className="text-muted-foreground">{c.proposed_title}</p>
                        </div>
                        <div>
                          <p className="font-medium">
                            Existing task{typeof sim === 'number' ? ` · ${Math.round(sim * 100)}% alike` : ''}
                          </p>
                          <p className="text-muted-foreground">{dupTitle}</p>
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => approve.mutate({ c, title: c.proposed_title, assigneeId: c.proposed_assignee_id })}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => { setEditing(c); setEditTitle(c.proposed_title); }}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Edit &amp; approve
                      </Button>
                      {dupId && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => merge.mutate({ c, taskId: dupId })}>
                          <GitMerge className="mr-1 h-3.5 w-3.5" /> Merge
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() => { setRejecting(c); setRejectReason(''); }}
                      >
                        <X className="mr-1 h-3.5 w-3.5" /> Reject
                      </Button>
                      {link && (
                        <Button asChild size="sm" variant="ghost" className="ml-auto">
                          <a href={link} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Source
                          </a>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))
      )}

      {/* Edit and approve */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit and approve</DialogTitle></DialogHeader>
          <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          {editing && (
            <Select
              value={editing.proposed_assignee_id ?? 'none'}
              onValueChange={(v) => setEditing({ ...editing, proposed_assignee_id: v === 'none' ? null : v })}
            >
              <SelectTrigger><SelectValue placeholder="Owner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {(members.data ?? []).map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button
              disabled={!editTitle.trim() || busy}
              onClick={() => editing && approve.mutate({
                c: editing, title: editTitle.trim(), assigneeId: editing.proposed_assignee_id,
              })}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject with a reason */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Why is this not a task?</DialogTitle></DialogHeader>
          <Textarea
            placeholder="Short reason — this is kept so the extraction rules can be corrected later."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => rejecting && reject.mutate({ c: rejecting, reason: rejectReason.trim() })}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
