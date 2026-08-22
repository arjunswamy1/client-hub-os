import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { CheckCircle2, AlertTriangle, RefreshCw, Chrome, Facebook, Link as LinkIcon, ExternalLink, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { RRM_CLIENT_ID } from "@/hooks/useRRMData";
import { useRRMConnections, RRMConnection, RRMAdAccount } from "@/hooks/useRRMDrillDown";


const PLATFORMS = [
  {
    id: "google" as const,
    label: "Google Ads",
    icon: Chrome,
    blurb: "Plumbing campaigns — pulls campaigns, ad groups, keywords and search terms.",
    initiate: "google-oauth-initiate",
    sync: "sync-google-ads",
  },
  {
    id: "meta" as const,
    label: "Meta Ads",
    icon: Facebook,
    blurb: "Windows campaigns — pulls campaigns, ad sets and creative-level performance.",
    initiate: "meta-oauth-initiate",
    sync: "sync-meta-ads",
  },
];

function ErrorHint({ error, platform }: { error: string; platform: string }) {
  const lower = error.toLowerCase();
  if (lower.includes("google ads api has not been used") || lower.includes("disabled") || lower.includes("googleads.googleapis.com")) {
    const projectMatch = error.match(/project\s+(\d+)/);
    const projectId = projectMatch?.[1];
    const enableUrl = projectId
      ? `https://console.developers.google.com/apis/api/googleads.googleapis.com/overview?project=${projectId}`
      : "https://console.cloud.google.com/apis/library/googleads.googleapis.com";
    return (
      <div className="mt-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
        <p className="font-medium">Google Ads API is disabled in your Google Cloud project.</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>Click the link below and enable the Google Ads API.</li>
          <li>Wait 2–3 minutes for the change to propagate.</li>
          <li>Click <strong>Reconnect</strong> to refresh credentials, then <strong>Test</strong>.</li>
        </ol>
        <a
          href={enableUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 font-medium underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open Google Cloud console
        </a>
      </div>
    );
  }
  if (lower.includes("authorization expired") || lower.includes("invalid_grant") || lower.includes("token")) {
    return (
      <p className="mt-1 text-xs text-destructive">
        Authorization expired or token invalid — click <strong>Reconnect</strong> to refresh credentials.
      </p>
    );
  }
  return (
    <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      {error}
    </p>
  );
}

export default function RRMConnections() {
  const { data: connections = [], refetch } = useRRMConnections();
  const [busy, setBusy] = useState<string | null>(null);

  const connect = async (platform: "google" | "meta", fn: string) => {
    setBusy(platform);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body: { client_id: RRM_CLIENT_ID } });
      if (error) throw error;
      if (!data?.url) throw new Error("No redirect URL returned");
      window.location.href = data.url;
    } catch (e: any) {
      toast.error(`Could not start ${platform} authorization: ${e.message}`);
      setBusy(null);
    }
  };

  const sync = async (platform: string, fn: string, daysBack: number) => {
    setBusy(`sync-${platform}`);
    try {
      const { error } = await supabase.functions.invoke(fn, { body: { client_id: RRM_CLIENT_ID, days_back: daysBack } });
      if (error) throw error;
      toast.success(`${platform === "google" ? "Google" : "Meta"} sync complete`);
      await refetch();
    } catch (e: any) {
      toast.error(e.message || "Sync failed");
    } finally {
      setBusy(null);
    }
  };

  const persistAdAccount = async (conn: RRMConnection, account: RRMAdAccount) => {
    const { error } = await supabase
      .from("platform_connections")
      .update({ selected_ad_account: account as never })
      .eq("id", conn.id);
    if (error) throw error;
  };

  const selectAdAccount = async (conn: RRMConnection, accountId: string) => {
    const account = (conn.metadata?.ad_accounts || []).find((a) => (a.id || a.account_id) === accountId);
    if (!account) return;
    setBusy(`account-${conn.platform}`);
    try {
      await persistAdAccount(conn, account);
      toast.success(`Ad account set to ${account.name || accountId}`);
      await refetch();
    } catch (e: any) {
      toast.error(e.message || "Could not save the ad account");
    } finally {
      setBusy(null);
    }
  };

  // Auto-save a default when there is exactly one ad account and none is stored yet
  useEffect(() => {
    connections.forEach((conn) => {
      const accounts = conn.metadata?.ad_accounts || [];
      const stored = conn.selected_ad_account?.id || conn.selected_ad_account?.account_id;
      if (stored || accounts.length !== 1) return;
      if (autoSaved.current.has(conn.id)) return;
      autoSaved.current.add(conn.id);
      persistAdAccount(conn, accounts[0])
        .then(() => refetch())
        .catch(() => autoSaved.current.delete(conn.id));
    });
  }, [connections, refetch]);





  return (
    <div className="space-y-3">
      {PLATFORMS.map((p) => {
        const conn = connections.find((c) => c.platform === p.id);
        const active = conn?.status === "active";
        const Icon = p.icon;
        return (
          <Card key={p.id} className="p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="rounded-md bg-accent p-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{p.label}</p>
                  <Badge variant={active ? "default" : "secondary"} className="text-[10px]">
                    {active ? (
                      <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Connected</span>
                    ) : conn ? conn.status : "Not connected"}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.blurb}</p>
                {conn && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {conn.account_name || conn.account_id || "Account linked"}
                    {conn.last_synced_at &&
                      ` · last sync ${format(new Date(conn.last_synced_at), "MMM d, h:mm a")}`}
                    {conn.last_sync_records != null && ` · ${conn.last_sync_records} records`}
                  </p>
                )}
                {conn?.sync_error && <ErrorHint error={conn.sync_error} platform={p.id} />}
                {conn && (conn.metadata?.ad_accounts?.length ?? 0) > 0 && (
                  <div className="mt-2 max-w-sm">
                    <p className="mb-1 text-xs font-medium">Ad account to report on</p>
                    <Select
                      value={conn.selected_ad_account?.id || conn.selected_ad_account?.account_id || undefined}
                      onValueChange={(v) => selectAdAccount(conn, v)}
                      disabled={busy === `account-${p.id}`}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Choose the RRM ad account" />
                      </SelectTrigger>
                      <SelectContent>
                        {(conn.metadata?.ad_accounts || []).map((a: RRMAdAccount) => {
                          const value = a.id || a.account_id || "";
                          return (
                            <SelectItem key={value} value={value} className="text-xs">
                              {a.name || value} {a.account_id ? `(${a.account_id})` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={active ? "outline" : "default"}
                  className="h-8 gap-1.5 text-xs"
                  disabled={busy === p.id}
                  onClick={() => connect(p.id, p.initiate)}
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                  {active ? "Reconnect" : "Connect"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  disabled={!conn || busy === `sync-${p.id}`}
                  onClick={() => sync(p.id, p.sync, 1)}
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  Test
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  disabled={!conn || busy === `sync-${p.id}`}
                  onClick={() => sync(p.id, p.sync, 90)}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy === `sync-${p.id}` ? "animate-spin" : ""}`} />
                  Sync 90 days
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Authorize with the account that has access to RRM's Google Ads and Meta ad accounts. After connecting, run a sync
        to backfill 90 days of campaign, ad group/ad set, keyword, search term and creative data.
      </p>
    </div>
  );
}
