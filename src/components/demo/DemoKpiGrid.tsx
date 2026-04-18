import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { DemoKPI } from '@/data/demoFixtures';
import { cn } from '@/lib/utils';

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="opacity-80">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DemoKpiGrid({ kpis }: { kpis: DemoKPI[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {kpis.map((k) => {
        const positive = k.change >= 0;
        return (
          <Card
            key={k.label}
            className="p-4 bg-white border-slate-200 shadow-sm hover:shadow-md transition-shadow"
          >
            <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{k.label}</p>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{k.value}</p>
              {k.trend && <div className="text-[hsl(94,55%,38%)]"><Sparkline data={k.trend} /></div>}
            </div>
            <div className="mt-2 flex items-center gap-1">
              {positive ? (
                <TrendingUp className="h-3 w-3 text-[hsl(94,55%,38%)]" />
              ) : (
                <TrendingDown className="h-3 w-3 text-rose-600" />
              )}
              <span
                className={cn(
                  'text-xs font-semibold tabular-nums',
                  positive ? 'text-[hsl(94,55%,32%)]' : 'text-rose-600'
                )}
              >
                {positive ? '+' : ''}{k.change}%
              </span>
              <span className="text-[10px] text-slate-400 ml-1">vs last week</span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
