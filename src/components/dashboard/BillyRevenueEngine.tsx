import { useVerticalKPIs } from "@/hooks/useBillyData";
import { useRingbaRevenue } from "@/hooks/useRingbaData";
import { useVertical } from "@/contexts/VerticalContext";
import { useDateRange } from "@/contexts/DateRangeContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useClient } from "@/contexts/ClientContext";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Target, MousePointerClick, PhoneCall, TrendingUp,
  AlertTriangle, CheckCircle2, RefreshCw, Calendar,
  Lightbulb, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { differenceInDays, getDaysInMonth, format } from "date-fns";
import { useState } from "react";

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
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold tracking-tight ${mono ? "font-mono" : ""}`}>
        {prefix}{typeof value === "number" ? value.toLocaleString() : value}{suffix}
      </p>
      {hasChange && (
        <div className={`flex items-center gap-0.5 text-[11px] font-medium ${isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
          {isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {change! >= 0 ? "+" : ""}{change}%
          <span className="ml-0.5 font-normal text-muted-foreground">vs prev</span>
        </div>
      )}
    </div>
  );
}

/* ─── section card wrapper ─── */
function FunnelStep({
  icon: Icon, step, title, subtitle, children, action,
}: {
  icon: React.ElementType; step: number; title: string; subtitle: string;
  children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Step {step} — {title}</h3>
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        {children}
      </div>
    </div>
  );
}

/* ─── margin insight bar ─── */
function MarginCard({
  rpv, cpc, label, revenueLabel, spendLabel,
}: {
  rpv: number; cpc: number; label: string; revenueLabel: string; spendLabel: string;
}) {
  const margin = cpc > 0 ? Math.round(((rpv - cpc) / cpc) * 100) : 0;
  const isScalable = rpv >= cpc;
  return (
    <div className={`flex items-center justify-between rounded-xl border p-4 ${
      isScalable
        ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
        : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
    }`}>
      <div>
        <div className="flex items-center gap-2">
          {isScalable ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-red-500" />
          )}
          <span className="text-sm font-semibold">{label}: ${rpv.toFixed(2)} vs ${cpc.toFixed(2)} — Margin: {margin}%</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {revenueLabel} | {spendLabel}
        </p>
      </div>
      <Badge variant={isScalable ? "default" : "destructive"} className="font-mono text-xs">
        {isScalable ? "✓ SCALABLE" : "✗ NOT SCALABLE"}
      </Badge>
    </div>
  );
}

