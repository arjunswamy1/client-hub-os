import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Tv, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { CANNABALL_CLIENT_ID } from "@/hooks/useCannaballData";

type Conn = {
  id: string;
  status: string | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
  metadata: any;
};

type MetricRow = {
  date: string;
  entity_uid: string;
  entity_name: string | null;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  video_completions: number;
};

const fmtMoney = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function CannaballRokuSetup() {
  const [conn, setConn] = useState<Conn | null>(null);
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: connRow }, { data: metricRows }] = await Promise.all([
      supabase
        .from("platform_connections")
        .select("id, status, token_expires_at, last_synced_at, sync_error, metadata")
        .eq("platform", "roku")
        .eq("client_id", CANNABALL_CLIENT_ID)
        .maybeSingle(),
      supabase
        .from("roku_daily_metrics" as any)
        .select("date, entity_uid, entity_name, campaign_name, spend, impressions, video_completions")
        .eq("client_id", CANNABALL_CLIENT_ID)
        .eq("entity", "campaign")
        .order("date", { ascending: false })
        .limit(1000),
    ]);
    setConn((connRow ?? null) as Conn | null);
    setRows(((metricRows ?? []) as unknown as MetricRow[]));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const accounts: { uid: string; name: string }[] = useMemo(() => {
    const list = conn?.metadata?.accounts ?? [];
    return list.map((a: any) => ({ uid: a?.uid, name: a?.attributes?.name ?? a?.uid })).filter((a: any) => a.uid);
  }, [conn]);

  const byCampaign = useMemo(() => {
    const map = new Map<string, { campaign: string; spend: number; impressions: number; completions: number; lastDate: string }>();
    for (const r of rows) {
      const campaign = r.campaign_name || r.entity_name || r.entity_uid;
      const cur = map.get(campaign) ?? { campaign, spend: 0, impressions: 0, completions: 0, lastDate: r.date };
      cur.spend += Number(r.spend || 0);
      cur.impressions += Number(r.impressions || 0);
      cur.completions += Number(r.video_completions || 0);
      if (r.date > cur.lastDate) cur.lastDate = r.date;
      map.set(campaign, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.spend - a.spend);
  }, [rows]);

  const sync = async (days: number) => {
    setSyncing(days);
    try {
      const { data, error } = await supabase.functions.invoke("sync-roku-live", {
        body: { client_id: CANNABALL_CLIENT_ID, days, entity: "campaign" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const d = data as any;
      toast.success(`Roku synced — ${d.metric_rows ?? 0} campaign rows, ${d.cannaball_spend_rows ?? 0} spend rows`);
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
              <CardDescription>Pulls Cannaball campaign spend, impressions and completions into this dashboard.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={syncing !== null} onClick={() => sync(2)} className="gap-1.5">
                {syncing === 2 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync now
              </Button>
              <Button size="sm" variant="outline" disabled={syncing !== null} onClick={() => sync(7)} className="gap-1.5">
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
              No Roku connection saved for Cannaball yet. An admin can link it from the Roku Connections page.
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
                  <p className="mt-1">
                    {conn.last_synced_at ? format(new Date(conn.last_synced_at), "MMM d, h:mm a") : "Never"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Access valid until</p>
                  <p className="mt-1">
                    {conn.token_expires_at ? format(new Date(conn.token_expires_at), "MMM d, h:mm a") : "—"}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Ad accounts</p>
                <p className="mt-1">{accounts.length ? accounts.map((a) => a.name).join(", ") : "None cached — reconnect Roku"}</p>
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

      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Roku campaign delivery</CardTitle>
          <CardDescription>All synced days for Cannaball, newest activity first.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Campaign</th>
                <th className="px-3 py-2 font-medium">Last day</th>
                <th className="px-3 py-2 text-right font-medium">Spend</th>
                <th className="px-3 py-2 text-right font-medium">Impressions</th>
                <th className="px-3 py-2 text-right font-medium">Completions</th>
              </tr>
            </thead>
            <tbody>
              {byCampaign.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                    Nothing synced yet — run a sync above.
                  </td>
                </tr>
              ) : (
                byCampaign.map((r) => (
                  <tr key={r.campaign} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.campaign}</td>
                    <td className="px-3 py-2">{format(new Date(`${r.lastDate}T00:00:00`), "MMM d")}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(r.spend)}</td>
                    <td className="px-3 py-2 text-right">{r.impressions.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{r.completions.toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
