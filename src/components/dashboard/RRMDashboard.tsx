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
  RefreshCw, Phone, DollarSign, TrendingUp, Target, Layers, PhoneCall, Blinds, Wrench,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  useMojaCalls, useRRMSpend, serviceLineOf, MojaCall, RRMCampaignRow,
} from "@/hooks/useRRMData";

const fmtMoney = (n: number) =>
  n === 0 ? "$0" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtMoney2 = (n: number) => `$${n.toFixed(2)}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

type SvcLine = "blended" | "windows" | "plumbing";

const LINE_META: Record<SvcLine, { label: string; platform: string | null; icon: any; blurb: string }> = {
  blended: { label: "Blended", platform: null, icon: Layers, blurb: "All service lines" },
  windows: { label: "Windows", platform: "meta", icon: Blinds, blurb: "Meta Ads" },
  plumbing: { label: "Plumbing", platform: "google", icon: Wrench, blurb: "Google Ads" },
};

function summarize(calls: MojaCall[], spend: number) {
  const total = calls.length;
  const connected = calls.filter((c) => c.connected).length;
  const converted = calls.filter((c) => c.converted).length;
  const revenue = calls.reduce((s, c) => s + Number(c.revenue || 0), 0);
  const talk = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0);
  return {
    calls: total,
    connected,
    converted,
    convRate: total ? converted / total : 0,
    revenue,
    spend,
    profit: revenue - spend,
    roas: spend > 0 ? revenue / spend : 0,
    cpl: total > 0 ? spend / total : 0,
    cpConverted: converted > 0 ? spend / converted : 0,
    rpc: total > 0 ? revenue / total : 0,
    avgTalk: connected > 0 ? talk / connected : 0,
  };
}

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

export default function RRMDashboard() {
  const { data: calls = [], isLoading, refetch: refetchCalls } = useMojaCalls();
  const { data: spendRows = [], refetch: refetchSpend } = useRRMSpend();
  const [line, setLine] = useState<SvcLine>("blended");
  const [syncing, setSyncing] = useState(false);

  const spendLine = (r: RRMCampaignRow): SvcLine => {
    const sl = serviceLineOf(r.campaign_name);
    if (sl === "windows" || sl === "plumbing") return sl;
    return r.platform?.toLowerCase() === "meta" ? "windows" : "plumbing";
  };

  const scopedCalls = useMemo(
    () => (line === "blended" ? calls : calls.filter((c) => (c.service_line || "unassigned") === line)),
    [calls, line],
  );
  const scopedSpend = useMemo(
    () => (line === "blended" ? spendRows : spendRows.filter((r) => spendLine(r) === line)),
    [spendRows, line],
  );

  const spendTotal = useMemo(
    () => scopedSpend.reduce((s, r) => s + Number(r.spend || 0), 0),
    [scopedSpend],
  );
  const kpi = useMemo(() => summarize(scopedCalls, spendTotal), [scopedCalls, spendTotal]);

  const lineCounts = useMemo(() => ({
    blended: calls.length,
    windows: calls.filter((c) => c.service_line === "windows").length,
    plumbing: calls.filter((c) => c.service_line === "plumbing").length,
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

  const campaigns = useMemo(() => {
    const map = new Map<string, { platform: string; spend: number; impressions: number; clicks: number }>();
    for (const r of scopedSpend) {
      const key = r.campaign_name || "Unnamed campaign";
      const row = map.get(key) || { platform: r.platform, spend: 0, impressions: 0, clicks: 0 };
      row.spend += Number(r.spend || 0);
      row.impressions += Number(r.impressions || 0);
      row.clicks += Number(r.clicks || 0);
      map.set(key, row);
    }
    return Array.from(map.entries())
      .map(([name, v]) => {
        const matched = scopedCalls.filter((c) => (c.campaign_name || "").toLowerCase() === name.toLowerCase());
        const revenue = matched.reduce((s, c) => s + Number(c.revenue || 0), 0);
        return {
          name,
          ...v,
          calls: matched.length,
          revenue,
          cpl: matched.length ? v.spend / matched.length : 0,
          profit: revenue - v.spend,
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }, [scopedSpend, scopedCalls]);

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
        converted: items.filter((c) => c.converted).length,
        revenue: items.reduce((s, c) => s + Number(c.revenue || 0), 0),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [scopedCalls]);

  const syncSpend = async () => {
    setSyncing(true);
    try {
      const results = await Promise.allSettled([
        supabase.functions.invoke("sync-meta-ads", { body: { client_id: "4b2434db-6d47-4653-be34-313976790f9d" } }),
        supabase.functions.invoke("sync-google-ads", { body: { client_id: "4b2434db-6d47-4653-be34-313976790f9d" } }),
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
          <span className="text-xs text-muted-foreground">
            Moja call tracking · {LINE_META[line].blurb}
          </span>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={syncSpend} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            Sync spend
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI label="Media spend" value={fmtMoney(kpi.spend)} sub={`${scopedSpend.length} campaign-days`} icon={DollarSign} />
        <KPI label="Calls" value={String(kpi.calls)} sub={`${kpi.connected} connected · ${fmtDuration(kpi.avgTalk)} avg talk`} icon={Phone} />
        <KPI label="Revenue" value={fmtMoney(kpi.revenue)} sub={`${kpi.converted} converted · ${fmtPct(kpi.convRate)} conv rate`} icon={TrendingUp} />
        <KPI
          label="Gross profit"
          value={fmtMoney(kpi.profit)}
          sub={kpi.spend > 0 ? `${kpi.roas.toFixed(2)}x ROAS` : "No spend yet"}
          icon={Target}
          tone={kpi.profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}
        />
        <KPI label="Cost / call" value={fmtMoney2(kpi.cpl)} sub="Spend ÷ all calls" icon={PhoneCall} />
        <KPI label="Cost / converted call" value={fmtMoney2(kpi.cpConverted)} sub="Spend ÷ converted calls" icon={PhoneCall} />
        <KPI label="Revenue / call" value={fmtMoney2(kpi.rpc)} sub="Buyer payout ÷ calls" icon={DollarSign} />
        <KPI
          label="Margin"
          value={kpi.revenue > 0 ? fmtPct(kpi.profit / kpi.revenue) : "—"}
          sub="Profit ÷ revenue"
          icon={TrendingUp}
        />
      </div>

      <Tabs defaultValue="trend" className="space-y-4">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="trend" className="text-xs">Trend</TabsTrigger>
          <TabsTrigger value="campaigns" className="text-xs">Campaigns</TabsTrigger>
          <TabsTrigger value="buyers" className="text-xs">Buyers</TabsTrigger>
          <TabsTrigger value="calls" className="text-xs">Call log</TabsTrigger>
        </TabsList>

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
                  <Line yAxisId="right" type="monotone" dataKey="calls" name="Calls" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns">
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Campaign performance</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Impr.</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      No ad spend synced for this range yet.
                    </TableCell>
                  </TableRow>
                )}
                {campaigns.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="max-w-[240px] truncate font-medium">{c.name}</TableCell>
                    <TableCell className="capitalize">{c.platform}</TableCell>
                    <TableCell className="text-right">{fmtMoney(c.spend)}</TableCell>
                    <TableCell className="text-right">{c.impressions.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{c.clicks.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{c.calls}</TableCell>
                    <TableCell className="text-right">{c.calls ? fmtMoney2(c.cpl) : "—"}</TableCell>
                    <TableCell className="text-right">{fmtMoney(c.revenue)}</TableCell>
                    <TableCell className={`text-right ${c.profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                      {fmtMoney(c.profit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
                  <TableHead className="text-right">Converted</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Avg payout</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      No Moja calls received for this range yet.
                    </TableCell>
                  </TableRow>
                )}
                {buyers.map((b) => (
                  <TableRow key={b.buyer}>
                    <TableCell className="font-medium">{b.buyer}</TableCell>
                    <TableCell className="text-right">{b.calls}</TableCell>
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
                  <TableHead>Buyer</TableHead>
                  <TableHead className="text-right">Talk</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
                )}
                {!isLoading && scopedCalls.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                      No calls yet — once the Moja webhook is saved, calls appear here in real time.
                    </TableCell>
                  </TableRow>
                )}
                {scopedCalls.slice(0, 200).map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {format(new Date(c.call_start), "MMM d, h:mm a")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {c.caller_number || "—"}
                      {c.caller_state ? <span className="ml-1 text-muted-foreground">({c.caller_state})</span> : null}
                    </TableCell>
                    <TableCell className="text-xs capitalize">{c.service_line}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs">{c.campaign_name || "—"}</TableCell>
                    <TableCell className="text-xs">{c.buyer_name || c.target_name || "—"}</TableCell>
                    <TableCell className="text-right text-xs">{fmtDuration(c.duration_seconds || 0)}</TableCell>
                    <TableCell>
                      <Badge variant={c.converted ? "default" : c.connected ? "secondary" : "outline"} className="text-[10px]">
                        {c.converted ? "Converted" : c.connected ? "Connected" : "No connect"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">{fmtMoney2(Number(c.revenue || 0))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
