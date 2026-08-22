import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Sparkles, TrendingUp, AlertTriangle, FlaskConical, Link2Off } from "lucide-react";
import {
  useBuyologyCreativeAnalysis,
  CreativeRow,
} from "@/hooks/useBuyologyCreativeAnalysis";
import {
  ProductLine,
  productLineLabel,
  gradeFor,
  QUALIFIED_SECONDS,
  PREMIUM_SECONDS,
} from "@/lib/buyologyProductLines";

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const dur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

type SortKey = "spend" | "total" | "qualified" | "qualityScore" | "cpqc";

function GradePill({ score }: { score: number }) {
  const g = gradeFor(score);
  const tone =
    g === "A" ? "bg-emerald-500/15 text-emerald-600" :
    g === "B" ? "bg-primary/15 text-primary" :
    g === "C" ? "bg-amber-500/15 text-amber-600" :
    "bg-destructive/15 text-destructive";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>
      {g} · {score}
    </span>
  );
}

function InsightCard({
  icon: Icon, title, tone, items,
}: { icon: any; title: string; tone: string; items: { head: string; body: string }[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <h4 className="text-sm font-semibold">{title}</h4>
        <Badge variant="secondary" className="ml-auto text-[10px]">{items.length}</Badge>
      </div>
      <ul className="space-y-2.5">
        {items.map((it) => (
          <li key={it.head} className="text-xs">
            <p className="font-medium">{it.head}</p>
            <p className="mt-0.5 text-muted-foreground">{it.body}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function BuyologyCreativeAnalysis({ line }: { line: ProductLine | "all" }) {
  const { data, isLoading } = useBuyologyCreativeAnalysis();
  const [sort, setSort] = useState<SortKey>("spend");

  const rows = useMemo(() => {
    const all = data?.creativeRows || [];
    const scoped = line === "all" ? all : all.filter((r) => r.line === line);
    return [...scoped]
      .filter((r) => r.spend > 0 || r.total > 0)
      .sort((a, b) => {
        if (sort === "cpqc") {
          const av = a.cpqc || Infinity;
          const bv = b.cpqc || Infinity;
          return av - bv;
        }
        return (b[sort] as number) - (a[sort] as number);
      });
  }, [data, line, sort]);

  const scope = useMemo(() => {
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const qualified = rows.reduce((s, r) => s + r.qualified, 0);
    const converted = rows.reduce((s, r) => s + r.converted, 0);
    return {
      spend, total, qualified, converted,
      cpqc: qualified ? spend / qualified : 0,
      cpl: total ? spend / total : 0,
      qualifiedRate: total ? qualified / total : 0,
    };
  }, [rows]);

  /** Optimization context: winners to scale, waste to cut, tests to run */
  const insights = useMemo(() => {
    const funded = rows.filter((r) => r.matched && r.spend >= 25);
    const withCalls = funded.filter((r) => r.qualified > 0);
    const benchmark = scope.cpqc;

    const scale = withCalls
      .filter((r) => r.qualityScore >= 55 && (benchmark === 0 || r.cpqc <= benchmark * 0.85))
      .sort((a, b) => a.cpqc - b.cpqc)
      .slice(0, 5)
      .map((r) => ({
        head: `Scale ${r.adName} — ${money2(r.cpqc)} per qualified call`,
        body: `Quality ${r.qualityScore}/100 (${pct(r.qualified / r.total)} of ${r.total} calls ran ${QUALIFIED_SECONDS}s+, ${r.premium} hit ${PREMIUM_SECONDS}s+). ${
          benchmark ? `${pct(1 - r.cpqc / benchmark)} cheaper than the ${productLineLabel(r.line)} average of ${money2(benchmark)}.` : ""
        } Raise budget in ${r.adsets[0] || "its ad set"} and duplicate the angle into a new test set.`,
      }));

    const cut = funded
      .filter((r) => r.qualified === 0 || (benchmark > 0 && r.cpqc > benchmark * 1.75))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5)
      .map((r) => ({
        head: `${r.qualified === 0 ? "Pause" : "Trim"} ${r.adName} — ${money(r.spend)} spent`,
        body: r.qualified === 0
          ? `${r.total} call${r.total === 1 ? "" : "s"} and zero reached ${QUALIFIED_SECONDS}s of talk time. Reallocating this spend at the ${money2(benchmark || 0)} benchmark would return roughly ${Math.floor(benchmark ? r.spend / benchmark : 0)} qualified calls.`
          : `${money2(r.cpqc)} per qualified call vs ${money2(benchmark)} benchmark (quality ${r.qualityScore}/100). Cut budget or refresh the hook before it drags the account CPQC up.`,
      }));

    const tests = funded
      .filter((r) => r.spend >= 25 && r.total === 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 4)
      .map((r) => ({
        head: `${r.adName} is spending without calls`,
        body: `${money(r.spend)} spent, ${r.clicks.toLocaleString()} clicks, no attributed calls. Confirm the tracking number / utm_content on this creative before judging performance.`,
      }));

    const noSpend = rows
      .filter((r) => !r.matched && r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 3)
      .map((r) => ({
        head: `${r.total} unattributed ${productLineLabel(r.line)} calls`,
        body: `These calls arrived without a matching utm_content value (${pct(r.qualified / r.total)} qualified). Push utm_content={{ad.name}} on every Meta ad so creative-level cost per qualified call stays complete.`,
      }));

    return { scale, cut, tests, noSpend };
  }, [rows, scope]);

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted" />;
  }

  const maxScore = Math.max(1, ...rows.map((r) => r.qualityScore));

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">
              Creative quality analysis — {line === "all" ? "all product lines" : productLineLabel(line as ProductLine)}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Lifetime Meta creative spend joined to Ringba calls through <code className="text-[11px]">utm_content</code>.
              Quality = talk-time depth ({QUALIFIED_SECONDS}s / {PREMIUM_SECONDS}s), conversion and connect rate.
            </p>
          </div>
          <div className="flex flex-wrap gap-6 text-xs">
            <div>
              <p className="text-muted-foreground">Spend</p>
              <p className="text-base font-semibold">{money(scope.spend)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Qualified calls</p>
              <p className="text-base font-semibold">{scope.qualified.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">of {scope.total.toLocaleString()}</span></p>
            </div>
            <div>
              <p className="text-muted-foreground">Cost / qualified call</p>
              <p className="text-base font-semibold">{scope.qualified ? money2(scope.cpqc) : "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Attribution coverage</p>
              <p className="text-base font-semibold">{pct(data?.attributionRate || 0)}</p>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <InsightCard icon={TrendingUp} tone="text-emerald-500" title="Scale these creatives" items={insights.scale} />
        <InsightCard icon={AlertTriangle} tone="text-destructive" title="Cut or refresh" items={insights.cut} />
        <InsightCard icon={FlaskConical} tone="text-amber-500" title="Spending without calls" items={insights.tests} />
        <InsightCard icon={Link2Off} tone="text-muted-foreground" title="Attribution gaps" items={insights.noSpend} />
      </div>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            Creative leaderboard
          </h3>
          <div className="flex gap-1">
            {([
              ["spend", "Spend"],
              ["total", "Calls"],
              ["qualified", "Qualified"],
              ["qualityScore", "Quality"],
              ["cpqc", "Best CPQC"],
            ] as [SortKey, string][]).map(([k, label]) => (
              <Button
                key={k}
                size="sm"
                variant={sort === k ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setSort(k)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No creative data for this product line yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Creative</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Qualified</TableHead>
                  <TableHead className="text-right">Qual. rate</TableHead>
                  <TableHead className="text-right">Avg talk</TableHead>
                  <TableHead className="text-right">CPQC</TableHead>
                  <TableHead className="text-right">Cost / call</TableHead>
                  <TableHead className="w-[150px]">Quality</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r: CreativeRow) => (
                  <>
                  <TableRow
                    key={r.key}
                    className={`cursor-pointer ${!r.matched ? "opacity-70" : ""}`}
                    onClick={() => setExpanded(expanded === r.key ? null : r.key)}
                  >
                    <TableCell className="max-w-[300px]">
                      <div className="flex items-center gap-2">
                        <ChevronRight
                          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded === r.key ? "rotate-90" : ""}`}
                        />
                        {r.thumbnailUrl && (
                          <img
                            src={r.thumbnailUrl}
                            alt={`${r.adName} creative thumbnail`}
                            loading="lazy"
                            className="h-8 w-8 shrink-0 rounded object-cover"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">{r.adName}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {line === "all" ? `${productLineLabel(r.line)} · ` : ""}
                            {r.format || (r.matched ? "—" : "no Meta match")}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs">{r.spend ? money(r.spend) : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{r.total}</TableCell>
                    <TableCell className="text-right text-xs">{r.qualified}</TableCell>
                    <TableCell className="text-right text-xs">{r.total ? pct(r.qualified / r.total) : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{r.total ? dur(r.avgDuration) : "—"}</TableCell>
                    <TableCell className="text-right text-xs">
                      {r.spend && r.qualified ? (
                        <span className={scope.cpqc && r.cpqc < scope.cpqc ? "text-emerald-600" : undefined}>
                          {money2(r.cpqc)}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs">{r.spend && r.total ? money2(r.cpl) : "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={(r.qualityScore / maxScore) * 100} className="h-1.5" />
                        <GradePill score={r.qualityScore} />
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded === r.key && (
                    <TableRow key={`${r.key}-calls`} className="hover:bg-transparent">
                      <TableCell colSpan={9} className="bg-muted/30 p-3">
                        <CallDrilldown row={r} calls={callsFor(r)} />
                      </TableCell>
                    </TableRow>
                  )}
                  </>
                ))}
              </TableBody>

            </Table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Creative spend is lifetime-to-date from the Meta creative sync, so it is not filtered by the date picker.
          Qualified = {QUALIFIED_SECONDS}s+ of talk time.
        </p>
      </Card>
    </div>
  );
}
