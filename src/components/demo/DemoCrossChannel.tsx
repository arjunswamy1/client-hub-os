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
        <Sparkles className="h-4 w-4 text-amber-600" />
        <h3 className="text-sm font-semibold text-slate-900">Cross-Channel Story</h3>
      </div>

      {/* Hero insight */}
      <Card className="p-4 bg-gradient-to-br from-amber-50 via-white to-[hsl(94,55%,45%)]/[0.08] border-amber-200 shadow-sm">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-amber-700 font-bold">The Insight</p>
          <h4 className="text-lg font-bold text-slate-900 leading-tight">{story.title}</h4>
          <p className="text-xs text-slate-600 leading-relaxed">{story.summary}</p>
        </div>
      </Card>

      {/* Metric tiles */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3 bg-white border-slate-200 shadow-sm text-center">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Search Lift</p>
          <p className="text-xl font-bold text-[hsl(94,55%,32%)] tabular-nums mt-1">+{story.metaInfluencedSearchLift}%</p>
          <p className="text-[10px] text-slate-500 mt-0.5">when Meta active</p>
        </Card>
        <Card className="p-3 bg-white border-slate-200 shadow-sm text-center">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Calls</p>
          <p className="text-xl font-bold text-amber-700 tabular-nums mt-1">{story.callsAttributedToMeta}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">attributed to Meta</p>
        </Card>
        <Card className="p-3 bg-white border-slate-200 shadow-sm text-center">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Incremental</p>
          <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">{fmt(story.incrementalRevenue)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">last 7 days</p>
        </Card>
      </div>

      {/* Trend chart */}
      <Card className="p-4 bg-white border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-900">7-Day Spend vs Revenue</p>
          <p className="text-[10px] text-slate-500 tabular-nums">Updated live</p>
        </div>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data.trend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(94,55%,38%)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(94,55%,38%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(220,80%,55%)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="hsl(220,80%,55%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgb(100,116,139)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: 'rgb(100,116,139)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid rgb(226,232,240)',
                borderRadius: '8px',
                fontSize: 11,
                color: 'rgb(15,23,42)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}
              formatter={(v: number) => `$${v.toLocaleString()}`}
            />
            <Area type="monotone" dataKey="spend" stroke="hsl(220,80%,55%)" strokeWidth={2} fill="url(#spendGrad)" />
            <Area type="monotone" dataKey="revenue" stroke="hsl(94,55%,38%)" strokeWidth={2} fill="url(#revGrad)" />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-[hsl(94,55%,38%)]" />
            <span>Revenue</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-[hsl(220,80%,55%)]" />
            <span>Spend</span>
          </div>
        </div>
      </Card>

      <Card className="p-3 bg-white border-slate-200 shadow-sm">
        <div className="flex items-start gap-2">
          <ArrowRight className="h-3.5 w-3.5 text-[hsl(94,55%,38%)] mt-0.5 shrink-0" />
          <p className="text-[11px] leading-relaxed text-slate-600">
            <span className="font-semibold text-slate-900">How we'd act on this: </span>
            Increase Meta prospecting by 20% on days you push branded search. The halo more than pays for itself.
          </p>
        </div>
      </Card>
    </div>
  );
}
