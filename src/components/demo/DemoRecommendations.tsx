import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DemoRecommendation } from '@/data/demoFixtures';
import { cn } from '@/lib/utils';
import { Zap, Target, Layers, Compass, FileText, Sparkles } from 'lucide-react';

const PRIORITY_STYLES = {
  critical: {
    label: 'Critical',
    color: 'bg-rose-100 text-rose-700 border-rose-200',
    border: 'border-l-rose-500',
  },
  high: {
    label: 'High',
    color: 'bg-amber-100 text-amber-800 border-amber-200',
    border: 'border-l-amber-500',
  },
  medium: {
    label: 'Medium',
    color: 'bg-slate-100 text-slate-700 border-slate-200',
    border: 'border-l-slate-400',
  },
};

const CATEGORY_ICONS = {
  budget: Target,
  creative: Layers,
  audience: Compass,
  bid: Zap,
  landing: FileText,
} as const;

const EFFORT_LABEL = {
  quick: '⚡ Quick win (<1 day)',
  medium: '🔧 Medium (2-3 days)',
  big: '🏗️ Big (1+ week)',
};

export function DemoRecommendations({ recommendations }: { recommendations: DemoRecommendation[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[hsl(94,55%,38%)]" />
        <h3 className="text-sm font-semibold text-slate-900">AI Recommendations</h3>
        <Badge className="text-[10px] py-0 h-4 bg-[hsl(94,55%,45%)]/15 text-[hsl(94,55%,28%)] border-[hsl(94,55%,45%)]/30">
          {recommendations.length} actions
        </Badge>
      </div>
      <p className="text-[11px] text-slate-500 -mt-1">Prioritized by impact · click to send to your team</p>
      <div className="space-y-2.5">
        {recommendations.map((r, idx) => {
          const p = PRIORITY_STYLES[r.priority];
          const Icon = CATEGORY_ICONS[r.category];
          return (
            <Card
              key={r.id}
              className={cn(
                'p-3.5 bg-white border-slate-200 border-l-4 shadow-sm',
                p.border
              )}
            >
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
                    <Icon className="h-4 w-4 text-slate-600" />
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 tabular-nums">#{idx + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <p className="text-sm font-semibold text-slate-900 leading-snug">{r.title}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mb-2">
                    <Badge className={cn('text-[10px] py-0 h-5 px-2 font-bold', p.color)}>
                      {p.label}
                    </Badge>
                    <span className="text-[10px] text-slate-500">{EFFORT_LABEL[r.effort]}</span>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">Why</p>
                      <p className="text-[11px] text-slate-600 leading-relaxed">{r.reasoning}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-0.5">Action</p>
                      <p className="text-[11px] text-slate-700 leading-relaxed">{r.action}</p>
                    </div>
                    <div className="rounded-lg bg-[hsl(94,55%,45%)]/10 border border-[hsl(94,55%,45%)]/30 p-2 flex items-start gap-1.5">
                      <Sparkles className="h-3 w-3 shrink-0 text-[hsl(94,55%,38%)] mt-0.5" />
                      <p className="text-[11px] leading-relaxed">
                        <span className="font-semibold text-[hsl(94,55%,25%)]">Projected impact: </span>
                        <span className="text-[hsl(94,55%,28%)]">{r.projectedImpact}</span>
                      </p>
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
