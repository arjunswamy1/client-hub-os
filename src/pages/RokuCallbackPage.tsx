import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';

export default function RokuCallbackPage() {
  const [params] = useSearchParams();
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  const oauthError = params.get('error');

  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const redirectUri = useMemo(() => `${window.location.origin}/roku/callback`, []);

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
