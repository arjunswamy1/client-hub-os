import { Card } from '@/components/ui/card';
import { Sparkles, ArrowRight } from 'lucide-react';
import type { DemoData } from '@/data/demoFixtures';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

const fmt = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`;

export function DemoCrossChannel({ data }: { data: DemoData }) {
  const story = data.crossChannelStory;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-300" />
        <h3 className="text-sm font-semibold text-white">Cross-Channel Story</h3>
      </div>

      {/* Hero insight */}
      <Card className="p-4 bg-gradient-to-br from-amber-400/10 via-white/[0.03] to-[hsl(94,55%,45%)]/10 border-amber-400/20">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-amber-300 font-bold">The Insight</p>
          <h4 className="text-lg font-bold text-white leading-tight">{story.title}</h4>
          <p className="text-xs text-white/70 leading-relaxed">{story.summary}</p>
        </div>
      </Card>

      {/* Metric tiles */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3 bg-white/[0.03] border-white/10 text-center">
          <p className="text-[10px] uppercase tracking-wider text-white/45 font-semibold">Search Lift</p>
          <p className="text-xl font-bold text-[hsl(94,55%,55%)] tabular-nums mt-1">+{story.metaInfluencedSearchLift}%</p>
          <p className="text-[10px] text-white/45 mt-0.5">when Meta active</p>
        </Card>
        <Card className="p-3 bg-white/[0.03] border-white/10 text-center">
          <p className="text-[10px] uppercase tracking-wider text-white/45 font-semibold">Calls</p>
          <p className="text-xl font-bold text-amber-300 tabular-nums mt-1">{story.callsAttributedToMeta}</p>
          <p className="text-[10px] text-white/45 mt-0.5">attributed to Meta</p>
        </Card>
        <Card className="p-3 bg-white/[0.03] border-white/10 text-center">
          <p className="text-[10px] uppercase tracking-wider text-white/45 font-semibold">Incremental</p>
          <p className="text-xl font-bold text-white tabular-nums mt-1">{fmt(story.incrementalRevenue)}</p>
          <p className="text-[10px] text-white/45 mt-0.5">last 7 days</p>
        </Card>
      </div>

      {/* Trend chart */}
      <Card className="p-4 bg-white/[0.03] border-white/10">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-white">7-Day Spend vs Revenue</p>
          <p className="text-[10px] text-white/45 tabular-nums">Updated live</p>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data.trend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(94,55%,55%)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(94,55%,55%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(220,80%,65%)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(220,80%,65%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(222,47%,12%)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                fontSize: 11,
                color: 'white',
              }}
              formatter={(v: number) => `$${v.toLocaleString()}`}
            />
            <Area type="monotone" dataKey="spend" stroke="hsl(220,80%,65%)" strokeWidth={2} fill="url(#spendGrad)" />
            <Area type="monotone" dataKey="revenue" stroke="hsl(94,55%,55%)" strokeWidth={2} fill="url(#revGrad)" />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-3 mt-2 text-[10px] text-white/55">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-[hsl(94,55%,55%)]" />
            <span>Revenue</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-[hsl(220,80%,65%)]" />
            <span>Spend</span>
          </div>
        </div>
      </Card>

      <Card className="p-3 bg-white/[0.03] border-white/10">
        <div className="flex items-start gap-2">
          <ArrowRight className="h-3.5 w-3.5 text-[hsl(94,55%,55%)] mt-0.5 shrink-0" />
          <p className="text-[11px] leading-relaxed text-white/70">
            <span className="font-semibold text-white">How we'd act on this: </span>
            Increase Meta prospecting by 20% on days you push branded search. The halo more than pays for itself.
          </p>
        </div>
      </Card>
    </div>
  );
}
