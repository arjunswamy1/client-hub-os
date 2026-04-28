import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Check, Circle, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { STATUS_LABEL, type ShootStatus } from '@/types/production';
import { STAGE_ORDER, STAGE_LABEL, STAGE_CLASSES, shootStageOf, type ProjectStage } from '@/types/projectStage';

// Map each unified stage to (a) the shoot timestamp field that records its first entry
// and (b) the shoot statuses that count as that stage being "current".
const STAGE_META: Record<ProjectStage, { tsField: string | null }> = {
  planning:      { tsField: null },
  scheduled:     { tsField: 'scheduled_at' },
  in_production: { tsField: 'production_started_at' },
  in_post:       { tsField: 'post_prod_handoff_at' },
  delivered:     { tsField: 'delivered_at' },
  canceled:      { tsField: 'canceled_at' },
};

export function StatusTimeline({ brief }: { brief: any }) {
  const currentStage = shootStageOf(brief.status as ShootStatus);
  const currentIdx = STAGE_ORDER.indexOf(currentStage);

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-1 overflow-x-auto">
        {STAGE_ORDER.map((stage, i) => {
          const stageIdx = i;
          const isReached = currentIdx > stageIdx;
          const isCurrent = currentIdx === stageIdx;
          const ts = STAGE_META[stage].tsField ? brief[STAGE_META[stage].tsField as string] : null;
          const cls = STAGE_CLASSES[stage];

          return (
            <div key={stage} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center text-center min-w-0">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors ${
                    isReached
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : isCurrent
                      ? `${cls.dot} border-transparent text-white animate-pulse`
                      : 'bg-background border-border text-muted-foreground'
                  }`}
                >
                  {isReached ? <Check className="h-3 w-3" /> : isCurrent ? <Clock className="h-3 w-3" /> : <Circle className="h-2 w-2" />}
                </div>
                <div className={`text-[10px] mt-1 font-medium ${isReached || isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {STAGE_LABEL[stage]}
                </div>
                <div className="text-[9px] text-muted-foreground h-3 truncate w-16">
                  {ts ? format(new Date(ts), 'MMM d') : ''}
                </div>
              </div>
              {i < STAGE_ORDER.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${currentIdx > stageIdx ? 'bg-emerald-500' : 'bg-border'}`} />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function StatusHistory({ briefId }: { briefId: string }) {
  const { data: history = [] } = useQuery({
    queryKey: ['shoot_brief_status_history', briefId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shoot_brief_status_history')
        .select('id,from_status,to_status,changed_at,changed_by_id')
        .eq('brief_id', briefId)
        .order('changed_at', { ascending: false });
      if (error) throw error;
      const memberIds = Array.from(new Set((data || []).map((h: any) => h.changed_by_id).filter(Boolean)));
      let memberMap = new Map<string, string>();
      if (memberIds.length > 0) {
        const { data: members } = await supabase.from('team_members').select('id,name').in('id', memberIds);
        memberMap = new Map((members || []).map((m: any) => [m.id, m.name]));
      }
      return (data || []).map((h: any) => ({ ...h, changed_by_name: h.changed_by_id ? memberMap.get(h.changed_by_id) || null : null }));
    },
    enabled: !!briefId,
  });

  if (history.length === 0) {
    return <div className="text-xs text-muted-foreground italic">No status changes yet.</div>;
  }

  return (
    <div className="space-y-1.5">
      {history.map((h: any) => (
        <div key={h.id} className="text-xs flex items-center gap-2 py-1">
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="text-muted-foreground">{format(new Date(h.changed_at), 'MMM d, h:mm a')}</span>
          <span>·</span>
          <span className="font-medium">{h.changed_by_name || '(system)'}</span>
          <span className="text-muted-foreground">moved from</span>
          <span className="font-mono text-[10px] bg-muted px-1 rounded">{STATUS_LABEL[h.from_status as ShootStatus] || h.from_status || '—'}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-mono text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-1 rounded">{STATUS_LABEL[h.to_status as ShootStatus] || h.to_status}</span>
        </div>
      ))}
    </div>
  );
}
