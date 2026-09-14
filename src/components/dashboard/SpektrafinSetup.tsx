import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Tv, AlertTriangle, Copy, Phone } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  SPEKTRAFIN_CLIENT_ID,
  useSpektrafinNumbers,
  useSyncSpektrafinRoku,
} from "@/hooks/useSpektrafinData";

type Conn = {
  id: string;
  status: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
  metadata: any;
};

const WEBHOOK_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ringfuel-webhook?client_id=${SPEKTRAFIN_CLIENT_ID}`;

const formatPhone = (v: string) => {
  const m = String(v).match(/(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : v;
};

export default function SpektrafinSetup() {
  const [conn, setConn] = useState<Conn | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<number | null>(null);
  const { data: numbers = [] } = useSpektrafinNumbers();
  const syncRoku = useSyncSpektrafinRoku();

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("platform_connections")
      .select("id, status, token_expires_at, last_synced_at, sync_error, metadata")
      .eq("platform", "roku")
      .eq("client_id", SPEKTRAFIN_CLIENT_ID)
      .maybeSingle();
    setConn((data ?? null) as Conn | null);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const accounts: string[] = useMemo(() => {
    const list = conn?.metadata?.accounts ?? [];
    return list.map((a: any) => a?.attributes?.name ?? a?.uid).filter(Boolean);
  }, [conn]);

  const run = async (days: number) => {
    setSyncing(days);
    try {
      const data = await syncRoku(days);
      toast.success(`Roku synced — ${data?.metric_rows ?? 0} campaign rows`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Tv className="h-4 w-4" />
                Roku Ads connection
              </CardTitle>
              <CardDescription>
                Spektrafin uses its own Roku login. Link it on the Roku Connections page, then sync here.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={syncing !== null} onClick={() => run(2)} className="gap-1.5">
                {syncing === 2 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync now
              </Button>
              <Button size="sm" variant="outline" disabled={syncing !== null} onClick={() => run(7)} className="gap-1.5">
                {syncing === 7 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Backfill 7 days
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : !conn ? (
            <p className="text-muted-foreground">
              No Roku account linked for Spektrafin yet — connect their Roku login from the Roku Connections page,
              then come back and press Sync now.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                  <Badge variant={conn.status === "active" ? "default" : "destructive"} className="mt-1">
                    {conn.status ?? "unknown"}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Last synced</p>
                  <p className="mt-1">{conn.last_synced_at ? format(new Date(conn.last_synced_at), "MMM d, h:mm a") : "Never"}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Ad accounts</p>
                  <p className="mt-1">{accounts.length ? accounts.join(", ") : "None cached — reconnect Roku"}</p>
                </div>
              </div>
              {conn.sync_error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{conn.sync_error}</span>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4" />
            RingFuel call feed
          </CardTitle>
          <CardDescription>
            RingFuel is the source of truth for calls and payout. Paste this endpoint into RingFuel's webhook
            settings for Spektrafin — it also needs the shared secret already stored here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md bg-muted px-2 py-1.5 text-xs">{WEBHOOK_URL}</code>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                navigator.clipboard.writeText(WEBHOOK_URL);
                toast.success("Webhook URL copied");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              Tracking numbers ({numbers.length}) — one per creative
            </p>
            {numbers.length === 0 ? (
              <p className="text-muted-foreground">
                No numbers minted for Spektrafin yet. Mint one per creative on the RingFuel Numbers page so every
                call lands against the creative that produced it.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-2 py-1.5 font-medium">Number</th>
                    <th className="px-2 py-1.5 font-medium">Creative</th>
                    <th className="px-2 py-1.5 font-medium">Campaign</th>
                    <th className="px-2 py-1.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {numbers.map((n: any) => (
                    <tr key={n.id} className="border-t">
                      <td className="px-2 py-1.5 font-mono text-xs">{formatPhone(n.phone_number)}</td>
                      <td className="px-2 py-1.5">{n.creative_label || "—"}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{n.campaign_label || "—"}</td>
                      <td className="px-2 py-1.5">{n.status || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
