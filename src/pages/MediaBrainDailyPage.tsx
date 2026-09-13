/**
 * Media Brain — DAILY
 *
 * Two minutes unless something is flagged. THIS SCREEN CHANGES NOTHING.
 * No cut buttons, no budget controls, no creative swaps — not even disabled
 * ones. The only actions are the circuit breakers, and they are same-day.
 *
 * No week-over-week deltas anywhere on this view (§3 display rules).
 *
 * @see docs/media-brain/03_Operating_Procedures.md §3
 */

import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ShieldCheck, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pullWindow, type PullWindowResult } from "@/lib/mediaBrain/pull";
import {
  ConfidenceBadge,
  GateBlock,
  Notice,
  StaleWarning,
  WindowConfirm,
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtSeconds,
  groupRows,
  rowClass,
  todayIso,
  useMediaBrainGate,
  type ConfirmedWindow,
} from "@/components/mediaBrain/shared";

interface Breaker {
  fired: boolean;
  title: string;
  evidence: string;
}

export default function MediaBrainDailyPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const gate = useMediaBrainGate(clientId);
  const [confirmed, setConfirmed] = useState<ConfirmedWindow | null>(null);

  // Never auto-pull on mount: the pull waits on a confirmed window.
  const pull = useQuery({
    queryKey: ["mb-daily-pull", clientId, confirmed?.start, confirmed?.end, confirmed?.timezone],
    queryFn: async (): Promise<PullWindowResult> =>
      pullWindow({ clientId: clientId!, start: confirmed!.start, end: confirmed!.end, timezone: confirmed!.timezone }),
    enabled: !!clientId && !!confirmed,
    staleTime: 60_000,
  });

  // Trailing baseline, used only to judge an RTB no-bid spike (§3 breaker 2).
  const baselineStart = confirmed ? isoShift(confirmed.start, -14) : null;
  const baselineEnd = confirmed ? isoShift(confirmed.start, -1) : null;
  const baseline = useQuery({
    queryKey: ["mb-daily-baseline", clientId, baselineStart, baselineEnd],
    queryFn: async (): Promise<PullWindowResult> =>
      pullWindow({ clientId: clientId!, start: baselineStart!, end: baselineEnd!, timezone: confirmed!.timezone }),
    enabled: !!clientId && !!confirmed && pull.data?.ok === true && pull.data.payoutMode === "rtb",
    staleTime: 60_000,
  });

  const block = <GateBlock gate={gate} clientId={clientId} />;
  if (block) return <div className="mx-auto max-w-5xl space-y-4">{block}</div>;

  const instance = gate.instance!;
  const data = pull.data;

  const breakers: Breaker[] = [];
  if (data?.ok) {
    breakers.push({
      fired: data.unjoinedSpend.length > 0 || data.unjoinedCalls.length > 0,
      title: "Tracking broken or calls not routing",
      evidence:
        data.unjoinedSpend.length > 0 || data.unjoinedCalls.length > 0
          ? `${data.unjoinedSpend.length} Meta ${data.unjoinedSpend.length === 1 ? "entity" : "entities"} spending ${fmtMoney(
              data.unjoinedSpend.reduce((s, u) => s + u.spend, 0),
            )} with no joined call records; ${data.unjoinedCalls.length} calls with no ad mapping. Unjoined spend is a tracking flag, not a zero.`
          : "Every spending entity joined to call records, and every call mapped to an entity.",
    });

    const zeroNow = data.totals.payoutDistribution?.zeroRate ?? null;
    const zeroBase = baseline.data?.ok ? (baseline.data.totals.payoutDistribution?.zeroRate ?? null) : null;
    if (data.payoutMode === "rtb") {
      const spike = zeroNow !== null && zeroBase !== null && zeroNow - zeroBase >= 0.15;
      breakers.push({
        fired: spike,
        title: "Buyer down or at capacity — no-bid spike",
        evidence:
          zeroNow === null
            ? "No payout distribution in the window — cannot judge the no-bid rate."
            : zeroBase === null
              ? `No-bid rate ${fmtPct(zeroNow)} in the window. Trailing 14-day baseline unavailable, so a spike cannot be confirmed or ruled out.`
              : `No-bid rate ${fmtPct(zeroNow)} against a trailing 14-day baseline of ${fmtPct(zeroBase)}${
                  spike ? " — an abrupt spike. Check buyer status and rate limiting today." : "."
                }`,
      });
    } else {
      breakers.push({
        fired: data.totals.billableCalls === 0 && data.totals.calls > 0,
        title: "Buyer down or at capacity",
        evidence:
          data.totals.billableCalls === 0 && data.totals.calls > 0
            ? `${fmtNum(data.totals.calls)} calls and zero billable — check buyer status and capacity today.`
            : `${fmtNum(data.totals.billableCalls)} billable of ${fmtNum(data.totals.calls)} calls.`,
      });
    }

    const decisive = data.rows.filter((r) => r.confidenceState === "decisive_zero");
    breakers.push({
      fired: decisive.length > 0,
      title: `Ad past the kill threshold (${fmtMoney(data.thresholds.killThreshold)}) with zero billable calls`,
      evidence:
        decisive.length > 0
          ? decisive.map((r) => `${r.entity_name} — ${fmtMoney(r.spend)} spent, 0 billable`).join(" · ")
          : "No entity past 2× payout at zero billable calls.",
    });
  }

  const anyFired = breakers.some((b) => b.fired);
  const adsetRows = data?.ok
    ? groupRows(data.rows, "adset", data.payoutMode, data.thresholds.killThreshold, data.thresholds.minCalls)
    : [];
  const adRows = data?.ok
    ? groupRows(data.rows, "ad", data.payoutMode, data.thresholds.killThreshold, data.thresholds.minCalls)
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Daily — {gate.client?.name}</h1>
        <p className="text-sm text-muted-foreground">
          Circuit-breaker scan and dashboard. No optimizations happen here: no cuts, no budget changes, no creative
          swaps. A number looking alarming on a Tuesday is not a circuit breaker — if it is still bad on review day, the
          weekly review will catch it.
        </p>
      </div>

      <StaleWarning instance={instance} />

      {/* Circuit-breaker banner sits above everything, always visible. */}
      {data?.ok && (
        <div
          className={`rounded-lg border-2 p-4 ${
            anyFired
              ? "border-destructive bg-destructive/10"
              : "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
          }`}
        >
          <p className="flex items-center gap-2 text-base font-semibold">
            {anyFired ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <ShieldCheck className="h-5 w-5 text-emerald-600" />}
            {anyFired ? "Circuit breaker fired — act today" : "No circuit breakers — nothing needs action today"}
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {breakers.map((b) => (
              <li key={b.title} className="flex gap-2">
                <Badge variant={b.fired ? "destructive" : "outline"} className="mt-0.5 h-fit shrink-0">
                  {b.fired ? "FIRED" : "clear"}
                </Badge>
                <span>
                  <span className="font-medium">{b.title}.</span>{" "}
                  <span className="text-muted-foreground">{b.evidence}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <WindowConfirm
        label="Confirm the window before pulling"
        defaultStart={todayIso()}
        defaultEnd={todayIso()}
        confirmed={confirmed}
        onConfirm={setConfirmed}
        onReset={() => setConfirmed(null)}
      />

      {confirmed && (pull.isLoading || pull.isFetching) && (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Pulling {confirmed.start} → {confirmed.end}…
        </div>
      )}

      {data && !data.ok && (
        <Notice tone="danger" title="The pull failed">
          {(data as { error?: string }).error}
          <p className="mt-2">
            An empty result means the pull failed, not that there were zero calls — and zero billable calls is a kill
            trigger. Nothing below is shown until the pull succeeds.
          </p>
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => pull.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry pull
            </Button>
          </div>
        </Notice>
      )}

      {data?.ok && (
        <>
          {data.missingBillableDefinition.length > 0 && (
            <Notice tone="warn" title="Billable definition missing">
              {data.missingBillableDefinition.length} calls cannot be judged billable because the client's
              billable_min_duration_seconds is not recorded. They are counted as not billable, and named here rather
              than substituted.
            </Notice>
          )}

          <Notice tone="info" title={`Join resolved at ${data.joinLevel} level`}>
            {data.joinNote}
          </Notice>

          {/* 2. Account totals */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account totals</CardTitle>
              <CardDescription>
                Against this client's floor of {fmtPct(instance.min_margin)} margin. Payout mode:{" "}
                {data.payoutMode === "rtb" ? "RTB — total calls is the denominator, zeros included" : "Static — cost per billable call decides"}.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Spend" value={fmtMoney(data.totals.spend)} />
              <Stat label="Calls" value={fmtNum(data.totals.calls)} />
              <Stat label="Billable calls" value={fmtNum(data.totals.billableCalls)} />
              <Stat label="Profit" value={fmtMoney(data.totals.profit)} />
              <Stat label="Margin %" value={fmtPct(data.totals.marginPct)} />
              <Stat
                label="Margin band"
                value={data.totals.marginBand?.verdict ?? "—"}
                hint={data.totals.marginBand?.action}
              />
              <Stat label="Margin per call" value={fmtMoney(data.totals.marginPerCall)} />
              <Stat label="Cost per call" value={fmtMoney(data.totals.costPerCall)} />
              <Stat label="Cost per billable call" value={fmtMoney(data.totals.costPerBillableCall)} />
              <Stat label="RPC" value={fmtMoney(data.totals.rpc)} />
              <Stat label="Connection rate" value={fmtPct(data.totals.connectionRate)} />
              <Stat label="Billable rate" value={fmtPct(data.totals.billableRate)} />
              {data.payoutMode === "rtb" && (
                <>
                  <Stat label="Median payout" value={fmtMoney(data.totals.payoutDistribution?.median ?? null)} />
                  <Stat label="P25 payout" value={fmtMoney(data.totals.payoutDistribution?.p25 ?? null)} />
                  <Stat label="No-bid rate" value={fmtPct(data.totals.payoutDistribution?.zeroRate ?? null)} />
                  <Stat
                    label="Top 10% revenue share"
                    value={fmtPct(data.totals.payoutDistribution?.top10RevenueShare ?? null)}
                  />
                </>
              )}
            </CardContent>
          </Card>

          <EntityTable
            title="Ad sets"
            description={`Insufficient rows — under ${fmtNum(data.thresholds.minCalls)} billable calls — are greyed and marked. You see whether a number means anything before you see the number.`}
            rows={adsetRows}
            rtb={data.payoutMode === "rtb"}
            showAdColumns={false}
          />

          <EntityTable
            title="Ads"
            description="Same columns, plus call rate and, under RTB, median duration."
            rows={adRows}
            rtb={data.payoutMode === "rtb"}
            showAdColumns
          />

          <p className="text-xs text-muted-foreground">
            Nothing on this page justifies a same-day change except a fired circuit breaker. No week-over-week deltas are
            shown here by design — they invite intervention on a cadence the data cannot support.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EntityTable({
  title,
  description,
  rows,
  rtb,
  showAdColumns,
}: {
  title: string;
  description: string;
  rows: ReturnType<typeof groupRows>;
  rtb: boolean;
  showAdColumns: boolean;
}) {
  const sorted = [...rows].sort((a, b) => (b.marginPerCall ?? -Infinity) - (a.marginPerCall ?? -Infinity));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0 sm:p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entity</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead className="text-right">Margin / call</TableHead>
              <TableHead className="text-right">Cost / billable call</TableHead>
              <TableHead className="text-right">Billable calls</TableHead>
              {showAdColumns && <TableHead className="text-right">Call rate</TableHead>}
              {showAdColumns && rtb && <TableHead className="text-right">Median duration</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground">
                  No entities in this window.
                </TableCell>
              </TableRow>
            )}
            {sorted.map((r) => (
              <TableRow key={r.groupKey} className={rowClass(r.confidenceState)}>
                <TableCell className="max-w-[22rem] truncate font-medium">{r.entity_name}</TableCell>
                <TableCell>
                  <ConfidenceBadge state={r.confidenceState} />
                </TableCell>
                <TableCell className="text-right">{fmtMoney(r.marginPerCall)}</TableCell>
                <TableCell className="text-right">{fmtMoney(r.costPerBillableCall)}</TableCell>
                <TableCell className="text-right">{fmtNum(r.billable_calls)}</TableCell>
                {showAdColumns && <TableCell className="text-right">{fmtPct(r.callRate)}</TableCell>}
                {showAdColumns && rtb && (
                  <TableCell className="text-right">{fmtSeconds(r.medianDurationSeconds)}</TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function isoShift(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
