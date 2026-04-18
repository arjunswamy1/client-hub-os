import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ArrowRight, Sparkles, Zap, HardDrive, Mail, DollarSign } from 'lucide-react';
import { useTechUsageDaily, useClientsBasic } from '@/hooks/useTechCosts';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() { return new Date().toISOString().slice(0, 10); }
function fmt(n: number) { return `$${n.toFixed(4)}`; }
function fmtBig(n: number) { return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`; }

const CATEGORY_COLORS: Record<string, string> = {
  ai: 'hsl(217 91% 60%)',
  integration: 'hsl(142 71% 45%)',
  storage: 'hsl(43 96% 56%)',
  email: 'hsl(280 65% 60%)',
};

const CATEGORY_ICONS: Record<string, typeof Sparkles> = {
  ai: Sparkles,
  integration: Zap,
  storage: HardDrive,
  email: Mail,
};

export function TechCostsOverview() {
  const [startDate, setStartDate] = useState(startOfMonth());
  const [endDate, setEndDate] = useState(today());
  const { data: rows = [], isLoading } = useTechUsageDaily(startDate, endDate);
  const { data: clients = [] } = useClientsBasic();

  const clientMap = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null }>();
    clients.forEach((c: any) => m.set(c.id, { name: c.name, color: c.color }));
    return m;
  }, [clients]);

  const totals = useMemo(() => {
    const out = { all: 0, ai: 0, integration: 0, storage: 0, email: 0 };
    rows.forEach((r) => {
      out.all += Number(r.total_cost_usd);
      out[r.category as keyof typeof out] = (out[r.category as keyof typeof out] || 0) + Number(r.total_cost_usd);
    });
    return out;
  }, [rows]);

  const byClient = useMemo(() => {
    const m = new Map<string, { client_id: string | null; total: number; ai: number; integration: number; storage: number; email: number; events: number }>();
    rows.forEach((r) => {
      const key = r.client_id ?? 'system';
      let b = m.get(key);
      if (!b) {
        b = { client_id: r.client_id, total: 0, ai: 0, integration: 0, storage: 0, email: 0, events: 0 };
        m.set(key, b);
      }
      b.total += Number(r.total_cost_usd);
      b.events += Number(r.event_count);
      const cat = r.category as 'ai' | 'integration' | 'storage' | 'email';
      b[cat] = (b[cat] || 0) + Number(r.total_cost_usd);
    });
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  const chartData = useMemo(() => {
    // Group by date, then by client
    const dateMap = new Map<string, Record<string, string | number>>();
    rows.forEach((r) => {
      let day = dateMap.get(r.date);
      if (!day) { day = { date: r.date }; dateMap.set(r.date, day); }
      const name = r.client_id ? (clientMap.get(r.client_id)?.name ?? 'Unknown') : 'System';
      day[name] = (Number(day[name] || 0) + Number(r.total_cost_usd));
    });
    return Array.from(dateMap.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [rows, clientMap]);

  const topClientNames = useMemo(() => {
    return byClient.slice(0, 8).map((b) =>
      b.client_id ? (clientMap.get(b.client_id)?.name ?? 'Unknown') : 'System'
    );
  }, [byClient, clientMap]);

  const palette = [
    'hsl(217 91% 60%)', 'hsl(142 71% 45%)', 'hsl(43 96% 56%)', 'hsl(280 65% 60%)',
    'hsl(0 72% 51%)', 'hsl(189 94% 43%)', 'hsl(24 95% 53%)', 'hsl(252 56% 57%)',
  ];

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 w-40" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {rows.length.toLocaleString()} aggregated rows · raw cost (no markup)
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-3 md:grid-cols-5">
        <KpiCard label="Total" value={fmtBig(totals.all)} icon={DollarSign} color="hsl(var(--primary))" />
        <KpiCard label="AI" value={fmtBig(totals.ai)} icon={Sparkles} color={CATEGORY_COLORS.ai} />
        <KpiCard label="Integrations" value={fmtBig(totals.integration)} icon={Zap} color={CATEGORY_COLORS.integration} />
        <KpiCard label="Storage" value={fmtBig(totals.storage)} icon={HardDrive} color={CATEGORY_COLORS.storage} />
        <KpiCard label="Email" value={fmtBig(totals.email)} icon={Mail} color={CATEGORY_COLORS.email} />
      </div>

      {/* Chart */}
      <Card>
        <CardHeader><CardTitle className="text-base">Daily cost by client</CardTitle></CardHeader>
        <CardContent className="h-72">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {isLoading ? 'Loading…' : 'No usage logged yet for this period.'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {topClientNames.map((name, i) => (
                  <Bar key={name} dataKey={name} stackId="a" fill={palette[i % palette.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Cost by client</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">AI</TableHead>
                <TableHead className="text-right">Integrations</TableHead>
                <TableHead className="text-right">Storage</TableHead>
                <TableHead className="text-right">Email</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byClient.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="h-24 text-center text-sm text-muted-foreground">No data</TableCell></TableRow>
              ) : byClient.map((b) => {
                const name = b.client_id ? (clientMap.get(b.client_id)?.name ?? 'Unknown') : 'System (unattributed)';
                return (
                  <TableRow key={b.client_id ?? 'system'}>
                    <TableCell className="font-medium">
                      {name}
                      {!b.client_id && <Badge variant="secondary" className="ml-2 text-[10px]">system</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(b.ai)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(b.integration)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(b.storage)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(b.email)}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">{b.events.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">{fmtBig(b.total)}</TableCell>
                    <TableCell>
                      {b.client_id && (
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/admin/costs/${b.client_id}`}>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, icon: Icon, color }: { label: string; value: string; icon: typeof Sparkles; color: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          </div>
          <div className="rounded-md p-2" style={{ backgroundColor: `${color}20` }}>
            <Icon className="h-5 w-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
