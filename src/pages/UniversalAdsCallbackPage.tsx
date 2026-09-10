import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Copy, Info } from 'lucide-react';
import { toast } from 'sonner';

export default function UniversalAdsCallbackPage() {
  const [params] = useSearchParams();
  const code = params.get('code') ?? '';
  const state = params.get('state') ?? '';
  const oauthError = params.get('error');

  const [status, setStatus] = useState<'idle' | 'done' | 'error'>('idle');

  const redirectUri = useMemo(() => `${window.location.origin}/universal-ads/callback`, []);

  useEffect(() => {
    if (oauthError) {
      setStatus('error');
    } else if (code) {
      setStatus('done');
    }
  }, [code, oauthError]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Universal Ads authorization</h1>
        <p className="text-sm text-muted-foreground">
          This page receives the redirect from Universal Ads if their portal requests a callback URL.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Info className="h-4 w-4" /> How the connection works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Universal Ads authenticates with an <strong>API key + private key signature</strong> on every request, not a traditional OAuth flow.
            The app credentials are already saved in this project.
          </p>
          <p className="text-muted-foreground">
            To finish connecting Cannaball, go to the Cannaball dashboard → <strong>Universal Ads</strong> tab and enter the Cannaball ad account ID.
          </p>
          <div>
            <Link to="/dashboard/cannaball">
              <Button size="sm">Open Cannaball dashboard</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Redirect URL</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md border bg-muted px-3 py-2 text-sm">{redirectUri}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(redirectUri);
                toast.success('Redirect URL copied');
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Give this exact value as the redirect URL in the Universal Ads developer portal if requested.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Authorization result</CardTitle>
          {status === 'done' && <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Redirect received</Badge>}
          {status === 'error' && <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Error</Badge>}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {oauthError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive">
              Authorization error: {oauthError}
            </div>
          )}

          {!code && !oauthError && (
            <p className="text-muted-foreground">
              No authorization code yet. If you just approved access in the Universal Ads portal, the code should appear in the URL above.
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
              {state && (
                <p className="text-muted-foreground">
                  State passed: <code>{state}</code>. You can ignore this — finish the connection from the Cannaball dashboard.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
