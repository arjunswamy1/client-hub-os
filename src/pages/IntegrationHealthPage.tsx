import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

interface ProbeResult {
  raw_env?: string;
  normalized_env?: string;
  mode?: 'stage' | 'v1';
  is_sandbox?: boolean;
  host?: string;
  render_url?: string;
  key_source?: string;
  api_key_present?: boolean;
  api_key_length?: number;
  prod_key_present?: boolean;
  stage_key_present?: boolean;
  probe_url?: string;
  probe_status?: number;
  probe_ok?: boolean;
  probe_body?: unknown;
  probe_error?: string;
}

export default function IntegrationHealthPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runProbe = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('shotstack-probe', { body: {} });
      if (error) throw error;
      setResult(data as ProbeResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const renderUrl = result?.render_url ?? (result?.host ? `${result.host}/render` : '—');
  const isSandbox = result?.mode === 'stage';
  const passed = result?.probe_ok && result?.api_key_present;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integration Health</h1>
        <p className="text-sm text-muted-foreground">Verify third-party service connectivity</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Shotstack</CardTitle>
          <Button onClick={runProbe} disabled={loading} size="sm">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Run probe
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {result && (
            <>
              <div className="flex items-center gap-2">
                {passed ? (
                  <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> PASS</Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> FAIL</Badge>
                )}
                <span className="text-sm text-muted-foreground">
                  Status {result.probe_status ?? 'n/a'}
                </span>
              </div>

              <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Raw SHOTSTACK_ENV</dt>
                  <dd className="font-mono">{result.raw_env || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Normalized SHOTSTACK_ENV</dt>
                  <dd className="font-mono">{result.normalized_env || '—'}</dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-muted-foreground">Render URL</dt>
                  <dd className="font-mono break-all">{renderUrl}</dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="text-muted-foreground">Probe URL</dt>
                  <dd className="font-mono break-all">{result.probe_url || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">API key present</dt>
                  <dd>{result.api_key_present ? `Yes (${result.api_key_length} chars)` : 'No'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Probe OK</dt>
                  <dd>{result.probe_ok ? 'Yes' : 'No'}</dd>
                </div>
              </dl>

              <div>
                <div className="mb-1 text-sm text-muted-foreground">Response body</div>
                <pre className="max-h-80 overflow-auto rounded-md border bg-muted p-3 text-xs">
{JSON.stringify(result.probe_body ?? result.probe_error ?? {}, null, 2)}
                </pre>
              </div>
            </>
          )}

          {!result && !error && !loading && (
            <p className="text-sm text-muted-foreground">Click "Run probe" to test the Shotstack integration.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
