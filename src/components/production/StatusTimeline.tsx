import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Check, Circle, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { STATUS_LABEL, type ShootStatus } from '@/types/production';

// The 6-stage workflow you defined (the DB has finer-grained statuses but they roll up here).
const WORKFLOW: { key: string; label: string; matches: ShootStatus[]; tsField: string | null }[] = [
  { key: 'draft',    label: 'Draft',         matches: ['draft', 'submitted', 'scripts_approved', 'actors_cast', 'location_confirmed'], tsField: null },
  { key: 'sched',    label: 'Scheduled',     matches: ['scheduled'],          tsField: 'scheduled_at' },
  { key: 'prod',     label: 'In Progress',   matches: ['in_production'],      tsField: 'production_started_at' },
  { key: 'footage',  label: 'Footage Up',    matches: ['footage_uploaded'],   tsField: 'footage_uploaded_at' },
  { key: 'handoff',  label: 'Post-Prod',     matches: ['in_post_production'], tsField: 'post_prod_handoff_at' },
  { key: 'done',     label: 'Complete',      matches: ['delivered'],          tsField: 'delivered_at' },
];

// Order index for "is this stage reached?"
const ORDER: ShootStatus[] = [
  'draft', 'submitted', 'scripts_approved', 'actors_cast', 'location_confirmed',
  'scheduled', 'in_production', 'footage_uploaded', 'in_post_production', 'delivered',
];

export function StatusTimeline({ brief }: { brief: any }) {
  const currentIdx = ORDER.indexOf(brief.status as ShootStatus);

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-1 overflow-x-auto">
        {WORKFLOW.map((stage, i) => {
          const stageMaxOrder = Math.max(...stage.matches.map((s) => ORDER.indexOf(s)));
          const isReached = currentIdx >= stageMaxOrder && currentIdx >= 0;
          const isCurrent = stage.matches.includes(brief.status as ShootStatus);
          const ts = stage.tsField ? brief[stage.tsField] : null;

          return (
            <div key={stage.key} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center text-center min-w-0">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center border-2 ${
                    isReached
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : isCurrent
                      ? 'bg-blue-500 border-blue-500 text-white animate-pulse'
                      : 'bg-white border-slate-300 text-slate-400'
                  }`}
                >
                  {isReached ? <Check className="h-3 w-3" /> : isCurrent ? <Clock className="h-3 w-3" /> : <Circle className="h-2 w-2" />}
                </div>
                <div className={`text-[10px] mt-1 font-medium ${isReached || isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {stage.label}
                </div>
                <div className="text-[9px] text-muted-foreground h-3 truncate w-16">
                  {ts ? format(new Date(ts), 'MMM d') : ''}
                </div>
              </div>
              {i < WORKFLOW.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${currentIdx > stageMaxOrder ? 'bg-emerald-500' : 'bg-slate-200'}`} />
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
          <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          <span className="text-muted-foreground">{format(new Date(h.changed_at), 'MMM d, h:mm a')}</span>
          <span>·</span>
          <span className="font-medium">{h.changed_by_name || '(system)'}</span>
          <span className="text-muted-foreground">moved from</span>
          <span className="font-mono text-[10px] bg-slate-100 px-1 rounded">{STATUS_LABEL[h.from_status as ShootStatus] || h.from_status || '—'}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-mono text-[10px] bg-emerald-50 text-emerald-700 px-1 rounded">{STATUS_LABEL[h.to_status as ShootStatus] || h.to_status}</span>
        </div>
      ))}
    </div>
  );
}
