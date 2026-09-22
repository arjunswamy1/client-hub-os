import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, BarChart, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import type { SpektrafinHourlyRow, SpektrafinSpendRow } from "@/hooks/useSpektrafinData";

/** Anything under these is normal rounding between Roku's daily and hourly reports. */
const SPEND_TOLERANCE = 1; // dollars
const IMPRESSION_TOLERANCE = 100;
const PCT_TOLERANCE = 0.01; // 1%

type Status = "ok" | "mismatch" | "missing_hourly" | "missing_daily";

const money = (n: number) =>
  n < 0 ? `-$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const int = (n: number) => (n || 0).toLocaleString();
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const signed = (n: number, fmt: (v: number) => string) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;

const STATUS_META: Record<Status, { label: string; className: string }> = {
  ok: { label: "Matched", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" },
  mismatch: { label: "Mismatch", className: "border-amber-500/40 bg-amber-500/10 text-amber-600" },
  missing_hourly: { label: "No hourly rows", className: "border-orange-500/40 bg-orange-500/10 text-orange-600" },
  missing_daily: { label: "No daily row", className: "border-blue-500/40 bg-blue-500/10 text-blue-600" },
};

export interface HourCallStats {
  hour: number;
  calls: number;
  connected: number;
  converted: number;
  revenue: number;
  revenueUnknown: number;
}

/**
 * Hour-of-day read for Spektrafin: Roku delivery by hour and campaign against the
 * calls that arrived in the same hour, plus a reconciliation of the hourly roll-up
 * against the daily spend rows so an unsynced hour surfaces instead of quietly
 * understating cost per call.
 */
export default function SpektrafinHourly({
  hourlyRows,
  dailyRows,
  callsByHour,
}: {
  hourlyRows: SpektrafinHourlyRow[];
  dailyRows: SpektrafinSpendRow[];
  callsByHour: HourCallStats[];
}) {
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [campaignFilter, setCampaignFilter] = useState<string>("all");

  const campaigns = useMemo(() => {
    const map = new Map<string, { key: string; label: string; spend: number }>();
    hourlyRows.forEach((h) => {
      const key = h.campaign_uid;
      const cur = map.get(key) ?? { key, label: h.campaign_name || h.campaign_uid, spend: 0 };
      cur.spend += h.spend;
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
  }, [hourlyRows]);

  const scoped = useMemo(
    () => (campaignFilter === "all" ? hourlyRows : hourlyRows.filter((h) => h.campaign_uid === campaignFilter)),
    [hourlyRows, campaignFilter],
  );

  /** 24 rows, always — an hour with no delivery is information, not an absence. */
  const hours = useMemo(() => {
    const rows = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, "0")}:00`,
      spend: 0,
      impressions: 0,
      completions: 0,
      calls: 0,
      connected: 0,
      converted: 0,
      revenue: 0,
      revenueUnknown: 0,
    }));
    scoped.forEach((h) => {
      const r = rows[h.hour];
      if (!r) return;
      r.spend += h.spend;
      r.impressions += h.impressions;
      r.completions += h.video_completions;
    });
    // Call timing is whole-account: a call carries its tracking number, not the
    // Roku campaign, so it is never split across the campaign filter.
    callsByHour.forEach((c) => {
      const r = rows[c.hour];
      if (!r) return;
      r.calls += c.calls;
      r.connected += c.connected;
      r.converted += c.converted;
      r.revenue += c.revenue;
      r.revenueUnknown += c.revenueUnknown;
    });
    return rows.map((r) => ({
      ...r,
      cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
      costPerCall: r.calls > 0 ? r.spend / r.calls : 0,
      // Revenue we were never told is left out, so a per-hour margin is published
      // only for hours where every call reported a figure.
      revenuePlot: r.calls > 0 && r.revenueUnknown === r.calls ? null : r.revenue,
    }));
  }, [scoped, callsByHour]);

  const hasHourlyDelivery = hours.some((h) => h.spend > 0 || h.impressions > 0);

  const audit = useMemo(() => {
    const daily = new Map<string, { spend: number; imps: number }>();
    dailyRows.forEach((d) => {
      const cur = daily.get(d.date) ?? { spend: 0, imps: 0 };
      cur.spend += d.spend;
      cur.imps += d.impressions;
      daily.set(d.date, cur);
    });
    const hourly = new Map<string, { spend: number; imps: number; hours: number }>();
    hourlyRows.forEach((h) => {
      const cur = hourly.get(h.date) ?? { spend: 0, imps: 0, hours: 0 };
      cur.spend += h.spend;
      cur.imps += h.impressions;
      if (h.spend > 0 || h.impressions > 0) cur.hours += 1;
      hourly.set(h.date, cur);
    });

    const rows = Array.from(new Set([...daily.keys(), ...hourly.keys()])).map((date) => {
      const d = daily.get(date);
      const h = hourly.get(date);
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
      return { date, dailySpend, hourlySpend, dailyImps, hourlyImps, spendDelta, impsDelta, spendPct, hours: h?.hours ?? 0, status };
    });

    return rows.sort((a, b) => {
      const rank = (r: typeof a) => (r.status === "ok" ? 1 : 0);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return b.date.localeCompare(a.date);
    });
  }, [dailyRows, hourlyRows]);

  const flagged = audit.filter((r) => r.status !== "ok");
  const visibleAudit = onlyIssues ? flagged : audit;
  const auditTotals = useMemo(
    () => ({
      dailySpend: audit.reduce((s, r) => s + r.dailySpend, 0),
      hourlySpend: audit.reduce((s, r) => s + r.hourlySpend, 0),
      dailyImps: audit.reduce((s, r) => s + r.dailyImps, 0),
      hourlyImps: audit.reduce((s, r) => s + r.hourlyImps, 0),
    }),
    [audit],
  );

  /** Campaign × hour: which hours each buy actually delivered in. */
  const campaignHours = useMemo(() => {
    const map = new Map<string, { label: string; spend: number; impressions: number; completions: number; hours: Set<number>; first: number | null; last: number | null }>();
    hourlyRows.forEach((h) => {
      const cur = map.get(h.campaign_uid) ?? {
        label: h.campaign_name || h.campaign_uid,
        spend: 0, impressions: 0, completions: 0, hours: new Set<number>(), first: null, last: null,
      };
      cur.spend += h.spend;
      cur.impressions += h.impressions;
      cur.completions += h.video_completions;
      if (h.spend > 0 || h.impressions > 0) {
        cur.hours.add(h.hour);
        cur.first = cur.first === null ? h.hour : Math.min(cur.first, h.hour);
        cur.last = cur.last === null ? h.hour : Math.max(cur.last, h.hour);
      }
      map.set(h.campaign_uid, cur);
    });
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, ...v, hourCount: v.hours.size }))
      .sort((a, b) => b.spend - a.spend);
  }, [hourlyRows]);

  const hh = (h: number | null) => (h === null ? "—" : `${String(h).padStart(2, "0")}:00`);

  return (
    <div className="space-y-4">
      {!hasHourlyDelivery && (
        <Card className="border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
          No hourly Roku delivery for this range yet. Roku builds the hourly report in the background and closes each
          hour with roughly an hour's lag — press <strong>Sync Roku hourly</strong> above and it lands within a few
          minutes.
        </Card>
      )}

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Campaign:</span>
          <Button
            size="sm"
            variant={campaignFilter === "all" ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setCampaignFilter("all")}
          >
            All campaigns
          </Button>
          {campaigns.map((c) => (
            <Button
              key={c.key}
              size="sm"
              variant={campaignFilter === c.key ? "default" : "outline"}
              className="h-7 max-w-[22rem] truncate text-xs"
              title={c.label}
              onClick={() => setCampaignFilter(c.key)}
            >
              {c.label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Hours are as Roku reports them, in the ad account's own clock — the same clock the campaign daypart was set
          in, so a buy written "6-6 EST" can be read straight off these hours. Calls are stamped in Puerto Rico time,
          matching RingFuel, and are a whole-account figure: a call carries its tracking number, not the Roku campaign,
          so filtering by campaign changes delivery only.
        </p>
      </Card>

      <Card className="p-4">
        <p className="mb-1 text-sm font-medium">Hour-of-day delivery vs calls</p>
        <p className="mb-3 text-xs text-muted-foreground">
          {campaignFilter === "all" ? "All campaigns" : campaigns.find((c) => c.key === campaignFilter)?.label}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={hours}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
            <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="l" dataKey="spend" name="Spend" fill="hsl(var(--primary))" opacity={0.7} radius={[3, 3, 0, 0]} />
            <Line yAxisId="l" type="monotone" dataKey="revenuePlot" name="Revenue (reported)" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
            <Line yAxisId="r" type="monotone" dataKey="calls" name="Calls" stroke="#6366f1" strokeWidth={2} dot={{ r: 2 }} />
            <Line yAxisId="r" type="monotone" dataKey="converted" name="Converted" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <Card className="p-4">
        <p className="mb-3 text-sm font-medium">Impressions by hour</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={hours}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => int(v as number)} />
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
            <Bar dataKey="impressions" name="Impressions" fill="#3b82f6" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Hour</th>
              <th className="px-3 py-2 text-right">Spend</th>
              <th className="px-3 py-2 text-right">Impressions</th>
              <th className="px-3 py-2 text-right">Completions</th>
              <th className="px-3 py-2 text-right">CPM</th>
              <th className="px-3 py-2 text-right">Calls</th>
              <th className="px-3 py-2 text-right">Connected</th>
              <th className="px-3 py-2 text-right">Converted</th>
              <th className="px-3 py-2 text-right">Cost / call</th>
              <th className="px-3 py-2 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((r) => (
              <tr key={r.hour} className={`border-t ${r.spend === 0 && r.calls === 0 ? "text-muted-foreground" : ""}`}>
                <td className="px-3 py-2 font-mono text-xs">{r.label}</td>
                <td className="px-3 py-2 text-right">{money2(r.spend)}</td>
                <td className="px-3 py-2 text-right">{int(r.impressions)}</td>
                <td className="px-3 py-2 text-right">{int(r.completions)}</td>
                <td className="px-3 py-2 text-right">{r.impressions > 0 ? money2(r.cpm) : "—"}</td>
                <td className="px-3 py-2 text-right">{int(r.calls)}</td>
                <td className="px-3 py-2 text-right">{r.calls ? pct(r.connected / r.calls) : "—"}</td>
                <td className="px-3 py-2 text-right">
                  {r.calls === 0 ? "—" : r.revenueUnknown === r.calls ? <span className="text-amber-600">unknown</span> : int(r.converted)}
                </td>
                <td className="px-3 py-2 text-right">{r.calls > 0 && r.spend > 0 ? money2(r.costPerCall) : "—"}</td>
                <td className="px-3 py-2 text-right">
                  {r.calls === 0 ? "—" : r.revenueUnknown === r.calls ? (
                    <span className="text-amber-600">unknown</span>
                  ) : (
                    <>
                      {money(r.revenue)}
                      {r.revenueUnknown > 0 && (
                        <span className="ml-1 text-xs text-amber-600" title={`Revenue unknown for ${r.revenueUnknown} of ${r.calls} calls`}>
                          ({r.revenueUnknown} unknown)
                        </span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto">
        <div className="p-3">
          <p className="text-sm font-medium">Delivery window by campaign</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            First and last hour each buy actually delivered in, against the daypart written into its name. A buy
            delivering outside its intended window is a setup problem, not a creative one.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Roku campaign</th>
              <th className="px-3 py-2 text-right">Hours with delivery</th>
              <th className="px-3 py-2 text-right">First hour</th>
              <th className="px-3 py-2 text-right">Last hour</th>
              <th className="px-3 py-2 text-right">Spend</th>
              <th className="px-3 py-2 text-right">Impressions</th>
              <th className="px-3 py-2 text-right">CPM</th>
            </tr>
          </thead>
          <tbody>
            {campaignHours.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No hourly delivery in this range.</td></tr>
            ) : campaignHours.map((c) => (
              <tr key={c.key} className="border-t">
                <td className="px-3 py-2">{c.label}</td>
                <td className="px-3 py-2 text-right">{c.hourCount}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{hh(c.first)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{hh(c.last)}</td>
                <td className="px-3 py-2 text-right">{money2(c.spend)}</td>
                <td className="px-3 py-2 text-right">{int(c.impressions)}</td>
                <td className="px-3 py-2 text-right">{c.impressions > 0 ? money2((c.spend / c.impressions) * 1000) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Hourly vs daily reconciliation</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Hourly roll-up compared with the daily Roku spend per day. Differences under {money2(SPEND_TOLERANCE)} /{" "}
              {int(IMPRESSION_TOLERANCE)} impressions (or 1%) are treated as rounding.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {flagged.length === 0 ? (
              <Badge variant="outline" className={STATUS_META.ok.className}>
                <CheckCircle2 className="mr-1 h-3 w-3" /> {audit.length} days matched
              </Badge>
            ) : (
              <Badge variant="outline" className={STATUS_META.mismatch.className}>
                <AlertTriangle className="mr-1 h-3 w-3" /> {flagged.length} of {audit.length} flagged
              </Badge>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOnlyIssues((v) => !v)}>
              {onlyIssues ? "Show all days" : "Show only issues"}
            </Button>
          </div>
        </div>

        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">Daily spend</p>
            <p className="text-sm font-semibold">{money2(auditTotals.dailySpend)}</p>
            <p className="text-xs text-muted-foreground">{int(auditTotals.dailyImps)} imps</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">Hourly roll-up</p>
            <p className="text-sm font-semibold">{money2(auditTotals.hourlySpend)}</p>
            <p className="text-xs text-muted-foreground">{int(auditTotals.hourlyImps)} imps</p>
          </div>
          <div className="rounded-md border p-2">
            <p className="text-xs text-muted-foreground">Difference</p>
            <p className="text-sm font-semibold">{signed(auditTotals.hourlySpend - auditTotals.dailySpend, money2)}</p>
            <p className="text-xs text-muted-foreground">{signed(auditTotals.hourlyImps - auditTotals.dailyImps, int)} imps</p>
          </div>
        </div>

        {visibleAudit.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {audit.length === 0 ? "No delivery data in this period yet." : "No mismatches in this period."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
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
                {visibleAudit.map((r) => (
                  <tr key={r.date} className="border-t">
                    <td className="whitespace-nowrap px-3 py-2">{format(parseISO(r.date), "MMM d")}</td>
                    <td className="px-3 py-2 text-right">{money2(r.dailySpend)}</td>
                    <td className="px-3 py-2 text-right">{money2(r.hourlySpend)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${r.status === "ok" ? "text-muted-foreground" : "text-amber-600"}`}>
                      {signed(r.spendDelta, money2)}
                      {Math.abs(r.spendPct) >= 0.005 && (
                        <span className="ml-1 text-xs text-muted-foreground">({(r.spendPct * 100).toFixed(1)}%)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{int(r.dailyImps)}</td>
                    <td className="px-3 py-2 text-right">{int(r.hourlyImps)}</td>
                    <td className={`px-3 py-2 text-right ${r.status === "ok" ? "text-muted-foreground" : "text-amber-600"}`}>
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
    </div>
  );
}
