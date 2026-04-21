import {
  Target, MousePointerClick, PhoneCall, TrendingUp,
  AlertTriangle, CheckCircle2, Calendar, Lightbulb,
  ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { DemoRevenueEngine as REData } from '@/data/demoFixtures';

const ACCENT = 'hsl(94,55%,38%)';
const ACCENT_TINT = 'hsl(94,55%,45%)';

/* ─── tiny stat cell ─── */
function Stat({
  label, value, change, prefix, suffix, mono,
}: {
  label: string; value: string | number; change?: number | null;
  prefix?: string; suffix?: string; mono?: boolean;
}) {
  const hasChange = change !== undefined && change !== null;
  const isPositive = (change ?? 0) >= 0;
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`text-lg font-bold tracking-tight text-slate-900 ${mono ? 'font-mono' : ''}`}>
        {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
      </p>
      {hasChange && (
        <div className={`flex items-center gap-0.5 text-[10px] font-medium ${isPositive ? 'text-emerald-600' : 'text-rose-500'}`}>
          {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {change! >= 0 ? '+' : ''}{change}%
          <span className="ml-0.5 font-normal text-slate-400">vs prev</span>
        </div>
      )}
    </div>
  );
}

function FunnelStep({
  icon: Icon, step, title, subtitle, children,
}: {
  icon: React.ElementType; step: number; title: string; subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start gap-2.5">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${ACCENT_TINT}1f` }}
        >
          <Icon className="h-4 w-4" style={{ color: ACCENT }} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Step {step} — {title}</h3>
          <p className="text-[11px] text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {children}
      </div>
    </div>
  );
}

function MarginCard({ rpv, cpc }: { rpv: number; cpc: number }) {
  const margin = cpc > 0 ? Math.round(((rpv - cpc) / cpc) * 100) : 0;
  const isScalable = rpv >= cpc;
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 ${
        isScalable
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-rose-200 bg-rose-50'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {isScalable ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
          )}
          <span className="text-xs font-semibold text-slate-900">
            RPV ${rpv.toFixed(2)} vs CPC ${cpc.toFixed(2)} — Margin: {margin}%
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-slate-500">
          RPV/CPC measures scalability headroom. Above CPC = room to scale spend profitably.
        </p>
      </div>
      <Badge
        variant={isScalable ? 'default' : 'destructive'}
        className={`shrink-0 font-mono text-[10px] ${isScalable ? 'bg-emerald-600 hover:bg-emerald-600' : ''}`}
      >
        {isScalable ? '✓ SCALABLE' : '✗ NOT SCALABLE'}
      </Badge>
    </div>
  );
}

function CallRoasCard({
  callRoas, spend, callRevenue, revPerConnected, costPerCall,
}: {
  callRoas: number; spend: number; callRevenue: number;
  revPerConnected: number; costPerCall: number;
}) {
  const profitable = callRoas >= 1;
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 ${
        profitable ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {profitable ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
          )}
          <span className="text-xs font-semibold text-slate-900">
            Call ROAS: {callRoas.toFixed(2)}x — Spend ${spend.toLocaleString()} → Revenue ${callRevenue.toLocaleString()}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-slate-500">
          Rev/Connected: ${revPerConnected.toFixed(2)} · Cost/Call: ${costPerCall.toFixed(2)}
        </p>
      </div>
      <Badge
        variant={profitable ? 'default' : 'destructive'}
        className={`shrink-0 font-mono text-[10px] ${profitable ? 'bg-emerald-600 hover:bg-emerald-600' : ''}`}
      >
        {profitable ? '✓ PROFITABLE' : '✗ UNPROFITABLE'}
      </Badge>
    </div>
  );
}

