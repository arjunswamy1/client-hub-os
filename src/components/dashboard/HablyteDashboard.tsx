import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { AlertTriangle, DollarSign, Layers, Phone, PhoneCall, Target, TrendingUp, FileText } from "lucide-react";
import {
  useHablyteCalls,
  useHablyteMetaSpend,
  useHablyteMetaFreshness,
  useHablytePublishers,
  verticalForCampaign,
  HABLYTE_VERTICALS,
  HablyteVertical,
  HablyteCall,
  HablyteSpendRow,
} from "@/hooks/useHablyteData";

const money = (n: number) =>
  (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const money2 = (n: number) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toFixed(2);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/**
 * Hablyte is an RTB (bid-per-call) account, so both RPC and cost per call use TOTAL
 * calls — that keeps no-bid losses visible instead of hiding them behind paid calls
 * only. Revenue comes from Ringba's reported payouts; nothing is assumed.
 */
const MIN_CALLS_RTB = 35; // {min_calls} at the RTB setting — below this, no verdict

/**
 * Revenue basis. Ringba records two different money fields: `payoutAmount` is what
 * the account owes an outside publisher, and `conversionAmount` is what the buyer
 * pays for the call. Our own traffic carries no publisher payout — we are the
 * publisher — so its revenue lives in the buyer amount. Take the buyer amount and
 * fall back to payout, never both, so no call is counted twice.
 */
const callRevenue = (c: HablyteCall) => ((c.revenue || 0) > 0 ? c.revenue : (c.payout || 0));

interface Agg {
  calls: number;
  connected: number;
  paid: number;
  revenue: number;
  spend: number;
  clicks: number;
  impressions: number;
}

function agg(calls: HablyteCall[], spend: number, clicks = 0, impressions = 0): Agg & {
  rpc: number; costPerCall: number; costPerPaidCall: number; marginPerCall: number;
  marginPct: number; profit: number; paidRate: number; connectRate: number; sufficient: boolean;
} {
  const total = calls.length;
  const connected = calls.filter((c) => c.connected === true).length;
  const paid = calls.filter((c) => callRevenue(c) > 0).length;
  const revenue = calls.reduce((s, c) => s + callRevenue(c), 0);
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

export default function HablyteDashboard() {
  const { data: calls = [], isLoading } = useHablyteCalls();
  const { data: spendRows = [] } = useHablyteMetaSpend();
  const { data: freshness } = useHablyteMetaFreshness();
  const { data: publishers = [] } = useHablytePublishers();

  const totalSpend = useMemo(() => spendRows.reduce((s, r) => s + (r.spend || 0), 0), [spendRows]);
  const totalClicks = useMemo(() => spendRows.reduce((s, r) => s + (r.clicks || 0), 0), [spendRows]);
  const totalImpr = useMemo(() => spendRows.reduce((s, r) => s + (r.impressions || 0), 0), [spendRows]);
  const overall = useMemo(() => agg(calls, totalSpend, totalClicks, totalImpr), [calls, totalSpend, totalClicks, totalImpr]);

  /** The core read: each vertical scored on its own Meta spend against its own calls. */
  const byVertical = useMemo(() => {
    const callBuckets = new Map<HablyteVertical, HablyteCall[]>();
    for (const c of calls) {
      const v = verticalForCampaign(c.campaign_name);
      if (!callBuckets.has(v)) callBuckets.set(v, []);
      callBuckets.get(v)!.push(c);
    }
    const spendBuckets = new Map<HablyteVertical, { spend: number; clicks: number; impressions: number }>();
    for (const r of spendRows) {
      const v = verticalForCampaign(r.campaign_name);
      const cur = spendBuckets.get(v) ?? { spend: 0, clicks: 0, impressions: 0 };
      cur.spend += r.spend || 0;
      cur.clicks += r.clicks || 0;
      cur.impressions += r.impressions || 0;
      spendBuckets.set(v, cur);
    }
    const names = new Set<HablyteVertical>([
      ...HABLYTE_VERTICALS,
      ...callBuckets.keys(),
      ...spendBuckets.keys(),
    ]);
    return [...names]
      .map((v) => {
        const s = spendBuckets.get(v) ?? { spend: 0, clicks: 0, impressions: 0 };
        return { vertical: v, ...agg(callBuckets.get(v) || [], s.spend, s.clicks, s.impressions) };
      })
      .filter((r) => r.calls > 0 || r.spend > 0)
      .sort((a, b) => b.spend - a.spend || b.calls - a.calls);
  }, [calls, spendRows]);

  const metaCampaigns = useMemo(() => {
    const map = new Map<string, { campaign: string; vertical: HablyteVertical; spend: number; clicks: number; impressions: number }>();
    for (const r of spendRows) {
      const key = r.campaign_name || "(unnamed)";
      const cur = map.get(key) ?? { campaign: key, vertical: verticalForCampaign(key), spend: 0, clicks: 0, impressions: 0 };
      cur.spend += r.spend || 0;
      cur.clicks += r.clicks || 0;
      cur.impressions += r.impressions || 0;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => b.spend - a.spend);
  }, [spendRows]);

  const ringbaCampaigns = useMemo(() => {
    const map = new Map<string, HablyteCall[]>();
    for (const c of calls) {
      const key = c.campaign_name || "(unnamed)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return [...map.entries()]
      .map(([campaign, items]) => ({ campaign, vertical: verticalForCampaign(campaign), ...agg(items, 0) }))
      .sort((a, b) => b.calls - a.calls);
  }, [calls]);

  /** Caller state — the read that tests a "the geography was wrong" explanation. */
  const byState = useMemo(() => {
    const map = new Map<string, HablyteCall[]>();
    for (const c of calls) {
      const st = ((c.metadata as Record<string, unknown> | null)?.state as string) || "Unknown";
      if (!map.has(st)) map.set(st, []);
      map.get(st)!.push(c);
    }
    return [...map.entries()]
      .map(([state, items]) => ({ state, ...agg(items, 0) }))
      .sort((a, b) => b.calls - a.calls);
  }, [calls]);

  const trend = useMemo(() => {
    const byDate = new Map<string, { date: string; calls: number; paid: number; spend: number; revenue: number }>();
    const row = (d: string) => byDate.get(d) ?? { date: d, calls: 0, paid: 0, spend: 0, revenue: 0 };
    for (const c of calls) {
      const d = c.call_date.slice(0, 10);
      const r = row(d);
      r.calls += 1;
      if (callRevenue(c) > 0) r.paid += 1;
      r.revenue += callRevenue(c);
      byDate.set(d, r);
    }
    for (const s of spendRows) {
      const r = row(s.date);
      r.spend += s.spend || 0;
      byDate.set(s.date, r);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [calls, spendRows]);

  const zeroRevenue = overall.calls > 0 && overall.revenue === 0;

  return (
    <div className="space-y-4">
      {/* What this read can and cannot say */}
      <Card className="border-l-4 border-l-primary p-4">
        <div className="flex items-start gap-2">
          <Layers className="mt-0.5 h-4 w-4 text-primary" />
          <div className="space-y-1 text-xs">
            <p className="text-sm font-semibold">Meta click-to-call, Ringba call tracking — campaign level</p>
            <p className="text-muted-foreground">
              Calls are scoped to {publishers.length ? publishers.map((p) => `"${p}"`).join(", ") : "no publisher yet"} in
              Ringba, so other publishers' traffic on the same account is excluded. The ads dial the number
              directly with no landing page, so no tracking tags exist and performance reads by vertical and
              campaign, never per individual ad.
            </p>
            <p className="text-muted-foreground">
              Bid-per-call account: revenue is what the buyer paid for the call as Ringba reports it, and both
              revenue per call and cost per call use every call, so unsold calls stay visible. Verticals under {MIN_CALLS_RTB} calls are marked
              as too thin to judge.
              {freshness?.last_synced_at
                ? ` Meta spend last pulled ${format(new Date(freshness.last_synced_at), "MMM d, HH:mm")}.`
                : ""}
            </p>
          </div>
        </div>
      </Card>

      {zeroRevenue && (
        <Card className="border-l-4 border-l-destructive p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
            <div className="text-xs">
              <p className="text-sm font-semibold text-destructive">No payout on any call in this window</p>
              <p className="text-muted-foreground">
                {overall.calls} calls from our buying, none paid by the buyer, against {money(overall.spend)} of Meta
                spend. That is a routing or qualification question for the client before any margin read means
                anything — not a media verdict.
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <KPI label="Meta spend" value={money(overall.spend)} sub={`${totalImpr.toLocaleString()} impressions`} icon={DollarSign} />
        <KPI label="Calls" value={overall.calls.toLocaleString()} sub={`${pct(overall.connectRate)} connected`} icon={Phone} />
        <KPI label="Paid calls" value={overall.paid.toLocaleString()} sub={`${pct(overall.paidRate)} of calls`} icon={PhoneCall} />
        <KPI label="Revenue" value={money(overall.revenue)} sub={`RPC ${money2(overall.rpc)}`} icon={TrendingUp} accent="text-primary" />
        <KPI label="Cost / call" value={money2(overall.costPerCall)} sub={overall.paid ? `${money2(overall.costPerPaidCall)} per paid call` : "no paid calls"} icon={Target} />
        <KPI
          label="Margin / call"
          value={money2(overall.marginPerCall)}
          sub={overall.revenue > 0 ? `${pct(overall.marginPct)} margin` : "no revenue recorded"}
          icon={FileText}
          accent={overall.marginPerCall >= 0 ? "text-primary" : "text-destructive"}
        />
      </div>

      <Tabs defaultValue="verticals" className="space-y-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 scrollbar-none">
          <TabsList className="inline-flex w-auto bg-secondary/50">
            <TabsTrigger value="verticals" className="text-xs">Verticals</TabsTrigger>
            <TabsTrigger value="meta" className="text-xs">Meta campaigns</TabsTrigger>
            <TabsTrigger value="ringba" className="text-xs">Ringba campaigns</TabsTrigger>
            <TabsTrigger value="states" className="text-xs">States</TabsTrigger>
            <TabsTrigger value="trend" className="text-xs">Trend</TabsTrigger>
            <TabsTrigger value="calls" className="text-xs">Call log</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="verticals">
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Vertical</th>
                  <th className="p-3 text-right">Spend</th>
                  <th className="p-3 text-right">Calls</th>
                  <th className="p-3 text-right">Connected</th>
                  <th className="p-3 text-right">Paid calls</th>
                  <th className="p-3 text-right">Revenue</th>
                  <th className="p-3 text-right">RPC</th>
                  <th className="p-3 text-right">Cost / call</th>
                  <th className="p-3 text-right">Cost / paid call</th>
                  <th className="p-3 text-right">Margin / call</th>
                  <th className="p-3 text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {byVertical.map((r) => (
                  <tr key={r.vertical} className={`border-b last:border-0 ${r.sufficient ? "" : "text-muted-foreground"}`}>
                    <td className="p-3 font-medium">
                      {r.vertical}
                      {!r.sufficient && (
                        <Badge variant="outline" className="ml-2 text-[10px]">too thin to judge</Badge>
                      )}
                    </td>
                    <td className="p-3 text-right">{money(r.spend)}</td>
                    <td className="p-3 text-right">{r.calls.toLocaleString()}</td>
                    <td className="p-3 text-right">{r.calls ? pct(r.connectRate) : "—"}</td>
                    <td className="p-3 text-right">{r.paid.toLocaleString()}</td>
                    <td className="p-3 text-right">{money(r.revenue)}</td>
                    <td className="p-3 text-right">{r.calls ? money2(r.rpc) : "—"}</td>
                    <td className="p-3 text-right">{r.calls ? money2(r.costPerCall) : "—"}</td>
                    <td className="p-3 text-right">{r.paid ? money2(r.costPerPaidCall) : "—"}</td>
                    <td className={`p-3 text-right ${r.calls && r.marginPerCall < 0 ? "text-destructive" : ""}`}>
                      {r.calls ? money2(r.marginPerCall) : "—"}
                    </td>
                    <td className={`p-3 text-right ${r.profit < 0 ? "text-destructive" : ""}`}>{money(r.profit)}</td>
                  </tr>
                ))}
                {byVertical.length === 0 && (
                  <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">
                    {isLoading ? "Loading…" : "No spend or calls in this window."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="meta">
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Meta campaign</th>
                  <th className="p-3 text-left">Vertical</th>
                  <th className="p-3 text-right">Spend</th>
                  <th className="p-3 text-right">Impressions</th>
                  <th className="p-3 text-right">Clicks</th>
                  <th className="p-3 text-right">CPC</th>
                  <th className="p-3 text-right">CTR</th>
                </tr>
              </thead>
              <tbody>
                {metaCampaigns.map((r) => (
                  <tr key={r.campaign} className="border-b last:border-0">
                    <td className="p-3">{r.campaign}</td>
                    <td className="p-3 text-muted-foreground">{r.vertical}</td>
                    <td className="p-3 text-right">{money(r.spend)}</td>
                    <td className="p-3 text-right">{r.impressions.toLocaleString()}</td>
                    <td className="p-3 text-right">{r.clicks.toLocaleString()}</td>
                    <td className="p-3 text-right">{r.clicks ? money2(r.spend / r.clicks) : "—"}</td>
                    <td className="p-3 text-right">{r.impressions ? pct(r.clicks / r.impressions) : "—"}</td>
                  </tr>
                ))}
                {metaCampaigns.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No Meta spend in this window.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="ringba">
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Ringba campaign</th>
                  <th className="p-3 text-left">Vertical</th>
                  <th className="p-3 text-right">Calls</th>
                  <th className="p-3 text-right">Connected</th>
                  <th className="p-3 text-right">Paid calls</th>
                  <th className="p-3 text-right">Revenue</th>
                  <th className="p-3 text-right">RPC</th>
                </tr>
              </thead>
              <tbody>
                {ringbaCampaigns.map((r) => (
                  <tr key={r.campaign} className="border-b last:border-0">
                    <td className="p-3">{r.campaign}</td>
                    <td className="p-3 text-muted-foreground">{r.vertical}</td>
                    <td className="p-3 text-right">{r.calls.toLocaleString()}</td>
                    <td className="p-3 text-right">{pct(r.connectRate)}</td>
                    <td className="p-3 text-right">{r.paid.toLocaleString()}</td>
                    <td className="p-3 text-right">{money(r.revenue)}</td>
                    <td className="p-3 text-right">{money2(r.rpc)}</td>
                  </tr>
                ))}
                {ringbaCampaigns.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No calls in this window.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="states">
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Caller state</th>
                  <th className="p-3 text-right">Calls</th>
                  <th className="p-3 text-right">Connected</th>
                  <th className="p-3 text-right">Sold</th>
                  <th className="p-3 text-right">Sold rate</th>
                  <th className="p-3 text-right">Revenue</th>
                  <th className="p-3 text-right">RPC</th>
                </tr>
              </thead>
              <tbody>
                {byState.map((r) => (
                  <tr key={r.state} className="border-b last:border-0">
                    <td className="p-3 font-medium">{r.state}</td>
                    <td className="p-3 text-right">{r.calls.toLocaleString()}</td>
                    <td className="p-3 text-right">{pct(r.connectRate)}</td>
                    <td className="p-3 text-right">{r.paid.toLocaleString()}</td>
                    <td className="p-3 text-right">{pct(r.paidRate)}</td>
                    <td className="p-3 text-right">{money(r.revenue)}</td>
                    <td className="p-3 text-right">{money2(r.rpc)}</td>
                  </tr>
                ))}
                {byState.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No calls in this window.</td></tr>
                )}
              </tbody>
            </table>
            <p className="p-3 text-xs text-muted-foreground">
              Buyer state acceptance is set per buyer in Ringba. Instar's static auto target accepts 22 states
              (AK, CT, GA, KY, MD, ME, MI, MN, MS, MT, NC, NH, OK, OR, PA, RI, TX, UT, VA, VT, WV, WY) and
              excludes NY and NJ — but the bidding buyers do take both, so a state outside one buyer's list is
              not automatically unsellable.
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="trend">
          <Card className="p-4">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="calls" name="Calls" fill="hsl(var(--primary))" />
                  <Bar yAxisId="left" dataKey="paid" name="Paid calls" fill="hsl(var(--muted-foreground))" />
                  <Line yAxisId="right" dataKey="spend" name="Meta spend" stroke="hsl(var(--destructive))" dot={false} />
                  <Line yAxisId="right" dataKey="revenue" name="Revenue" stroke="hsl(var(--primary))" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="calls">
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3 text-left">Time</th>
                  <th className="p-3 text-left">Vertical</th>
                  <th className="p-3 text-left">Campaign</th>
                  <th className="p-3 text-left">Caller</th>
                  <th className="p-3 text-left">Buyer</th>
                  <th className="p-3 text-right">Duration</th>
                  <th className="p-3 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {calls.slice(0, 300).map((c) => (
                  <tr key={c.call_id} className="border-b last:border-0">
                    <td className="p-3 whitespace-nowrap">{format(new Date(c.call_date), "MMM d, HH:mm")}</td>
                    <td className="p-3 text-muted-foreground">{verticalForCampaign(c.campaign_name)}</td>
                    <td className="p-3">{c.campaign_name || "—"}</td>
                    <td className="p-3">{c.caller_number || "—"}</td>
                    <td className="p-3">{c.target_name || "—"}</td>
                    <td className="p-3 text-right">{c.duration_seconds ?? 0}s</td>
                    <td className="p-3 text-right">{money2(callRevenue(c))}</td>
                  </tr>
                ))}
                {calls.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">
                    {isLoading ? "Loading…" : "No calls in this window."}
                  </td></tr>
                )}
              </tbody>
            </table>
            {calls.length > 300 && (
              <p className="p-3 text-xs text-muted-foreground">Showing the 300 most recent of {calls.length} calls.</p>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
