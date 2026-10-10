/**
 * Improvement proposals — what the team's feedback turned into.
 *
 * Each row is a proposal distilled from replies and reactions to bot messages. The
 * prompt is copied and pasted by a human into Lovable or Claude Code; nothing here
 * applies anything, and nothing here writes to tasks.
 *
 * Where feedback contained instruction-shaped text, the proposal is flagged and the
 * warning is shown before the copy button, so nobody pastes it unread.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Copy, Check, X, Inbox, Loader2, ShieldAlert, RotateCcw, ChevronDown, ChevronUp,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

interface EvidenceQuote {
  quote: string;
  author?: string | null;
  said_at?: string | null;
  permalink?: string | null;
  injection_suspected?: boolean;
}

interface Proposal {
  id: string;
  title: string;
  target_surface: string;
  category: string;
  problem_statement: string;
  evidence: { quotes?: EvidenceQuote[] } | null;
  proposed_change: string;
  generated_prompt: string;
  feedback_ids: string[];
  occurrences: number;
  status: string;
  injection_suspected: boolean;
  applied_at: string | null;
  applied_note: string | null;
  recurred_after_apply: boolean | null;
  created_at: string;
}

const SURFACE_LABEL: Record<string, string> = {
  task_digest: 'Morning task digest',
  daily_update_drafter: 'Client daily update',
  cannaball_analyst: 'Cannaball daily analyst',
  qa_bot: 'Q&A bot',
  task_gate: 'Task quality gate',
  data_feed: 'Data feed',
  unknown: 'Unidentified',
};

export default function ImprovementProposalsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('open');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState<Proposal | null>(null);
  const [appliedNote, setAppliedNote] = useState('');

  const proposals = useQuery({
    queryKey: ['improvement_proposals', tab],
    queryFn: async () => {
      let q = supabase.from('improvement_proposals')
        .select('*')
        .order('occurrences', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(200);
      if (tab === 'open') q = q.in('status', ['open', 'proposed']);
      else if (tab !== 'all') q = q.eq('status', tab);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Proposal[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: string; note?: string }) => {
      const patch = {
        status,
        ...(status === 'applied'
          ? { applied_at: new Date().toISOString(), applied_note: note ?? null }
          : {}),
      };
      const { error } = await supabase.from('improvement_proposals').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['improvement_proposals'] });
      setApplying(null);
      setAppliedNote('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = async (p: Proposal) => {
    await navigator.clipboard.writeText(p.generated_prompt);
    toast.success('Prompt copied — paste it into Lovable or Claude Code');
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Improvement Proposals</h1>
        <p className="text-sm text-muted-foreground">
          What the team told the bot, turned into a prompt you can paste. Nothing here is applied
          automatically — you approve it and run it yourself.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="applied">Applied</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {proposals.isLoading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : proposals.error ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {(proposals.error as Error).message}
        </div>
      ) : (proposals.data ?? []).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Inbox className="mb-3 h-12 w-12 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">Nothing here yet</p>
        </div>
      ) : (
        (proposals.data ?? []).map((p) => {
          const quotes = p.evidence?.quotes ?? [];
          const open = expanded[p.id] === true;
          return (
            <Card key={p.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {SURFACE_LABEL[p.target_surface] ?? p.target_surface}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px]">{p.category.replace(/_/g, ' ')}</Badge>
                  {p.occurrences > 1 && (
                    <Badge className="text-[10px]">reported {p.occurrences}×</Badge>
                  )}
                  {p.recurred_after_apply && (
                    <Badge variant="outline" className="text-[10px] text-amber-700">
                      <RotateCcw className="mr-1 h-3 w-3" /> came back after the fix
                    </Badge>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {format(new Date(p.created_at), 'MMM d, HH:mm')}
                  </span>
                </div>

                <p className="text-sm font-medium">{p.title}</p>

                {p.injection_suspected && (
                  <div className="flex gap-2 rounded-md border border-destructive/60 bg-destructive/10 p-2 text-xs text-destructive">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      The quoted feedback contains instruction-shaped text. It is quoted as data only,
                      but read the evidence below before pasting this prompt anywhere.
                    </span>
                  </div>
                )}

                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{p.problem_statement}</p>

                {quotes.length > 0 && (
                  <div className="space-y-2 rounded-md border bg-muted/40 p-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      What people said — quoted, not acted on
                    </p>
                    {quotes.map((q, i) => (
                      <blockquote key={i} className="border-l-2 pl-2 text-xs">
                        <span className="whitespace-pre-wrap">“{q.quote}”</span>
                        <span className="mt-0.5 block text-muted-foreground">
                          {q.author ?? 'author unresolved'}
                          {q.said_at ? ` · ${format(new Date(q.said_at), 'MMM d, HH:mm')}` : ''}
                          {q.permalink ? (
                            <> · <a className="underline" href={q.permalink} target="_blank" rel="noreferrer">source</a></>
                          ) : null}
                        </span>
                      </blockquote>
                    ))}
                  </div>
                )}

                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Proposed change</p>
                  <p className="whitespace-pre-wrap text-sm">{p.proposed_change}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => copy(p)}>
                    <Copy className="mr-1 h-3.5 w-3.5" /> Copy prompt
                  </Button>
                  {(p.status === 'open' || p.status === 'proposed') && (
                    <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: p.id, status: 'approved' })}>
                      <Check className="mr-1 h-3.5 w-3.5" /> Approve
                    </Button>
                  )}
                  {p.status !== 'applied' && (
                    <Button size="sm" variant="outline" onClick={() => { setApplying(p); setAppliedNote(''); }}>
                      Mark applied
                    </Button>
                  )}
                  {p.status !== 'rejected' && (
                    <Button size="sm" variant="ghost" className="text-destructive"
                      onClick={() => setStatus.mutate({ id: p.id, status: 'rejected' })}>
                      <X className="mr-1 h-3.5 w-3.5" /> Reject
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="ml-auto"
                    onClick={() => setExpanded({ ...expanded, [p.id]: !open })}>
                    {open ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
                    {open ? 'Hide prompt' : 'Show prompt'}
                  </Button>
                </div>

                {open && (
                  <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
                    {p.generated_prompt}
                  </pre>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      <Dialog open={!!applying} onOpenChange={(o) => !o && setApplying(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark as applied</DialogTitle></DialogHeader>
          <Textarea
            placeholder="What was changed, and where. If the same complaint comes back, this proposal reopens."
            value={appliedNote}
            onChange={(e) => setAppliedNote(e.target.value)}
          />
          <DialogFooter>
            <Button
              disabled={setStatus.isPending}
              onClick={() => applying && setStatus.mutate({ id: applying.id, status: 'applied', note: appliedNote.trim() })}
            >
              Mark applied
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