function ProfitForecast({
  spend, revenue, daysInRange, daysInMonth,
}: {
  spend: number; revenue: number; daysInRange: number; daysInMonth: number;
}) {
  const profit = revenue - spend;
  const dailyProfit = daysInRange > 0 ? profit / daysInRange : 0;
  const projected = dailyProfit * daysInMonth;
  const pct = Math.round((daysInRange / daysInMonth) * 100);
  const remaining = daysInMonth - daysInRange;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Calendar className="h-4 w-4" style={{ color: ACCENT }} />
        <h3 className="text-sm font-semibold text-slate-900">
          Monthly Profit Forecast
        </h3>
      </div>
      <p className="mb-3 text-[11px] text-slate-500 leading-relaxed">
        Daily Budget × LP CVR × RPV = Revenue − Spend. Projecting from current pace.
      </p>
      <div className="mb-3">
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>Day {daysInRange} of {daysInMonth} ({remaining} remaining)</span>
          <span>{pct}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: ACCENT }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-lg border border-slate-200 p-2.5">
          <p className="text-[10px] font-medium uppercase text-slate-500">MTD Profit</p>
          <p className={`text-lg font-bold font-mono ${profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
            {profit >= 0 ? '' : '−'}${Math.abs(Math.round(profit)).toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 p-2.5">
          <p className="text-[10px] font-medium uppercase text-slate-500">Projected Month</p>
          <p className={`text-lg font-bold font-mono ${projected >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
            {projected >= 0 ? '' : '−'}${Math.abs(Math.round(projected)).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

function RecommendationsCard({ re }: { re: REData }) {
  const tips: { icon: React.ElementType; title: string; body: string; tone: 'good' | 'warn' }[] = [];

  if (re.rpv >= re.cpc) {
    tips.push({
      icon: CheckCircle2, tone: 'good',
      title: `Scale aggressively — RPV is ${(((re.rpv - re.cpc) / re.cpc) * 100).toFixed(0)}% above CPC`,
      body: `Every visitor generates $${re.rpv.toFixed(2)} in revenue at $${re.cpc.toFixed(2)} CPC. There's headroom to push budget on top campaigns.`,
    });
  }
  if (re.callRoas >= 1.5) {
    tips.push({
      icon: CheckCircle2, tone: 'good',
      title: `Call ROAS at ${re.callRoas.toFixed(2)}x — highly profitable`,
      body: `For every $1 spent on ads, you're generating $${re.callRoas.toFixed(2)} in call revenue. Lock in winning campaigns and replicate to new geos.`,
    });
  }
  if (re.conversionRate < 45) {
    tips.push({
      icon: Lightbulb, tone: 'warn',
      title: `Lift conversion rate to 45%+ to add ~$${Math.round(re.callRevenue * 0.18).toLocaleString()}/wk`,
      body: `Currently ${re.conversionRate}% of connected calls convert. Buyer routing + agent scripts can typically push this 7–12 points.`,
    });
  }
  if (tips.length === 0) {
    tips.push({
      icon: CheckCircle2, tone: 'good',
      title: 'Funnel looks healthy',
      body: 'All key metrics are within target ranges. Keep monitoring daily trends.',
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Lightbulb className="h-4 w-4" style={{ color: ACCENT }} />
        <h3 className="text-sm font-semibold text-slate-900">Recommendations</h3>
      </div>
      <p className="mb-3 text-[11px] text-slate-500">Auto-generated from your funnel data</p>
      <div className="space-y-2.5">
        {tips.map((tip, i) => (
          <div
            key={i}
            className={`rounded-lg border p-2.5 ${
              tip.tone === 'warn'
                ? 'border-amber-200 bg-amber-50'
                : 'border-emerald-200 bg-emerald-50/60'
            }`}
          >
            <div className="flex items-center gap-2">
              <tip.icon className={`h-3.5 w-3.5 ${tip.tone === 'warn' ? 'text-amber-600' : 'text-emerald-600'}`} />
              <span className="text-xs font-semibold text-slate-900">{tip.title}</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">{tip.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DemoRevenueEngine({ data }: { data: REData & { companyName: string; industryLabel: string } }) {
  const re = data;
  const minutes = Math.floor(re.avgDurationSec / 60);
  const seconds = re.avgDurationSec % 60;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">
          Lead-Gen Revenue Engine
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">
          4-step funnel: Traffic → Landing Page → Call Processing → Monetization
        </p>
        <p className="mt-0.5 text-[10px] text-slate-400">Platforms: Meta + Google · Last 7 days</p>
      </div>

      {/* Step 1 — Traffic */}
      <FunnelStep icon={Target} step={1} title="Traffic (Media Buying)" subtitle="Goal: Get qualified traffic cheaply">
        <Stat label="$ Spend" value={re.spend.toLocaleString()} prefix="$" change={re.spendChange} />
        <Stat label="Clicks" value={re.clicks} />
        <Stat label="CPC" value={`$${re.cpc.toFixed(3)}`} change={re.cpcChange} />
        <Stat label="CTR" value={`${re.ctr}%`} change={re.ctrChange} />
        <Stat label="CPM" value={`$${re.cpm.toFixed(2)}`} />
        <Stat label="Impressions" value={re.impressions} />
      </FunnelStep>

      {/* Step 2 — Landing Page */}
      <FunnelStep icon={MousePointerClick} step={2} title="Landing Page Conversion" subtitle="Goal: Convert visitors to intent actions">
        <Stat label="Visitors" value={re.visitors} />
        <Stat label="CTA Clicks" value={re.ctaClicks} />
        <Stat label="LP CVR" value={`${re.lpCvr}%`} mono />
        <Stat label="RPV" value={`$${re.rpv.toFixed(2)}`} mono />
      </FunnelStep>

      {/* Margin */}
      <MarginCard rpv={re.rpv} cpc={re.cpc} />

      {/* Step 3 — Calls */}
      <FunnelStep icon={PhoneCall} step={3} title="Call Processing" subtitle="Goal: Connect and convert inbound calls">
        <Stat label="Total Calls" value={re.totalCalls} change={re.totalCallsChange} />
        <Stat label="Connected" value={re.connectedCalls} />
        <Stat label="Connect Rate" value={`${re.connectRate}%`} mono />
        <Stat label="Converted" value={re.convertedCalls} change={re.convertedCallsChange} />
        <Stat label="Conv. Rate" value={`${re.conversionRate}%`} mono />
        <Stat label="Avg Duration" value={`${minutes > 0 ? `${minutes}m ` : ''}${seconds}s`} />
      </FunnelStep>

      {/* Step 4 — Monetization */}
      <FunnelStep icon={TrendingUp} step={4} title="Monetization" subtitle="Goal: Maximize revenue per connected call">
        <Stat label="$ Call Revenue" value={re.callRevenue.toLocaleString()} prefix="$" change={re.callRevenueChange} mono />
        <Stat label="Rev/Connected" value={`$${re.revPerConnected.toFixed(2)}`} mono />
        <Stat label="Cost/Call" value={`$${re.costPerCall.toFixed(2)}`} mono />
        <Stat label="Call ROAS" value={`${re.callRoas.toFixed(2)}x`} mono />
        <Stat
          label="Net Profit"
          value={`${re.netProfit >= 0 ? '' : '−'}$${Math.abs(Math.round(re.netProfit)).toLocaleString()}`}
          mono
        />
      </FunnelStep>

      {/* Call ROAS card */}
      <CallRoasCard
        callRoas={re.callRoas}
        spend={re.spend}
        callRevenue={re.callRevenue}
        revPerConnected={re.revPerConnected}
        costPerCall={re.costPerCall}
      />

      {/* Forecast + recs */}
      <div className="grid gap-3 lg:grid-cols-2">
        <ProfitForecast
          spend={re.spend}
          revenue={re.callRevenue}
          daysInRange={re.daysInRange}
          daysInMonth={re.daysInMonth}
        />
        <RecommendationsCard re={re} />
      </div>
    </div>
  );
}
