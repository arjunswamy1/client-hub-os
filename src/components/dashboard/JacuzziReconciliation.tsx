import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  useJacuzziRecon, useJacuzziReconMatches, useRunRecon, ReconMatch,
} from "@/hooks/useJacuzziData";

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, string> = {
  matched: "Matched",
  lead_only: "Lead, no tracked call",
  call_only: "Tracked call, not recognized",
  qr_no_call_expected: "QR scan (client-only)",
};

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "matched" ? "default" :
    status === "qr_no_call_expected" ? "secondary" : "outline";
  return (
    <Badge variant={variant as any} className="whitespace-nowrap text-[10px]">
      {STATUS_LABEL[status] || status}
    </Badge>
  );
}

export default function JacuzziReconciliation() {
  const { data: daily, isLoading } = useJacuzziRecon();
  const [onlyExceptions, setOnlyExceptions] = useState(true);
  const { data: matches } = useJacuzziReconMatches(onlyExceptions);
  const runRecon = useRunRecon();
  const [running, setRunning] = useState(false);

  const days = daily || [];
  const totals = days.reduce(
    (a, d) => ({
      leads: a.leads + d.leads_total,
      calls: a.calls + d.ringfuel_calls,
      matched: a.matched + d.matched_count,
      unmatchedLeads: a.unmatchedLeads + d.unmatched_leads,
      unmatchedCalls: a.unmatchedCalls + d.unmatched_calls,
      stationMismatch: a.stationMismatch + d.station_mismatches,
      rateMismatch: a.rateMismatch + d.rate_mismatches,
      revenue: a.revenue + Number(d.expected_revenue || 0),
    }),
    { leads: 0, calls: 0, matched: 0, unmatchedLeads: 0, unmatchedCalls: 0, stationMismatch: 0, rateMismatch: 0, revenue: 0 }
  );
  const clean = !totals.stationMismatch && !totals.rateMismatch && !totals.unmatchedLeads;
  const lastRun = days[0]?.generated_at;

  const run = async () => {
    setRunning(true);
    try {
      const res = await runRecon(60);
      if (res?.error) throw new Error(res.error);
      toast.success(
        `Reconciled ${res?.days ?? 0} days — ${res?.matched ?? 0} matched, ${res?.unmatched_leads ?? 0} unmatched leads, ${res?.station_mismatches ?? 0} station mismatches`
      );
    } catch (e: any) {
      toast.error(e.message || "Reconciliation failed");
    } finally {
      setRunning(false);
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-2 text-sm">
          {clean ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          )}
          <span className="font-medium">
            {clean ? "Station and payout rate confirmed on every recognized lead" : "Exceptions need review"}
          </span>
          {lastRun && (
            <span className="text-xs text-muted-foreground">
              · last run {format(parseISO(lastRun), "MMM d, h:mm a")}
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={running} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} /> Run reconciliation
        </Button>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Recognized leads", value: String(totals.leads) },
          { label: "Tracked calls", value: String(totals.calls) },
          { label: "Matched", value: String(totals.matched) },
          { label: "Unmatched leads", value: String(totals.unmatchedLeads) },
          { label: "Station mismatches", value: String(totals.stationMismatch) },
          { label: "Expected revenue", value: money(totals.revenue) },
        ].map((k) => (
          <Card key={k.label} className="p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
            <p className="mt-1 text-xl font-semibold">{k.value}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <p className="border-b border-border p-3 text-sm font-medium">Daily reconciliation</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-right">Rate applied</th>
                <th className="p-2 text-right">Leads</th>
                <th className="p-2 text-right">Calls</th>
                <th className="p-2 text-right">QR</th>
                <th className="p-2 text-right">RingFuel calls</th>
                <th className="p-2 text-right">Matched</th>
                <th className="p-2 text-right">Unmatched leads</th>
                <th className="p-2 text-right">Unmatched calls</th>
                <th className="p-2 text-right">Station diffs</th>
                <th className="p-2 text-right">Rate diffs</th>
                <th className="p-2 text-right">Expected revenue</th>
                <th className="p-2 text-left">Stations</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <td className="p-2 whitespace-nowrap">{format(parseISO(d.date), "EEE MMM d")}</td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {money2(Number(d.applied_rate))}
                    {d.rate_effective_from && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        since {format(parseISO(d.rate_effective_from), "MMM d")}
                      </span>
                    )}
                  </td>
                  <td className="p-2 text-right font-medium">{d.leads_total || "—"}</td>
                  <td className="p-2 text-right">{d.call_leads || "—"}</td>
                  <td className="p-2 text-right">{d.qr_leads || "—"}</td>
                  <td className="p-2 text-right">{d.ringfuel_calls || "—"}</td>
                  <td className="p-2 text-right text-green-600">{d.matched_count || "—"}</td>
                  <td className={`p-2 text-right ${d.unmatched_leads ? "text-amber-600" : ""}`}>{d.unmatched_leads || "—"}</td>
                  <td className={`p-2 text-right ${d.unmatched_calls ? "text-amber-600" : ""}`}>{d.unmatched_calls || "—"}</td>
                  <td className={`p-2 text-right ${d.station_mismatches ? "text-red-500" : ""}`}>{d.station_mismatches || "—"}</td>
                  <td className={`p-2 text-right ${d.rate_mismatches ? "text-red-500" : ""}`}>{d.rate_mismatches || "—"}</td>
                  <td className="p-2 text-right">{money(Number(d.expected_revenue || 0))}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {Object.entries(d.by_station || {})
                      .sort((a, b) => b[1].leads - a[1].leads)
                      .map(([st, v]) => `${st} ${v.leads}`)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
              {!days.length && (
                <tr>
                  <td colSpan={13} className="p-6 text-center text-muted-foreground">
                    No reconciliation yet for this range — hit “Run reconciliation”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <p className="text-sm font-medium">Line-by-line audit trail</p>
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setOnlyExceptions((v) => !v)}>
            {onlyExceptions ? "Show all rows" : "Show exceptions only"}
          </Button>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left">Transaction</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-left">Lead station</th>
                <th className="p-2 text-left">RingFuel station</th>
                <th className="p-2 text-left">Caller</th>
                <th className="p-2 text-left">DID</th>
                <th className="p-2 text-left">Match</th>
                <th className="p-2 text-right">Rate on lead</th>
                <th className="p-2 text-right">Rate expected</th>
                <th className="p-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {(matches || []).map((m: ReconMatch) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="p-2 whitespace-nowrap">{format(parseISO(m.date), "MMM d")}</td>
                  <td className="p-2"><StatusBadge status={m.status} /></td>
                  <td className="p-2 font-mono text-xs">{m.transaction_id || "—"}</td>
                  <td className="p-2 text-xs uppercase">{m.lead_type || "—"}</td>
                  <td className="p-2">{m.lead_station || "—"}</td>
                  <td className={`p-2 ${m.station_agrees === false ? "text-red-500 font-medium" : ""}`}>
                    {m.ringfuel_station || "—"}
                  </td>
                  <td className="p-2 font-mono text-xs">{m.caller_number || "—"}</td>
                  <td className="p-2 font-mono text-xs">{m.ringfuel_did || "—"}</td>
                  <td className="p-2 text-xs text-muted-foreground">{m.match_method?.replace(/_/g, " ") || "—"}</td>
                  <td className={`p-2 text-right ${m.rate_agrees === false ? "text-red-500 font-medium" : ""}`}>
                    {m.lead_payout_rate === null ? "—" : money2(Number(m.lead_payout_rate))}
                  </td>
                  <td className="p-2 text-right">{m.expected_rate === null ? "—" : money2(Number(m.expected_rate))}</td>
                  <td className="p-2 text-xs text-muted-foreground">{m.notes || "—"}</td>
                </tr>
              ))}
              {!(matches || []).length && (
                <tr>
                  <td colSpan={12} className="p-6 text-center text-muted-foreground">
                    {onlyExceptions ? "No exceptions — everything matched." : "No rows in this range."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
