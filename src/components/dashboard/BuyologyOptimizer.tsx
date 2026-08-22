import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import {
  Brain, FileDown, Loader2, TrendingUp, Scissors, FlaskConical, ArrowRightLeft, AlertTriangle, RefreshCw,
} from "lucide-react";
import { useBuyologyCreativeAnalysis, CreativeRow } from "@/hooks/useBuyologyCreativeAnalysis";
import { BUYOLOGY_CLIENT_ID } from "@/hooks/useBuyologyData";
import { ProductLine, productLineLabel, QUALIFIED_SECONDS, PREMIUM_SECONDS } from "@/lib/buyologyProductLines";
import { buildBuyologyOptimizerPdf, OptimizerPlan } from "@/lib/buyologyOptimizerPdf";
import BuyologyOptimizerSchedule from "./BuyologyOptimizerSchedule";
import { OptimizerBrief } from "@/hooks/useOptimizerSchedule";


const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${((n || 0) * 100).toFixed(0)}%`;

const TYPE_META: Record<string, { icon: any; tone: string }> = {
  scale: { icon: TrendingUp, tone: "text-emerald-500" },
  cut: { icon: Scissors, tone: "text-destructive" },
  reallocate: { icon: ArrowRightLeft, tone: "text-primary" },
  creative_test: { icon: FlaskConical, tone: "text-amber-500" },
  audience: { icon: Brain, tone: "text-primary" },
  bidding: { icon: ArrowRightLeft, tone: "text-primary" },
  tracking: { icon: AlertTriangle, tone: "text-muted-foreground" },
};

function severityTone(s?: string) {
  return s === "high"
    ? "bg-destructive/15 text-destructive"
    : s === "low"
      ? "bg-muted text-muted-foreground"
      : "bg-amber-500/15 text-amber-600";
}

export default function BuyologyOptimizer({
  line,
  rangeLabel = "lifetime to date",
}: {
  line: ProductLine | "all";
  rangeLabel?: string;
}) {
  const { data, isLoading } = useBuyologyCreativeAnalysis();
  const [notes, setNotes] = useState("");
  const [running, setRunning] = useState(false);
  const [plans, setPlans] = useState<Record<string, { plan: OptimizerPlan; generatedAt: string }>>({});

  /** Which product lines this run covers — "all" fans out to both live campaigns */
  const targets: ProductLine[] = line === "all" ? ["tubs", "bath"] : [line];

  const scoped = useMemo(() => {
    const all = data?.creativeRows || [];
    const build = (l: ProductLine) => {
      const rows = all.filter((r) => r.line === l && (r.spend > 0 || r.total > 0));
      const spend = rows.reduce((s, r) => s + r.spend, 0);
      const calls = rows.reduce((s, r) => s + r.total, 0);
      const qualified = rows.reduce((s, r) => s + r.qualified, 0);
      const premium = rows.reduce((s, r) => s + r.premium, 0);
      const connected = rows.reduce((s, r) => s + r.connected, 0);
      const converted = rows.reduce((s, r) => s + r.converted, 0);
      const attributed = rows.filter((r) => r.matched).reduce((s, r) => s + r.total, 0);
      return {
        line: l,
        rows,
        totals: {
          spend,
          calls,
          connected,
          qualified,
          premium,
          converted,
          cpl: calls ? spend / calls : 0,
          cpqc: qualified ? spend / qualified : 0,
          qualifiedRate: calls ? qualified / calls : 0,
          connectRate: calls ? connected / calls : 0,
          attributionRate: calls ? attributed / calls : 0,
        },
      };
    };
    return Object.fromEntries(targets.map((l) => [l, build(l)])) as Record<
      ProductLine,
      { line: ProductLine; rows: CreativeRow[]; totals: any }
    >;
  }, [data, line]);

  const runFor = async (l: ProductLine) => {
    const s = scoped[l];
    if (!s || s.rows.length === 0) {
      toast({ title: `No data for ${productLineLabel(l)}`, description: "Sync Meta spend and import calls first.", variant: "destructive" });
      return;
    }
    const { data: res, error } = await supabase.functions.invoke("buyology-optimizer", {
      body: {
        line: l,
        lineLabel: productLineLabel(l),
        rangeLabel,
        totals: {
          meta_spend: Math.round(s.totals.spend),
          raw_calls: s.totals.calls,
          connected_calls: s.totals.connected,
          qualified_calls_60s: s.totals.qualified,
          premium_calls_120s: s.totals.premium,
          converted_calls: s.totals.converted,
          cost_per_raw_call: Number(s.totals.cpl.toFixed(2)),
          cost_per_qualified_call: Number(s.totals.cpqc.toFixed(2)),
          qualified_rate: Number(s.totals.qualifiedRate.toFixed(3)),
          connect_rate: Number(s.totals.connectRate.toFixed(3)),
        },
        attributionRate: s.totals.attributionRate,
        unattributedCalls: s.rows.filter((r) => !r.matched).reduce((n, r) => n + r.total, 0),
        notes: notes.trim() || undefined,
        creatives: s.rows
          .filter((r) => r.matched)
          .map((r) => ({
            adName: r.adName,
            line: r.line,
            campaign: r.campaigns[0] || null,
            adset: r.adsets[0] || null,
            format: r.format,
            status: r.status,
            spend: r.spend,
            impressions: r.impressions,
            clicks: r.clicks,
            ctr: r.ctr,
            cpm: r.cpm,
            calls: r.total,
            connected: r.connected,
            qualified: r.qualified,
            premium: r.premium,
            converted: r.converted,
            avgTalkSeconds: r.avgDuration,
            qualityScore: r.qualityScore,
            costPerCall: r.cpl,
            costPerQualifiedCall: r.cpqc,
          })),
      },
    });

    if (error) {
      const msg = (await (error as any)?.context?.text?.().catch(() => null)) || error.message;
      throw new Error(msg);
    }
    if ((res as any)?.error) throw new Error((res as any).error);
    setPlans((p) => ({ ...p, [l]: { plan: (res as any).plan, generatedAt: (res as any).generatedAt } }));
  };

  const run = async () => {
    setRunning(true);
    try {
      for (const l of targets) await runFor(l);
      toast({ title: "Optimization brief ready", description: `Generated for ${targets.map(productLineLabel).join(" and ")}.` });
    } catch (e: any) {
      toast({ title: "Could not generate the plan", description: String(e?.message || e).slice(0, 300), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const exportPdf = (l: ProductLine) => {
    const entry = plans[l];
    const s = scoped[l];
    if (!entry || !s) return;
    buildBuyologyOptimizerPdf({
      lineLabel: productLineLabel(l),
      rangeLabel,
      generatedAt: new Date(entry.generatedAt).toLocaleString(),
      totals: {
        spend: s.totals.spend,
        calls: s.totals.calls,
        qualified: s.totals.qualified,
        converted: s.totals.converted,
        cpqc: s.totals.cpqc,
        cpl: s.totals.cpl,
        qualifiedRate: s.totals.qualifiedRate,
        attributionRate: s.totals.attributionRate,
      },
      plan: entry.plan,
    });
  };

  if (isLoading) return <div className="h-64 animate-pulse rounded-lg bg-muted" />;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Brain className="h-4 w-4 text-primary" />
              AI optimization recommendations
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Sends creative-level Meta spend joined to Ringba call quality ({QUALIFIED_SECONDS}s qualified / {PREMIUM_SECONDS}s premium)
              for {line === "all" ? "both live campaigns" : productLineLabel(line as ProductLine)} and returns a prioritized,
              buyer-ready action plan you can export as a PDF for Belu.
            </p>
          </div>
          <Button onClick={run} disabled={running} className="gap-2">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            {running ? "Analyzing…" : Object.keys(plans).length ? "Regenerate plan" : "Generate plan"}
          </Button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {targets.map((l) => {
            const t = scoped[l]?.totals;
            return (
              <div key={l} className="rounded-lg border p-3">
                <p className="text-xs font-semibold">{productLineLabel(l)}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <span>Spend <b className="text-foreground">{money(t?.spend || 0)}</b></span>
                  <span>Calls <b className="text-foreground">{(t?.calls || 0).toLocaleString()}</b></span>
                  <span>Qualified <b className="text-foreground">{t?.qualified || 0} ({pct(t?.qualifiedRate || 0)})</b></span>
                  <span>CPQC <b className="text-foreground">{t?.qualified ? money2(t.cpqc) : "—"}</b></span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4">
          <label className="text-xs font-medium">Context for the AI (optional)</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. daily budget cap is $500 per campaign, buyer pauses ads under 3 calls, new UGC batch lands Monday…"
            className="mt-1 min-h-[64px] text-xs"
          />
        </div>
      </Card>

      {targets.map((l) => {
        const entry = plans[l];
        if (!entry) return null;
        const plan = entry.plan;
        const recs = [...(plan.recommendations || [])].sort((a, b) => (a.priority || 99) - (b.priority || 99));
        return (
          <Card key={l} className="p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{productLineLabel(l)} — optimization brief</h3>
                <p className="text-[11px] text-muted-foreground">
                  Generated {new Date(entry.generatedAt).toLocaleString()} · {rangeLabel}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => runFor(l).catch((e) => toast({ title: "Refresh failed", description: String(e.message).slice(0, 200), variant: "destructive" }))}>
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => exportPdf(l)}>
                  <FileDown className="h-3.5 w-3.5" /> Export PDF
                </Button>
              </div>
            </div>

            {plan.summary && <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed">{plan.summary}</p>}

            {plan.diagnosis?.length ? (
              <ul className="mt-3 space-y-1.5">
                {plan.diagnosis.map((d, idx) => (
                  <li key={idx} className="flex gap-2 text-xs text-muted-foreground">
                    <span className="text-primary">•</span> {d}
                  </li>
                ))}
              </ul>
            ) : null}

            {recs.length ? (
              <div className="mt-4 space-y-2">
                {recs.map((r, idx) => {
                  const meta = TYPE_META[r.type || ""] || { icon: Brain, tone: "text-primary" };
                  const Icon = meta.icon;
                  return (
                    <div key={idx} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Icon className={`h-4 w-4 shrink-0 ${meta.tone}`} />
                        <p className="text-xs font-semibold">{r.priority ? `${r.priority}. ` : ""}{r.title}</p>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${severityTone(r.severity)}`}>
                          {(r.severity || "medium").toUpperCase()}
                        </span>
                        {r.type && <Badge variant="secondary" className="text-[10px]">{r.type.replace(/_/g, " ")}</Badge>}
                        {r.confidence && <span className="ml-auto text-[10px] text-muted-foreground">confidence: {r.confidence}</span>}
                      </div>
                      {r.entity && <p className="mt-1.5 truncate text-[11px] font-medium text-muted-foreground">{r.entity}</p>}
                      {r.action && <p className="mt-1.5 text-xs">{r.action}</p>}
                      {r.rationale && <p className="mt-1 text-[11px] text-muted-foreground">{r.rationale}</p>}
                      {r.projected_impact && (
                        <p className="mt-1.5 text-[11px] font-medium text-emerald-600">Expected: {r.projected_impact}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {plan.budget_shifts?.length ? (
              <div className="mt-4">
                <h4 className="mb-2 text-xs font-semibold">Budget reallocation</h4>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[11px]">From</TableHead>
                        <TableHead className="text-[11px]">To</TableHead>
                        <TableHead className="text-right text-[11px]">Amount</TableHead>
                        <TableHead className="text-[11px]">Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plan.budget_shifts.map((s, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="max-w-[200px] truncate text-[11px]">{s.from || "—"}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-[11px]">{s.to || "—"}</TableCell>
                          <TableCell className="text-right text-[11px]">{money(Number(s.amount_usd || 0))}</TableCell>
                          <TableCell className="text-[11px] text-muted-foreground">{s.reason || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}

            {plan.creative_tests?.length ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {plan.creative_tests.map((t, idx) => (
                  <div key={idx} className="rounded-lg border p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold">
                      <FlaskConical className="h-3.5 w-3.5 text-amber-500" /> {t.hypothesis}
                    </p>
                    {t.how && <p className="mt-1 text-[11px] text-muted-foreground">{t.how}</p>}
                    {t.measure && <p className="mt-1 text-[11px] font-medium">Measure: {t.measure}</p>}
                  </div>
                ))}
              </div>
            ) : null}

            {plan.watchouts?.length ? (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Watchouts
                </p>
                <ul className="mt-1.5 space-y-1">
                  {plan.watchouts.map((w, idx) => (
                    <li key={idx} className="text-[11px] text-muted-foreground">• {w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
