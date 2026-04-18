/**
 * Highlights tab — the "story" view of a client's performance.
 *
 * Built on real data when available (cross-channel KPIs + top campaigns),
 * with a smart wins/leaks derivation. Falls back to demo data only if there
 * is no real spend in the date range, so a freshly-onboarded client still
 * sees a useful (clearly-labeled) preview.
 */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles, TrendingUp, TrendingDown, AlertTriangle, ArrowRight, Target, Zap, Layers,
} from "lucide-react";
import { useCrossChannelKPIs, useTopCampaigns, useChannelBreakdown } from "@/hooks/useAdData";
import { useClient } from "@/contexts/ClientContext";
import { generateDemoData } from "@/data/demoFixtures";
import { cn } from "@/lib/utils";

interface Insight {
  id: string;
  type: "win" | "leak" | "opportunity";
  title: string;
  metric: string;
  description: string;
  recommendation?: string;
  projectedImpact?: string;
  platform?: string;
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

const TYPE_STYLES = {
  win: {
    border: "border-l-emerald-500",
    bg: "bg-emerald-50/40 dark:bg-emerald-500/5",
    iconBg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
    metric: "text-emerald-700 dark:text-emerald-400",
    label: "Win",
    labelBg: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    Icon: TrendingUp,
  },
  leak: {
    border: "border-l-rose-500",
    bg: "bg-rose-50/40 dark:bg-rose-500/5",
    iconBg: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
    metric: "text-rose-700 dark:text-rose-400",
    label: "Leak",
    labelBg: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    Icon: AlertTriangle,
  },
  opportunity: {
    border: "border-l-amber-500",
    bg: "bg-amber-50/40 dark:bg-amber-500/5",
    iconBg: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    metric: "text-amber-700 dark:text-amber-400",
    label: "Opportunity",
    labelBg: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    Icon: Target,
  },
} as const;

function InsightCard({ insight }: { insight: Insight }) {
  const s = TYPE_STYLES[insight.type];
  const Icon = s.Icon;
  return (
    <Card className={cn("p-4 border-l-4", s.border, s.bg)}>
      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", s.iconBg)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <h4 className="text-sm font-semibold leading-snug">{insight.title}</h4>
            <span className={cn("text-base font-bold tabular-nums shrink-0", s.metric)}>
              {insight.metric}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            <span className={cn("text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded", s.labelBg)}>
              {s.label}
            </span>
            {insight.platform && (
              <Badge variant="outline" className="text-[10px] py-0 h-4">
                {insight.platform}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{insight.description}</p>
          {insight.recommendation && (
            <div className="mt-3 rounded-lg border border-border/50 bg-background/60 p-2.5 space-y-1.5">
              <div className="flex items-start gap-1.5">
                <ArrowRight className="h-3 w-3 shrink-0 text-primary mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  <span className="font-semibold">Fix: </span>
                  <span className="text-muted-foreground">{insight.recommendation}</span>
                </p>
              </div>
              {insight.projectedImpact && (
                <div className="flex items-start gap-1.5">
                  <Sparkles className="h-3 w-3 shrink-0 text-amber-500 mt-0.5" />
                  <p className="text-[11px] leading-relaxed">
                    <span className="font-semibold text-amber-600 dark:text-amber-400">Projected: </span>
                    <span className="text-muted-foreground">{insight.projectedImpact}</span>
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

/**
 * Derive insights from real ad data. Returns up to 5 prioritized insights.
 * Uses simple heuristics: low-ROAS campaigns = leaks, top-ROAS campaigns = wins,
 * cross-channel imbalance = opportunity.
 */
function deriveInsights(args: {
  channels: ReturnType<typeof useChannelBreakdown>["data"];
  campaigns: ReturnType<typeof useTopCampaigns>["data"];
  blendedRoas: number;
}): Insight[] {
  const { channels = [], campaigns = [], blendedRoas } = args;
  const insights: Insight[] = [];

  // ── Win: top campaign by ROAS (with material spend) ──
  const significantSpend = (campaigns ?? []).filter((c) => c.spend >= 100);
  const topByRoas = [...significantSpend].sort((a, b) => b.roas - a.roas)[0];
  if (topByRoas && topByRoas.roas > blendedRoas * 1.2) {
    insights.push({
      id: "win-top-campaign",
      type: "win",
      title: `${topByRoas.name} is your top performer`,
      metric: `${topByRoas.roas.toFixed(2)}x`,
      description: `${fmtMoney(topByRoas.revenue)} in revenue from ${fmtMoney(topByRoas.spend)} spend — ${(topByRoas.roas / Math.max(blendedRoas, 0.01)).toFixed(1)}x above your blended ROAS.`,
      platform: topByRoas.channel,
    });
  }

  // ── Leak: campaigns burning budget (low ROAS, material spend) ──
  const leakers = [...significantSpend]
    .filter((c) => c.roas > 0 && c.roas < blendedRoas * 0.5)
    .sort((a, b) => b.spend - a.spend);
  const topLeak = leakers[0];
  if (topLeak) {
    const wasted = Math.round(topLeak.spend * 0.4);
    insights.push({
      id: "leak-bad-campaign",
      type: "leak",
      title: `${topLeak.name} below break-even`,
      metric: `${topLeak.roas.toFixed(2)}x`,
      description: `Returning less than $1 for every $${(1 / Math.max(topLeak.roas, 0.01)).toFixed(2)} spent. Approximately ${fmtMoney(wasted)} of weekly spend at risk.`,
      recommendation: `Pause or reduce budget by 50% and reallocate to ${topByRoas?.name || "your top campaign"}.`,
      projectedImpact: `Recover ~${fmtMoney(wasted)} per period`,
      platform: topLeak.channel,
    });
  }

  // ── Opportunity: cross-channel imbalance ──
  if (channels && channels.length >= 2) {
    const sortedByRoas = [...channels].sort((a, b) => b.roas - a.roas);
    const best = sortedByRoas[0];
    const worst = sortedByRoas[sortedByRoas.length - 1];
    if (best && worst && best.roas > worst.roas * 1.5 && worst.spend > best.spend * 0.5) {
      insights.push({
        id: "opp-shift-budget",
        type: "opportunity",
        title: `Shift budget from ${worst.channel} to ${best.channel}`,
        metric: `+${Math.round(((best.roas - worst.roas) / Math.max(worst.roas, 0.01)) * 100)}%`,
        description: `${best.channel} (${best.roas.toFixed(2)}x) is dramatically outperforming ${worst.channel} (${worst.roas.toFixed(2)}x), but spend is similar.`,
        recommendation: `Move 20% of ${worst.channel} budget to ${best.channel}.`,
        projectedImpact: `+${fmtMoney(worst.spend * 0.2 * (best.roas - worst.roas))} incremental revenue`,
        platform: "Cross-channel",
      });
    }
  }

  // ── Win: cross-channel growth ──
  const totalSpend = channels?.reduce((s, c) => s + c.spend, 0) ?? 0;
  if (totalSpend > 0 && insights.length < 4) {
    insights.push({
      id: "win-blended",
      type: "win",
      title: "Healthy blended ROAS this period",
      metric: `${blendedRoas.toFixed(2)}x`,
      description: `Across ${channels?.length || 0} channels and ${fmtMoney(totalSpend)} in spend, your blended return is ${blendedRoas.toFixed(2)}x — ${blendedRoas >= 2 ? "above" : "below"} the typical 2.0x benchmark.`,
      platform: "All channels",
    });
  }

  return insights.slice(0, 4);
}

interface KPISparkProps {
  label: string;
  value: string;
  change: number | null | undefined;
  invertColor?: boolean;
}

function MiniKPI({ label, value, change, invertColor }: KPISparkProps) {
  const positive = (change ?? 0) >= 0;
  const isGood = invertColor ? !positive : positive;
  return (
    <Card className="p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums">{value}</p>
      {change !== null && change !== undefined && (
        <div className="mt-2 flex items-center gap-1">
          {positive ? (
            <TrendingUp className={cn("h-3 w-3", isGood ? "text-emerald-600" : "text-rose-500")} />
          ) : (
            <TrendingDown className={cn("h-3 w-3", isGood ? "text-emerald-600" : "text-rose-500")} />
          )}
          <span className={cn("text-xs font-semibold tabular-nums", isGood ? "text-emerald-600" : "text-rose-500")}>
            {positive ? "+" : ""}{change}%
          </span>
          <span className="text-[10px] text-muted-foreground ml-1">vs prior</span>
        </div>
      )}
    </Card>
  );
}

export default function DashboardHighlights() {
  const { activeClient } = useClient();
  const kpisQ = useCrossChannelKPIs();
  const channelsQ = useChannelBreakdown();
  const campaignsQ = useTopCampaigns();

  const isLoading = kpisQ.isLoading || channelsQ.isLoading || campaignsQ.isLoading;
  const realKpis = kpisQ.data;
  const realChannels = channelsQ.data;
  const realCampaigns = campaignsQ.data;

  // No real spend? Show demo preview.
  const hasRealData = (realKpis?.totalSpend ?? 0) > 0;

  const insights = useMemo<Insight[]>(() => {
    if (!hasRealData) {
      const demo = generateDemoData({
        companyName: activeClient?.name || "Your Brand",
      });
      return demo.callouts.slice(0, 4).map<Insight>((c) => ({
        id: c.id,
        type: c.type === "problem" ? "leak" : c.type,
        title: c.title,
        metric: c.metric,
        description: c.description,
        recommendation: c.recommendation,
        projectedImpact: c.projectedImpact,
        platform: c.platform,
      }));
    }
    return deriveInsights({
      channels: realChannels,
      campaigns: realCampaigns,
      blendedRoas: realKpis?.blendedROAS ?? 0,
    });
  }, [hasRealData, realChannels, realCampaigns, realKpis, activeClient?.name]);

  const wins = insights.filter((i) => i.type === "win");
  const leaks = insights.filter((i) => i.type === "leak");
  const opportunities = insights.filter((i) => i.type === "opportunity");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Highlights</h2>
          {!hasRealData ? (
            <Badge variant="outline" className="text-[10px] py-0 h-5 border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
              Preview — connect accounts to see live insights
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] py-0 h-5">
              Live · AI-derived from your data
            </Badge>
          )}
        </div>
      </div>

      {/* KPI strip */}
      {hasRealData && realKpis && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiniKPI
            label="Total Spend"
            value={fmtMoney(realKpis.totalSpend)}
            change={realKpis.changes.totalSpend}
            invertColor
          />
          <MiniKPI
            label="Revenue"
            value={fmtMoney(realKpis.totalRevenue)}
            change={realKpis.changes.totalRevenue}
          />
          <MiniKPI
            label="Blended ROAS"
            value={realKpis.blendedROAS ? `${realKpis.blendedROAS.toFixed(2)}x` : "—"}
            change={realKpis.changes.blendedROAS}
          />
          <MiniKPI
            label="Conversions"
            value={(realKpis.totalConversions ?? 0).toLocaleString()}
            change={realKpis.changes.totalConversions}
          />
        </div>
      )}

      {/* Top story callouts */}
      {leaks[0] && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-rose-700 dark:text-rose-400">
              Top Leak
            </h3>
          </div>
          <InsightCard insight={leaks[0]} />
        </div>
      )}

      {opportunities[0] && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-amber-700 dark:text-amber-400">
              Top Opportunity
            </h3>
          </div>
          <InsightCard insight={opportunities[0]} />
        </div>
      )}

      {wins[0] && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-emerald-700 dark:text-emerald-400">
              Top Win
            </h3>
          </div>
          <InsightCard insight={wins[0]} />
        </div>
      )}

      {/* Empty state if no insights */}
      {insights.length === 0 && hasRealData && (
        <Card className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No standout insights for this period yet. Try expanding your date range.
          </p>
        </Card>
      )}

      {/* Show all secondary insights compactly */}
      {insights.length > 1 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">
              All insights ({insights.length})
            </h3>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {insights.slice(1).map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
