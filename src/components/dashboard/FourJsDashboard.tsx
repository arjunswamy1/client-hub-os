import { useMemo, useState } from "react";
import { useFourJsCalls, useFourJsSpend, triggerFourJsSync, FourJsCall } from "@/hooks/useFourJsData";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Phone, DollarSign, TrendingUp, PhoneCall, Target, Layers, FileText } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { toast } from "sonner";

const PLATFORMS = ["roku", "universal", "google_demand_gen"] as const;
const PLATFORM_LABELS: Record<string, string> = {
  roku: "Roku",
  universal: "Universal",
  google_demand_gen: "Google Demand Gen",
};

const fmtMoney = (n: number) => n === 0 ? "$0" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtDuration = (s: number) => {
  if (!s) return "0:00";
  const m = Math.floor(s / 60); const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
};
const safe = (n: number) => (isFinite(n) ? n : 0);

function aggregate(calls: FourJsCall[], spend: number) {
  const total = calls.length;
  const connected = calls.filter((c) => c.connected).length;
  const revenue = calls.reduce((s, c) => s + Number(c.payout || 0), 0);
  const totalDuration = calls.reduce((s, c) => s + (c.connection_duration_seconds || c.call_duration_seconds || 0), 0);
  return {
    calls: total,
    connected,
    connectRate: total ? connected / total : 0,
    revenue,
    spend,
    profit: revenue - spend,
    roas: spend > 0 ? revenue / spend : 0,
    cpc: total > 0 ? spend / total : 0,
    cpcConn: connected > 0 ? spend / connected : 0,
    avgDuration: connected > 0 ? Math.round(totalDuration / connected) : 0,
  };
}

function KPI({ label, value, sub, icon: Icon, accent }: any) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <Icon className={`h-4 w-4 ${accent || "text-muted-foreground"}`} />
      </div>
    </Card>
  );
}

