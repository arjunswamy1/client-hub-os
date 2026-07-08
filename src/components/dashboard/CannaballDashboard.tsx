import { useMemo, useState } from "react";
import { useCannaballCalls, useCannaballSpend, CannaballCall, CANNABALL_CLIENT_ID } from "@/hooks/useCannaballData";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Phone, DollarSign, TrendingUp, PhoneCall, Target, Layers, FileText, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { toast } from "sonner";

const fmtMoney = (n: number) => n === 0 ? "$0" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtDuration = (s: number) => {
  if (!s) return "0:00";
  const m = Math.floor(s / 60); const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
};

function aggregate(calls: CannaballCall[], spend: number) {
  const total = calls.length;
  const connected = calls.filter((c) => c.connected).length;
  const revenue = calls.reduce((s, c) => s + Number(c.payout || 0), 0);
  const totalDuration = calls.reduce((s, c) => s + (c.connection_duration_seconds || c.duration_seconds || 0), 0);
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

export default function CannaballDashboard() {
  const { data: calls = [], isLoading: callsLoading, dataUpdatedAt, refetch: refetchCalls } = useCannaballCalls();
  const { data: spendRows = [], refetch: refetchSpend } = useCannaballSpend();
  const [uploading, setUploading] = useState(false);

  const totalSpend = useMemo(() => spendRows.reduce((s, r) => s + Number(r.spend || 0), 0), [spendRows]);
  const overall = useMemo(() => aggregate(calls, totalSpend), [calls, totalSpend]);

  const byCreative = useMemo(() => {
    const map = new Map<string, CannaballCall[]>();
    for (const c of calls) {
      const key = c.creative_name || "Unmapped";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries())
      .map(([creative, items]) => ({ creative, ...aggregate(items, 0) }))
      .sort((a, b) => b.connected - a.connected);
  }, [calls]);

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

  // Simple CSV upload for Roku spend: expects headers date, spend, impressions, clicks, campaign_name, creative_name
  const handleCsv = async (file: File) => {
    setUploading(true);
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      const headers = lines.shift()!.split(",").map((h) => h.trim().toLowerCase());
      const idx = (name: string) => headers.indexOf(name);
      const dateIdx = idx("date");
      const spendIdx = idx("spend");
      const impIdx = idx("impressions");
      const clkIdx = idx("clicks");
      const campIdx = idx("campaign_name");
      const creIdx = idx("creative_name");
      if (dateIdx < 0 || spendIdx < 0) throw new Error("CSV must include 'date' and 'spend' columns");

      const rows = lines.map((line) => {
        const cols = line.split(",").map((c) => c.trim());
        return {
          client_id: CANNABALL_CLIENT_ID,
          date: cols[dateIdx],
          platform: "roku",
          campaign_name: campIdx >= 0 ? cols[campIdx] || null : null,
          creative_name: creIdx >= 0 ? cols[creIdx] || null : null,
          spend: Number(cols[spendIdx] || 0),
          impressions: impIdx >= 0 ? Number(cols[impIdx] || 0) : 0,
          clicks: clkIdx >= 0 ? Number(cols[clkIdx] || 0) : 0,
        };
      }).filter((r) => r.date && !isNaN(new Date(r.date).getTime()));

      const { error } = await supabase.from("cannaball_spend" as any).upsert(rows as any, {
        onConflict: "client_id,date,platform,campaign_name,creative_name",
      });
      if (error) throw error;
      toast.success(`Imported ${rows.length} rows of Roku spend`);
      await refetchSpend();
    } catch (e: any) {
      toast.error(e.message || "CSV import failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Last synced: {lastSync}</p>
        <div className="flex gap-2">
          <label>
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleCsv(e.target.files[0])}
            />
            <Button asChild size="sm" variant="outline" disabled={uploading} className="gap-1.5">
              <span className="cursor-pointer"><Upload className="h-3.5 w-3.5" />{uploading ? "Uploading…" : "Upload Roku spend CSV"}</span>
            </Button>
          </label>
          <Button size="sm" variant="outline" onClick={() => { refetchCalls(); refetchSpend(); }} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

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

      <Tabs defaultValue="creative" className="space-y-3">
        <TabsList>
          <TabsTrigger value="creative" className="gap-1.5 text-xs"><Layers className="h-3.5 w-3.5" />Creative</TabsTrigger>
          <TabsTrigger value="trend" className="gap-1.5 text-xs"><TrendingUp className="h-3.5 w-3.5" />Trend</TabsTrigger>
          <TabsTrigger value="calls" className="gap-1.5 text-xs"><FileText className="h-3.5 w-3.5" />Call Log</TabsTrigger>
        </TabsList>

        <TabsContent value="creative">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Creative</th>
                  <th className="px-3 py-2 font-medium text-right">Calls</th>
                  <th className="px-3 py-2 font-medium text-right">Connected</th>
                  <th className="px-3 py-2 font-medium text-right">Connect %</th>
                  <th className="px-3 py-2 font-medium text-right">Avg Duration</th>
                  <th className="px-3 py-2 font-medium text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {byCreative.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No calls yet. CallGrid will populate this once the webhook is configured.</td></tr>
                ) : byCreative.map((r) => (
                  <tr key={r.creative} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.creative}</td>
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
                    <th className="px-3 py-2 font-medium">Caller</th>
                    <th className="px-3 py-2 font-medium">State</th>
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
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No calls yet. Configure the CallGrid webhook to start receiving calls.</td></tr>
                  ) : calls.slice(0, 500).map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-1.5 whitespace-nowrap">{format(new Date(c.call_start), "MMM d, HH:mm")}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{c.did || "—"}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{c.caller_number || "—"}</td>
                      <td className="px-3 py-1.5">{c.caller_state || "—"}</td>
                      <td className="px-3 py-1.5">{c.creative_name || "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtDuration(c.duration_seconds)}</td>
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
