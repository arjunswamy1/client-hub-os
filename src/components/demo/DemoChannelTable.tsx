import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { DemoChannelRow } from '@/data/demoFixtures';
import { cn } from '@/lib/utils';

const fmt = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

export function DemoChannelTable({ channels }: { channels: DemoChannelRow[] }) {
  const totalSpend = channels.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = channels.reduce((s, c) => s + c.revenue, 0);

  return (
    <Card className="bg-white border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-900">Channel Performance</h3>
        <p className="text-[11px] text-slate-500 mt-0.5">Last 7 days · sorted by ROAS</p>
      </div>
      <div className="divide-y divide-slate-100">
        {[...channels]
          .sort((a, b) => b.roas - a.roas)
          .map((ch) => {
            const share = (ch.spend / totalSpend) * 100;
            const TrendIcon = ch.trend === 'up' ? TrendingUp : ch.trend === 'down' ? TrendingDown : Minus;
            const trendColor =
              ch.trend === 'up' ? 'text-[hsl(94,55%,32%)]' : ch.trend === 'down' ? 'text-rose-600' : 'text-slate-400';
            const roasColor =
              ch.roas >= 3 ? 'text-[hsl(94,55%,32%)]' : ch.roas >= 1.5 ? 'text-amber-700' : 'text-rose-600';

            return (
              <div key={ch.channel} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-slate-900 truncate">{ch.channel}</span>
                    <Badge variant="outline" className="text-[10px] py-0 h-4 border-slate-300 text-slate-600 shrink-0">
                      {share.toFixed(0)}% spend
                    </Badge>
                  </div>
                  <div className={cn('text-base font-bold tabular-nums shrink-0', roasColor)}>
                    {ch.roas.toFixed(2)}x
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-[11px]">
                  <div>
                    <p className="text-slate-400 uppercase tracking-wider">Spend</p>
                    <p className="text-slate-800 font-semibold tabular-nums">{fmt(ch.spend)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 uppercase tracking-wider">Revenue</p>
                    <p className="text-slate-800 font-semibold tabular-nums">{fmt(ch.revenue)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 uppercase tracking-wider">CPA</p>
                    <p className="text-slate-800 font-semibold tabular-nums">${ch.cpa}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <TrendIcon className={cn('h-3 w-3', trendColor)} />
                  <span className={cn('text-[11px] font-semibold tabular-nums', trendColor)}>
                    {ch.changePct > 0 ? '+' : ''}{ch.changePct}%
                  </span>
                  <span className="text-[10px] text-slate-400">week-over-week</span>
                </div>
              </div>
            );
          })}
      </div>
      <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Blended</p>
          <p className="text-sm font-bold text-slate-900 tabular-nums">{fmt(totalSpend)} → {fmt(totalRevenue)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">ROAS</p>
          <p className="text-sm font-bold text-[hsl(94,55%,32%)] tabular-nums">
            {(totalRevenue / totalSpend).toFixed(2)}x
          </p>
        </div>
      </div>
    </Card>
  );
}
