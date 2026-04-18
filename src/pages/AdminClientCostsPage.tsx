import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Download } from 'lucide-react';
import { useTechUsageDaily, useTechUsageEvents, useClientsBasic } from '@/hooks/useTechCosts';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() { return new Date().toISOString().slice(0, 10); }
function fmt(n: number) { return `$${n.toFixed(4)}`; }
function fmtBig(n: number) { return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`; }

export default function AdminClientCostsPage() {
  const { clientId = '' } = useParams();
  const [startDate, setStartDate] = useState(startOfMonth());
  const [endDate, setEndDate] = useState(today());

  const { data: clients = [] } = useClientsBasic();
  const client = clients.find((c: any) => c.id === clientId);

  const { data: daily = [] } = useTechUsageDaily(startDate, endDate, clientId);
  const { data: events = [] } = useTechUsageEvents(clientId, startDate, endDate, 200);

  const totals = useMemo(() => {
    const out = { all: 0, ai: 0, integration: 0, storage: 0, email: 0, events: 0, input: 0, output: 0 };
    daily.forEach((r) => {
      out.all += Number(r.total_cost_usd);
      out.events += Number(r.event_count);
      out.input += Number(r.total_input_tokens);
      out.output += Number(r.total_output_tokens);
      const cat = r.category as 'ai' | 'integration' | 'storage' | 'email';
      out[cat] = (out[cat] || 0) + Number(r.total_cost_usd);
    });
    return out;
  }, [daily]);

  const trendData = useMemo(() => {
    const m = new Map<string, { date: string; total: number; ai: number; integration: number; storage: number; email: number }>();
    daily.forEach((r) => {
      let d = m.get(r.date);
      if (!d) { d = { date: r.date, total: 0, ai: 0, integration: 0, storage: 0, email: 0 }; m.set(r.date, d); }
      const c = Number(r.total_cost_usd);
      d.total += c;
      const cat = r.category as 'ai' | 'integration' | 'storage' | 'email';
      d[cat] = (d[cat] || 0) + c;
    });
    return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [daily]);

  const serviceBreakdown = useMemo(() => {
    const m = new Map<string, { service: string; category: string; cost: number; events: number; quantity: number }>();
    daily.forEach((r) => {
      const key = `${r.service}|${r.category}`;
      let s = m.get(key);
      if (!s) { s = { service: r.service, category: r.category, cost: 0, events: 0, quantity: 0 }; m.set(key, s); }
      s.cost += Number(r.total_cost_usd);
      s.events += Number(r.event_count);
      s.quantity += Number(r.total_quantity);
    });
    return Array.from(m.values()).sort((a, b) => b.cost - a.cost);
  }, [daily]);

  function exportCsv() {
    const headers = ['date', 'category', 'service', 'events', 'input_tokens', 'output_tokens', 'quantity', 'cost_usd'];
    const rows = daily.map((r) => [
      r.date, r.category, r.service, r.event_count,
      r.total_input_tokens, r.total_output_tokens, r.total_quantity, r.total_cost_usd,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tech-costs-${client?.slug ?? clientId}-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin"><ArrowLeft className="mr-1 h-4 w-4" />Back to Admin</Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{client?.name ?? 'Client'}</h1>
          <p className="text-sm text-muted-foreground">Technology costs · raw (no markup)</p>
        </div>
        <Button onClick={exportCsv} variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4" />Export CSV
        </Button>
      </div>

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
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-3 md:grid-cols-5">
        <Kpi label="Total" value={fmtBig(totals.all)} />
        <Kpi label="AI" value={fmtBig(totals.ai)} sub={`${totals.input.toLocaleString()} in · ${totals.output.toLocaleString()} out`} />
        <Kpi label="Integrations" value={fmtBig(totals.integration)} />
        <Kpi label="Storage" value={fmtBig(totals.storage)} />
        <Kpi label="Email" value={fmtBig(totals.email)} />
      </div>

      {/* Trend */}
      <Card>
        <CardHeader><CardTitle className="text-base">Daily cost trend</CardTitle></CardHeader>
        <CardContent className="h-64">
          {trendData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No usage logged yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="ai" stroke="hsl(217 91% 60%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="integration" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="storage" stroke="hsl(43 96% 56%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="email" stroke="hsl(280 65% 60%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Service breakdown */}
      <Card>
        <CardHeader><CardTitle className="text-base">By service</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {serviceBreakdown.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-20 text-center text-sm text-muted-foreground">No data</TableCell></TableRow>
              ) : serviceBreakdown.map((s) => (
                <TableRow key={`${s.service}-${s.category}`}>
                  <TableCell className="font-medium">{s.service}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{s.category}</Badge></TableCell>
                  <TableCell className="text-right font-mono text-xs">{s.events.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{s.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold">{fmtBig(s.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent events */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent events ({events.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Surface</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-20 text-center text-sm text-muted-foreground">No events</TableCell></TableRow>
                ) : events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{e.service}</TableCell>
                    <TableCell className="text-xs">{e.surface ?? '—'}</TableCell>
                    <TableCell className="text-xs">{e.model ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{e.input_tokens || '—'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{e.output_tokens || '—'}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{fmt(Number(e.cost_usd))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-[10px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}
