import { useState } from 'react';
import { DEMO_CALLOUTS, DEMO_VERTICALS, DEMO_PLATFORMS, type DemoCallout } from '@/data/demoFixtures';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, AlertTriangle, ArrowRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

function CalloutCard({ callout }: { callout: DemoCallout }) {
  const isWin = callout.type === 'win';
  const Icon = isWin ? TrendingUp : AlertTriangle;

  return (
    <Card
      className={cn(
        'p-4 border-l-4 transition-all hover:shadow-md',
        isWin ? 'border-l-emerald-500 bg-emerald-50/30' : 'border-l-rose-500 bg-rose-50/30'
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            isWin ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className="text-sm font-semibold leading-tight">{callout.title}</h4>
            <span
              className={cn(
                'text-sm font-bold tabular-nums shrink-0',
                isWin ? 'text-emerald-700' : 'text-rose-700'
              )}
            >
              {callout.metric}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-2">{callout.description}</p>
          {callout.recommendation && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md bg-background/80 border border-border/50 p-2">
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" />
              <p className="text-xs leading-relaxed">
                <span className="font-medium text-foreground">Fix: </span>
                <span className="text-muted-foreground">{callout.recommendation}</span>
              </p>
            </div>
          )}
          <div className="mt-2 flex items-center gap-1.5">
            {callout.platform && (
              <Badge variant="outline" className="text-[10px] py-0 h-4">
                {callout.platform}
              </Badge>
            )}
            {callout.vertical && (
              <Badge variant="outline" className="text-[10px] py-0 h-4">
                {callout.vertical}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function PerformanceCallouts() {
  const [vertical, setVertical] = useState('All Verticals');
  const [platform, setPlatform] = useState('All Platforms');

  const filtered = DEMO_CALLOUTS.filter((c) => {
    const verticalMatch = vertical === 'All Verticals' || c.vertical === vertical;
    const platformMatch = platform === 'All Platforms' || c.platform === platform;
    return verticalMatch && platformMatch;
  });

  const wins = filtered.filter((c) => c.type === 'win');
  const problems = filtered.filter((c) => c.type === 'problem');

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">AI Performance Insights</h2>
          <Badge variant="secondary" className="text-[10px]">Live</Badge>
        </div>
        <div className="flex gap-2">
          <Select value={vertical} onValueChange={setVertical}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEMO_VERTICALS.map((v) => (
                <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEMO_PLATFORMS.map((p) => (
                <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              What's Working ({wins.length})
            </h3>
          </div>
          {wins.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No wins matching filters.</p>
          ) : (
            wins.map((c) => <CalloutCard key={c.id} callout={c} />)
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-700">
              What's Broken ({problems.length})
            </h3>
          </div>
          {problems.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No issues matching filters. 🎉</p>
          ) : (
            problems.map((c) => <CalloutCard key={c.id} callout={c} />)
          )}
        </div>
      </div>
    </div>
  );
}
