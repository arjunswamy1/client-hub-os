import { useMemo, useState } from "react";
import { useBuyologyCalls, useBuyologySpend, BuyologyCall, BUYOLOGY_CLIENT_ID } from "@/hooks/useBuyologyData";
import { useBuyologyLineSpend } from "@/hooks/useBuyologyCreativeAnalysis";
import { PRODUCT_LINES, ProductLine, classifyName, productLineLabel, QUALIFIED_SECONDS } from "@/lib/buyologyProductLines";
import BuyologyRingbaImport from "./BuyologyRingbaImport";
import BuyologyCreativeAnalysis from "./BuyologyCreativeAnalysis";
import BuyologyOptimizer from "./BuyologyOptimizer";
import SlackReportCard from "./SlackReportCard";
import MetaDashboard from "./MetaDashboard";
import MetaConnectionCard from "./MetaConnectionCard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Phone, PhoneCall, DollarSign, TrendingUp, Target, Clock, Facebook, Upload, BarChart3, Link as LinkIcon, Sparkles, Brain } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { format } from "date-fns";

const money = (n: number) => (n === 0 ? "$0" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const money2 = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const dur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;



function agg(calls: BuyologyCall[], spend: number) {
  const total = calls.length;
  const connected = calls.filter((c) => c.connected).length;
  const converted = calls.filter((c) => c.converted).length;
  const revenue = calls.reduce((s, c) => s + Number(c.revenue || 0), 0);
  const totalDuration = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0);
  return {
    total,
    connected,
    converted,
    revenue,
    spend,
    profit: revenue - spend,
    roas: spend > 0 ? revenue / spend : 0,
    connectRate: total ? connected / total : 0,
    convertRate: total ? converted / total : 0,
    cprc: total ? spend / total : 0,
    cpcc: connected ? spend / connected : 0,
    cpConv: converted ? spend / converted : 0,
    rpc: total ? revenue / total : 0,
    avgDuration: connected ? totalDuration / connected : 0,
  };
}

