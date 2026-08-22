import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Facebook,
  Link as LinkIcon,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export interface MetaAdAccount {
  id?: string;
  account_id?: string;
  name?: string;
}

interface Props {
  clientId: string;
  clientLabel: string;
  blurb?: string;
}

export default function MetaConnectionCard({ clientId, clientLabel, blurb }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const { data: conn, refetch } = useQuery({
    queryKey: ["meta-connection", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_connections")
        .select("*")
        .eq("client_id", clientId)
        .eq("platform", "meta")
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const accounts: MetaAdAccount[] = conn?.metadata?.ad_accounts || [];
  const selected: MetaAdAccount | null = conn?.selected_ad_account || null;
  const active = conn?.status === "active";

  const connect = async () => {
    setBusy("connect");
    try {
      const { data, error } = await supabase.functions.invoke("meta-oauth-initiate", {
        body: { client_id: clientId },
      });
      if (error) throw error;
      if (!data?.url) throw new Error("No redirect URL returned");
      window.location.href = data.url;
    } catch (e: any) {
      toast.error(`Could not start Meta authorization: ${e.message}`);
      setBusy(null);
    }
  };

  const selectAccount = async (accountId: string) => {
    const account = accounts.find((a) => (a.id || a.account_id) === accountId);
    if (!account || !conn) return;
    setBusy("account");
    try {
      const { error } = await supabase
        .from("platform_connections")
        .update({ selected_ad_account: account as never })
        .eq("id", conn.id);
      if (error) throw error;
      toast.success(`Ad account set to ${account.name || accountId}`);
      await refetch();
    } catch (e: any) {
      toast.error(e.message || "Could not save the ad account");
    } finally {
      setBusy(null);
    }
  };

  const sync = async (daysBack: number) => {
    if (!selected) {
      toast.error("Pick the ad account to report on first");
      return;
    }
    setBusy("sync");
    try {
      const { error } = await supabase.functions.invoke("sync-meta-ads", {
        body: { client_id: clientId, days_back: daysBack },
      });
      if (error) throw error;
      toast.success("Meta sync complete");
      await refetch();
    } catch (e: any) {
      toast.error(e.message || "Sync failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="rounded-md bg-accent p-2">
          <Facebook className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Meta Ads</p>
            <Badge variant={active ? "default" : "secondary"} className="text-[10px]">
              {active ? (
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </span>
              ) : conn ? (
                conn.status
              ) : (
                "Not connected"
              )}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {blurb ||
              `Pulls campaigns, ad sets and creative-level spend for ${clientLabel} so cost per call is accurate.`}
          </p>
          {conn && (
            <p className="mt-1 text-xs text-muted-foreground">
              {conn.account_name || conn.account_id || "Account linked"}
              {conn.last_synced_at &&
                ` · last sync ${format(new Date(conn.last_synced_at), "MMM d, h:mm a")}`}
              {conn.last_sync_records != null && ` · ${conn.last_sync_records} records`}
            </p>
          )}
          {conn?.sync_error && (
            <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {conn.sync_error}
            </p>
          )}

          {conn && accounts.length > 0 && (
            <div className="mt-2 max-w-sm">
              <p className="mb-1 text-xs font-medium">Ad account to report on</p>
              <Select
                value={selected?.id || selected?.account_id || undefined}
                onValueChange={selectAccount}
                disabled={busy === "account"}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={`Choose the ${clientLabel} ad account`} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => {
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
          {conn && accounts.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              No ad accounts on this authorization yet — click Reconnect and grant access to the{" "}
              {clientLabel} ad account.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={active ? "outline" : "default"}
            className="h-8 gap-1.5 text-xs"
            disabled={busy === "connect"}
            onClick={connect}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            {active ? "Reconnect" : "Connect"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={!conn || busy === "sync"}
            onClick={() => sync(1)}
          >
            <PlayCircle className="h-3.5 w-3.5" />
            Test
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={!conn || busy === "sync"}
            onClick={() => sync(90)}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy === "sync" ? "animate-spin" : ""}`} />
            Sync 90 days
          </Button>
        </div>
      </div>
    </Card>
  );
}
