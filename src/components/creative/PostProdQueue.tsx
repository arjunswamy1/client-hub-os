import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Film, Star, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface Props {
  onBriefClick: (id: string) => void;
}

export function PostProdQueue({ onBriefClick }: Props) {
  const { teamMember } = useAuth();
  const designerId = teamMember?.id;

  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['postprod-queue', designerId],
    enabled: !!designerId,
    queryFn: async () => {
      // 1. Creative briefs assigned to me, of type video, that are linked from a shoot brief
      const { data: shootBriefs, error: sbErr } = await supabase
        .from('shoot_briefs')
        .select('id,title,client_ids,verticals,priority,content_deadline,linked_creative_brief_id,status,post_prod_handoff_at,broll_shot_list')
        .not('linked_creative_brief_id', 'is', null);
      if (sbErr) throw sbErr;
      if (!shootBriefs?.length) return [];

      const cbIds = shootBriefs.map((b: any) => b.linked_creative_brief_id);
      const { data: creativeBriefs } = await supabase
        .from('creative_briefs')
        .select('id,title,status,assigned_to_id,due_date,priority,client_id,submitted_at')
        .in('id', cbIds)
        .eq('assigned_to_id', designerId)
        .not('status', 'in', '(approved,trafficked,delivered)');

      if (!creativeBriefs?.length) return [];
      const cbMap = new Map(creativeBriefs.map((c: any) => [c.id, c]));

      // 2. Footage stats per shoot brief
      const briefIds = shootBriefs.filter((b: any) => cbMap.has(b.linked_creative_brief_id)).map((b: any) => b.id);
      const { data: footage } = await supabase
        .from('shoot_footage')
        .select('id,brief_id,clip_type,is_best_take,file_name,duration_seconds,uploaded_at')
        .in('brief_id', briefIds);

      // 3. Scripts count per brief (to compute "expected takes")
      const { data: scripts } = await supabase
        .from('shoot_scripts')
        .select('id,brief_id')
        .in('brief_id', briefIds);

      // 4. Client lookup
      const clientIdSet = new Set<string>();
      shootBriefs.forEach((b: any) => (b.client_ids || []).forEach((c: string) => clientIdSet.add(c)));
      let clientMap = new Map<string, { name: string; color: string | null }>();
      if (clientIdSet.size > 0) {
        const { data: clients } = await supabase.from('clients').select('id,name,color').in('id', Array.from(clientIdSet));
        clientMap = new Map((clients || []).map((c: any) => [c.id, { name: c.name, color: c.color }]));
      }

      return shootBriefs
        .filter((b: any) => cbMap.has(b.linked_creative_brief_id))
        .map((b: any) => {
          const cb = cbMap.get(b.linked_creative_brief_id) as any;
          const clips = (footage || []).filter((f: any) => f.brief_id === b.id);
          const scripted = clips.filter((c: any) => c.clip_type === 'scripted_take').length;
          const broll = clips.filter((c: any) => c.clip_type === 'broll').length;
          const bestTakes = clips.filter((c: any) => c.is_best_take).length;
          const numScripts = (scripts || []).filter((s: any) => s.brief_id === b.id).length;
          const brollNeeded = (b.broll_shot_list || []).length;

          // Completeness heuristic
          const hasScriptedCoverage = numScripts === 0 || scripted >= numScripts;
          const hasBrollCoverage = brollNeeded === 0 || broll >= brollNeeded;
          const hasBestTakes = numScripts === 0 || bestTakes >= numScripts;
          const completeness = [hasScriptedCoverage, hasBrollCoverage, hasBestTakes].filter(Boolean).length;
          const completenessPct = Math.round((completeness / 3) * 100);

          let readiness: 'ready' | 'partial' | 'no_footage';
          if (clips.length === 0) readiness = 'no_footage';
          else if (completenessPct >= 100) readiness = 'ready';
          else readiness = 'partial';

          return {
            shootBrief: b,
            creativeBrief: cb,
            clips,
            scripted,
            broll,
            bestTakes,
            numScripts,
            brollNeeded,
            completenessPct,
            readiness,
            clients: (b.client_ids || []).map((id: string) => clientMap.get(id)).filter(Boolean),
          };
        })
        .sort((a, b) => {
          // Ready first, then partial, then no footage; within group sort by due date
          const order = { ready: 0, partial: 1, no_footage: 2 };
          if (order[a.readiness] !== order[b.readiness]) return order[a.readiness] - order[b.readiness];
          const ad = a.creativeBrief?.due_date || '9999';
          const bd = b.creativeBrief?.due_date || '9999';
          return ad.localeCompare(bd);
        });
    },
  });

  if (isLoading) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">Loading post-production queue…</Card>;
  }

  if (queue.length === 0) {
    return (
      <Card className="p-12 text-center">
        <Film className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <div className="text-sm font-medium">Nothing in your post-production queue</div>
        <div className="text-xs text-muted-foreground mt-1">When a producer hands off footage from a shoot brief, it appears here.</div>
      </Card>
    );
  }

  const readyCount = queue.filter((q) => q.readiness === 'ready').length;
  const partialCount = queue.filter((q) => q.readiness === 'partial').length;
  const noFootageCount = queue.filter((q) => q.readiness === 'no_footage').length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 border-emerald-200 bg-emerald-50">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><div className="text-xs text-muted-foreground">Ready to edit</div></div>
          <div className="text-2xl font-semibold mt-1">{readyCount}</div>
        </Card>
        <Card className="p-3 border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-amber-600" /><div className="text-xs text-muted-foreground">Partial footage</div></div>
          <div className="text-2xl font-semibold mt-1">{partialCount}</div>
        </Card>
        <Card className="p-3 border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-slate-500" /><div className="text-xs text-muted-foreground">Awaiting footage</div></div>
          <div className="text-2xl font-semibold mt-1">{noFootageCount}</div>
        </Card>
      </div>

      <div className="space-y-2">
        {queue.map((item) => {
          const readyColor =
            item.readiness === 'ready' ? 'border-l-emerald-500'
            : item.readiness === 'partial' ? 'border-l-amber-500'
            : 'border-l-slate-300';

          const readyBadge =
            item.readiness === 'ready' ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Ready</Badge>
            : item.readiness === 'partial' ? <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Partial</Badge>
            : <Badge variant="secondary">Awaiting footage</Badge>;

          return (
            <Card
              key={item.creativeBrief.id}
              className={`p-4 border-l-4 ${readyColor} hover:shadow-md transition-shadow cursor-pointer`}
              onClick={() => onBriefClick(item.creativeBrief.id)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {readyBadge}
                    {item.creativeBrief.priority === 'urgent' && <Badge variant="destructive">Urgent</Badge>}
                    <div className="font-medium truncate">{item.creativeBrief.title}</div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                    <span>From shoot: {item.shootBrief.title}</span>
                    {item.clients.map((c: any, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px]" style={c.color ? { borderColor: c.color, color: c.color } : {}}>{c.name}</Badge>
                    ))}
                    {item.shootBrief.verticals.map((v: string) => (
                      <Badge key={v} variant="outline" className="text-[10px]">{v}</Badge>
                    ))}
                  </div>
                  {item.shootBrief.post_prod_handoff_at && (
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Handed off {formatDistanceToNow(new Date(item.shootBrief.post_prod_handoff_at), { addSuffix: true })}
                      {item.creativeBrief.due_date && <> · Due {format(new Date(item.creativeBrief.due_date), 'MMM d')}</>}
                    </div>
                  )}
                </div>

                <div className="w-64 flex-shrink-0 space-y-2">
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-muted-foreground">Footage completeness</span>
                      <span className="font-medium">{item.completenessPct}%</span>
                    </div>
                    <Progress value={item.completenessPct} className="h-1.5" />
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[10px]">
                    <div className="text-center bg-slate-50 rounded p-1">
                      <div className="font-semibold text-sm">{item.scripted}{item.numScripts > 0 && <span className="text-muted-foreground">/{item.numScripts}</span>}</div>
                      <div className="text-muted-foreground">Takes</div>
                    </div>
                    <div className="text-center bg-slate-50 rounded p-1">
                      <div className="font-semibold text-sm">{item.broll}{item.brollNeeded > 0 && <span className="text-muted-foreground">/{item.brollNeeded}</span>}</div>
                      <div className="text-muted-foreground">B-roll</div>
                    </div>
                    <div className="text-center bg-amber-50 rounded p-1">
                      <div className="font-semibold text-sm flex items-center justify-center gap-0.5">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />{item.bestTakes}
                      </div>
                      <div className="text-muted-foreground">Best</div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
