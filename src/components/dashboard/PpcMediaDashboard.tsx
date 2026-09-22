import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { CALLGRID_REPORTING_TZ, reportingDay } from "@/lib/reportingDay";
import { AlertTriangle, DollarSign, Layers, MapPin, Phone, PhoneCall, Sparkles, Target, TrendingUp } from "lucide-react";
import PpcMetaPerformance from "@/components/dashboard/PpcMetaPerformance";
import {
  usePpcCalls,
  usePpcMetaSpend,
  usePpcMetaConnection,
  ppcVerticalForCampaign,
  PPC_VERTICALS,
  PpcVertical,
  PpcCall,
  PpcSpendRow,
} from "@/hooks/usePpcMediaData";

const money = (n: number) =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const money2 = (n: number) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toFixed(2);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * RTB setting: detecting a 40% difference between two angles needs 35 calls before a
 * verdict is allowed. Rows below this render greyed and labelled insufficient.
 */
const MIN_CALLS_RTB = 35;

interface Agg {
  calls: number;
  connected: number;
  paid: number;
  revenue: number;
  spend: number;
  clicks: number;
  impressions: number;
  rpc: number;
  costPerCall: number;
  costPerPaidCall: number;
  marginPerCall: number;
  marginPct: number;
  profit: number;
  paidRate: number;
  connectRate: number;
  sufficient: boolean;
}

/** Every number on this page comes from here, so no view can invent its own rule. */
function agg(calls: PpcCall[], spend: number, clicks = 0, impressions = 0): Agg {
  const total = calls.length;
  const connected = calls.filter(
    (c) => c.connected === true || (c.connection_duration_seconds || 0) > 0,
  ).length;
  const paid = calls.filter((c) => (c.payout || 0) > 0).length;
  const revenue = calls.reduce((s, c) => s + (c.payout || 0), 0);
  const rpc = total ? revenue / total : 0;
  const costPerCall = total ? spend / total : 0;
  return {
    calls: total, connected, paid, revenue, spend, clicks, impressions,
    rpc,
    costPerCall,
    costPerPaidCall: paid ? spend / paid : 0,
    marginPerCall: rpc - costPerCall,
    marginPct: revenue > 0 ? (revenue - spend) / revenue : 0,
    profit: revenue - spend,
    paidRate: total ? paid / total : 0,
    connectRate: total ? connected / total : 0,
    sufficient: total >= MIN_CALLS_RTB,
  };
}

