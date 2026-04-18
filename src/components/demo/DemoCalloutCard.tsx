import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, AlertTriangle, Sparkles, ArrowRight, Target } from 'lucide-react';
import type { DemoCallout } from '@/data/demoFixtures';
import { cn } from '@/lib/utils';

function StatusIcon({ type }: { type: DemoCallout['type'] }) {
  if (type === 'win') return <TrendingUp className="h-4 w-4" />;
  if (type === 'opportunity') return <Target className="h-4 w-4" />;
  return <AlertTriangle className="h-4 w-4" />;
}

const TYPE_STYLES = {
  win: {
    border: 'border-l-[hsl(94,55%,38%)]',
    bg: 'bg-[hsl(94,55%,45%)]/[0.08]',
    iconBg: 'bg-[hsl(94,55%,45%)]/15 text-[hsl(94,55%,32%)]',
    metric: 'text-[hsl(94,55%,32%)]',
    label: 'Win',
    labelBg: 'bg-[hsl(94,55%,45%)]/15 text-[hsl(94,55%,28%)]',
  },
  problem: {
    border: 'border-l-rose-500',
    bg: 'bg-rose-50',
    iconBg: 'bg-rose-100 text-rose-600',
    metric: 'text-rose-600',
    label: 'Leak',
    labelBg: 'bg-rose-100 text-rose-700',
  },
  opportunity: {
    border: 'border-l-amber-500',
    bg: 'bg-amber-50',
    iconBg: 'bg-amber-100 text-amber-700',
    metric: 'text-amber-700',
    label: 'Opportunity',
    labelBg: 'bg-amber-100 text-amber-800',
  },
};

export function DemoCalloutCard({ callout }: { callout: DemoCallout }) {
  const s = TYPE_STYLES[callout.type];

  return (
    <Card
      className={cn(
        'p-4 border-slate-200 border-l-4 shadow-sm',
        s.border,
        s.bg
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', s.iconBg)}>
          <StatusIcon type={callout.type} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <h4 className="text-sm font-semibold leading-snug text-slate-900">{callout.title}</h4>
            <span className={cn('text-base font-bold tabular-nums shrink-0', s.metric)}>{callout.metric}</span>
          </div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className={cn('text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', s.labelBg)}>
              {s.label}
            </span>
            {callout.platform && (
              <Badge variant="outline" className="text-[10px] py-0 h-4 border-slate-300 text-slate-600 bg-white/60">
                {callout.platform}
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">{callout.description}</p>
          {callout.recommendation && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white/80 p-2.5 space-y-1.5">
              <div className="flex items-start gap-1.5">
                <ArrowRight className="h-3 w-3 shrink-0 text-[hsl(94,55%,38%)] mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  <span className="font-semibold text-slate-800">Fix: </span>
                  <span className="text-slate-600">{callout.recommendation}</span>
                </p>
              </div>
              {callout.projectedImpact && (
                <div className="flex items-start gap-1.5">
                  <Sparkles className="h-3 w-3 shrink-0 text-amber-600 mt-0.5" />
                  <p className="text-[11px] leading-relaxed">
                    <span className="font-semibold text-amber-800">Projected: </span>
                    <span className="text-amber-700">{callout.projectedImpact}</span>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
