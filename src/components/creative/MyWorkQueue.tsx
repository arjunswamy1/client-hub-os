import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCreativeBriefs } from '@/hooks/useCreativeBriefs';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Star, AlertCircle, CheckCircle2, Clock, Film, Image as ImageIcon, Calendar } from 'lucide-react';
import { isBriefLate } from '@/lib/briefStatus';
import { format, formatDistanceToNow, isPast, isThisWeek } from 'date-fns';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '@/types/creative';

interface Props {
  onBriefClick: (id: string) => void;
}

type Filter = 'all' | 'design' | 'postprod' | 'revisions' | 'due_week';

/**
 * Unified designer queue. Replaces the separate "My Queue" + "Post-Prod Queue" tabs.
 *
 * Each card shows the brief plus, when relevant, a footage-completeness badge so the
 * designer can spot post-production work at a glance without switching tabs.
 */
export function MyWorkQueue({ onBriefClick }: Props) {
  const { teamMember } = useAuth();
  const designerId = teamMember?.id;
  const { data: briefs = [] } = useCreativeBriefs({ allClients: true });
  const [filter, setFilter] = useState<Filter>('all');

  // ----- Footage completeness lookup for any brief that came from a shoot -----
  const { data: postProdMap = new Map() } = useQuery<Map<string, any>>({
    queryKey: ['my_postprod_completeness', designerId],
    enabled: !!designerId,
    queryFn: async () => {
      const { data: shootBriefs } = await supabase
        .from('shoot_briefs')
        .select('id, title, broll_shot_list, post_prod_handoff_at, linked_creative_brief_id')
        .not('linked_creative_brief_id', 'is', null);
      if (!shootBriefs?.length) return new Map();

      const sbIds = shootBriefs.map((b: any) => b.id);
      const [{ data: footage }, { data: scripts }] = await Promise.all([
        supabase.from('shoot_footage').select('brief_id, clip_type, is_best_take').in('brief_id', sbIds),
        supabase.from('shoot_scripts').select('brief_id').in('brief_id', sbIds),
      ]);

      const map = new Map<string, any>();
      shootBriefs.forEach((sb: any) => {
        const clips = (footage || []).filter((f: any) => f.brief_id === sb.id);
        const scripted = clips.filter((c: any) => c.clip_type === 'scripted_take').length;
        const broll = clips.filter((c: any) => c.clip_type === 'broll').length;
        const bestTakes = clips.filter((c: any) => c.is_best_take).length;
        const numScripts = (scripts || []).filter((s: any) => s.brief_id === sb.id).length;
        const brollNeeded = (sb.broll_shot_list || []).length;
        const hasScript = numScripts === 0 || scripted >= numScripts;
        const hasBroll  = brollNeeded === 0 || broll >= brollNeeded;
        const hasBest   = numScripts === 0 || bestTakes >= numScripts;
        const completenessPct = Math.round(([hasScript, hasBroll, hasBest].filter(Boolean).length / 3) * 100);
        const readiness: 'ready' | 'partial' | 'no_footage' =
          clips.length === 0 ? 'no_footage' : completenessPct >= 100 ? 'ready' : 'partial';

        if (sb.linked_creative_brief_id) {
          map.set(sb.linked_creative_brief_id, {
            shootTitle: sb.title,
            handoffAt: sb.post_prod_handoff_at,
            scripted, broll, bestTakes, numScripts, brollNeeded,
            completenessPct, readiness,
          });
        }
      });
      return map;
    },
  });

  // ----- Filter + categorize the designer's active briefs -----
  // Include 'draft' so a brief assigned to the designer never hides from My Work just because it hasn't been formally submitted yet.
  const items = useMemo(() => {
    // On-hold requests are listed too, marked paused: never late, never "due this week", sorted last.
    const active = ['draft', 'on_hold', 'submitted', 'in_design', 'ready_for_review', 'revision_requested'];
    const mine = briefs.filter((b: any) =>
      b.assigned_to_id === designerId && active.includes(b.status)
    );

    const decorated = mine.map((b: any) => {
      const pp = postProdMap.get(b.id);
      const dueDate = b.due_date ? new Date(b.due_date) : null;
      return {
        brief: b,
        postprod: pp,
        isPostProd: !!pp,
        isRevision: b.status === 'revision_requested',
        isDesign: !pp, // pure design (non-shoot) work
        dueDate,
        isPaused: b.status === 'on_hold',
        isOverdue: isBriefLate(b.status, dueDate),
        isDueThisWeek: b.status !== 'on_hold' && dueDate ? isThisWeek(dueDate, { weekStartsOn: 1 }) : false,
      };
    });

    let filtered = decorated;
    if (filter === 'design')    filtered = decorated.filter((d) => d.isDesign);
    if (filter === 'postprod')  filtered = decorated.filter((d) => d.isPostProd);
    if (filter === 'revisions') filtered = decorated.filter((d) => d.isRevision);
    if (filter === 'due_week')  filtered = decorated.filter((d) => d.isDueThisWeek || d.isOverdue);

    // Sort: overdue first, then by readiness (ready post-prod work first), then due date
    return filtered.sort((a, b) => {
      if (a.isPaused !== b.isPaused) return a.isPaused ? 1 : -1;
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      const readinessOrder = { ready: 0, partial: 1, no_footage: 2, undefined: 1 } as any;
      const ar = readinessOrder[a.postprod?.readiness ?? 'undefined'];
      const br = readinessOrder[b.postprod?.readiness ?? 'undefined'];
      if (ar !== br) return ar - br;
      const ad = a.dueDate?.getTime() ?? Infinity;
      const bd = b.dueDate?.getTime() ?? Infinity;
      return ad - bd;
    });
  }, [briefs, designerId, postProdMap, filter]);

  // Counts for filter chips (computed from full list, not filtered)
  const counts = useMemo(() => {
    const active = ['draft', 'submitted', 'in_design', 'ready_for_review', 'revision_requested'];
    const mine = briefs.filter((b: any) => b.assigned_to_id === designerId && active.includes(b.status));
    return {
      all: mine.length,
      design: mine.filter((b: any) => !postProdMap.get(b.id)).length,
      postprod: mine.filter((b: any) => postProdMap.get(b.id)).length,
      revisions: mine.filter((b: any) => b.status === 'revision_requested').length,
      due_week: mine.filter((b: any) => {
        if (b.status === 'on_hold') return false;
        const d = b.due_date ? new Date(b.due_date) : null;
        return d ? (isThisWeek(d, { weekStartsOn: 1 }) || isPast(d)) : false;
      }).length,
    };
  }, [briefs, designerId, postProdMap]);

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="design">Design ({counts.design})</TabsTrigger>
          <TabsTrigger value="postprod">Post-Prod ({counts.postprod})</TabsTrigger>
          <TabsTrigger value="revisions">Revisions ({counts.revisions})</TabsTrigger>
          <TabsTrigger value="due_week">Due this week ({counts.due_week})</TabsTrigger>
        </TabsList>
      </Tabs>

      {items.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          Nothing in this view. Switch a filter or check back later.
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map(({ brief, postprod, isOverdue, dueDate, isPaused }) => {
            const statusConf = STATUS_CONFIG[brief.status] || STATUS_CONFIG.draft;
            const priorityConf = PRIORITY_CONFIG[brief.priority] || PRIORITY_CONFIG.medium;

            const leftBorder = postprod
              ? postprod.readiness === 'ready'   ? 'border-l-emerald-500'
              : postprod.readiness === 'partial' ? 'border-l-amber-500'
              :                                    'border-l-muted'
              : '';

            return (
              <Card
                key={brief.id}
                className={`p-4 ${isPaused ? 'opacity-70' : ''} ${postprod ? `border-l-4 ${leftBorder}` : ''} ${brief.status === 'revision_requested' ? 'ring-1 ring-amber-300' : ''} hover:shadow-md transition-shadow cursor-pointer`}
                onClick={() => onBriefClick(brief.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {postprod ? (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Film className="h-3 w-3" /> Post-Prod
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <ImageIcon className="h-3 w-3" /> Design
                        </Badge>
                      )}
                      <Badge variant="secondary" className={`text-[10px] ${statusConf.color}`}>{statusConf.label}</Badge>
                      <Badge variant="secondary" className={`text-[10px] ${priorityConf.color}`}>{priorityConf.label}</Badge>
                      {brief.client_name && <Badge variant="outline" className="text-[10px]">{brief.client_name}</Badge>}
                      <div className="font-medium truncate">{brief.title}</div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                      {postprod && <span>From shoot: {postprod.shootTitle}</span>}
                      {isPaused && (
                        <span className="font-medium">
                          Paused{brief.hold_started_at ? ` · on hold ${formatDistanceToNow(new Date(brief.hold_started_at))}` : ''}
                          {brief.hold_original_due_date ? ` · originally due ${format(new Date(brief.hold_original_due_date), 'MMM d')}` : ''}
                          {brief.hold_reason ? ` · ${brief.hold_reason}` : ''}
                        </span>
                      )}
                      {dueDate && !isPaused && (
                        <span className={isOverdue ? 'text-destructive font-medium' : ''}>
                          {isOverdue ? 'Overdue · ' : 'Due '}{format(dueDate, 'MMM d')}
                        </span>
                      )}
                      {postprod?.handoffAt && (
                        <span>Handed off {formatDistanceToNow(new Date(postprod.handoffAt), { addSuffix: true })}</span>
                      )}
                    </div>
                  </div>

                  {postprod && (
                    <div className="w-56 shrink-0 space-y-2">
                      <div>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-muted-foreground">Footage</span>
                          <span className="font-medium flex items-center gap-1">
                            {postprod.readiness === 'ready' && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                            {postprod.readiness === 'partial' && <AlertCircle className="h-3 w-3 text-amber-600" />}
                            {postprod.readiness === 'no_footage' && <Clock className="h-3 w-3 text-muted-foreground" />}
                            {postprod.completenessPct}%
                          </span>
                        </div>
                        <Progress value={postprod.completenessPct} className="h-1.5" />
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[10px]">
                        <div className="text-center bg-muted rounded p-1">
                          <div className="font-semibold text-sm">{postprod.scripted}{postprod.numScripts > 0 && <span className="text-muted-foreground">/{postprod.numScripts}</span>}</div>
                          <div className="text-muted-foreground">Takes</div>
                        </div>
                        <div className="text-center bg-muted rounded p-1">
                          <div className="font-semibold text-sm">{postprod.broll}{postprod.brollNeeded > 0 && <span className="text-muted-foreground">/{postprod.brollNeeded}</span>}</div>
                          <div className="text-muted-foreground">B-roll</div>
                        </div>
                        <div className="text-center bg-amber-500/10 rounded p-1">
                          <div className="font-semibold text-sm flex items-center justify-center gap-0.5">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />{postprod.bestTakes}
                          </div>
                          <div className="text-muted-foreground">Best</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!postprod && dueDate && (
                    <div className="shrink-0 text-right">
                      <div className={`text-xs flex items-center gap-1 ${isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                        <Calendar className="h-3 w-3" />
                        {format(dueDate, 'MMM d')}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
