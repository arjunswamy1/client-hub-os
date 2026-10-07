import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw } from 'lucide-react';

type Status = 'ok' | 'warn' | 'fail';
interface Check { check: string; source: string | null; status: Status; explanation: string }
interface ClientHealth { client_id: string; client: string; timezone?: string; latest_reporting_day?: string; overall: Status; checks: Check[]; days: { date: string; state: string }[] }

const LABEL: Record<string, string> = {
  freshness: 'Freshness', provisional: 'Provisional', duplicate_rows: 'Duplicate rows', loaded_after_run: 'Loaded after the 9am draft',
  publisher_scope: 'Publisher scope', zero_vs_missing: 'Zero vs missing', config_mismatch: 'Config mismatch',
};
const variant = (s: Status) => (s === 'fail' ? 'destructive' : s === 'warn' ? 'secondary' : 'outline') as 'destructive' | 'secondary' | 'outline';
const dayClass: Record<string, string> = {
  available: 'bg-primary', no_delivery: 'bg-muted-foreground/40', missing: 'bg-destructive',
};

export default function DataHealthPage() {
  const [data, setData] = useState<{ generated_at: string; clients: ClientHealth[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    const { data: d, error: e } = await supabase.functions.invoke('data-health', { body: {} });
    if (e) setError(e.message); else setData(d);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Data health</h1>
          <p className="text-sm text-muted-foreground">Are the syncs right? The same checks agents see. Missing is not zero.</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Re-check
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && !data && <p className="text-sm text-muted-foreground">Running checks — large call feeds take a little while…</p>}
      {data && <p className="text-xs text-muted-foreground">Checked {new Date(data.generated_at).toLocaleString()}</p>}
      <div className="grid gap-4">
        {data?.clients.map((c) => (
          <Card key={c.client_id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{c.client}</CardTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {c.timezone && <span>{c.timezone} · latest day {c.latest_reporting_day}</span>}
                <Badge variant={variant(c.overall)}>{c.overall}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {c.days.length > 0 && (
                <div className="flex items-center gap-1" aria-label="Last 14 days">
                  {c.days.map((d) => (
                    <div key={d.date} title={`${d.date}: ${d.state.replace('_', ' ')}`} className={`h-4 w-4 rounded-sm ${dayClass[d.state] ?? 'bg-muted'}`} />
                  ))}
                  <span className="ml-2 text-xs text-muted-foreground">delivered · dark ($0) · missing</span>
                </div>
              )}
              <ul className="space-y-1.5">
                {c.checks.map((k, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Badge variant={variant(k.status)} className="mt-0.5 shrink-0">{k.status}</Badge>
                    <span><span className="font-medium">{LABEL[k.check] ?? k.check}{k.source ? ` · ${k.source}` : ''}:</span> {k.explanation}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
