import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { JacuzziDelivery, JacuzziHourly } from "@/hooks/useJacuzziData";

/** Anything under these is normal rounding between Roku's daily and hourly reports. */
const SPEND_TOLERANCE = 1; // dollars
const IMPRESSION_TOLERANCE = 100;
const PCT_TOLERANCE = 0.01; // 1%

type Status = "ok" | "mismatch" | "missing_hourly" | "missing_daily";

interface AuditRow {
  date: string;
  station: string;
  dailySpend: number;
  hourlySpend: number;
  dailyImps: number;
  hourlyImps: number;
  spendDelta: number;
  impsDelta: number;
  spendPct: number;
  hours: number;
  status: Status;
}

const money2 = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (n: number) => (n || 0).toLocaleString();
const signed = (n: number, fmt: (v: number) => string) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;

const STATUS_META: Record<Status, { label: string; className: string }> = {
  ok: { label: "Matched", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" },
  mismatch: { label: "Mismatch", className: "border-amber-500/40 bg-amber-500/10 text-amber-600" },
  missing_hourly: { label: "No hourly rows", className: "border-orange-500/40 bg-orange-500/10 text-orange-600" },
  missing_daily: { label: "No daily row", className: "border-blue-500/40 bg-blue-500/10 text-blue-600" },
};

/**
 * Reconciles Roku's hourly delivery roll-up against the daily delivery table so
 * gaps (an unsynced hour, a stale daily row, a sheet import that disagrees with
 * the API) surface instead of silently skewing spend.
 */
export default function JacuzziHourlyAudit({
  dailyRows,
  hourlyRows,
}: {
  dailyRows: JacuzziDelivery[];
  hourlyRows: JacuzziHourly[];
}) {
  const [onlyIssues, setOnlyIssues] = useState(true);

  const rows = useMemo<AuditRow[]>(() => {
    const daily = new Map<string, { spend: number; imps: number }>();
    dailyRows.forEach((d) => {
      const key = `${d.date}|${d.station_code}`;
      const cur = daily.get(key) ?? { spend: 0, imps: 0 };
      cur.spend += Number(d.spend || 0);
      cur.imps += Number(d.impressions || 0);
      daily.set(key, cur);
    });

    const hourly = new Map<string, { spend: number; imps: number; hours: number }>();
    hourlyRows.forEach((h) => {
      const key = `${h.date}|${h.station_code}`;
      const cur = hourly.get(key) ?? { spend: 0, imps: 0, hours: 0 };
      cur.spend += Number(h.spend || 0);
      cur.imps += Number(h.impressions || 0);
      if (Number(h.spend || 0) > 0 || Number(h.impressions || 0) > 0) cur.hours += 1;
      hourly.set(key, cur);
    });

    const keys = Array.from(new Set([...daily.keys(), ...hourly.keys()]));
    return keys
      .map((key) => {
        const [date, station] = key.split("|");
        const d = daily.get(key);
        const h = hourly.get(key);
        const dailySpend = d?.spend ?? 0;
        const hourlySpend = h?.spend ?? 0;
        const dailyImps = d?.imps ?? 0;
        const hourlyImps = h?.imps ?? 0;
        const spendDelta = hourlySpend - dailySpend;
        const impsDelta = hourlyImps - dailyImps;
        const base = Math.max(dailySpend, hourlySpend);
        const spendPct = base > 0 ? spendDelta / base : 0;

        let status: Status = "ok";
        if (!h && dailySpend + dailyImps > 0) status = "missing_hourly";
        else if (!d && hourlySpend + hourlyImps > 0) status = "missing_daily";
        else {
          const spendOff = Math.abs(spendDelta) > SPEND_TOLERANCE && Math.abs(spendPct) > PCT_TOLERANCE;
          const impsOff =
            Math.abs(impsDelta) > IMPRESSION_TOLERANCE &&
            Math.abs(impsDelta) / Math.max(1, Math.max(dailyImps, hourlyImps)) > PCT_TOLERANCE;
          if (spendOff || impsOff) status = "mismatch";
        }

        return {
          date, station, dailySpend, hourlySpend, dailyImps, hourlyImps,
          spendDelta, impsDelta, spendPct, hours: h?.hours ?? 0, status,
        };
      })
      .sort((a, b) => {
        const rank = (r: AuditRow) => (r.status === "ok" ? 1 : 0);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        const mag = Math.abs(b.spendDelta) - Math.abs(a.spendDelta);
        if (Math.abs(mag) > 0.005) return mag;
        return b.date.localeCompare(a.date);
      });
  }, [dailyRows, hourlyRows]);

  const flagged = rows.filter((r) => r.status !== "ok");
  const visible = onlyIssues ? flagged : rows;

  const totals = useMemo(() => {
    const dailySpend = rows.reduce((s, r) => s + r.dailySpend, 0);
    const hourlySpend = rows.reduce((s, r) => s + r.hourlySpend, 0);
    const dailyImps = rows.reduce((s, r) => s + r.dailyImps, 0);
    const hourlyImps = rows.reduce((s, r) => s + r.hourlyImps, 0);
    return { dailySpend, hourlySpend, dailyImps, hourlyImps };
  }, [rows]);

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Hourly vs daily reconciliation</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Hourly roll-up compared with the daily delivery totals per day and station. Differences under{" "}
            {money2(SPEND_TOLERANCE)} / {int(IMPRESSION_TOLERANCE)} impressions (or 1%) are treated as rounding.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {flagged.length === 0 ? (
            <Badge variant="outline" className={STATUS_META.ok.className}>
              <CheckCircle2 className="mr-1 h-3 w-3" /> {rows.length} day/station rows matched
            </Badge>
          ) : (
            <Badge variant="outline" className={STATUS_META.mismatch.className}>
              <AlertTriangle className="mr-1 h-3 w-3" /> {flagged.length} of {rows.length} flagged
            </Badge>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOnlyIssues((v) => !v)}>
            {onlyIssues ? "Show all rows" : "Show only issues"}
          </Button>
        </div>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border p-2">
          <p className="text-xs text-muted-foreground">Daily spend</p>
          <p className="text-sm font-semibold">{money2(totals.dailySpend)}</p>
          <p className="text-xs text-muted-foreground">{int(totals.dailyImps)} imps</p>
        </div>
        <div className="rounded-md border p-2">
          <p className="text-xs text-muted-foreground">Hourly roll-up</p>
          <p className="text-sm font-semibold">{money2(totals.hourlySpend)}</p>
          <p className="text-xs text-muted-foreground">{int(totals.hourlyImps)} imps</p>
        </div>
        <div className="rounded-md border p-2">
          <p className="text-xs text-muted-foreground">Difference</p>
          <p className="text-sm font-semibold">
            {signed(totals.hourlySpend - totals.dailySpend, money2)}
          </p>
          <p className="text-xs text-muted-foreground">
            {signed(totals.hourlyImps - totals.dailyImps, int)} imps
          </p>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? "No delivery data in this period yet." : "No mismatches in this period."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Station</th>
                <th className="px-3 py-2 text-right">Daily spend</th>
                <th className="px-3 py-2 text-right">Hourly spend</th>
                <th className="px-3 py-2 text-right">Δ spend</th>
                <th className="px-3 py-2 text-right">Daily imps</th>
                <th className="px-3 py-2 text-right">Hourly imps</th>
                <th className="px-3 py-2 text-right">Δ imps</th>
                <th className="px-3 py-2 text-right">Hours</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={`${r.date}|${r.station}`} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2">{format(parseISO(r.date), "MMM d")}</td>
                  <td className="px-3 py-2">{r.station}</td>
                  <td className="px-3 py-2 text-right">{money2(r.dailySpend)}</td>
                  <td className="px-3 py-2 text-right">{money2(r.hourlySpend)}</td>
                  <td
                    className={`px-3 py-2 text-right font-medium ${
                      r.status === "ok" ? "text-muted-foreground" : "text-amber-600"
                    }`}
                  >
                    {signed(r.spendDelta, money2)}
                    {Math.abs(r.spendPct) >= 0.005 && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({(r.spendPct * 100).toFixed(1)}%)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{int(r.dailyImps)}</td>
                  <td className="px-3 py-2 text-right">{int(r.hourlyImps)}</td>
                  <td
                    className={`px-3 py-2 text-right ${
                      r.status === "ok" ? "text-muted-foreground" : "text-amber-600"
                    }`}
                  >
                    {signed(r.impsDelta, int)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{r.hours || "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={`text-xs ${STATUS_META[r.status].className}`}>
                      {STATUS_META[r.status].label}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