function KPI({ label, value, sub, icon: Icon, accent }: any) {
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

function GroupTable({ title, rows }: { title: string; rows: any[] }) {
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No calls in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Connected</TableHead>
                <TableHead className="text-right">Converted</TableHead>
                <TableHead className="text-right">Conv. rate</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Rev / call</TableHead>
                <TableHead className="text-right">Avg dur</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="max-w-[280px] truncate text-xs font-medium">{r.name}</TableCell>
                  <TableCell className="text-right text-xs">{r.total}</TableCell>
                  <TableCell className="text-right text-xs">{r.connected}</TableCell>
                  <TableCell className="text-right text-xs">{r.converted}</TableCell>
                  <TableCell className="text-right text-xs">{pct(r.convertRate)}</TableCell>
                  <TableCell className="text-right text-xs">{money(r.revenue)}</TableCell>
                  <TableCell className="text-right text-xs">{money2(r.rpc)}</TableCell>
                  <TableCell className="text-right text-xs">{dur(r.avgDuration)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

export default function BuyologyDashboard() {
  const { data: allCalls = [], isLoading } = useBuyologyCalls();
  const { data: spendRows = [] } = useBuyologySpend();
  const { data: lineSpend } = useBuyologyLineSpend();
  const [tab, setTab] = useState("overview");
  const [line, setLine] = useState<ProductLine | "all">("all");

  const calls = useMemo(
    () => (line === "all" ? allCalls : allCalls.filter((c) => classifyName(c.campaign_name) === line)),
    [allCalls, line]
  );

  const spend = useMemo(() => {
    if (line === "all") return spendRows.reduce((s, r) => s + Number(r.spend || 0), 0);
    return lineSpend?.totals[line]?.spend ?? 0;
  }, [spendRows, lineSpend, line]);

  const totals = useMemo(() => agg(calls, spend), [calls, spend]);
  const qualified = useMemo(
    () => calls.filter((c) => Number(c.duration_seconds || 0) >= QUALIFIED_SECONDS).length,
    [calls]
  );

  const daily = useMemo(() => {
    const map = new Map<string, { date: string; calls: number; converted: number; revenue: number; spend: number }>();
    const touch = (key: string) =>
      map.get(key) || map.set(key, { date: key, calls: 0, converted: 0, revenue: 0, spend: 0 }).get(key)!;
    for (const c of calls) {
      const key = c.call_date.slice(0, 10);
      const row = touch(key);
      row.calls++;
      if (c.converted) row.converted++;
      row.revenue += Number(c.revenue || 0);
    }
    if (line === "all") {
      for (const s of spendRows) {
        const row = touch(String(s.date).slice(0, 10));
        row.spend += Number(s.spend || 0);
      }
    } else if (lineSpend) {
      for (const [key, value] of lineSpend.daily) {
        const [date, l] = key.split("|");
        if (l !== line) continue;
        touch(date).spend += value;
      }
    }
    return [...map.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ ...r, label: format(new Date(`${r.date}T12:00:00`), "MMM d") }));
  }, [calls, spendRows, lineSpend, line]);

  const groupBy = (key: "campaign_name" | "target_name") => {
    const map = new Map<string, BuyologyCall[]>();
    for (const c of calls) {
      const name = (c[key] as string) || "Unattributed";
      map.set(name, [...(map.get(name) || []), c]);
    }
    return [...map.entries()]
      .map(([name, list]) => ({ name, ...agg(list, 0) }))
      .sort((a, b) => b.total - a.total);
  };

  const byCampaign = useMemo(() => groupBy("campaign_name"), [calls]);
  const byTarget = useMemo(() => groupBy("target_name"), [calls]);


  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Product line</span>
        {PRODUCT_LINES.map((p) => {
          const s = p.id === "all" ? null : lineSpend?.totals[p.id as ProductLine]?.spend;
          return (
            <Button
              key={p.id}
              size="sm"
              variant={line === p.id ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setLine(p.id)}
            >
              {p.short}
              {s !== null && s !== undefined && s > 0 && (
                <span className="ml-1.5 opacity-70">{money(s)}</span>
              )}
            </Button>
          );
        })}
      </div>

      <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-none">
        <TabsList className="bg-secondary/50 inline-flex w-auto">
          <TabsTrigger value="overview" className="gap-1.5 text-xs whitespace-nowrap">
            <BarChart3 className="h-3.5 w-3.5" />
            Call Performance
          </TabsTrigger>
          <TabsTrigger value="creatives" className="gap-1.5 text-xs whitespace-nowrap">
            <Sparkles className="h-3.5 w-3.5" />
            Creative Analysis
          </TabsTrigger>
          <TabsTrigger value="optimizer" className="gap-1.5 text-xs whitespace-nowrap">
            <Brain className="h-3.5 w-3.5" />
            AI Optimizer
          </TabsTrigger>
          <TabsTrigger value="meta" className="gap-1.5 text-xs whitespace-nowrap">
            <Facebook className="h-3.5 w-3.5" />
            Meta Ads
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-1.5 text-xs whitespace-nowrap">
            <LinkIcon className="h-3.5 w-3.5" />
            Connections
          </TabsTrigger>
          <TabsTrigger value="import" className="gap-1.5 text-xs whitespace-nowrap">
            <Upload className="h-3.5 w-3.5" />
            Ringba Import
          </TabsTrigger>

        </TabsList>
      </div>

      <TabsContent value="overview" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KPI label="Raw calls" value={totals.total.toLocaleString()} sub={`${totals.connected} connected · ${pct(totals.connectRate)}`} icon={Phone} />
          <KPI label="Qualified calls" value={qualified.toLocaleString()} sub={`${QUALIFIED_SECONDS}s+ talk time · ${totals.total ? pct(qualified / totals.total) : "0%"}`} icon={PhoneCall} accent="text-emerald-500" />
          <KPI label="Converted calls" value={totals.converted.toLocaleString()} sub={`${pct(totals.convertRate)} of raw calls`} icon={PhoneCall} />
          <KPI label="Meta spend" value={money(totals.spend)} sub={spend === 0 ? "No Meta spend synced yet" : `${money2(totals.cprc)} cost per raw call`} icon={Facebook} />
          <KPI label="Cost / qualified" value={qualified ? money2(spend / qualified) : "—"} icon={Target} />
          <KPI label="Revenue" value={money(totals.revenue)} sub={`${money2(totals.rpc)} per raw call`} icon={DollarSign} accent="text-emerald-500" />
          <KPI label="Cost / converted" value={totals.converted ? money2(totals.cpConv) : "—"} icon={Target} />
          <KPI label="Avg talk time" value={dur(totals.avgDuration)} sub="Connected calls" icon={Clock} />
        </div>


        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Daily calls, revenue & spend</h3>
          {isLoading ? (
            <div className="h-64 animate-pulse rounded-md bg-muted" />
          ) : daily.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No data in this range yet — import a Ringba call export from the Ringba Import tab.
            </p>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    formatter={(v: any, n: any) =>
                      n === "Revenue" || n === "Spend" ? money2(Number(v)) : Number(v).toLocaleString()
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="calls" name="Calls" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="left" dataKey="converted" name="Converted" fill="hsl(var(--chart-2, var(--primary)))" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="spend" name="Spend" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <GroupTable title="By Ringba campaign" rows={byCampaign} />
        <GroupTable title="By buyer / target" rows={byTarget} />
      </TabsContent>

      <TabsContent value="creatives">
        <BuyologyCreativeAnalysis line={line} />
      </TabsContent>

      <TabsContent value="optimizer" className="space-y-4">
        <BuyologyOptimizer line={line} />
        <SlackReportCard clientId={BUYOLOGY_CLIENT_ID} scope="buyology" clientLabel="BuyologyIQ" />
      </TabsContent>


      <TabsContent value="meta" className="space-y-4">
        {lineSpend && lineSpend.campaigns.length > 0 && (
          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">
              Meta campaigns by product line{line !== "all" ? " (filtered)" : ""}
            </h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Product line</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Impr.</TableHead>
                    <TableHead className="text-right">Clicks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineSpend.campaigns
                    .filter((c) => line === "all" || c.line === line)
                    .map((c) => (
                      <TableRow key={c.name}>
                        <TableCell className="max-w-[340px] truncate text-xs font-medium">{c.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{productLineLabel(c.line)}</TableCell>
                        <TableCell className="text-right text-xs">{money(c.spend)}</TableCell>
                        <TableCell className="text-right text-xs">{c.impressions.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-xs">{c.clicks.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
        <MetaDashboard />
      </TabsContent>


      <TabsContent value="connections" className="space-y-3">
        <MetaConnectionCard clientId={BUYOLOGY_CLIENT_ID} clientLabel="BuyologyIQ" />
        <p className="text-xs text-muted-foreground">
          Authorize with the Meta user that has access to BuyologyIQ's ad account, pick the ad
          account above, then run a 90-day sync to backfill campaign, ad set and creative spend.
        </p>
      </TabsContent>

      <TabsContent value="import">
        <BuyologyRingbaImport />
      </TabsContent>
    </Tabs>
  );
}
