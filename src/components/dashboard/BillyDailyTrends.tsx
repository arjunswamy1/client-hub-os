import { useState, useEffect } from "react";
import { useBillyDailyTrends, DailyFunnelRow } from "@/hooks/useBillyDailyTrends";
import { useVertical } from "@/contexts/VerticalContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Bar, Area,
} from "recharts";
import { AlertTriangle, Brain, TrendingUp, ArrowUpRight, ArrowDownRight } from "lucide-react";

/* ─── Delta Badge ─── */
function DeltaBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const isPositive = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${isPositive ? "text-emerald-600" : "text-red-500"}`}>
      {isPositive ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
      {value >= 0 ? "+" : ""}{value}%
    </span>
  );
}

/* ─── AI Insights ─── */
function AlertSummary({ latest }: { latest: DailyFunnelRow | undefined }) {
  const [insights, setInsights] = useState<{ steps: { title: string; bullets: string[] }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!latest || !latest.date) return;
    setLoading(true);
    setError(null);

    const steps = [
      {
        title: "Step 1 — Traffic",
        metrics: [
          { label: "Spend", value: `$${latest.spend}`, delta: latest.deltas.spend },
          { label: "CPC", value: `$${latest.cpc.toFixed(3)}`, delta: latest.deltas.cpc },
          { label: "CTR", value: `${latest.ctr}%`, delta: latest.deltas.ctr },
          { label: "Clicks", value: latest.clicks.toString(), delta: latest.deltas.clicks },
        ],
      },
      {
        title: "Step 2 — Landing Page",
        metrics: [
          { label: "LP CVR", value: `${latest.lpCvr}%`, delta: latest.deltas.lpCvr },
          { label: "RPV", value: `$${latest.rpv.toFixed(2)}`, delta: latest.deltas.rpv },
        ],
      },
      {
        title: "Step 3 — Call Processing",
        metrics: [
          { label: "Total Calls", value: latest.totalCalls.toString(), delta: latest.deltas.totalCalls },
          { label: "Connect Rate", value: `${latest.connectRate}%`, delta: latest.deltas.connectRate },
          { label: "Conv Rate", value: `${latest.conversionRate}%`, delta: latest.deltas.conversionRate },
        ],
      },
      {
        title: "Step 4 — Monetization",
        metrics: [
          { label: "Call Revenue", value: `$${latest.callRevenue}`, delta: latest.deltas.callRevenue },
          { label: "Call ROAS", value: `${latest.callROAS}x`, delta: latest.deltas.callROAS },
          { label: "Profit", value: `$${latest.profit}`, delta: latest.deltas.profit },
        ],
      },
    ];

    supabase.functions
      .invoke("billy-daily-insights", { body: { steps } })
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setInsights(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [latest?.date]);

  if (loading) return <Skeleton className="h-32 rounded-xl" />;
  if (error) return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30">
      <CardContent className="p-4 text-xs text-muted-foreground">AI insights unavailable: {error}</CardContent>
    </Card>
  );
  if (!insights) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Brain className="h-4 w-4 text-primary" />
          AI Daily Insights — {latest?.dateLabel}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.steps.map((step, i) => (
          <div key={i} className="rounded-lg border p-3">
            <p className="text-xs font-semibold mb-1">{step.title}</p>
            <ul className="space-y-1">
              {step.bullets.map((b, j) => (
                <li key={j} className="text-[11px] text-muted-foreground leading-relaxed">• {b}</li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ─── Trend Charts ─── */
function TrendCharts({ data }: { data: DailyFunnelRow[] }) {
  const chartStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* CPC vs RPV */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">CPC vs RPV (Scalability)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={chartStyle} />
              <Line type="monotone" dataKey="cpc" name="CPC" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="rpv" name="RPV" stroke="hsl(142, 71%, 45%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Conversion Rates */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Conversion Rates</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={chartStyle} />
              <Line type="monotone" dataKey="lpCvr" name="LP CVR" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="connectRate" name="Connect %" stroke="hsl(45, 93%, 47%)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Daily Call ROAS */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Daily Call ROAS</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}x`} />
              <Tooltip contentStyle={chartStyle} />
              <Bar dataKey="callROAS" name="Call ROAS" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} opacity={0.8} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Daily Profit */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Daily Profit ($)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="dateLabel" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={chartStyle} />
              <Area
                type="monotone"
                dataKey="profit"
                name="Profit"
                stroke="hsl(142, 71%, 45%)"
                fill="hsl(142, 71%, 45%)"
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─── Daily Table ─── */
function DailyTable({ data, tab }: { data: DailyFunnelRow[]; tab: string }) {
  type ColDef = { key: keyof DailyFunnelRow; label: string; format?: (v: any) => string };

  const trafficCols: ColDef[] = [
    { key: "spend", label: "Spend", format: (v) => `$${v.toLocaleString()}` },
    { key: "clicks", label: "Clicks", format: (v) => v.toLocaleString() },
    { key: "cpc", label: "CPC", format: (v) => `$${v.toFixed(3)}` },
    { key: "ctr", label: "CTR", format: (v) => `${v}%` },
    { key: "cpm", label: "CPM", format: (v) => `$${v.toFixed(2)}` },
    { key: "impressions", label: "Impr.", format: (v) => v.toLocaleString() },
  ];
  const lpCols: ColDef[] = [
    { key: "visitors", label: "Visitors", format: (v) => v.toLocaleString() },
    { key: "ctaClicks", label: "CTA Clicks", format: (v) => v.toLocaleString() },
    { key: "lpCvr", label: "LP CVR", format: (v) => `${v}%` },
    { key: "rpv", label: "RPV", format: (v) => `$${v.toFixed(2)}` },
  ];
  const callCols: ColDef[] = [
    { key: "totalCalls", label: "Calls" },
    { key: "connectedCalls", label: "Connected" },
    { key: "connectRate", label: "Connect %", format: (v) => `${v}%` },
    { key: "convertedCalls", label: "Converted" },
    { key: "conversionRate", label: "Conv %", format: (v) => `${v}%` },
  ];
  const revCols: ColDef[] = [
    { key: "callRevenue", label: "Revenue", format: (v) => `$${v}` },
    { key: "revenuePerCall", label: "Rev/Call", format: (v) => `$${v.toFixed(2)}` },
    { key: "costPerCall", label: "Cost/Call", format: (v) => `$${v.toFixed(2)}` },
    { key: "callROAS", label: "ROAS", format: (v) => `${v}x` },
    { key: "profit", label: "Profit", format: (v) => `$${v.toLocaleString()}` },
  ];

  const colMap: Record<string, ColDef[]> = {
    all: [...trafficCols.slice(0, 3), ...lpCols.slice(2, 4), ...callCols.slice(0, 1), ...revCols.slice(0, 1), ...revCols.slice(4, 5)],
    traffic: trafficCols,
    lp: lpCols,
    calls: callCols,
    revenue: revCols,
  };

  const cols = colMap[tab] || colMap.all;
  const reversed = [...data].reverse();

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-background z-10">Date</TableHead>
            {cols.map((c) => <TableHead key={c.key} className="text-right text-xs">{c.label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {reversed.map((row) => (
            <TableRow
              key={row.date}
              className={row.alertCount >= 2 ? "bg-red-50/50 dark:bg-red-950/20" : ""}
            >
              <TableCell className="sticky left-0 bg-background z-10 font-medium text-xs whitespace-nowrap">
                {row.dateLabel}
                {row.alertCount >= 2 && <AlertTriangle className="inline ml-1 h-3 w-3 text-red-500" />}
              </TableCell>
              {cols.map((c) => {
                const val = row[c.key];
                const delta = row.deltas[c.key as string];
                return (
                  <TableCell key={c.key} className="text-right text-xs whitespace-nowrap">
                    {c.format ? c.format(val) : String(val)}
                    {delta !== undefined && <DeltaBadge value={delta} />}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ═══════ MAIN COMPONENT ═══════ */
export default function BillyDailyTrends() {
  const { data: dailyData, isLoading } = useBillyDailyTrends();
  const { activeVertical } = useVertical();
  const [tableTab, setTableTab] = useState("all");

  if (isLoading) return <Skeleton className="h-80 rounded-xl" />;

  const hasData = dailyData && dailyData.length > 0;
  const latest = hasData ? dailyData[dailyData.length - 1] : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold">
            Daily Trends & Alerts — {activeVertical.id === "all" ? "All Verticals" : activeVertical.label}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Day-over-day funnel metrics with anomaly detection
          </p>
        </div>
      </div>

      {/* AI Insights */}
      {latest && <AlertSummary latest={latest} />}

      {!hasData ? (
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            No trend data available for this period
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Trend Charts */}
          <TrendCharts data={dailyData!} />

          {/* Daily Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Daily Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={tableTab} onValueChange={setTableTab} className="space-y-3">
                <TabsList className="bg-secondary/50 text-xs">
                  <TabsTrigger value="all" className="text-xs">All Steps</TabsTrigger>
                  <TabsTrigger value="traffic" className="text-xs">Traffic</TabsTrigger>
                  <TabsTrigger value="lp" className="text-xs">Landing Page</TabsTrigger>
                  <TabsTrigger value="calls" className="text-xs">Calls</TabsTrigger>
                  <TabsTrigger value="revenue" className="text-xs">Revenue</TabsTrigger>
                </TabsList>
                <TabsContent value={tableTab}>
                  <DailyTable data={dailyData!} tab={tableTab} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
