import { useMemo } from 'react';
import { differenceInDays, format, parseISO, eachDayOfInterval } from 'date-fns';

interface Props {
  campaign: { start_date: string; end_date: string; name: string };
  phases: Array<{
    id: string;
    phase_name: string;
    start_date: string | null;
    end_date: string | null;
    daily_budget: number | null;
    phase_total: number | null;
  }>;
}

const PHASE_COLORS = [
  'bg-blue-500/20 border-blue-500',
  'bg-green-500/20 border-green-500',
  'bg-purple-500/20 border-purple-500',
  'bg-orange-500/20 border-orange-500',
  'bg-pink-500/20 border-pink-500',
];

export function BudgetGantt({ campaign, phases }: Props) {
  const start = parseISO(campaign.start_date);
  const end = parseISO(campaign.end_date);
  const totalDays = differenceInDays(end, start) + 1;

  const days = useMemo(() => eachDayOfInterval({ start, end }), [start, end]);

  // Show week labels if > 14 days, otherwise daily
  const showWeekly = totalDays > 21;

  return (
    <div className="space-y-4">
      <div className="text-xs font-medium text-muted-foreground">
        Campaign Timeline: {format(start, 'MMM d')} – {format(end, 'MMM d, yyyy')} ({totalDays} days)
      </div>

      {/* Date header */}
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          <div className="flex border-b pb-1 mb-2">
            <div className="w-28 shrink-0 text-xs font-medium text-muted-foreground">Phase</div>
            <div className="flex-1 flex">
              {days.filter((_, i) => !showWeekly || i % 7 === 0).map(day => (
                <div key={day.toISOString()} className="text-[9px] text-muted-foreground text-center" style={{ width: showWeekly ? `${(7 / totalDays) * 100}%` : `${(1 / totalDays) * 100}%`, minWidth: showWeekly ? 48 : 20 }}>
                  {format(day, showWeekly ? 'MMM d' : 'd')}
                </div>
              ))}
            </div>
          </div>

          {/* Phase bars */}
          {phases.map((phase, idx) => {
            if (!phase.start_date || !phase.end_date) return (
              <div key={phase.id} className="flex items-center h-8 mb-1">
                <div className="w-28 shrink-0 text-xs truncate">{phase.phase_name}</div>
                <div className="flex-1 flex items-center">
                  <span className="text-[10px] text-muted-foreground italic">Set dates to display</span>
                </div>
              </div>
            );

            const phaseStart = parseISO(phase.start_date);
            const phaseEnd = parseISO(phase.end_date);
            const offsetDays = differenceInDays(phaseStart, start);
            const widthDays = differenceInDays(phaseEnd, phaseStart) + 1;
            const leftPct = (offsetDays / totalDays) * 100;
            const widthPct = (widthDays / totalDays) * 100;
            const color = PHASE_COLORS[idx % PHASE_COLORS.length];

            return (
              <div key={phase.id} className="flex items-center h-8 mb-1">
                <div className="w-28 shrink-0 text-xs truncate">{phase.phase_name}</div>
                <div className="flex-1 relative h-6">
                  <div
                    className={`absolute top-0 h-full rounded border ${color} flex items-center justify-center`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  >
                    <span className="text-[9px] font-medium truncate px-1">
                      {phase.daily_budget ? `$${Number(phase.daily_budget).toFixed(0)}/day` : ''}
                      {phase.phase_total ? ` ($${Number(phase.phase_total).toLocaleString()})` : ''}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {phases.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">Add budget phases to see the timeline.</p>
          )}
        </div>
      </div>
    </div>
  );
}