function KPI({ label, value, sub, icon: Icon, accent }: {
  label: string; value: string; sub?: string; icon: typeof Phone; accent?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
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

export default function PpcMediaDashboard() {
  const { data: calls = [], isLoading } = usePpcCalls();
  const { data: spendRows = [] } = usePpcMetaSpend();
  const { data: connection } = usePpcMetaConnection();

  const totalSpend = useMemo(() => spendRows.reduce((s, r) => s + (r.spend || 0), 0), [spendRows]);
  const totalClicks = useMemo(() => spendRows.reduce((s, r) => s + (r.clicks || 0), 0), [spendRows]);
  const totalImpr = useMemo(() => spendRows.reduce((s, r) => s + (r.impressions || 0), 0), [spendRows]);
  const overall = useMemo(
    () => agg(calls, totalSpend, totalClicks, totalImpr),
    [calls, totalSpend, totalClicks, totalImpr],
  );

  const spendMissing = spendRows.length === 0;

  /** The core read: each of the four campaigns scored on its own spend and its own calls. */
  const byVertical = useMemo(() => {
    const callBuckets = new Map<PpcVertical, PpcCall[]>();
    for (const c of calls) {
      const v = ppcVerticalForCampaign(c.campaign_name);
      if (!callBuckets.has(v)) callBuckets.set(v, []);
      callBuckets.get(v)!.push(c);
    }
    const spendBuckets = new Map<PpcVertical, { spend: number; clicks: number; impressions: number }>();
    for (const r of spendRows) {
      const v = ppcVerticalForCampaign(r.campaign_name);
      const cur = spendBuckets.get(v) ?? { spend: 0, clicks: 0, impressions: 0 };
      cur.spend += r.spend || 0;
      cur.clicks += r.clicks || 0;
      cur.impressions += r.impressions || 0;
      spendBuckets.set(v, cur);
    }
    const names = new Set<PpcVertical>([...PPC_VERTICALS, ...callBuckets.keys(), ...spendBuckets.keys()]);
    return [...names].map((v) => {
      const s = spendBuckets.get(v) ?? { spend: 0, clicks: 0, impressions: 0 };
      return { vertical: v, ...agg(callBuckets.get(v) || [], s.spend, s.clicks, s.impressions) };
    }).sort((a, b) => b.spend - a.spend || b.calls - a.calls);
  }, [calls, spendRows]);

  const campaignRows = useMemo(() => {
    const callMap = new Map<string, PpcCall[]>();
    for (const c of calls) {
      const key = c.campaign_name || "(untagged)";
      if (!callMap.has(key)) callMap.set(key, []);
      callMap.get(key)!.push(c);
    }
    const spendMap = new Map<string, { spend: number; clicks: number; impressions: number }>();
    for (const r of spendRows) {
      const key = r.campaign_name || "(unnamed)";
      const cur = spendMap.get(key) ?? { spend: 0, clicks: 0, impressions: 0 };
      cur.spend += r.spend || 0;
      cur.clicks += r.clicks || 0;
      cur.impressions += r.impressions || 0;
      spendMap.set(key, cur);
    }
    const keys = new Set<string>([...callMap.keys(), ...spendMap.keys()]);
    return [...keys].map((k) => {
      const s = spendMap.get(k) ?? { spend: 0, clicks: 0, impressions: 0 };
      return {
        campaign: k,
        vertical: ppcVerticalForCampaign(k),
        ...agg(callMap.get(k) || [], s.spend, s.clicks, s.impressions),
      };
    }).sort((a, b) => b.spend - a.spend || b.calls - a.calls);
  }, [calls, spendRows]);

  const daily = useMemo(() => {
    const map = new Map<string, { date: string; calls: number; paid: number; revenue: number; spend: number }>();
    const touch = (d: string) => {
      if (!map.has(d)) map.set(d, { date: d, calls: 0, paid: 0, revenue: 0, spend: 0 });
      return map.get(d)!;
    };
    for (const c of calls) {
      const d = c.call_start ? reportingDay(c.call_start, CALLGRID_REPORTING_TZ) : "";
      if (!d) continue;
      const row = touch(d);
      row.calls += 1;
      if ((c.payout || 0) > 0) row.paid += 1;
      row.revenue += c.payout || 0;
    }
    for (const r of spendRows) touch(r.date).spend += r.spend || 0;
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({
      ...r,
      label: format(new Date(`${r.date}T12:00:00`), "MMM d"),
      rpc: r.calls ? r.revenue / r.calls : 0,
      costPerCall: r.calls ? r.spend / r.calls : 0,
    }));
  }, [calls, spendRows]);

  const byState = useMemo(() => {
    const map = new Map<string, PpcCall[]>();
    for (const c of calls) {
      const st = c.caller_state || "Unknown";
      if (!map.has(st)) map.set(st, []);
      map.get(st)!.push(c);
    }
    return [...map.entries()]
      .map(([state, items]) => ({ state, ...agg(items, 0) }))
      .sort((a, b) => b.calls - a.calls);
  }, [calls]);

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading PPC Media…</div>;
  }

  return (
    <div className="space-y-4">
      {spendMissing && (
        <Card className="border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/20">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-medium">No Meta spend in this window yet</p>
              <p className="mt-1 text-muted-foreground">
                Meta is connected{connection?.account_name ? ` as ${connection.account_name}` : ""}, but no ad
                account has been chosen for PPC Media, so spend isn't arriving.
                Pick it under Settings → Meta and the cost columns below fill in.
                Calls and payouts are live already; nothing here is estimated.
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI label="Calls" value={overall.calls.toLocaleString()} icon={Phone}
          sub={`${overall.paid.toLocaleString()} paid · ${pct(overall.paidRate)} paid rate`} />
        <KPI label="Revenue" value={money(overall.revenue)} icon={DollarSign} accent="text-emerald-600"
          sub={`RPC ${money2(overall.rpc)} on all calls`} />
        <KPI label="Spend" value={spendMissing ? "—" : money(overall.spend)} icon={Target}
          sub={spendMissing ? "awaiting Meta account" : `Cost per call ${money2(overall.costPerCall)}`} />
        <KPI
          label="Margin per call"
          value={spendMissing ? "—" : money2(overall.marginPerCall)}
          icon={TrendingUp}
          accent={spendMissing ? undefined : overall.marginPerCall >= 0 ? "text-emerald-600" : "text-red-600"}
          sub={spendMissing ? "needs spend to decide" : `${money(overall.profit)} profit · ${pct(overall.marginPct)} margin`}
        />
      </div>

      <Tabs defaultValue="verticals" className="space-y-4">
        <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-auto bg-secondary/50">
            <TabsTrigger value="verticals" className="gap-1.5 text-xs whitespace-nowrap">
              <Layers className="h-3.5 w-3.5" />The four campaigns
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="gap-1.5 text-xs whitespace-nowrap">
              <Target className="h-3.5 w-3.5" />Campaign detail
            </TabsTrigger>
            <TabsTrigger value="trend" className="gap-1.5 text-xs whitespace-nowrap">
              <TrendingUp className="h-3.5 w-3.5" />Daily
            </TabsTrigger>
            <TabsTrigger value="states" className="gap-1.5 text-xs whitespace-nowrap">
              <MapPin className="h-3.5 w-3.5" />Caller states
            </TabsTrigger>
            <TabsTrigger value="meta" className="gap-1.5 text-xs whitespace-nowrap">
              <Sparkles className="h-3.5 w-3.5" />Meta performance
            </TabsTrigger>
            <TabsTrigger value="calls" className="gap-1.5 text-xs whitespace-nowrap">
              <PhoneCall className="h-3.5 w-3.5" />Call log
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="meta">
          <PpcMetaPerformance />
        </TabsContent>


        <TabsContent value="verticals">
          <Card className="overflow-hidden">
            <div className="border-b p-4">
              <h3 className="text-sm font-semibold">Home and Auto, English and Spanish</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Bid-per-call, so revenue per call and cost per call both divide by every call — the calls the
                buyer didn't bid on stay visible. Under {MIN_CALLS_RTB} calls a row is too thin to rank.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">Campaign</th>
                    <th className="p-3 text-right">Calls</th>
                    <th className="p-3 text-right">Paid</th>
                    <th className="p-3 text-right">Paid rate</th>
                    <th className="p-3 text-right">Revenue</th>
                    <th className="p-3 text-right">RPC</th>
                    <th className="p-3 text-right">Spend</th>
                    <th className="p-3 text-right">Cost / call</th>
                    <th className="p-3 text-right">Margin / call</th>
                  </tr>
                </thead>
                <tbody>
                  {byVertical.map((r) => (
                    <tr key={r.vertical} className={`border-t ${r.sufficient ? "" : "text-muted-foreground"}`}>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{r.vertical}</span>
                          {!r.sufficient && (
                            <Badge variant="outline" className="text-[10px]">not enough calls</Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right">{r.calls.toLocaleString()}</td>
                      <td className="p-3 text-right">{r.paid.toLocaleString()}</td>
                      <td className="p-3 text-right">{pct(r.paidRate)}</td>
                      <td className="p-3 text-right">{money2(r.revenue)}</td>
                      <td className="p-3 text-right">{money2(r.rpc)}</td>
                      <td className="p-3 text-right">{r.spend > 0 ? money2(r.spend) : "—"}</td>
                      <td className="p-3 text-right">{r.spend > 0 ? money2(r.costPerCall) : "—"}</td>
                      <td className={`p-3 text-right font-medium ${r.spend > 0 ? (r.marginPerCall >= 0 ? "text-emerald-600" : "text-red-600") : ""}`}>
                        {r.spend > 0 ? money2(r.marginPerCall) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns">
          <Card className="overflow-hidden">
            <div className="border-b p-4">
              <h3 className="text-sm font-semibold">Every campaign name, both sides</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Meta spend and CallGrid calls are matched on the campaign name. A row with spend and no calls,
                or calls and no spend, is a naming or tracking gap rather than a result.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">Campaign</th>
                    <th className="p-3 text-left">Reads as</th>
                    <th className="p-3 text-right">Spend</th>
                    <th className="p-3 text-right">Clicks</th>
                    <th className="p-3 text-right">Calls</th>
                    <th className="p-3 text-right">Call rate</th>
                    <th className="p-3 text-right">Revenue</th>
                    <th className="p-3 text-right">Margin / call</th>
                  </tr>
                </thead>
                <tbody>
                  {campaignRows.map((r) => (
                    <tr key={r.campaign} className="border-t">
                      <td className="p-3 font-medium">{r.campaign}</td>
                      <td className="p-3 text-xs text-muted-foreground">{r.vertical}</td>
                      <td className="p-3 text-right">{r.spend > 0 ? money2(r.spend) : "—"}</td>
                      <td className="p-3 text-right">{r.clicks ? r.clicks.toLocaleString() : "—"}</td>
                      <td className="p-3 text-right">{r.calls.toLocaleString()}</td>
                      <td className="p-3 text-right">{r.clicks ? pct(r.calls / r.clicks) : "—"}</td>
                      <td className="p-3 text-right">{money2(r.revenue)}</td>
                      <td className={`p-3 text-right ${r.spend > 0 ? (r.marginPerCall >= 0 ? "text-emerald-600" : "text-red-600") : ""}`}>
                        {r.spend > 0 ? money2(r.marginPerCall) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="trend">
          <Card className="p-4">
            <h3 className="text-sm font-semibold">Calls, revenue and spend by day</h3>
            <div className="mt-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number, n) => (n === "Calls" || n === "Paid calls" ? v : money2(Number(v)))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="calls" name="Calls" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="left" dataKey="paid" name="Paid calls" fill="hsl(var(--primary) / 0.45)" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" dataKey="revenue" name="Revenue" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" dataKey="spend" name="Spend" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="states">
          <Card className="overflow-hidden">
            <div className="border-b p-4">
              <h3 className="text-sm font-semibold">Where the callers are</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Caller location from CallGrid. This is not the same measurement as where Meta served the
                impression, so the two are never added together.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">State</th>
                    <th className="p-3 text-right">Calls</th>
                    <th className="p-3 text-right">Paid</th>
                    <th className="p-3 text-right">Paid rate</th>
                    <th className="p-3 text-right">Revenue</th>
                    <th className="p-3 text-right">RPC</th>
                  </tr>
                </thead>
                <tbody>
                  {byState.map((r) => (
                    <tr key={r.state} className="border-t">
                      <td className="p-3 font-medium">{r.state}</td>
                      <td className="p-3 text-right">{r.calls.toLocaleString()}</td>
                      <td className="p-3 text-right">{r.paid.toLocaleString()}</td>
                      <td className="p-3 text-right">{pct(r.paidRate)}</td>
                      <td className="p-3 text-right">{money2(r.revenue)}</td>
                      <td className="p-3 text-right">{money2(r.rpc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="calls">
          <Card className="overflow-hidden">
            <div className="border-b p-4">
              <h3 className="text-sm font-semibold">Call log</h3>
              <p className="mt-1 text-xs text-muted-foreground">Most recent 200 calls as CallGrid delivered them.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">Time</th>
                    <th className="p-3 text-left">Campaign</th>
                    <th className="p-3 text-left">Caller</th>
                    <th className="p-3 text-left">State</th>
                    <th className="p-3 text-right">Duration</th>
                    <th className="p-3 text-right">Payout</th>
                    <th className="p-3 text-left">Disposition</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.slice(0, 200).map((c) => (
                    <tr key={c.call_id} className="border-t">
                      <td className="p-3 whitespace-nowrap">
                        {format(new Date(c.call_start), "MMM d, HH:mm")}
                      </td>
                      <td className="p-3 text-xs">{c.campaign_name || "(untagged)"}</td>
                      <td className="p-3">{c.caller_number || "—"}</td>
                      <td className="p-3">{c.caller_state || "—"}</td>
                      <td className="p-3 text-right">{c.duration_seconds ?? 0}s</td>
                      <td className={`p-3 text-right ${(c.payout || 0) > 0 ? "font-medium text-emerald-600" : ""}`}>
                        {(c.payout || 0) > 0 ? money2(c.payout) : "—"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{c.disposition || "—"}</td>
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