export default function FourJsDashboard() {
  const { data: calls = [], isLoading: callsLoading, dataUpdatedAt, refetch: refetchCalls } = useFourJsCalls();
  const { data: spendRows = [], refetch: refetchSpend } = useFourJsSpend();
  const [syncing, setSyncing] = useState(false);

  const totalSpend = useMemo(() => spendRows.reduce((s, r) => s + Number(r.spend || 0), 0), [spendRows]);
  const overall = useMemo(() => aggregate(calls, totalSpend), [calls, totalSpend]);

  // Per-platform breakdown
  const byPlatform = useMemo(() => {
    return PLATFORMS.map((p) => {
      const c = calls.filter((x) => x.platform === p);
      const s = spendRows.filter((x) => x.platform === p).reduce((a, b) => a + Number(b.spend || 0), 0);
      return { platform: p, label: PLATFORM_LABELS[p], ...aggregate(c, s) };
    });
  }, [calls, spendRows]);

  // Per-creative
  const byCreative = useMemo(() => {
    const map = new Map<string, FourJsCall[]>();
    for (const c of calls) {
      const key = `${c.creative_name || "Unmapped"} · ${c.platform || "—"}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries())
      .map(([key, items]) => ({ key, creative: items[0].creative_name || "Unmapped", platform: items[0].platform, ...aggregate(items, 0) }))
      .sort((a, b) => b.connected - a.connected);
  }, [calls]);

  // Per-cluster
  const byCluster = useMemo(() => {
    const map = new Map<string, FourJsCall[]>();
    for (const c of calls) {
      const key = c.audience_cluster || "Unspecified";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries())
      .map(([cluster, items]) => ({ cluster, ...aggregate(items, 0) }))
      .sort((a, b) => b.connected - a.connected);
  }, [calls]);

  // Daily trend
  const trend = useMemo(() => {
    const byDate = new Map<string, { calls: number; spend: number }>();
    for (const c of calls) {
      const d = c.call_start.slice(0, 10);
      const row = byDate.get(d) || { calls: 0, spend: 0 };
      row.calls += 1;
      byDate.set(d, row);
    }
    for (const s of spendRows) {
      const row = byDate.get(s.date) || { calls: 0, spend: 0 };
      row.spend += Number(s.spend || 0);
      byDate.set(s.date, row);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, v]) => ({ date: format(new Date(date), "MMM d"), calls: v.calls, spend: Math.round(v.spend) }));
  }, [calls, spendRows]);

  const lastSync = dataUpdatedAt ? `${Math.round((Date.now() - dataUpdatedAt) / 60000)} min ago` : "—";

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { error } = await triggerFourJsSync(7);
      if (error) throw error;
      toast.success("Ringba sync complete");
      await Promise.all([refetchCalls(), refetchSpend()]);
    } catch (e: any) {
      toast.error(e.message || "Sync failed");
    } finally { setSyncing(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Last synced: {lastSync}</p>
        <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Refresh now"}
        </Button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KPI label="Spend" value={fmtMoney(overall.spend)} icon={DollarSign} accent="text-blue-500" />
        <KPI label="Calls" value={overall.calls.toLocaleString()} icon={Phone} accent="text-indigo-500" />
        <KPI label="Connected" value={overall.connected.toLocaleString()} sub={fmtPct(overall.connectRate)} icon={PhoneCall} accent="text-emerald-500" />
        <KPI label="Cost / Call" value={overall.cpc > 0 ? fmtMoney(overall.cpc) : "—"} icon={Target} />
        <KPI label="Cost / Conn." value={overall.cpcConn > 0 ? fmtMoney(overall.cpcConn) : "—"} icon={Target} />
        <KPI label="Revenue" value={fmtMoney(overall.revenue)} icon={DollarSign} accent="text-emerald-500" />
        <KPI label="Profit" value={fmtMoney(overall.profit)} icon={TrendingUp} accent={overall.profit >= 0 ? "text-emerald-500" : "text-destructive"} />
        <KPI label="ROAS" value={overall.roas > 0 ? `${overall.roas.toFixed(2)}x` : "—"} icon={TrendingUp} accent="text-blue-500" />
      </div>

      <Tabs defaultValue="platform" className="space-y-3">
        <TabsList>
          <TabsTrigger value="platform" className="gap-1.5 text-xs"><Layers className="h-3.5 w-3.5" />Platform</TabsTrigger>
          <TabsTrigger value="creative" className="gap-1.5 text-xs"><Layers className="h-3.5 w-3.5" />Creative</TabsTrigger>
          <TabsTrigger value="cluster" className="gap-1.5 text-xs"><Target className="h-3.5 w-3.5" />Cluster</TabsTrigger>
          <TabsTrigger value="trend" className="gap-1.5 text-xs"><TrendingUp className="h-3.5 w-3.5" />Trend</TabsTrigger>
          <TabsTrigger value="calls" className="gap-1.5 text-xs"><FileText className="h-3.5 w-3.5" />Call Log</TabsTrigger>
        </TabsList>

        <TabsContent value="platform">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Platform</th>
                  <th className="px-3 py-2 font-medium text-right">Spend</th>
                  <th className="px-3 py-2 font-medium text-right">Calls</th>
                  <th className="px-3 py-2 font-medium text-right">Connected</th>
                  <th className="px-3 py-2 font-medium text-right">Connect %</th>
                  <th className="px-3 py-2 font-medium text-right">Cost / Call</th>
                  <th className="px-3 py-2 font-medium text-right">Cost / Conn.</th>
                  <th className="px-3 py-2 font-medium text-right">Revenue</th>
                  <th className="px-3 py-2 font-medium text-right">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {byPlatform.map((r) => (
                  <tr key={r.platform} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.label}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.spend)}</td>
                    <td className="px-3 py-2 text-right">{r.calls}</td>
                    <td className="px-3 py-2 text-right">{r.connected}</td>
                    <td className="px-3 py-2 text-right">{fmtPct(r.connectRate)}</td>
                    <td className="px-3 py-2 text-right">{r.cpc > 0 ? fmtMoney(r.cpc) : "—"}</td>
                    <td className="px-3 py-2 text-right">{r.cpcConn > 0 ? fmtMoney(r.cpcConn) : "—"}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.revenue)}</td>
                    <td className="px-3 py-2 text-right">{r.roas > 0 ? `${r.roas.toFixed(2)}x` : "—"}</td>
                  </tr>
                ))}
                <tr className="border-t bg-muted/30 font-medium">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(overall.spend)}</td>
                  <td className="px-3 py-2 text-right">{overall.calls}</td>
                  <td className="px-3 py-2 text-right">{overall.connected}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(overall.connectRate)}</td>
                  <td className="px-3 py-2 text-right">{overall.cpc > 0 ? fmtMoney(overall.cpc) : "—"}</td>
                  <td className="px-3 py-2 text-right">{overall.cpcConn > 0 ? fmtMoney(overall.cpcConn) : "—"}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(overall.revenue)}</td>
                  <td className="px-3 py-2 text-right">{overall.roas > 0 ? `${overall.roas.toFixed(2)}x` : "—"}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="creative">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Creative</th>
                  <th className="px-3 py-2 font-medium">Platform</th>
                  <th className="px-3 py-2 font-medium text-right">Calls</th>
                  <th className="px-3 py-2 font-medium text-right">Connected</th>
                  <th className="px-3 py-2 font-medium text-right">Connect %</th>
                  <th className="px-3 py-2 font-medium text-right">Avg Duration</th>
                  <th className="px-3 py-2 font-medium text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {byCreative.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No calls yet for this period.</td></tr>
                ) : byCreative.map((r) => (
                  <tr key={r.key} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.creative}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.platform ? PLATFORM_LABELS[r.platform] : "—"}</td>
                    <td className="px-3 py-2 text-right">{r.calls}</td>
                    <td className="px-3 py-2 text-right">{r.connected}</td>
                    <td className="px-3 py-2 text-right">{fmtPct(r.connectRate)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtDuration(r.avgDuration)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="cluster">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Audience Cluster</th>
                  <th className="px-3 py-2 font-medium text-right">Calls</th>
                  <th className="px-3 py-2 font-medium text-right">Connected</th>
                  <th className="px-3 py-2 font-medium text-right">Connect %</th>
                  <th className="px-3 py-2 font-medium text-right">Avg Duration</th>
                  <th className="px-3 py-2 font-medium text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {byCluster.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No calls yet.</td></tr>
                ) : byCluster.map((r) => (
                  <tr key={r.cluster} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.cluster}</td>
                    <td className="px-3 py-2 text-right">{r.calls}</td>
                    <td className="px-3 py-2 text-right">{r.connected}</td>
                    <td className="px-3 py-2 text-right">{fmtPct(r.connectRate)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtDuration(r.avgDuration)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="trend">
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-medium">Daily Spend vs Calls</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="spend" orientation="left" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <YAxis yAxisId="calls" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="spend" dataKey="spend" name="Spend" fill="hsl(var(--primary))" opacity={0.5} />
                  <Line yAxisId="calls" type="monotone" dataKey="calls" name="Calls" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="calls">
          <Card className="overflow-hidden">
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">DID</th>
                    <th className="px-3 py-2 font-medium">State</th>
                    <th className="px-3 py-2 font-medium">Platform</th>
                    <th className="px-3 py-2 font-medium">Creative</th>
                    <th className="px-3 py-2 font-medium text-right">Duration</th>
                    <th className="px-3 py-2 font-medium text-right">Conn.</th>
                    <th className="px-3 py-2 font-medium text-right">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {callsLoading ? (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : calls.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No calls in this date range yet. Click "Refresh now" to pull from Ringba.</td></tr>
                  ) : calls.slice(0, 500).map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-1.5 whitespace-nowrap">{format(new Date(c.call_start), "MMM d, HH:mm")}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{c.did}</td>
                      <td className="px-3 py-1.5">{c.caller_state || "—"}</td>
                      <td className="px-3 py-1.5">{c.platform ? PLATFORM_LABELS[c.platform] : "—"}</td>
                      <td className="px-3 py-1.5">{c.creative_name || "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtDuration(c.call_duration_seconds)}</td>
                      <td className="px-3 py-1.5 text-right">{c.connected ? "✓" : "—"}</td>
                      <td className="px-3 py-1.5 text-right">{c.payout > 0 ? fmtMoney(c.payout) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
