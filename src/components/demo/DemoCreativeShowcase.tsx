import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DemoCreative } from '@/data/demoFixtures';
import { cn } from '@/lib/utils';
import { Trophy, AlertTriangle, FlaskConical, TrendingDown } from 'lucide-react';

const STATUS_STYLES = {
  winner: {
    icon: Trophy,
    label: 'Winner',
    color: 'bg-[hsl(94,55%,45%)]/20 text-[hsl(94,55%,60%)] border-[hsl(94,55%,45%)]/30',
    border: 'border-l-[hsl(94,55%,45%)]',
  },
  fatigued: {
    icon: AlertTriangle,
    label: 'Fatigued',
    color: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    border: 'border-l-rose-500',
  },
  testing: {
    icon: FlaskConical,
    label: 'Testing',
    color: 'bg-amber-400/20 text-amber-200 border-amber-400/30',
    border: 'border-l-amber-400',
  },
  underperformer: {
    icon: TrendingDown,
    label: 'Pause',
    color: 'bg-white/10 text-white/60 border-white/20',
    border: 'border-l-white/30',
  },
};

const fmt = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

export function DemoCreativeShowcase({ creatives }: { creatives: DemoCreative[] }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Creative Performance</h3>
        <span className="text-[11px] text-white/50">Tap a creative for the AI insight</span>
      </div>
      <div className="space-y-2.5">
        {creatives.map((c) => {
          const s = STATUS_STYLES[c.status];
          const Icon = s.icon;
          return (
            <Card
              key={c.id}
              className={cn(
                'p-3.5 bg-white/[0.03] border-white/10 border-l-4',
                s.border
              )}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/5 text-2xl">
                  {c.thumbnail}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                    <Badge className={cn('text-[10px] py-0 h-5 px-2 font-bold gap-1 shrink-0', s.color)}>
                      <Icon className="h-2.5 w-2.5" />
                      {s.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-white/55 mb-2">
                    <span>{c.format}</span>
                    <span>·</span>
                    <span className="tabular-nums">{c.ctr}% CTR</span>
                    <span>·</span>
                    <span className="tabular-nums">{c.frequency}x freq</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] mb-2.5">
                    <div>
                      <p className="text-white/40 uppercase tracking-wider text-[9px]">Spend</p>
                      <p className="text-white/85 font-semibold tabular-nums">{fmt(c.spend)}</p>
                    </div>
                    <div>
                      <p className="text-white/40 uppercase tracking-wider text-[9px]">Revenue</p>
                      <p className="text-white/85 font-semibold tabular-nums">{fmt(c.revenue)}</p>
                    </div>
                    <div>
                      <p className="text-white/40 uppercase tracking-wider text-[9px]">ROAS</p>
                      <p
                        className={cn(
                          'font-semibold tabular-nums',
                          c.roas >= 3 ? 'text-[hsl(94,55%,55%)]' : c.roas >= 1.5 ? 'text-amber-300' : 'text-rose-400'
                        )}
                      >
                        {c.roas.toFixed(2)}x
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-white/65 italic">
                    <span className="text-white/85 font-medium not-italic">AI: </span>{c.insight}
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
