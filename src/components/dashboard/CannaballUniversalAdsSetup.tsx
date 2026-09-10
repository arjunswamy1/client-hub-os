import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, RefreshCw, Copy } from "lucide-react";
import { toast } from "sonner";
import { CANNABALL_CLIENT_ID } from "@/hooks/useCannaballData";

interface Connection {
  id: string;
  platform: string;
  status: string;
  account_id: string | null;
  account_name: string | null;
  metadata: any;
  updated_at: string;
}

export default function CannaballUniversalAdsSetup() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [adaccountId, setAdaccountId] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);

  const fetchConnection = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("platform_connections" as any)
        .select("id, platform, status, account_id, account_name, metadata, updated_at")
        .eq("client_id", CANNABALL_CLIENT_ID)
        .eq("platform", "universal_ads")
        .maybeSingle();
      if (error) throw error;
      const conn = data as unknown as Connection | null;
      setConnection(conn);
      setAdaccountId(conn?.account_id || "");
    } catch (e: any) {
      toast.error(e.message || "Failed to load connection");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnection();
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("universal-ads-verify", {
        body: { action: adaccountId ? "test_adaccount" : "list_adaccounts", adaccount_id: adaccountId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setTestResult(data);
      if (data?.adaccounts?.data) setAccounts(data.adaccounts.data);
      if (data?.adaccounts && Array.isArray(data.adaccounts)) setAccounts(data.adaccounts);
      toast.success(adaccountId ? "Ad account reachable" : "Credentials verified");
    } catch (e: any) {
      toast.error(e.message || "Connection test failed");
      setTestResult({ error: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!adaccountId.trim()) {
      toast.error("Enter the Cannaball ad account ID");
      return;
    }
    setSaving(true);
    try {
      const record = {
        client_id: CANNABALL_CLIENT_ID,
        platform: "universal_ads",
        status: "active",
        account_id: adaccountId.trim(),
        account_name: connection?.account_name || null,
        metadata: { platform: "Universal Ads", connected_at: new Date().toISOString() },
      };
      if (connection?.id) {
        const { error } = await supabase
          .from("platform_connections" as any)
          .update(record)
          .eq("id", connection.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("platform_connections" as any).insert(record);
        if (error) throw error;
      }
      toast.success("Universal Ads connection saved for Cannaball");
      await fetchConnection();
    } catch (e: any) {
      toast.error(e.message || "Failed to save connection");
    } finally {
      setSaving(false);
    }
  };

  const redirectUri = `${window.location.origin}/universal-ads/callback`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Universal Ads connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Universal Ads uses API-key + private-key request signing (not OAuth). The app credentials are already saved.
            To connect Cannaball, enter the Universal Ads ad account ID you want to report on.
          </p>

          <div className="space-y-2">
            <Label htmlFor="ua-adaccount">Cannaball ad account ID</Label>
            <Input
              id="ua-adaccount"
              placeholder="e.g. a1b2c3d4-e5f6-..."
              value={adaccountId}
              onChange={(e) => setAdaccountId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              This is the ad account UUID from Universal Ads that contains the Cannaball campaigns.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleTest} disabled={testing} className="gap-1.5">
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {testing ? "Testing…" : adaccountId ? "Test ad account" : "List ad accounts"}
            </Button>
            <Button size="sm" variant="outline" onClick={handleSave} disabled={saving || !adaccountId.trim()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save connection"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleSync(7)} disabled={syncing || !adaccountId.trim()} className="gap-1.5">
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync last 7 days
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleSync(45)} disabled={syncing || !adaccountId.trim()}>
              Backfill 45 days
            </Button>
          </div>

          {syncResult && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1">
              <p className="font-medium">Last spend sync</p>
              <p>
                {syncResult.rows_written} day/creative rows · ${Number(syncResult.total_spend || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} spend ·{" "}
                {Number(syncResult.total_impressions || 0).toLocaleString()} impressions
              </p>
              <p className="text-muted-foreground">
                {syncResult.range?.start} → {syncResult.range?.end} ({syncResult.level} level)
              </p>
            </div>
          )}

          {connection && (
            <div className="rounded-md border bg-muted/40 p-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Status:</span>
                <Badge variant={connection.status === "active" ? "default" : "secondary"} className="gap-1">
                  {connection.status === "active" ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {connection.status}
                </Badge>
              </div>
              <div><span className="text-muted-foreground">Saved account ID:</span> <code className="text-xs">{connection.account_id || "—"}</code></div>
              <div><span className="text-muted-foreground">Last updated:</span> {new Date(connection.updated_at).toLocaleString()}</div>
            </div>
          )}

          {testResult && !testResult.error && (
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="font-medium mb-2">Test result</p>
              {accounts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Available ad accounts:</p>
                  <ul className="space-y-1">
                    {accounts.map((a: any) => (
                      <li key={a.id || a.adaccount_id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                        <span>{a.name || a.adaccount_name || a.id || a.adaccount_id}</span>
                        <code className="text-muted-foreground">{a.id || a.adaccount_id}</code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => {
                            navigator.clipboard.writeText(a.id || a.adaccount_id);
                            toast.success("Copied account ID");
                          }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {testResult.campaigns && (
                <p className="text-xs text-muted-foreground">
                  Found {(testResult.campaigns.data ?? testResult.campaigns).length} campaign(s) in ad account.
                </p>
              )}
            </div>
          )}

          {testResult?.error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-xs">
              {testResult.error}
              {testResult.details && (
                <pre className="mt-2 whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(testResult.details, null, 2)}</pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Redirect URL (for reference)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            If Universal Ads asks for a redirect URL, use this value. The callback page only confirms the app is registered;
            actual API access is granted through the saved API key and private key.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md border bg-muted px-3 py-2 text-xs">{redirectUri}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(redirectUri);
                toast.success("Copied");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
