import { useMemo } from "react";
import { useBillyDailyTrends, DailyFunnelRow } from "@/hooks/useBillyDailyTrends";
import { useVertical } from "@/contexts/VerticalContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CalendarDays } from "lucide-react";
import { startOfWeek, format, parseISO } from "date-fns";

interface AggBucket {
  label: string;
  spend: number;
  revenue: number;
  profit: number;
  clicks: number;
  impressions: number;
  totalCalls: number;
  connectedCalls: number;
  convertedCalls: number;
  callRevenue: number;
  cpc: number;
  roas: number;
  connectRate: number;
}

function aggregateBuckets(rows: DailyFunnelRow[], keyFn: (r: DailyFunnelRow) => string): AggBucket[] {
  const buckets = new Map<string, Omit<AggBucket, "cpc" | "roas" | "connectRate">>();

  for (const row of rows) {
    const key = keyFn(row);
    const b = buckets.get(key) || {
      label: key, spend: 0, revenue: 0, profit: 0, clicks: 0, impressions: 0,
      totalCalls: 0, connectedCalls: 0, convertedCalls: 0, callRevenue: 0,
    };
    b.spend += row.spend;
    b.revenue += row.callRevenue;
    b.profit += row.profit;
    b.clicks += row.clicks;
    b.impressions += row.impressions;
    b.totalCalls += row.totalCalls;
    b.connectedCalls += row.connectedCalls;
    b.convertedCalls += row.convertedCalls;
    b.callRevenue += row.callRevenue;
    buckets.set(key, b);
  }

  return Array.from(buckets.values()).map((b) => ({
    ...b,
    spend: Math.round(b.spend),
    revenue: Math.round(b.revenue),
    profit: Math.round(b.profit),
    callRevenue: Math.round(b.callRevenue),
    cpc: b.clicks > 0 ? Math.round((b.spend / b.clicks) * 100) / 100 : 0,
    roas: b.spend > 0 ? Math.round((b.callRevenue / b.spend) * 100) / 100 : 0,
    connectRate: b.totalCalls > 0 ? Math.round((b.connectedCalls / b.totalCalls) * 100) : 0,
  }));
}

function BucketCharts({ data }: { data: AggBucket[] }) {
  const chartStyle = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Spend vs Revenue</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
              <Tooltip contentStyle={chartStyle} />
              <Bar dataKey="spend" name="Spend" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} opacity={0.7} />
              <Bar dataKey="callRevenue" name="Revenue" fill="hsl(142, 71%, 45%)" radius={[3, 3, 0, 0]} opacity={0.7} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Profit</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={chartStyle} />
              <Bar dataKey="profit" name="Profit" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">CPC Trend</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip contentStyle={chartStyle} />
              <Line type="monotone" dataKey="cpc" name="CPC" stroke="hsl(var(--primary))" strokeWidth={2} dot />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">ROAS & Connect Rate</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}x`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
              <Tooltip contentStyle={chartStyle} />
              <Line yAxisId="left" type="monotone" dataKey="roas" name="ROAS" stroke="hsl(var(--primary))" strokeWidth={2} dot />
              <Line yAxisId="right" type="monotone" dataKey="connectRate" name="Connect %" stroke="hsl(45, 93%, 47%)" strokeWidth={2} dot />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function BucketTable({ data }: { data: AggBucket[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Profit</TableHead>
            <TableHead className="text-right">CPC</TableHead>
            <TableHead className="text-right">ROAS</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Connect %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((b) => (
            <TableRow key={b.label}>
              <TableCell className="font-medium text-xs">{b.label}</TableCell>
              <TableCell className="text-right text-xs">${b.spend.toLocaleString()}</TableCell>
              <TableCell className="text-right text-xs">${b.callRevenue.toLocaleString()}</TableCell>
              <TableCell className={`text-right text-xs font-medium ${b.profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {b.profit >= 0 ? "" : "−"}${Math.abs(b.profit).toLocaleString()}
              </TableCell>
              <TableCell className="text-right text-xs">${b.cpc.toFixed(2)}</TableCell>
              <TableCell className="text-right text-xs">{b.roas}x</TableCell>
              <TableCell className="text-right text-xs">{b.totalCalls}</TableCell>
              <TableCell className="text-right text-xs">{b.connectRate}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function BillyTrendAnalysis() {
  const { data: dailyData, isLoading } = useBillyDailyTrends();
  const { activeVertical } = useVertical();

  const weekly = useMemo(() => {
    if (!dailyData?.length) return [];
    return aggregateBuckets(dailyData, (r) => {
      const weekStart = startOfWeek(parseISO(r.date), { weekStartsOn: 1 });
      return `Wk ${format(weekStart, "MMM d")}`;
    });
  }, [dailyData]);

  const monthly = useMemo(() => {
    if (!dailyData?.length) return [];
    return aggregateBuckets(dailyData, (r) => format(parseISO(r.date), "yyyy-MM"));
  }, [dailyData]);

  if (isLoading) return <Skeleton className="h-80 rounded-xl" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold">
            Trend Analysis — {activeVertical.id === "all" ? "All Verticals" : activeVertical.label}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            Weekly and monthly aggregated performance
          </p>
        </div>
      </div>

      <Tabs defaultValue="weekly" className="space-y-4">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="weekly" className="text-xs">Weekly</TabsTrigger>
          <TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="space-y-4">
          {weekly.length > 0 ? (
            <>
              <BucketCharts data={weekly} />
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Weekly Summary</CardTitle></CardHeader>
                <CardContent><BucketTable data={weekly} /></CardContent>
              </Card>
            </>
          ) : (
            <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">No weekly data available</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="monthly" className="space-y-4">
          {monthly.length > 0 ? (
            <>
              <BucketCharts data={monthly} />
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Summary</CardTitle></CardHeader>
                <CardContent><BucketTable data={monthly} /></CardContent>
              </Card>
            </>
          ) : (
            <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">No monthly data available</CardContent></Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
