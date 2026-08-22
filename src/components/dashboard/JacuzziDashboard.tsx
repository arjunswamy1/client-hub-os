import { useMemo, useState } from "react";
import {
  useJacuzziLeads, useJacuzziDelivery, useJacuzziHourly, useJacuzziRates,
  rateForDate, parseTmSheet, useImportLeads, STATION_NOTES, JacuzziLead,
  useRokuHourlyStatus, useSyncRokuHourly,
} from "@/hooks/useJacuzziData";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, BarChart,
} from "recharts";
import {
  RefreshCw, DollarSign, Phone, QrCode, TrendingUp, Clock, Radio, Upload, Users, ShieldCheck,
} from "lucide-react";
import JacuzziReconciliation from "./JacuzziReconciliation";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

const money = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${((n || 0) * 100).toFixed(1)}%`;
const safe = (n: number) => (isFinite(n) ? n : 0);
const shortDate = (d: string) => format(parseISO(d), "MMM d");

function KPI({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub?: string; icon: any; accent?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <Icon className={`h-4 w-4 shrink-0 ${accent || "text-muted-foreground"}`} />
      </div>
    </Card>
  );
}

export default function JacuzziDashboard() {
  const { data: allLeads = [], isLoading: leadsLoading, refetch: refetchLeads } = useJacuzziLeads();
  const { data: rawDelivery = [], isLoading: deliveryLoading, refetch: refetchDelivery } = useJacuzziDelivery();
  const { data: allHourly = [], refetch: refetchHourly } = useJacuzziHourly();
  const { data: rokuConn, refetch: refetchConn } = useRokuHourlyStatus();
  const { data: rates = [] } = useJacuzziRates();
  const importLeads = useImportLeads();
  const syncHourly = useSyncRokuHourly();
  const [syncing, setSyncing] = useState(false);

  const [paste, setPaste] = useState("");
  const [importing, setImporting] = useState(false);

  /** Drill-down: empty station set = blended across every station we're paid on. */
  const [stationFilter, setStationFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | "call" | "qr">("all");
  /** Default view is today (hour-by-hour); "all" opens the full campaign history. */
  const [period, setPeriod] = useState<"today" | "all">("today");
  const [tab, setTab] = useState("hourly");
  const todayKey = format(new Date(), "yyyy-MM-dd");
  const inPeriod = (d?: string | null) => period === "all" || d === todayKey;


  /**
   * Roku hourly rows are the freshest signal for the current day, so spend for a
   * date+station is the greater of the daily row and its hourly roll-up. Hourly
   * days with no daily row at all are added in.
   */
  const allDelivery = useMemo(() => {
    const hourlyTotals = new Map<string, { impressions: number; spend: number }>();
    allHourly.forEach((h) => {
      const key = `${h.date}|${h.station_code}`;
      const cur = hourlyTotals.get(key) ?? { impressions: 0, spend: 0 };
      cur.impressions += Number(h.impressions || 0);
      cur.spend += Number(h.spend || 0);
      hourlyTotals.set(key, cur);
    });
    const merged = rawDelivery.map((d) => {
      const h = hourlyTotals.get(`${d.date}|${d.station_code}`);
      if (!h) return d;
      hourlyTotals.delete(`${d.date}|${d.station_code}`);
      return {
        ...d,
        impressions: Math.max(Number(d.impressions || 0), h.impressions),
        spend: Math.max(Number(d.spend || 0), h.spend),
      };
    });
    hourlyTotals.forEach((h, key) => {
      const [date, station_code] = key.split("|");
      merged.push({
        date, station_code, campaign_name: null,
        impressions: h.impressions, spend: h.spend,
        cpm: h.impressions > 0 ? (h.spend / h.impressions) * 1000 : 0,
      });
    });
    return merged.sort((a, b) => a.date.localeCompare(b.date));
  }, [rawDelivery, allHourly]);

  const stationOf = (l: JacuzziLead) => l.attributed_station || l.station_code || "Unknown";
  const stationActive = (s: string) => stationFilter.length === 0 || stationFilter.includes(s);
  const toggleStation = (s: string) =>
    setStationFilter((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  const isBlended = stationFilter.length === 0;
  const scopeLabel = isBlended ? "Blended — all stations" : stationFilter.join(" + ");
  const periodLabel = period === "today" ? "Today, hour by hour" : "All time — full campaign";

  /** Period scope applies before station/type drill-down so every panel agrees. */
  const scopedLeads = useMemo(() => allLeads.filter((l) => inPeriod(l.transaction_date)), [allLeads, period, todayKey]);
  const scopedDelivery = useMemo(() => allDelivery.filter((d) => inPeriod(d.date)), [allDelivery, period, todayKey]);
  const scopedHourly = useMemo(() => allHourly.filter((h) => inPeriod(h.date)), [allHourly, period, todayKey]);

  const leads = useMemo(
    () => scopedLeads.filter((l) => stationActive(stationOf(l)) && (typeFilter === "all" || l.lead_type === typeFilter)),
    [scopedLeads, stationFilter, typeFilter]
  );
  const delivery = useMemo(
    () => scopedDelivery.filter((d) => stationActive(d.station_code)),
    [scopedDelivery, stationFilter]
  );
  const hourly = useMemo(
    () => scopedHourly.filter((h) => stationActive(h.station_code)),
    [scopedHourly, stationFilter]
  );


  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncHourly(3);
      if (res?.error) toast.error(res.error);
      else if (res?.pending)
        toast.info("Roku is still generating the hourly report — it'll land automatically within the hour.");
      else toast.success(`Hourly delivery synced (${res?.hourly ?? 0} hours)`);
      refetchHourly();
      refetchDelivery();
      refetchConn();
    } catch (e: any) {
      toast.error(e.message || "Hourly sync failed");
    } finally {
      setSyncing(false);
    }
  };


  const currentRate = useMemo(
    () => rateForDate(rates, format(new Date(), "yyyy-MM-dd")),
    [rates]
  );


  const totals = useMemo(() => {
    const spend = delivery.reduce((s, d) => s + Number(d.spend || 0), 0);
    const impressions = delivery.reduce((s, d) => s + Number(d.impressions || 0), 0);
    const calls = leads.filter((l) => l.lead_type === "call").length;
    const qr = leads.filter((l) => l.lead_type === "qr").length;
    const revenue = leads.reduce((s, l) => s + Number(l.payout_rate || 0), 0);
    const all = calls + qr;
    return {
      spend, impressions, calls, qr, leads: all, revenue,
      profit: revenue - spend,
      margin: revenue > 0 ? (revenue - spend) / revenue : 0,
      cpl: all > 0 ? spend / all : 0,
      cpCall: calls > 0 ? spend / calls : 0,
      cpQr: qr > 0 ? spend / qr : 0,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    };
  }, [leads, delivery]);

  /** Daily roll-up: media spend + recognized leads + efficiency per day. */
  const daily = useMemo(() => {
    const map = new Map<string, any>();
    const row = (d: string) => {
      if (!map.has(d)) map.set(d, { date: d, spend: 0, impressions: 0, calls: 0, qr: 0, revenue: 0 });
      return map.get(d);
    };
    delivery.forEach((d) => {
      const r = row(d.date);
      r.spend += Number(d.spend || 0);
      r.impressions += Number(d.impressions || 0);
    });
    leads.forEach((l) => {
      const r = row(l.transaction_date);
      if (l.lead_type === "qr") r.qr += 1; else r.calls += 1;
      r.revenue += Number(l.payout_rate || 0);
    });
    return Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({
        ...r,
        leads: r.calls + r.qr,
        label: shortDate(r.date),
        cpl: r.calls + r.qr > 0 ? safe(r.spend / (r.calls + r.qr)) : 0,
        cpCall: r.calls > 0 ? safe(r.spend / r.calls) : 0,
        cpQr: r.qr > 0 ? safe(r.spend / r.qr) : 0,
        profit: r.revenue - r.spend,
      }));
  }, [leads, delivery]);

  /** Hour-of-day delivery: spend/impressions from Roku (when present) + lead timing. */
  const hourlyRows = useMemo(() => {
    const rows = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, "0")}:00`,
      spend: 0, impressions: 0, calls: 0, qr: 0,
    }));
    hourly.forEach((h) => {
      const r = rows[h.hour];
      if (!r) return;
      r.spend += Number(h.spend || 0);
      r.impressions += Number(h.impressions || 0);
    });
    leads.forEach((l) => {
      if (!l.transaction_time) return;
      const h = Number(l.transaction_time.slice(0, 2));
      const r = rows[h];
      if (!r) return;
      if (l.lead_type === "qr") r.qr += 1; else r.calls += 1;
    });
    return rows.map((r) => ({
      ...r,
      leads: r.calls + r.qr,
      cpl: r.calls + r.qr > 0 ? safe(r.spend / (r.calls + r.qr)) : 0,
    }));
  }, [hourly, leads]);

  const hasHourlySpend = hourlyRows.some((r) => r.spend > 0 || r.impressions > 0);

  /** Always computed across every station so the full picture stays visible while drilled in. */
  const stations = useMemo(() => {
    const map = new Map<string, any>();
    const row = (s: string) => {
      if (!map.has(s)) map.set(s, { station: s, spend: 0, impressions: 0, calls: 0, qr: 0, revenue: 0 });
      return map.get(s);
    };
    scopedDelivery.forEach((d) => {
      const r = row(d.station_code);
      r.spend += Number(d.spend || 0);
      r.impressions += Number(d.impressions || 0);
    });
    scopedLeads.forEach((l) => {
      const r = row(stationOf(l));
      if (l.lead_type === "qr") r.qr += 1; else r.calls += 1;
      r.revenue += Number(l.payout_rate || 0);
    });
    return Array.from(map.values())
      .map((r) => ({
        ...r,
        leads: r.calls + r.qr,
        profit: r.revenue - r.spend,
        cpl: r.calls + r.qr > 0 ? safe(r.spend / (r.calls + r.qr)) : 0,
        cpCall: r.calls > 0 ? safe(r.spend / r.calls) : 0,
        cpQr: r.qr > 0 ? safe(r.spend / r.qr) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.spend - a.spend);
  }, [scopedLeads, scopedDelivery]);

  /** Blended footer for the station table — the whole-account picture. */
  const blended = useMemo(() => {
    const t = stations.reduce(
      (a, s) => ({
        spend: a.spend + s.spend, impressions: a.impressions + s.impressions,
        calls: a.calls + s.calls, qr: a.qr + s.qr, revenue: a.revenue + s.revenue,
      }),
      { spend: 0, impressions: 0, calls: 0, qr: 0, revenue: 0 }
    );
    const all = t.calls + t.qr;
    return {
      ...t, leads: all, profit: t.revenue - t.spend,
      cpl: all > 0 ? t.spend / all : 0,
      cpCall: t.calls > 0 ? t.spend / t.calls : 0,
      cpQr: t.qr > 0 ? t.spend / t.qr : 0,
    };
  }, [stations]);


  const parsed = useMemo(() => (paste.trim() ? parseTmSheet(paste) : []), [paste]);

  const handleImport = async () => {
    if (!parsed.length) return;
    setImporting(true);
    try {
      const n = await importLeads(parsed, rates);
      toast.success(`Imported ${n} recognized leads`);
      setPaste("");
      refetchLeads();
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  if (leadsLoading || deliveryLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <Radio className="h-3 w-3" /> CTV cost-per-lead · {scopeLabel}
        </Badge>
        <Badge variant="outline">Current payout {money(currentRate)} / call or QR scan</Badge>
        <Badge variant={rokuConn?.status === "active" ? "secondary" : "outline"} className="gap-1">
          <Clock className="h-3 w-3" />
          {rokuConn
            ? rokuConn.last_synced_at
              ? `Roku hourly synced ${format(new Date(rokuConn.last_synced_at), "MMM d h:mm a")}`
              : "Roku hourly sync pending"
            : "Roku not connected"}
        </Badge>
        <Button
          variant="outline" size="sm" className="ml-auto h-8 gap-1.5 text-xs"
          onClick={handleSync} disabled={syncing || !rokuConn}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync Roku hourly"}
        </Button>
        <Button
          variant="outline" size="sm" className="h-8 gap-1.5 text-xs"
          onClick={() => { refetchLeads(); refetchDelivery(); refetchHourly(); toast.success("Refreshed"); }}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>

      </div>

      {/* Drill-down controls: default view is blended across every station we're paid on. */}
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs font-medium text-muted-foreground">Stations</span>
        <Button
          variant={isBlended ? "default" : "outline"} size="sm" className="h-7 text-xs"
          onClick={() => setStationFilter([])}
        >
          Blended
        </Button>
        {stations.map((s) => (
          <Button
            key={s.station}
            variant={stationFilter.includes(s.station) ? "default" : "outline"}
            size="sm" className="h-7 text-xs"
            onClick={() => toggleStation(s.station)}
            title={STATION_NOTES[s.station] || ""}
          >
            {s.station}
            <span className="ml-1 opacity-60">{s.leads}</span>
          </Button>
        ))}
        <span className="ml-2 text-xs font-medium text-muted-foreground">Lead type</span>
        {([
          ["all", "All"],
          ["call", "Calls"],
          ["qr", "QR scans"],
        ] as const).map(([v, label]) => (
          <Button
            key={v}
            variant={typeFilter === v ? "default" : "outline"}
            size="sm" className="h-7 text-xs"
            onClick={() => setTypeFilter(v)}
          >
            {label}
          </Button>
        ))}
        {(!isBlended || typeFilter !== "all") && (
          <Button
            variant="ghost" size="sm" className="h-7 text-xs"
            onClick={() => { setStationFilter([]); setTypeFilter("all"); }}
          >
            Reset
          </Button>
        )}
      </Card>


      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI label="Media spend" value={money(totals.spend)} sub={`${totals.impressions.toLocaleString()} imps · ${money2(totals.cpm)} CPM`} icon={DollarSign} />
        <KPI label="Recognized leads" value={String(totals.leads)} sub={`${totals.calls} calls · ${totals.qr} QR scans`} icon={Users} accent="text-primary" />
        <KPI label="Revenue" value={money(totals.revenue)} sub="Client-recognized payout" icon={TrendingUp} accent="text-green-600" />
        <KPI label="Gross profit" value={money(totals.profit)} sub={`${pct(totals.margin)} margin`} icon={TrendingUp} accent={totals.profit >= 0 ? "text-green-600" : "text-red-500"} />
        <KPI label="Cost / lead" value={money2(totals.cpl)} sub="Spend ÷ all leads" icon={DollarSign} />
        <KPI label="Cost / call" value={money2(totals.cpCall)} sub="Spend ÷ phone calls" icon={Phone} />
        <KPI label="Cost / QR scan" value={money2(totals.cpQr)} sub="Spend ÷ QR leads" icon={QrCode} />
        <KPI label="Payout vs cost" value={totals.cpl > 0 ? `${(currentRate / totals.cpl).toFixed(2)}x` : "—"} sub={`vs ${money(currentRate)} payout`} icon={TrendingUp} />
      </div>

      <Tabs defaultValue="daily" className="space-y-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 scrollbar-none">
          <TabsList className="inline-flex w-auto bg-secondary/50">
            <TabsTrigger value="daily" className="gap-1.5 text-xs">Daily</TabsTrigger>
            <TabsTrigger value="hourly" className="gap-1.5 text-xs"><Clock className="h-3.5 w-3.5" /> Hourly</TabsTrigger>
            <TabsTrigger value="stations" className="gap-1.5 text-xs">Stations</TabsTrigger>
            <TabsTrigger value="leads" className="gap-1.5 text-xs">Lead log</TabsTrigger>
            <TabsTrigger value="recon" className="gap-1.5 text-xs"><ShieldCheck className="h-3.5 w-3.5" /> Reconciliation</TabsTrigger>
            <TabsTrigger value="import" className="gap-1.5 text-xs"><Upload className="h-3.5 w-3.5" /> Import</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="daily" className="space-y-4">
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium">Spend, leads &amp; cost per lead by day</p>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                  formatter={(v: number, n: string) => (n === "Leads" ? [v, n] : [money2(Number(v)), n])}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="spend" name="Spend" fill="hsl(var(--primary))" opacity={0.75} radius={[3, 3, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="leads" name="Leads" stroke="#16a34a" strokeWidth={2} dot={{ r: 2 }} />
                <Line yAxisId="l" type="monotone" dataKey="cpl" name="Cost / lead" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-right">Imps</th>
                    <th className="p-2 text-right">Spend</th>
                    <th className="p-2 text-right">Calls</th>
                    <th className="p-2 text-right">QR</th>
                    <th className="p-2 text-right">Leads</th>
                    <th className="p-2 text-right">Cost / call</th>
                    <th className="p-2 text-right">Cost / QR</th>
                    <th className="p-2 text-right">Revenue</th>
                    <th className="p-2 text-right">GP</th>
                  </tr>
                </thead>
                <tbody>
                  {[...daily].reverse().map((r) => (
                    <tr key={r.date} className="border-t border-border">
                      <td className="p-2 whitespace-nowrap">{format(parseISO(r.date), "EEE MMM d")}</td>
                      <td className="p-2 text-right">{r.impressions.toLocaleString()}</td>
                      <td className="p-2 text-right">{money2(r.spend)}</td>
                      <td className="p-2 text-right">{r.calls || "—"}</td>
                      <td className="p-2 text-right">{r.qr || "—"}</td>
                      <td className="p-2 text-right font-medium">{r.leads || "—"}</td>
                      <td className="p-2 text-right">{r.calls ? money2(r.cpCall) : "—"}</td>
                      <td className="p-2 text-right">{r.qr ? money2(r.cpQr) : "—"}</td>
                      <td className="p-2 text-right">{money(r.revenue)}</td>
                      <td className={`p-2 text-right ${r.profit >= 0 ? "text-green-600" : "text-red-500"}`}>{money(r.profit)}</td>
                    </tr>
                  ))}
                  {!daily.length && (
                    <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No data in this date range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="hourly" className="space-y-4">
          {!hasHourlySpend && (
            <Card className="border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
              Hourly Roku delivery syncs automatically every 15 minutes (Roku's report has ~8h data latency, so the
              latest hours fill in as they become available). Hit <strong>Sync Roku hourly</strong> to pull now.
              {rokuConn?.sync_error ? ` Last sync issue: ${rokuConn.sync_error}` : ""}
            </Card>
          )}

          <Card className="p-4">
            <p className="mb-3 text-sm font-medium">Hour-of-day delivery vs leads</p>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={hourlyRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
                <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="l" dataKey="spend" name="Spend" fill="hsl(var(--primary))" opacity={0.7} radius={[3, 3, 0, 0]} />
                <Line yAxisId="r" type="monotone" dataKey="calls" name="Calls" stroke="#16a34a" strokeWidth={2} dot={{ r: 2 }} />
                <Line yAxisId="r" type="monotone" dataKey="qr" name="QR scans" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium">Leads by hour</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={hourlyRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={1} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} />
                <Bar dataKey="leads" name="Leads" fill="#16a34a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </TabsContent>

        <TabsContent value="stations">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Station</th>
                    <th className="p-2 text-left">Role</th>
                    <th className="p-2 text-right">Imps</th>
                    <th className="p-2 text-right">Spend</th>
                    <th className="p-2 text-right">Calls</th>
                    <th className="p-2 text-right">QR</th>
                    <th className="p-2 text-right">Leads</th>
                    <th className="p-2 text-right">Cost / lead</th>
                    <th className="p-2 text-right">Cost / call</th>
                    <th className="p-2 text-right">Cost / QR</th>
                    <th className="p-2 text-right">Revenue</th>
                    <th className="p-2 text-right">GP</th>
                  </tr>
                </thead>
                <tbody>
                  {stations.map((s) => (
                    <tr
                      key={s.station}
                      onClick={() => toggleStation(s.station)}
                      className={`cursor-pointer border-t border-border hover:bg-muted/40 ${stationFilter.includes(s.station) ? "bg-primary/5" : ""}`}
                    >
                      <td className="p-2 font-medium">{s.station}</td>
                      <td className="p-2 text-xs text-muted-foreground">{STATION_NOTES[s.station] || "—"}</td>
                      <td className="p-2 text-right">{s.impressions.toLocaleString()}</td>
                      <td className="p-2 text-right">{money2(s.spend)}</td>
                      <td className="p-2 text-right">{s.calls || "—"}</td>
                      <td className="p-2 text-right">{s.qr || "—"}</td>
                      <td className="p-2 text-right font-medium">{s.leads || "—"}</td>
                      <td className="p-2 text-right">{s.leads ? money2(s.cpl) : "—"}</td>
                      <td className="p-2 text-right">{s.calls ? money2(s.cpCall) : "—"}</td>
                      <td className="p-2 text-right">{s.qr ? money2(s.cpQr) : "—"}</td>
                      <td className="p-2 text-right">{money(s.revenue)}</td>
                      <td className={`p-2 text-right ${s.profit >= 0 ? "text-green-600" : "text-red-500"}`}>{money(s.profit)}</td>
                    </tr>
                  ))}
                  {!stations.length && (
                    <tr><td colSpan={12} className="p-6 text-center text-muted-foreground">No station data in range.</td></tr>
                  )}
                </tbody>
                {!!stations.length && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/40 font-medium">
                      <td className="p-2">Blended</td>
                      <td className="p-2 text-xs text-muted-foreground">All stations combined</td>
                      <td className="p-2 text-right">{blended.impressions.toLocaleString()}</td>
                      <td className="p-2 text-right">{money2(blended.spend)}</td>
                      <td className="p-2 text-right">{blended.calls}</td>
                      <td className="p-2 text-right">{blended.qr}</td>
                      <td className="p-2 text-right">{blended.leads}</td>
                      <td className="p-2 text-right">{money2(blended.cpl)}</td>
                      <td className="p-2 text-right">{money2(blended.cpCall)}</td>
                      <td className="p-2 text-right">{money2(blended.cpQr)}</td>
                      <td className="p-2 text-right">{money(blended.revenue)}</td>
                      <td className={`p-2 text-right ${blended.profit >= 0 ? "text-green-600" : "text-red-500"}`}>{money(blended.profit)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="border-t border-border p-3 text-xs text-muted-foreground">
              Click any station row to drill the whole dashboard into it (click again to remove). QR scans tagged
              CT13 are re-attributed to CT14 — the CT14 creative carried the wrong QR code.
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="leads">
          <Card className="overflow-hidden">
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Time</th>
                    <th className="p-2 text-left">Type</th>
                    <th className="p-2 text-left">Station</th>
                    <th className="p-2 text-left">TFN</th>
                    <th className="p-2 text-left">Caller</th>
                    <th className="p-2 text-left">Location</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-right">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l: JacuzziLead) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="p-2 whitespace-nowrap">{format(parseISO(l.transaction_date), "MMM d")}</td>
                      <td className="p-2 whitespace-nowrap">{l.transaction_time?.slice(0, 5) || "—"}</td>
                      <td className="p-2">
                        <Badge variant={l.lead_type === "qr" ? "secondary" : "outline"} className="text-[10px]">
                          {l.lead_type === "qr" ? "QR scan" : "Call"}
                        </Badge>
                      </td>
                      <td className="p-2">
                        {l.attributed_station}
                        {l.station_code && l.attributed_station !== l.station_code && (
                          <span className="ml-1 text-xs text-muted-foreground">(from {l.station_code})</span>
                        )}
                      </td>
                      <td className="p-2 text-xs">{l.toll_free_number || "—"}</td>
                      <td className="p-2 text-xs">{l.caller_ani || "—"}</td>
                      <td className="p-2 text-xs">{[l.billing_city, l.billing_state].filter(Boolean).join(", ") || "—"}</td>
                      <td className="p-2 text-xs">{l.call_status || "—"}</td>
                      <td className="p-2 text-right">{money(Number(l.payout_rate))}</td>
                    </tr>
                  ))}
                  {!leads.length && (
                    <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No recognized leads in range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="recon">
          <JacuzziReconciliation />
        </TabsContent>

        <TabsContent value="import" className="space-y-4">
          <Card className="p-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Import the client's recognized-lead sheet</p>
              <p className="text-xs text-muted-foreground">
                Copy the rows straight out of the Jacuzzi TM export (including the header row) and paste below.
                Calls and QR scans are detected automatically, CT13 QR scans roll into CT14, and payout is stamped
                from the rate in effect on each date. Re-pasting the same sheet updates rather than duplicates.
              </p>
            </div>
            <Textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="Telemarketer Code	Call Center Code	Client	Transaction ID	Transaction Date	Transaction Time	Record Type	Record Detail	…"
              className="h-48 font-mono text-xs"
            />
            <div className="flex items-center gap-3">
              <Button onClick={handleImport} disabled={!parsed.length || importing} className="gap-1.5">
                <Upload className="h-4 w-4" />
                {importing ? "Importing…" : `Import ${parsed.length || ""} leads`.trim()}
              </Button>
              {paste.trim() && !parsed.length && (
                <span className="text-xs text-red-500">Couldn't find Transaction ID / Transaction Date columns.</span>
              )}
              {!!parsed.length && (
                <span className="text-xs text-muted-foreground">
                  {parsed.filter((p) => p.lead_type === "call").length} calls ·{" "}
                  {parsed.filter((p) => p.lead_type === "qr").length} QR scans detected
                </span>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-sm font-medium">Payout rate history</p>
            <div className="space-y-1 text-sm">
              {rates.map((r) => (
                <div key={r.effective_from} className="flex justify-between border-b border-border py-1 last:border-0">
                  <span className="text-muted-foreground">From {format(parseISO(r.effective_from), "MMM d, yyyy")}</span>
                  <span className="font-medium">{money(Number(r.rate))} per call / QR scan</span>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
