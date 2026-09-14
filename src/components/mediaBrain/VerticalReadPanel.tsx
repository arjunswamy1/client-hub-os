/**
 * The VERTICAL READ panel — information for a human, never a decision.
 *
 * Cut / hold / scale verdicts are deliberately absent: they are ad-level rules,
 * and a vertical row blends dozens of ads together. The ad-level coverage figure
 * sits beside the table so the reader knows why they are looking at verticals at
 * all.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice, ConfidenceBadge, fmtMoney, fmtNum, fmtPct } from "@/components/mediaBrain/shared";
import { useMediaBrainVerticalRead } from "@/hooks/useMediaBrainVerticalRead";
import type { VerticalReadRow } from "@/lib/mediaBrain/verticalRead";
import { SensitivityBandTable } from "@/components/mediaBrain/SensitivityBand";
import { Info } from "lucide-react";

interface Props {
  clientId?: string;
  start: string;
  end: string;
  /** Share of calls resolved at ad level, from the pull. */
  adLevelPct?: number | null;
}

function SourceBadge({ row }: { row: VerticalReadRow }) {
  if (row.revenueSource === "computed") {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-600">
        computed
      </Badge>
    );
  }
  if (row.revenueSource === "unclassified") {
    return <Badge variant="outline">no economics</Badge>;
  }
  return <Badge variant="outline">platform</Badge>;
}

export function VerticalReadPanel({ clientId, start, end, adLevelPct }: Props) {
  const q = useMediaBrainVerticalRead(clientId, start, end, adLevelPct);

  if (q.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vertical read</CardTitle>
          <CardDescription>Loading calls, spend and per-vertical economics…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const payload = q.data;
  if (!payload || "error" in payload) {
    return (
      <Notice tone="danger" title="The vertical read could not be built — this is not a zero">
        {payload && "error" in payload ? payload.error : (q.error as Error | undefined)?.message}
      </Notice>
    );
  }

  const { read, validations, notes, totalCalls } = payload;
  const rows = [...read.rows, read.unclassified];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Vertical read
          <Badge variant="secondary">not an ad-level decision</Badge>
        </CardTitle>
        <CardDescription>{read.note}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Notice tone="info" title="What this is, and what it is not">
          Every row blends many ads, so no cut, hold or scale verdict is shown here — those are ad-level rules and
          blending hides exactly the differences they act on. Read this to understand where the money is by product,
          then act at ad level once ad-level attribution covers enough calls.
        </Notice>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Vertical</th>
                <th className="py-2 pr-3 text-right">Spend</th>
                <th className="py-2 pr-3 text-right">Calls</th>
                <th className="py-2 pr-3 text-right">Paid</th>
                <th className="py-2 pr-3 text-right">Billable</th>
                <th className="py-2 pr-3 text-right">Revenue</th>
                <th className="py-2 pr-3">Source</th>
                <th className="py-2 pr-3 text-right">RPC</th>
                <th className="py-2 pr-3 text-right">Cost / call</th>
                <th className="py-2 pr-3 text-right">Cost / billable</th>
                <th className="py-2 pr-3 text-right">Margin / call</th>
                <th className="py-2 pr-3 text-right">Margin %</th>
                <th className="py-2 pr-3">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.vertical_id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-3 font-medium">{row.label}</td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(row.spend)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.calls)}</td>
                  <td className="py-2 pr-3 text-right">{fmtNum(row.paidCalls)}</td>
                  <td className="py-2 pr-3 text-right">
                    {row.billableCalls === null ? (
                      <span className="text-muted-foreground">threshold unknown</span>
                    ) : (
                      fmtNum(row.billableCalls)
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {row.durationThresholdUnknown && row.revenue === null ? (
                      <span className="text-muted-foreground">see band below</span>
                    ) : row.revenue === null ? (
                      <span className="text-muted-foreground">unavailable</span>
                    ) : (
                      fmtMoney(row.revenue)
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <SourceBadge row={row} />
                  </td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(row.rpc)}</td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(row.costPerCall)}</td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(row.costPerBillableCall)}</td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(row.marginPerCall)}</td>
                  <td className="py-2 pr-3 text-right">{fmtPct(row.marginPct)}</td>
                  <td className="py-2 pr-3">
                    <ConfidenceBadge state={row.confidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            {fmtNum(totalCalls)} calls in the window.
            {adLevelPct !== null && adLevelPct !== undefined
              ? ` Ad-level attribution covers ${fmtPct(adLevelPct)} of them.`
              : ""}
          </p>
          {rows.map((row) =>
            row.revenueNote ? (
              <p key={`${row.vertical_id}-note`} className="flex gap-2">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  <span className="font-medium">{row.label}:</span> {row.revenueNote}
                </span>
              </p>
            ) : null,
          )}
        </div>

        {rows.some((r) => r.sensitivity) && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sensitivity band — shown instead of revenue, not beside it
            </p>
            {rows
              .filter((r) => r.sensitivity)
              .map((r) => (
                <SensitivityBandTable
                  key={`${r.vertical_id}-band`}
                  label={r.label}
                  spend={r.spend}
                  calls={r.calls}
                  band={r.sensitivity!}
                  blockedFigures={r.blockedFigures}
                />
              ))}
          </div>
        )}

        {rows.some((r) => r.flags.length > 0) && (
          <Notice tone="warn" title="Named caveats on these numbers">
            <ul className="ml-4 list-disc space-y-1">
              {rows.flatMap((r) => r.flags.map((f, i) => <li key={`${r.vertical_id}-${i}`}>{r.label}: {f}</li>))}
            </ul>
          </Notice>
        )}

        {read.mixedCampaigns.length > 0 && (
          <Notice tone="info" title="Mixed Meta campaigns — resolved ad by ad">
            {read.mixedCampaigns.join(" · ")}. These campaigns carry ads from more than one vertical, so only an ad's own
            name may assign it. Ads matching nothing are reported as unclassified rather than assigned by default.
            {read.unclassifiedAdNames.length > 0 && (
              <p className="mt-2">Unclassified ads: {read.unclassifiedAdNames.join(" · ")}</p>
            )}
          </Notice>
        )}

        {read.unclassifiedCallCampaigns.length > 0 && (
          <Notice tone="warn" title="Calls on campaigns that match no vertical">
            {read.unclassifiedCallCampaigns.join(" · ")}. Reported as unclassified, never folded into a vertical.
          </Notice>
        )}

        {notes.map((n) => (
          <Notice key={n} tone="warn" title="Data limitation">
            {n}
          </Notice>
        ))}

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Billable definition vs the data (last 30 days at intake)
          </p>
          {validations.map((v) => (
            <div key={v.vertical_id} className="rounded-md border p-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium">{v.label}</span>
                <Badge variant="outline">{v.revenueSource}</Badge>
                {v.result.blocks && <Badge variant="destructive">disagreement above 10%</Badge>}
                {v.payoutConfirmed === false && <Badge variant="outline">payout observed, unconfirmed</Badge>}
                {v.durationThresholdUnknown && <Badge variant="outline">duration threshold UNKNOWN</Badge>}
              </div>
              <p className="mt-1 text-muted-foreground">{v.result.note}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
