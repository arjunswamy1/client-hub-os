import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  RefreshCw, Phone, DollarSign, TrendingUp, Target, PhoneCall, Blinds, Wrench,
  Chrome, Facebook, Plug, Info, Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  useMojaCalls, useRRMSpend, MojaCall, RRMCampaignRow, RRMLine,
  RRM_CLIENT_ID, classifyCampaign, callLine, callPlatform, callMetrics, CallMetrics, platformOfLine,
} from "@/hooks/useRRMData";
import { useRRMCallAttribution } from "@/hooks/useRRMDrillDown";
import RRMPlatformPanel from "@/components/dashboard/RRMPlatformPanel";
import RRMOptimizer from "@/components/dashboard/RRMOptimizer";
import RRMConnections from "@/components/dashboard/RRMConnections";

const fmtMoney = (n: number) =>
  n === 0 ? "$0" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtMoney2 = (n: number) => `$${n.toFixed(2)}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Only vertical-specific views — there is deliberately no blended mode. */
type SvcLine = RRMLine;

const LINE_META: Record<SvcLine, { label: string; platform: "meta" | "google"; icon: any; blurb: string; platformLabel: string; platformIcon: any }> = {
  windows: {
    label: "Windows", platform: "meta", icon: Blinds, blurb: "Meta Ads → Moja calls",
    platformLabel: "Meta · Windows", platformIcon: Facebook,
  },
  plumbing: {
    label: "Plumbing", platform: "google", icon: Wrench, blurb: "Google Ads → Moja calls",
    platformLabel: "Google · Plumbing", platformIcon: Chrome,
  },
};


function KPI({ label, value, sub, icon: Icon, tone }: {
  label: string; value: string; sub?: string; icon: any; tone?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={`mt-1 text-2xl font-semibold ${tone || ""}`}>{value}</p>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </Card>
  );
}

/** Full metric scorecard for the active service line only — no blended column. */
function LineScorecard({ line, metrics }: { line: SvcLine; metrics: CallMetrics }) {
  const meta = LINE_META[line];
  const Icon = meta.icon;
  const rows: { label: string; get: (m: CallMetrics) => string; hint?: string; tone?: (m: CallMetrics) => string }[] = [
    { label: "Media spend", get: (m) => fmtMoney(m.spend) },
    { label: "Raw calls", get: (m) => String(m.raw), hint: "Every call that rang" },
    { label: "Connected calls", get: (m) => `${m.connected} (${fmtPct(m.connectRate)})`, hint: "Reached a buyer" },
    { label: "Converted calls", get: (m) => `${m.converted} (${fmtPct(m.convRate)})`, hint: "Billable to the buyer" },
    { label: "Cost per raw call", get: (m) => (m.raw ? fmtMoney2(m.costPerRawCall) : "—") },
    { label: "Cost per connected call", get: (m) => (m.connected ? fmtMoney2(m.costPerConnectedCall) : "—") },
    { label: "Cost per converted call", get: (m) => (m.converted ? fmtMoney2(m.costPerConvertedCall) : "—") },
    { label: "Revenue per call", get: (m) => (m.raw ? fmtMoney2(m.revenuePerRawCall) : "—") },
    { label: "Revenue per connected call", get: (m) => (m.connected ? fmtMoney2(m.revenuePerConnectedCall) : "—") },
    { label: "Revenue", get: (m) => fmtMoney(m.revenue) },
    {
      label: "Gross profit",
      get: (m) => fmtMoney(m.profit),
      tone: (m) => (m.profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"),
    },
    { label: "ROAS", get: (m) => (m.spend ? `${m.roas.toFixed(2)}x` : "—") },
    { label: "Margin", get: (m) => (m.revenue ? fmtPct(m.margin) : "—") },
    { label: "Avg talk time", get: (m) => (m.connected ? fmtDuration(m.avgTalk) : "—") },
  ];

  return (
    <Card className="p-4">
      <h3 className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="h-3.5 w-3.5" /> {meta.platformLabel} performance
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Metric</TableHead>
            <TableHead className="text-right text-xs">{meta.platformLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell className="text-xs">
                {r.label}
                {r.hint && <span className="ml-1.5 text-[10px] text-muted-foreground">{r.hint}</span>}
              </TableCell>
              <TableCell className={`text-right text-xs font-medium ${r.tone?.(metrics) || ""}`}>
                {r.get(metrics)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}


export default function RRMDashboard() {
  const { data: calls = [], isLoading, refetch: refetchCalls } = useMojaCalls();
  const { data: spendRows = [], refetch: refetchSpend } = useRRMSpend();
  const attr = useRRMCallAttribution(calls);
  const [line, setLine] = useState<SvcLine>("windows");
  const [syncing, setSyncing] = useState(false);

  /** Spend rows that genuinely belong to RRM, tagged with their service line. */
  const rrmSpend = useMemo(
    () =>
      spendRows
        .map((r) => ({ row: r, line: classifyCampaign(r.campaign_name, r.platform) }))
        .filter((x): x is { row: RRMCampaignRow; line: RRMLine } => x.line !== "excluded"),
    [spendRows],
  );

  /** Spend sitting in the connected ad accounts that is not RRM at all. */
  const excluded = useMemo(() => {
    const names = new Map<string, number>();
    for (const r of spendRows) {
      if (classifyCampaign(r.campaign_name, r.platform) !== "excluded") continue;
      const key = r.campaign_name || "Unnamed campaign";
      names.set(key, (names.get(key) || 0) + Number(r.spend || 0));
    }
    return {
      total: Array.from(names.values()).reduce((s, v) => s + v, 0),
      names: Array.from(names.keys()),
    };
  }, [spendRows]);

  const scopedCalls = useMemo(() => calls.filter((c) => callLine(c) === line), [calls, line]);
  const scopedSpend = useMemo(
    () => rrmSpend.filter((x) => x.line === line).map((x) => x.row),
    [rrmSpend, line],
  );

  const kpi = useMemo(
    () => callMetrics(scopedCalls, scopedSpend.reduce((s, r) => s + Number(r.spend || 0), 0)),
    [scopedCalls, scopedSpend],
  );

  const lineCounts = useMemo(() => ({
    windows: calls.filter((c) => callLine(c) === "windows").length,
    plumbing: calls.filter((c) => callLine(c) === "plumbing").length,
  }), [calls]);


  const trend = useMemo(() => {
    const byDate = new Map<string, { spend: number; calls: number; revenue: number }>();
    const bump = (d: string) => byDate.get(d) || { spend: 0, calls: 0, revenue: 0 };
    for (const r of scopedSpend) {
      const row = bump(r.date);
      row.spend += Number(r.spend || 0);
      byDate.set(r.date, row);
    }
    for (const c of scopedCalls) {
      const d = c.call_start.slice(0, 10);
      const row = bump(d);
      row.calls += 1;
      row.revenue += Number(c.revenue || 0);
      byDate.set(d, row);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, v]) => ({
        date: format(new Date(`${date}T12:00:00`), "MMM d"),
        spend: Math.round(v.spend),
        revenue: Math.round(v.revenue),
        calls: v.calls,
      }));
  }, [scopedSpend, scopedCalls]);

  /**
   * Campaign performance. Moja stores its own internal campaign labels
   * ("RRM INTERNAL - Plumbing"), which never equal the ad platform campaign
   * names — so calls are joined through the UTM keyword/creative index, and any
   * call without UTMs is spread across the line's campaigns by spend share.
   */
  const campaigns = useMemo(() => {
    const map = new Map<string, {
      platform: string; line: RRMLine; spend: number; impressions: number; clicks: number; conversions: number;
    }>();
    for (const x of rrmSpend) {
      if (line !== "blended" && x.line !== line) continue;
      const key = x.row.campaign_name || "Unnamed campaign";
      const row = map.get(key) || {
        platform: x.row.platform, line: x.line, spend: 0, impressions: 0, clicks: 0, conversions: 0,
      };
      row.spend += Number(x.row.spend || 0);
      row.impressions += Number(x.row.impressions || 0);
      row.clicks += Number(x.row.clicks || 0);
      row.conversions += Number(x.row.conversions || 0);
      map.set(key, row);
    }

    const list = Array.from(map.entries()).map(([name, v]) => ({
      name, ...v, exact: attr.campaignCalls(name),
    }));

    return (["windows", "plumbing"] as RRMLine[])
      .flatMap((l) => {
        const inLine = list.filter((c) => c.line === l);
        if (!inLine.length) return [];
        const lineSpend = inLine.reduce((s, c) => s + c.spend, 0);
        const loose = attr.unattributed(l);
        const looseConnected = loose.filter((c) => c.connected).length;
        const looseConverted = loose.filter((c) => c.converted).length;
        const looseRevenue = loose.reduce((s, c) => s + Number(c.revenue || 0), 0);

        return inLine.map((c) => {
          const w = lineSpend > 0 ? c.spend / lineSpend : 1 / inLine.length;
          const m = callMetrics(c.exact, c.spend);
          const raw = m.raw + loose.length * w;
          const connected = m.connected + looseConnected * w;
          const converted = m.converted + looseConverted * w;
          const revenue = m.revenue + looseRevenue * w;
          return {
            ...c,
            exactCount: m.raw,
            modelled: loose.length * w,
            raw, connected, converted, revenue,
            costPerRaw: raw > 0 ? c.spend / raw : 0,
            costPerConnected: connected > 0 ? c.spend / connected : 0,
            revenuePerCall: raw > 0 ? revenue / raw : 0,
            profit: revenue - c.spend,
          };
        });
      })
      .sort((a, b) => b.spend - a.spend);
  }, [rrmSpend, line, attr]);

  const buyers = useMemo(() => {
    const map = new Map<string, MojaCall[]>();
    for (const c of scopedCalls) {
      const key = c.buyer_name || c.target_name || "Unattributed";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries())
      .map(([buyer, items]) => ({
        buyer,
        calls: items.length,
        connected: items.filter((c) => c.connected).length,
        converted: items.filter((c) => c.converted).length,
        revenue: items.reduce((s, c) => s + Number(c.revenue || 0), 0),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [scopedCalls]);

  const syncSpend = async () => {
    setSyncing(true);
    try {
      const results = await Promise.allSettled([
        supabase.functions.invoke("sync-meta-ads", { body: { client_id: RRM_CLIENT_ID } }),
        supabase.functions.invoke("sync-google-ads", { body: { client_id: RRM_CLIENT_ID } }),
      ]);
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed) toast.warning(`${failed} of 2 platform syncs failed — check the connection`);
      else toast.success("Meta + Google spend synced");
      await Promise.all([refetchSpend(), refetchCalls()]);
    } catch (e: any) {
      toast.error(e.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Service line switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Service line</span>
        {(Object.keys(LINE_META) as SvcLine[]).map((key) => {
          const meta = LINE_META[key];
          const Icon = meta.icon;
          return (
            <Button
              key={key}
              size="sm"
              variant={line === key ? "default" : "outline"}
              className="h-8 gap-1.5 text-xs"
              onClick={() => setLine(key)}
            >
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{lineCounts[key]}</Badge>
            </Button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{LINE_META[line].blurb}</span>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={syncSpend} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            Sync spend
          </Button>
        </div>
      </div>

      {excluded.total > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {fmtMoney(excluded.total)} of spend in the connected ad accounts is excluded from every RRM metric because it
            belongs to other campaigns: {excluded.names.join(", ")}.
          </span>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI label="Media spend" value={fmtMoney(kpi.spend)} sub={`${scopedSpend.length} campaign-days`} icon={DollarSign} />
        <KPI label="Raw calls" value={String(kpi.raw)} sub={`${kpi.connected} connected · ${fmtPct(kpi.connectRate)} connect rate`} icon={Phone} />
        <KPI label="Revenue" value={fmtMoney(kpi.revenue)} sub={`${kpi.converted} converted · ${fmtPct(kpi.convRate)} conv rate`} icon={TrendingUp} />
        <KPI
          label="Gross profit"
          value={fmtMoney(kpi.profit)}
          sub={kpi.spend > 0 ? `${kpi.roas.toFixed(2)}x ROAS · ${kpi.revenue ? fmtPct(kpi.margin) : "—"} margin` : "No spend yet"}
          icon={Target}
          tone={kpi.profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}
        />
        <KPI label="Cost / raw call" value={kpi.raw ? fmtMoney2(kpi.costPerRawCall) : "—"} sub="Spend ÷ all calls that rang" icon={PhoneCall} />
        <KPI label="Cost / connected call" value={kpi.connected ? fmtMoney2(kpi.costPerConnectedCall) : "—"} sub="Spend ÷ calls that reached a buyer" icon={PhoneCall} />
        <KPI label="Revenue / call" value={kpi.raw ? fmtMoney2(kpi.revenuePerRawCall) : "—"} sub={`${kpi.connected ? fmtMoney2(kpi.revenuePerConnectedCall) : "—"} per connected call`} icon={DollarSign} />
        <KPI label="Cost / converted call" value={kpi.converted ? fmtMoney2(kpi.costPerConvertedCall) : "—"} sub={`${fmtDuration(kpi.avgTalk)} avg talk time`} icon={Target} />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
          <TabsTrigger value="trend" className="text-xs">Trend</TabsTrigger>
          <TabsTrigger value="campaigns" className="text-xs">Campaigns</TabsTrigger>
          <TabsTrigger value="buyers" className="text-xs">Buyers</TabsTrigger>
          <TabsTrigger value="calls" className="text-xs">Call log</TabsTrigger>
          <TabsTrigger value="google" className="gap-1.5 text-xs">
            <Chrome className="h-3.5 w-3.5" /> Google · Plumbing
          </TabsTrigger>
          <TabsTrigger value="meta" className="gap-1.5 text-xs">
            <Facebook className="h-3.5 w-3.5" /> Meta · Windows
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-1.5 text-xs">
            <Plug className="h-3.5 w-3.5" /> Connections
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <LineComparison windows={windowsKpi} plumbing={plumbingKpi} blended={blendedKpi} />
          <Card className="p-4">
            <h3 className="mb-1 text-sm font-semibold">Call attribution coverage</h3>
            <p className="text-xs text-muted-foreground">
              {attr.attributedCount} of {attr.totalCount} calls in this range are matched to an exact keyword or creative
              through Moja's UTMs (Google: utm_term = keyword, Meta: utm_content = ad name). The remaining{" "}
              {attr.totalCount - attr.attributedCount} are attributed to their service line and spread across campaigns
              by share of spend, so line totals always reconcile with Moja.
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="google">
          <RRMPlatformPanel platform="google" />
        </TabsContent>
        <TabsContent value="meta">
          <RRMPlatformPanel platform="meta" />
        </TabsContent>
        <TabsContent value="connections">
          <RRMConnections />
        </TabsContent>

        <TabsContent value="trend">
          <Card className="p-4">
            <h3 className="mb-4 text-sm font-semibold">Spend vs calls &amp; revenue</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="spend" name="Spend" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="hsl(var(--chart-2, 142 71% 45%))" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="calls" name="Calls" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns">
          <Card className="p-4">
            <h3 className="mb-1 text-sm font-semibold">Campaign performance</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Calls joined to campaigns through Moja UTMs; counts marked with ~ include calls modelled from that
              campaign's share of the service line's spend. Open the Google or Meta tab to drill into keywords and creatives.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Campaign</TableHead>
                    <TableHead className="text-xs">Line</TableHead>
                    <TableHead className="text-right text-xs">Spend</TableHead>
                    <TableHead className="text-right text-xs">Impr.</TableHead>
                    <TableHead className="text-right text-xs">Clicks</TableHead>
                    <TableHead className="text-right text-xs">Raw calls</TableHead>
                    <TableHead className="text-right text-xs">Connected</TableHead>
                    <TableHead className="text-right text-xs">Cost / raw</TableHead>
                    <TableHead className="text-right text-xs">Cost / conn.</TableHead>
                    <TableHead className="text-right text-xs">Rev / call</TableHead>
                    <TableHead className="text-right text-xs">Revenue</TableHead>
                    <TableHead className="text-right text-xs">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center text-sm text-muted-foreground">
                        No RRM ad spend synced for this range yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {campaigns.map((c) => {
                    const approx = c.modelled > 0.05;
                    return (
                      <TableRow key={c.name}>
                        <TableCell className="max-w-[260px] truncate text-xs font-medium">{c.name}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="secondary" className="px-1 py-0 text-[10px] capitalize">{c.line}</Badge>
                          <span className="ml-1.5 capitalize text-muted-foreground">{c.platform}</span>
                        </TableCell>
                        <TableCell className="text-right text-xs">{fmtMoney(c.spend)}</TableCell>
                        <TableCell className="text-right text-xs">{c.impressions.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-xs">{c.clicks.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-xs">
                          {approx ? `~${c.raw.toFixed(1)}` : c.raw}
                          {c.exactCount > 0 && (
                            <span className="ml-1 text-[10px] text-muted-foreground">({c.exactCount} exact)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs">{approx ? c.connected.toFixed(1) : c.connected}</TableCell>
                        <TableCell className="text-right text-xs">{c.raw ? fmtMoney2(c.costPerRaw) : "—"}</TableCell>
                        <TableCell className="text-right text-xs">{c.connected ? fmtMoney2(c.costPerConnected) : "—"}</TableCell>
                        <TableCell className="text-right text-xs">{c.raw ? fmtMoney2(c.revenuePerCall) : "—"}</TableCell>
                        <TableCell className="text-right text-xs">{fmtMoney(c.revenue)}</TableCell>
                        <TableCell className={`text-right text-xs ${c.profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                          {fmtMoney(c.profit)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="buyers">
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Revenue by buyer</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer / target</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Connected</TableHead>
                  <TableHead className="text-right">Converted</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Avg payout</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      No Moja calls received for this range yet.
                    </TableCell>
                  </TableRow>
                )}
                {buyers.map((b) => (
                  <TableRow key={b.buyer}>
                    <TableCell className="font-medium">{b.buyer}</TableCell>
                    <TableCell className="text-right">{b.calls}</TableCell>
                    <TableCell className="text-right">{b.connected}</TableCell>
                    <TableCell className="text-right">{b.converted}</TableCell>
                    <TableCell className="text-right">{fmtMoney(b.revenue)}</TableCell>
                    <TableCell className="text-right">{b.converted ? fmtMoney2(b.revenue / b.converted) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="calls">
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Call log</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Caller</TableHead>
                  <TableHead>Line</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Keyword / creative</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead className="text-right">Talk</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={9} className="text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isLoading && scopedCalls.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      No calls yet — once the Moja webhook is saved, calls appear here in real time.
                    </TableCell>
                  </TableRow>
                )}
                {scopedCalls.slice(0, 200).map((c) => {
                  const isMeta = callPlatform(c) === "meta";
                  const detail = isMeta ? c.utm_content : c.utm_term;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {format(new Date(c.call_start), "MMM d, h:mm a")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {c.caller_number || "—"}
                        {c.caller_state ? <span className="ml-1 text-muted-foreground">({c.caller_state})</span> : null}
                      </TableCell>
                      <TableCell className="text-xs capitalize">{callLine(c)}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-xs">{c.campaign_name || "—"}</TableCell>
                      <TableCell className="max-w-[220px] text-xs">
                        {detail ? (
                          <div className="min-w-0">
                            <p className="truncate">{detail}</p>
                            <p className="text-[10px] text-muted-foreground">{isMeta ? "Meta creative" : "Google keyword"}</p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">No UTM</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{c.buyer_name || c.target_name || "—"}</TableCell>
                      <TableCell className="text-right text-xs">{fmtDuration(c.duration_seconds || 0)}</TableCell>
                      <TableCell>
                        <Badge variant={c.converted ? "default" : c.connected ? "secondary" : "outline"} className="text-[10px]">
                          {c.converted ? "Converted" : c.connected ? "Connected" : "No connect"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs">{fmtMoney2(Number(c.revenue || 0))}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