/* ─── profit forecast ─── */
function ProfitForecast({
  spend, revenue, daysInRange, daysInMonth,
}: {
  spend: number; revenue: number; daysInRange: number; daysInMonth: number;
}) {
  const profit = revenue - spend;
  const dailyProfit = daysInRange > 0 ? profit / daysInRange : 0;
  const projectedProfit = dailyProfit * daysInMonth;
  const pctComplete = Math.round((daysInRange / daysInMonth) * 100);
  const remaining = daysInMonth - daysInRange;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Calendar className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">
          {format(new Date(), "MMMM yyyy")} Profit Forecast
        </h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Projecting monthly profit using 4-step funnel: Daily Budget × LP CVR × RPV = Revenue − Spend
      </p>
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Day {daysInRange} of {daysInMonth} ({remaining} remaining)
          </span>
          <span>{pctComplete}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pctComplete}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-3">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">MTD Profit</p>
          <p className={`text-xl font-bold font-mono ${profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {profit >= 0 ? "" : "−"}${Math.abs(Math.round(profit)).toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-[10px] font-medium uppercase text-muted-foreground">Projected Month Profit</p>
          <p className={`text-xl font-bold font-mono ${projectedProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {projectedProfit >= 0 ? "" : "−"}${Math.abs(Math.round(projectedProfit)).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── recommendations ─── */
function Recommendations({ rpv, cpc, callRoas, conversionRate }: {
  rpv: number; cpc: number; callRoas: number; conversionRate: number;
}) {
  const tips: { icon: React.ElementType; title: string; body: string; severity: "warning" | "info" }[] = [];

  if (rpv < cpc) {
    tips.push({
      icon: AlertTriangle, severity: "warning",
      title: "RPV below CPC — pause scaling",
      body: `RPV ($${rpv.toFixed(2)}) is below CPC ($${cpc.toFixed(2)}). Every visitor costs more than they generate. Focus on improving LP CVR or negotiating higher payouts.`,
    });
  }

  if (callRoas > 0 && callRoas < 1) {
    tips.push({
      icon: AlertTriangle, severity: "warning",
      title: "Call ROAS below 1x — unprofitable",
      body: `Call ROAS is ${callRoas.toFixed(2)}x. Revenue from calls doesn't cover ad spend. Review target payouts and call quality.`,
    });
  }

  if (conversionRate > 0 && conversionRate < 10) {
    tips.push({
      icon: Lightbulb, severity: "info",
      title: "Low call conversion rate",
      body: `Only ${conversionRate}% of calls convert. Consider call routing optimization or target qualification improvements.`,
    });
  }

  if (tips.length === 0) {
    tips.push({
      icon: CheckCircle2, severity: "info",
      title: "Funnel looks healthy",
      body: "All key metrics are within acceptable ranges. Keep monitoring daily trends.",
    });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Recommendations</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Auto-generated insights based on your funnel data and goals</p>
      <div className="space-y-3">
        {tips.map((tip, i) => (
          <div key={i} className={`rounded-lg border p-3 ${
            tip.severity === "warning"
              ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
              : "border-border bg-muted/30"
          }`}>
            <div className="flex items-center gap-2">
              <tip.icon className={`h-3.5 w-3.5 ${tip.severity === "warning" ? "text-amber-600" : "text-muted-foreground"}`} />
              <span className="text-xs font-semibold">{tip.title}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{tip.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

interface RingbaSyncResponse {
  calls_synced?: number;
  last_page?: number;
  next_page?: number | null;
  total_in_range?: number;
}

/* ═══════ MAIN COMPONENT ═══════ */
export default function BillyRevenueEngine() {
  const { data: adKpis, isLoading: adLoading } = useVerticalKPIs();
  const { data: ringba, isLoading: ringbaLoading } = useRingbaRevenue();
  const { activeVertical } = useVertical();
  const { activeClient } = useClient();
  const { dateRange } = useDateRange();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const [syncLabel, setSyncLabel] = useState("");

  const isLoading = adLoading || ringbaLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    );
  }

  // ── derived metrics ──
  const spend = adKpis?.spend ?? 0;
  const clicks = adKpis?.clicks ?? 0;
  const impressions = adKpis?.impressions ?? 0;
  const cpc = adKpis?.cpc ?? 0;
  const ctr = adKpis?.ctr ?? 0;
  const cpm = impressions > 0 ? Math.round((spend / impressions) * 1000 * 100) / 100 : 0;

  // LP metrics (visitors ≈ clicks for lead-gen)
  const visitors = clicks;
  const totalCalls = ringba?.totalCalls ?? 0;
  const lpCvr = visitors > 0 ? Math.round((totalCalls / visitors) * 1000) / 10 : 0;
  const callRevenue = ringba?.revenue ?? 0;
  const rpv = visitors > 0 ? Math.round((callRevenue / visitors) * 100) / 100 : 0;

  // Ringba call metrics
  const connectedCalls = ringba?.connectedCalls ?? 0;
  const convertedCalls = ringba?.convertedCalls ?? 0;
  const connectRate = ringba?.connectRate ?? 0;
  const conversionRate = ringba?.conversionRate ?? 0;
  const avgDuration = ringba?.avgDuration ?? 0;
  const avgDurMin = Math.floor(avgDuration / 60);
  const avgDurSec = avgDuration % 60;

  // Monetization
  const revPerConnected = connectedCalls > 0 ? Math.round((callRevenue / connectedCalls) * 100) / 100 : 0;
  const costPerCall = totalCalls > 0 ? Math.round((spend / totalCalls) * 100) / 100 : 0;
  const callRoas = spend > 0 ? Math.round((callRevenue / spend) * 100) / 100 : 0;
  const netProfit = callRevenue - spend;

  // Forecast
  const daysInRange = differenceInDays(dateRange.to, dateRange.from) + 1;
  const daysInMonth = getDaysInMonth(new Date());

  const handleSync = async () => {
    if (!activeClient?.id) {
      toast.error("Select a client before syncing Ringba calls");
      return;
    }

    setSyncing(true);
    setSyncLabel("");

    try {
      let totalProcessed = 0;
      let totalInRange: number | null = null;
      let batchCount = 0;
      let nextPage: number | null = 1;
      const seenPages = new Set<number>();

      while (nextPage !== null) {
        if (seenPages.has(nextPage)) {
          throw new Error(`Sync loop detected at page ${nextPage}`);
        }

        seenPages.add(nextPage);
        batchCount += 1;
        setSyncLabel(
          totalInRange
            ? `${Math.min(totalProcessed, totalInRange).toLocaleString()} / ${totalInRange.toLocaleString()}`
            : `Batch ${batchCount}`
        );

        const { data, error } = await supabase.functions.invoke("sync-ringba-calls", {
          body: {
            clientId: activeClient.id,
            daysBack: 365,
            startPage: nextPage,
          },
        });

        if (error) throw error;

        const result = (data ?? {}) as RingbaSyncResponse;
        totalProcessed += result.calls_synced ?? 0;
        totalInRange = result.total_in_range ?? totalInRange;

        if (result.last_page === -1 || result.next_page == null) {
          nextPage = null;
        } else {
          nextPage = result.next_page;
        }

        if (batchCount >= 100) {
          throw new Error("Sync exceeded safe batch limit");
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ringba-revenue"] }),
        queryClient.invalidateQueries({ queryKey: ["ringba-daily-revenue"] }),
      ]);

      toast.success(`Ringba sync complete: ${totalProcessed.toLocaleString()} calls processed`);
    } catch (e: any) {
      toast.error("Sync failed: " + (e.message || "Unknown error"));
    } finally {
      setSyncing(false);
      setSyncLabel("");
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="text-lg">{activeVertical.emoji}</span>
        <div>
          <h2 className="text-base font-semibold">
            {activeVertical.id === "all" ? "All Verticals" : activeVertical.label} — Revenue Engine
          </h2>
          <p className="text-[11px] text-muted-foreground">
            4-step lead-gen funnel: Traffic → Landing Page → Call Processing → Monetization
          </p>
          <p className="text-[10px] text-muted-foreground">Platforms: Meta + Google</p>
        </div>
      </div>

      {/* Step 1 — Traffic */}
      <FunnelStep
        icon={Target}
        step={1}
        title="Traffic (Media Buying)"
        subtitle="Goal: Get qualified traffic cheaply"
      >
        <Stat label="$ Spend" value={spend} prefix="$" change={adKpis?.changes.spend} />
        <Stat label="Clicks" value={clicks} />
        <Stat label="CPC" value={`$${cpc.toFixed(3)}`} change={adKpis?.changes.cpc} />
        <Stat label="CTR" value={`${ctr}%`} change={adKpis?.changes.ctr} />
        <Stat label="CPM" value={`$${cpm.toFixed(2)}`} />
        <Stat label="Impressions" value={impressions} change={null} />
      </FunnelStep>

      {/* Step 2 — Landing Page */}
      <FunnelStep
        icon={MousePointerClick}
        step={2}
        title="Landing Page Conversion"
        subtitle="Goal: Convert visitors to intent actions"
      >
        <Stat label="Visitors" value={visitors} />
        <Stat label="CTA Clicks" value={totalCalls} />
        <Stat label="LP CVR" value={`${lpCvr}%`} />
        <Stat label="RPV" value={`$${rpv.toFixed(2)}`} mono />
      </FunnelStep>

      {/* RPV vs CPC Margin */}
      <MarginCard
        rpv={rpv}
        cpc={cpc}
        label={`RPV $${rpv.toFixed(2)} vs CPC $${cpc.toFixed(2)}`}
        revenueLabel="RPV/CPC = Revenue per visitor vs cost per click — measures scalability headroom"
        spendLabel="ROAS = Total revenue ÷ total ad spend — measures overall profitability"
      />

      {/* Step 3 — Call Processing */}
      <FunnelStep
        icon={PhoneCall}
        step={3}
        title="Call Processing (Ringba)"
        subtitle="Goal: Connect and convert inbound calls from ads"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing || !activeClient?.id}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? syncLabel || "Syncing..." : "Sync Calls"}
          </Button>
        }
      >
        <Stat label="Total Calls" value={totalCalls} change={ringba?.changes.totalCalls} />
        <Stat label="Connected" value={connectedCalls} />
        <Stat label="Connect Rate" value={`${connectRate}%`} mono />
        <Stat label="Converted" value={convertedCalls} change={ringba?.changes.convertedCalls} />
        <Stat label="Conv. Rate" value={`${conversionRate}%`} mono />
        <Stat label="Avg Duration" value={`${avgDurMin > 0 ? `${avgDurMin}m ` : ""}${avgDurSec}s`} />
      </FunnelStep>

      {/* Step 4 — Monetization */}
      <FunnelStep
        icon={TrendingUp}
        step={4}
        title="Monetization (Call Revenue)"
        subtitle="Goal: Maximize revenue per connected call"
      >
        <Stat label="$ Call Revenue" value={callRevenue.toFixed(2)} prefix="$" change={ringba?.changes.revenue} mono />
        <Stat label="Rev/Connected Call" value={`$${revPerConnected.toFixed(2)}`} mono />
        <Stat label="Cost/Call" value={`$${costPerCall.toFixed(2)}`} mono />
        <Stat label="Call ROAS" value={`${callRoas.toFixed(2)}x`} mono />
        <Stat label="Net Profit" value={`${netProfit >= 0 ? "" : "−"}$${Math.abs(Math.round(netProfit)).toLocaleString()}`} mono />
      </FunnelStep>

      {/* Call ROAS insight */}
      <div className={`flex items-center justify-between rounded-xl border p-4 ${
        callRoas >= 1
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
      }`}>
        <div>
          <div className="flex items-center gap-2">
            {callRoas >= 1 ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-500" />
            )}
            <span className="text-sm font-semibold">
              Call ROAS: {callRoas.toFixed(2)}x — Ad Spend ${spend.toLocaleString()} → Call Revenue ${callRevenue.toFixed(0)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Revenue per Connected Call: ${revPerConnected.toFixed(2)} | Cost per Call: ${costPerCall.toFixed(2)}
          </p>
        </div>
        <Badge variant={callRoas >= 1 ? "default" : "destructive"} className="font-mono text-xs">
          {callRoas >= 1 ? "✓ PROFITABLE" : "✗ UNPROFITABLE"}
        </Badge>
      </div>

      {/* Forecast + Recommendations */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfitForecast
          spend={spend}
          revenue={callRevenue}
          daysInRange={daysInRange}
          daysInMonth={daysInMonth}
        />
        <Recommendations
          rpv={rpv}
          cpc={cpc}
          callRoas={callRoas}
          conversionRate={conversionRate}
        />
      </div>
    </div>
  );
}
