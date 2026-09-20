import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RefreshCw, Phone, DollarSign, TrendingUp, PhoneCall, Target, Layers, FileText, Plug, MapPin,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import SpektrafinSetup from "./SpektrafinSetup";
import {
  useSpektrafinCalls,
  useSpektrafinRokuSpend,
  useSpektrafinRokuFreshness,
  SpektrafinCall,
} from "@/hooks/useSpektrafinData";

const fmtMoney = (n: number) => (n < 0 ? `-$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const fmtMoney2 = (n: number) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`);
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtDuration = (s: number) => {
  if (!s) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Spektrafin payout terms, confirmed by AJ: $16 per CONVERTED call — not per raw
 * call. It was $23 until 2026-09-09. Roughly three calls in four convert; the rest
 * earn nothing. Kept for reference only: revenue is READ from RingFuel's own
 * revenue field, never multiplied out here, and conversion is NEVER inferred from
 * duration (converted and non-converted calls overlap completely on duration).
 */
export const SPEKTRAFIN_PAYOUT_PER_CONVERTED_CALL = 16;

/** Revenue arrived for this call, as opposed to simply not having been sent. */
const captured = (c: SpektrafinCall) => c.revenue_captured !== false;

function aggregate(calls: SpektrafinCall[], spend: number) {
  const total = calls.length;
  const connected = calls.filter((c) => c.connected === true).length;

  // ABSENT IS NOT ZERO. Rows the live webhook delivered carry no revenue field, so
  // they are excluded from revenue and counted separately — reading them as $0
  // would turn a roughly break-even account into a fabricated catastrophe.
  const withRevenue = calls.filter(captured);
  const uncaptured = total - withRevenue.length;
  const revenue = withRevenue.reduce((s, c) => s + Number(c.revenue || 0), 0);
  const convertedCalls = withRevenue.filter((c) => c.converted === true).length;

  const duration = calls.reduce((s, c) => s + (c.connection_duration_seconds || c.duration_seconds || 0), 0);
  // Revenue-denominated reads cover only the calls whose revenue we actually have.
  const rpc = withRevenue.length ? revenue / withRevenue.length : null;
  const costPerCall = total ? spend / total : 0;
  const revenueComplete = uncaptured === 0 && total > 0;
  return {
    calls: total,
    connected,
    connectRate: total ? connected / total : 0,
    callsWithRevenue: withRevenue.length,
    uncapturedRevenueCalls: uncaptured,
    revenueComplete,
    convertedCalls,
    conversionRate: withRevenue.length ? convertedCalls / withRevenue.length : null,
    revenue,
    spend,
    // Profit and margin are published ONLY when every call's revenue is known.
    profit: revenueComplete ? revenue - spend : null,
    rpc,
    costPerCall,
    costPerConvertedCall: convertedCalls ? spend / convertedCalls : 0,
    marginPerCall: revenueComplete && rpc !== null ? rpc - costPerCall : null,
    marginPct: revenueComplete && revenue > 0 ? (revenue - spend) / revenue : null,
    avgDuration: connected ? Math.round(duration / connected) : 0,
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

export default function SpektrafinDashboard() {
  const { data: calls = [], isLoading, dataUpdatedAt, refetch: refetchCalls } = useSpektrafinCalls();
  const { data: spendRows = [], refetch: refetchSpend } = useSpektrafinRokuSpend();
  const { data: rokuFreshness, refetch: refetchFreshness } = useSpektrafinRokuFreshness();

  const totalSpend = useMemo(() => spendRows.reduce((s, r) => s + r.spend, 0), [spendRows]);
  const overall = useMemo(() => aggregate(calls, totalSpend), [calls, totalSpend]);

  const byCreative = useMemo(() => {
    const map = new Map<string, SpektrafinCall[]>();
    for (const c of calls) {
      const key = c.creative_label || "Unmapped number";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries())
      .map(([creative, items]) => ({ creative, ...aggregate(items, 0) }))
      .sort((a, b) => b.revenue - a.revenue || b.calls - a.calls);
  }, [calls]);

  const byCampaign = useMemo(() => {
    const map = new Map<string, { campaign: string; spend: number; impressions: number; completions: number }>();
    for (const r of spendRows) {
      const campaign = r.campaign_name || r.entity_name || r.entity_uid;
      const cur = map.get(campaign) ?? { campaign, spend: 0, impressions: 0, completions: 0 };
      cur.spend += r.spend;
      cur.impressions += r.impressions;
      cur.completions += r.video_completions;
      map.set(campaign, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
  }, [spendRows]);

  const trend = useMemo(() => {
    const byDate = new Map<string, { calls: number; converted: number; spend: number; revenue: number; uncaptured: number }>();
    const row = (d: string) => byDate.get(d) ?? { calls: 0, converted: 0, spend: 0, revenue: 0, uncaptured: 0 };
    for (const c of calls) {
      const d = prDay(c.call_start);
      const r = row(d);
      r.calls += 1;
      // Days RingFuel never reported revenue for show calls and spend but no
      // revenue bar — a gap in what we were told, not a day that earned nothing.
      if (captured(c)) {
        r.revenue += Number(c.revenue || 0);
        if (c.converted === true) r.converted += 1;
      } else {
        r.uncaptured += 1;
      }
      byDate.set(d, r);
    }
    for (const s of spendRows) {
      const r = row(s.date);
      r.spend += s.spend;
      byDate.set(s.date, r);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, v]) => ({
        date: format(new Date(`${date}T00:00:00`), "MMM d"),
        calls: v.calls,
        converted: v.converted,
        spend: Math.round(v.spend),
        revenue: v.uncaptured === v.calls && v.calls > 0 ? null : Math.round(v.revenue),
        revenueUnknownCalls: v.uncaptured,
      }));
  }, [calls, spendRows]);

  const byState = useMemo(() => {
    const map = new Map<string, SpektrafinCall[]>();
    for (const c of calls) {
      const key = c.caller_state || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries())
      .map(([state, items]) => ({ state, ...aggregate(items, 0) }))
      .sort((a, b) => b.calls - a.calls);
  }, [calls]);

  const lastSync = dataUpdatedAt ? `${Math.round((Date.now() - dataUpdatedAt) / 60000)} min ago` : "—";
  const spendAge = rokuFreshness?.last_synced_at
    ? `${Math.round((Date.now() - new Date(rokuFreshness.last_synced_at).getTime()) / 60000)} min ago`
    : "never pulled";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Roku spend (pulled {spendAge}) · RingFuel calls (Puerto Rico time, matching RingFuel) · revenue at $16 per raw call — screen updated {lastSync}
        </p>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { refetchCalls(); refetchSpend(); refetchFreshness(); }}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KPI label="Spend" value={fmtMoney(overall.spend)} icon={DollarSign} accent="text-blue-500" />
        <KPI label="Calls" value={overall.calls.toLocaleString()} icon={Phone} accent="text-indigo-500" />
        <KPI label="Connected" value={overall.connected.toLocaleString()} sub={fmtPct(overall.connectRate)} icon={PhoneCall} accent="text-emerald-500" />
        <KPI label="Paid calls" value={overall.paid.toLocaleString()} sub="$16 per raw call" icon={Target} />
        <KPI label="Revenue" value={fmtMoney(overall.revenue)} sub={`RPC ${fmtMoney2(overall.rpc)}`} icon={DollarSign} accent="text-emerald-500" />
        <KPI label="Cost / call" value={overall.costPerCall > 0 ? fmtMoney2(overall.costPerCall) : "—"} sub={overall.costPerPaidCall > 0 ? `${fmtMoney2(overall.costPerPaidCall)} per paid call` : undefined} icon={Target} />
        <KPI label="Margin / call" value={overall.calls ? fmtMoney2(overall.marginPerCall) : "—"} sub={overall.revenue > 0 ? fmtPct(overall.marginPct) : undefined} icon={TrendingUp} accent={overall.marginPerCall >= 0 ? "text-emerald-500" : "text-destructive"} />
        <KPI label="Profit" value={fmtMoney(overall.profit)} icon={TrendingUp} accent={overall.profit >= 0 ? "text-emerald-500" : "text-destructive"} />
      </div>

      <Tabs defaultValue="creative" className="space-y-3">
        <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-none">
          <TabsList>
            <TabsTrigger value="creative" className="gap-1.5 text-xs"><Layers className="h-3.5 w-3.5" />Creative</TabsTrigger>
            <TabsTrigger value="campaigns" className="gap-1.5 text-xs"><DollarSign className="h-3.5 w-3.5" />Roku campaigns</TabsTrigger>
            <TabsTrigger value="trend" className="gap-1.5 text-xs"><TrendingUp className="h-3.5 w-3.5" />Trend</TabsTrigger>
            <TabsTrigger value="geo" className="gap-1.5 text-xs"><MapPin className="h-3.5 w-3.5" />Geo</TabsTrigger>
            <TabsTrigger value="calls" className="gap-1.5 text-xs"><FileText className="h-3.5 w-3.5" />Call log</TabsTrigger>
            <TabsTrigger value="setup" className="gap-1.5 text-xs"><Plug className="h-3.5 w-3.5" />Setup</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="creative">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Creative</th>
                  <th className="px-3 py-2 text-right font-medium">Calls</th>
                  <th className="px-3 py-2 text-right font-medium">Connected</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Connect rate</th>
                  <th className="px-3 py-2 text-right font-medium">Avg duration</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">RPC</th>
                </tr>
              </thead>
              <tbody>
                {byCreative.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                    No calls yet. Once RingFuel posts calls to the webhook on the Setup tab, each tracking number lands here as its creative.
                  </td></tr>
                ) : byCreative.map((r) => (
                  <tr key={r.creative} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.creative}</td>
                    <td className="px-3 py-2 text-right">{r.calls}</td>
                    <td className="px-3 py-2 text-right">{r.connected}</td>
                    <td className="px-3 py-2 text-right">{r.paid}</td>
                    <td className="px-3 py-2 text-right">{fmtPct(r.connectRate)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtDuration(r.avgDuration)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.revenue)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney2(r.rpc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Roku campaign</th>
                  <th className="px-3 py-2 text-right font-medium">Spend</th>
                  <th className="px-3 py-2 text-right font-medium">Impressions</th>
                  <th className="px-3 py-2 text-right font-medium">Completions</th>
                  <th className="px-3 py-2 text-right font-medium">CPM</th>
                </tr>
              </thead>
              <tbody>
                {byCampaign.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    No Roku delivery synced for this range — link the Roku account and sync on the Setup tab.
                  </td></tr>
                ) : byCampaign.map((r) => (
                  <tr key={r.campaign} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.campaign}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney2(r.spend)}</td>
                    <td className="px-3 py-2 text-right">{r.impressions.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{r.completions.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{r.impressions > 0 ? fmtMoney2((r.spend / r.impressions) * 1000) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="trend">
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-medium">Daily spend, revenue and calls</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="money" orientation="left" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <YAxis yAxisId="calls" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="money" dataKey="spend" name="Spend" fill="hsl(var(--primary))" opacity={0.5} />
                  <Bar yAxisId="money" dataKey="revenue" name="Revenue" fill="hsl(var(--chart-2, var(--primary)))" opacity={0.7} />
                  <Line yAxisId="calls" type="monotone" dataKey="calls" name="Calls" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                  <Line yAxisId="calls" type="monotone" dataKey="paid" name="Paid calls" stroke="hsl(var(--muted-foreground))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="geo">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 text-right font-medium">Calls</th>
                  <th className="px-3 py-2 text-right font-medium">Connected</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">RPC</th>
                </tr>
              </thead>
              <tbody>
                {byState.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No calls yet.</td></tr>
                ) : byState.map((r) => (
                  <tr key={r.state} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.state}</td>
                    <td className="px-3 py-2 text-right">{r.calls}</td>
                    <td className="px-3 py-2 text-right">{r.connected}</td>
                    <td className="px-3 py-2 text-right">{r.paid}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.revenue)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney2(r.rpc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="calls">
          <Card className="overflow-hidden">
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Number</th>
                    <th className="px-3 py-2 font-medium">Creative</th>
                    <th className="px-3 py-2 font-medium">Caller</th>
                    <th className="px-3 py-2 font-medium">State</th>
                    <th className="px-3 py-2 font-medium">Buyer</th>
                    <th className="px-3 py-2 text-right font-medium">Duration</th>
                    <th className="px-3 py-2 text-right font-medium">Conn.</th>
                    <th className="px-3 py-2 text-right font-medium">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : calls.length === 0 ? (
                    <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                      No calls in this range yet.
                    </td></tr>
                  ) : calls.slice(0, 500).map((c) => (
                    <tr key={c.id} className="border-t hover:bg-muted/30">
                      <td className="px-3 py-1.5 whitespace-nowrap">{prTime(c.call_start)}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{c.did || "—"}</td>
                      <td className="px-3 py-1.5">{c.creative_label || "—"}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{c.caller_number || "—"}</td>
                      <td className="px-3 py-1.5">{c.caller_state || "—"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{c.buyer_name || c.target_name || "—"}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{fmtDuration(c.duration_seconds)}</td>
                      <td className="px-3 py-1.5 text-right">{c.connected === true ? "✓" : c.connected === false ? "—" : "?"}</td>
                      <td className="px-3 py-1.5 text-right">{fmtMoney2(SPEKTRAFIN_PAYOUT_PER_RAW_CALL)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="setup">
          <SpektrafinSetup />
        </TabsContent>
      </Tabs>
    </div>
  );
}
