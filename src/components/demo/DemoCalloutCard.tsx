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
    border: 'border-l-[hsl(94,55%,45%)]',
    bg: 'bg-[hsl(94,55%,45%)]/[0.06]',
    iconBg: 'bg-[hsl(94,55%,45%)]/15 text-[hsl(94,55%,55%)]',
    metric: 'text-[hsl(94,55%,55%)]',
    label: 'Win',
    labelBg: 'bg-[hsl(94,55%,45%)]/15 text-[hsl(94,55%,60%)]',
  },
  problem: {
    border: 'border-l-rose-500',
    bg: 'bg-rose-500/[0.05]',
    iconBg: 'bg-rose-500/15 text-rose-400',
    metric: 'text-rose-400',
    label: 'Leak',
    labelBg: 'bg-rose-500/15 text-rose-300',
  },
  opportunity: {
    border: 'border-l-amber-400',
    bg: 'bg-amber-400/[0.05]',
    iconBg: 'bg-amber-400/15 text-amber-300',
    metric: 'text-amber-300',
    label: 'Opportunity',
    labelBg: 'bg-amber-400/15 text-amber-200',
  },
};

export function DemoCalloutCard({ callout }: { callout: DemoCallout }) {
  const s = TYPE_STYLES[callout.type];

  return (
    <Card
      className={cn(
        'p-4 border-white/10 border-l-4 bg-white/[0.03]',
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
            <h4 className="text-sm font-semibold leading-snug text-white">{callout.title}</h4>
            <span className={cn('text-base font-bold tabular-nums shrink-0', s.metric)}>{callout.metric}</span>
          </div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className={cn('text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', s.labelBg)}>
              {s.label}
            </span>
            {callout.platform && (
              <Badge variant="outline" className="text-[10px] py-0 h-4 border-white/15 text-white/60">
                {callout.platform}
              </Badge>
            )}
          </div>
          <p className="text-xs text-white/65 leading-relaxed">{callout.description}</p>
          {callout.recommendation && (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-2.5 space-y-1.5">
              <div className="flex items-start gap-1.5">
                <ArrowRight className="h-3 w-3 shrink-0 text-[hsl(94,55%,55%)] mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  <span className="font-semibold text-white/85">Fix: </span>
                  <span className="text-white/55">{callout.recommendation}</span>
                </p>
              </div>
              {callout.projectedImpact && (
                <div className="flex items-start gap-1.5">
                  <Sparkles className="h-3 w-3 shrink-0 text-amber-300 mt-0.5" />
                  <p className="text-[11px] leading-relaxed">
                    <span className="font-semibold text-amber-200">Projected: </span>
                    <span className="text-amber-100/70">{callout.projectedImpact}</span>
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
