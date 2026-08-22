import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

export default function RokuCallbackPage() {
  const [params] = useSearchParams();
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  const oauthError = params.get('error');

  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const redirectUri = useMemo(() => `${window.location.origin}/roku/callback`, []);

  type RokuConn = {
    id: string;
    account_id: string | null;
    account_name: string | null;
    status: string | null;
    token_expires_at: string | null;
    last_synced_at: string | null;
    sync_error: string | null;
    updated_at: string | null;
    clients?: { name: string } | null;
  };
  const [connections, setConnections] = useState<RokuConn[] | null>(null);
  const [loadingConns, setLoadingConns] = useState(true);

  const loadConnections = async () => {
    setLoadingConns(true);
    const { data, error } = await supabase
      .from('platform_connections')
      .select('id, account_id, account_name, status, token_expires_at, last_synced_at, sync_error, updated_at, clients(name)')
      .eq('platform', 'roku')
      .order('updated_at', { ascending: false });
    if (error) {
      setConnections([]);
    } else {
      setConnections((data ?? []) as unknown as RokuConn[]);
    }
    setLoadingConns(false);
  };

  useEffect(() => {
    loadConnections();
  }, []);

  const exchange = async () => {
    if (!code) return;
    setStatus('working');
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('roku-oauth-exchange', {
        body: { code, client_id: state, redirect_uri: redirectUri },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setStatus('done');
      setMessage(`Connected. ${((data as any)?.accounts?.length ?? 0)} Roku ad account(s) available.`);
      loadConnections();
    } catch (e) {
      setStatus('error');
      setMessage((e as Error).message);
    }
  };

  useEffect(() => {
    if (code && state) exchange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, state]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roku Ads authorization</h1>
        <p className="text-sm text-muted-foreground">
          This page receives the authorization code from Roku Ads Manager.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Redirect URI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md border bg-muted px-3 py-2 text-sm">{redirectUri}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(redirectUri);
                toast.success('Redirect URI copied');
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Give this exact value to Roku as the developer app Redirect URI.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Connection status</CardTitle>
          <div className="flex items-center gap-2">
            {!loadingConns && (connections?.length ?? 0) > 0 && (
              <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Connected</Badge>
            )}
            {!loadingConns && (connections?.length ?? 0) === 0 && (
              <Badge variant="secondary" className="gap-1"><XCircle className="h-3 w-3" /> Not connected</Badge>
            )}
            <Button variant="outline" size="sm" onClick={loadConnections} disabled={loadingConns}>
              <RefreshCw className={`h-3.5 w-3.5 ${loadingConns ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {loadingConns && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking stored Roku connections…
            </p>
          )}

          {!loadingConns && (connections?.length ?? 0) === 0 && (
            <p className="text-muted-foreground">
              No Roku connection is stored yet. Open the Roku authorization URL (with{' '}
              <code>&amp;state=&lt;client id&gt;</code> appended) and approve access — the tokens will be saved here
              automatically.
            </p>
          )}

          {!loadingConns &&
            (connections ?? []).map((c) => (
              <div key={c.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{c.clients?.name ?? 'Unassigned client'}</div>
                  <Badge variant={c.status === 'connected' ? 'default' : 'secondary'}>{c.status ?? 'unknown'}</Badge>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <dt>Ad account</dt>
                  <dd className="text-foreground">{c.account_name ?? c.account_id ?? '—'}</dd>
                  <dt>Token expires</dt>
                  <dd className="text-foreground">
                    {c.token_expires_at ? new Date(c.token_expires_at).toLocaleString() : '—'}
                  </dd>
                  <dt>Last sync</dt>
                  <dd className="text-foreground">
                    {c.last_synced_at ? new Date(c.last_synced_at).toLocaleString() : 'Never'}
                  </dd>
                  <dt>Updated</dt>
                  <dd className="text-foreground">
                    {c.updated_at ? new Date(c.updated_at).toLocaleString() : '—'}
                  </dd>
                </dl>
                {c.sync_error && (
                  <div className="mt-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                    {c.sync_error}
                  </div>
                )}
              </div>
            ))}
        </CardContent>
      </Card>



      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Authorization result</CardTitle>
          {status === 'done' && <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Connected</Badge>}
          {status === 'error' && <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Failed</Badge>}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {oauthError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive">
              Roku returned an error: {oauthError}
            </div>
          )}

          {!code && !oauthError && (
            <p className="text-muted-foreground">
              No authorization code in the URL yet. Open the Roku authorization URL, approve access, and you will
              land back here automatically.
            </p>
          )}

          {code && (
            <>
              <div>
                <div className="text-muted-foreground">Authorization code</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-md border bg-muted px-3 py-2 text-xs">{code}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(code);
                      toast.success('Code copied');
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {!state && (
                <p className="text-muted-foreground">
                  No client was passed in <code>state</code>, so this code was not saved automatically. Copy it and
                  finish the connection from Settings.
                </p>
              )}

              {status === 'working' && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Exchanging the code for access tokens…
                </p>
              )}

              {message && (
                <div
                  className={
                    status === 'error'
                      ? 'rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive'
                      : 'rounded-md border bg-muted p-3'
                  }
                >
                  {message}
                </div>
              )}

              {status === 'error' && (
                <Button size="sm" onClick={exchange}>Retry exchange</Button>
              )}
            </>
          )}

          <div>
            <Link className="text-sm underline" to="/settings">Back to Settings</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
