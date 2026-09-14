/**
 * The SENSITIVITY BAND — what renders in place of revenue and margin when the
 * billable duration threshold is an UNKNOWN.
 *
 * It never renders alongside a point estimate. On a `computed` vertical the
 * threshold IS the revenue, so publishing a single figure would present a
 * contract term nobody has supplied as a measurement.
 *
 * Nothing is derived here. The band comes from `engine.revenueSensitivity`.
 */

import { Notice, fmtMoney, fmtNum, fmtPct } from "@/components/mediaBrain/shared";
import { Badge } from "@/components/ui/badge";
import type { SensitivityBand as Band } from "@/lib/mediaBrain/engine";

interface Props {
  label: string;
  spend: number;
  calls: number;
  band: Band;
  blockedFigures?: string[];
}

export function SensitivityBandTable({ label, spend, calls, band, blockedFigures }: Props) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {label}
        <Badge variant="outline">threshold UNKNOWN</Badge>
        {band.verdictBlocking && <Badge variant="destructive">range crosses zero — no verdict</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        {fmtNum(calls)} calls and {fmtMoney(spend)} of spend are measured. Revenue and margin are not — they depend on
        the billable duration threshold, which is assumed rather than stated in any contract.
      </p>
      {blockedFigures && blockedFigures.length > 0 && (
        <p className="text-xs text-muted-foreground">
          This UNKNOWN blocks: <span className="font-medium">{blockedFigures.join(", ")}</span>.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-3">If the threshold is</th>
              <th className="py-1 pr-3 text-right">Billable</th>
              <th className="py-1 pr-3 text-right">Revenue</th>
              <th className="py-1 pr-3 text-right">Margin / call</th>
              <th className="py-1 pr-3 text-right">Margin %</th>
            </tr>
          </thead>
          <tbody>
            {band.points.map((p) => (
              <tr key={p.thresholdSeconds} className="border-b last:border-0">
                <td className="py-1 pr-3">{p.thresholdSeconds}s</td>
                <td className="py-1 pr-3 text-right">{fmtNum(p.billableCalls)}</td>
                <td className="py-1 pr-3 text-right">{fmtMoney(p.revenue)}</td>
                <td className="py-1 pr-3 text-right">{fmtMoney(p.marginPerCall)}</td>
                <td
                  className={
                    "py-1 pr-3 text-right" +
                    (p.marginPct !== null && p.marginPct < 0 ? " font-semibold text-destructive" : "")
                  }
                >
                  {fmtPct(p.marginPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notice tone={band.verdictBlocking ? "danger" : "warn"} title="Why no single figure is shown">
        {band.note}
      </Notice>
    </div>
  );
}
