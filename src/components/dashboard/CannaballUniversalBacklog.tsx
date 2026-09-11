import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { CANNABALL_CLIENT_ID } from "@/hooks/useCannaballData";
import { differenceInCalendarDays, parseISO, format } from "date-fns";

interface BacklogRow {
  date: string;
  campaign: string;
  calls: number;
  dids: number;
  spend: number | null;
  impressions: number | null;
  hasGeo: boolean;
}

function useUniversalBacklog() {
  return useQuery({
    queryKey: ["cannaball-universal-backlog"],
    queryFn: async (): Promise<BacklogRow[]> => {
      const [callsRes, spendRes, geoRes] = await Promise.all([
        supabase
          .from("cannaball_calls" as any)
          .select("call_start, campaign_name, did")
          .eq("client_id", CANNABALL_CLIENT_ID)
          .eq("platform", "universal_ads")
          .limit(20000),
        supabase
          .from("cannaball_spend" as any)
          .select("date, campaign_name, spend, impressions")
          .eq("client_id", CANNABALL_CLIENT_ID)
          .eq("platform", "universal_ads")
          .limit(20000),
        supabase
          .from("universal_ads_geo_metrics" as any)
          .select("date")
          .eq("client_id", CANNABALL_CLIENT_ID)
          .limit(20000),
      ]);
      if (callsRes.error) throw callsRes.error;
      if (spendRes.error) throw spendRes.error;
      if (geoRes.error) throw geoRes.error;

      const spendMap = new Map<string, { spend: number; impressions: number }>();
      for (const r of (spendRes.data || []) as any[]) {
        const key = `${r.date}|${r.campaign_name ?? "—"}`;
        const prev = spendMap.get(key) ?? { spend: 0, impressions: 0 };
        spendMap.set(key, {
          spend: prev.spend + Number(r.spend || 0),
          impressions: prev.impressions + Number(r.impressions || 0),
        });
      }
      const spendByDate = new Map<string, { spend: number; impressions: number }>();
      for (const r of (spendRes.data || []) as any[]) {
        const prev = spendByDate.get(r.date) ?? { spend: 0, impressions: 0 };
        spendByDate.set(r.date, {
          spend: prev.spend + Number(r.spend || 0),
          impressions: prev.impressions + Number(r.impressions || 0),
        });
      }
      const geoDates = new Set(((geoRes.data || []) as any[]).map((r) => r.date));

      const grouped = new Map<string, { calls: number; dids: Set<string> }>();
      for (const c of (callsRes.data || []) as any[]) {
        const date = String(c.call_start).slice(0, 10);
        const key = `${date}|${c.campaign_name ?? "—"}`;
        const g = grouped.get(key) ?? { calls: 0, dids: new Set<string>() };
        g.calls += 1;
        if (c.did) g.dids.add(c.did);
        grouped.set(key, g);
      }

      return Array.from(grouped.entries())
        .map(([key, g]) => {
          const [date, campaign] = key.split("|");
          const s = spendMap.get(key) ?? spendByDate.get(date) ?? null;
          return {
            date,
            campaign,
            calls: g.calls,
            dids: g.dids.size,
            spend: s ? s.spend : null,
            impressions: s ? s.impressions : null,
            hasGeo: geoDates.has(date),
          };
        })
        .sort((a, b) => (a.date < b.date ? 1 : -1));
    },
  });
}

export default function CannaballUniversalBacklog() {
  const { data, isLoading, error } = useUniversalBacklog();

  const rows = data ?? [];
  const missing = rows.filter((r) => r.spend === null || r.spend === 0);
  const earliest = missing.length ? missing[missing.length - 1].date : null;
  const daysBack = earliest ? differenceInCalendarDays(new Date(), parseISO(earliest)) + 1 : 0;
  const missingCalls = missing.reduce((s, r) => s + r.calls, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Universal spend backlog</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Days with Universal Ads calls but no spend imported yet. Once the ad account authorizes the app, run a backfill
          covering the range below to fill these in.
        </p>

        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking backlog…
          </div>
        )}
        {error && <p className="text-destructive text-xs">{(error as Error).message}</p>}

        {!isLoading && !error && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Days missing spend</p>
                <p className="text-lg font-semibold">{missing.length}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Calls on those days</p>
                <p className="text-lg font-semibold">{missingCalls.toLocaleString()}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Earliest gap</p>
                <p className="text-lg font-semibold">
                  {earliest ? format(parseISO(earliest), "MMM d, yyyy") : "—"}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Backfill window needed</p>
                <p className="text-lg font-semibold">{daysBack ? `${daysBack} days` : "—"}</p>
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="text-muted-foreground text-xs">No Universal Ads calls recorded yet.</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">DIDs</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">Impressions</TableHead>
                      <TableHead>Geo data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const gap = r.spend === null || r.spend === 0;
                      return (
                        <TableRow key={`${r.date}-${r.campaign}`} className={gap ? "bg-destructive/5" : undefined}>
                          <TableCell className="font-medium">{format(parseISO(r.date), "MMM d")}</TableCell>
                          <TableCell className="text-xs">{r.campaign}</TableCell>
                          <TableCell className="text-right">{r.calls.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{r.dids}</TableCell>
                          <TableCell className="text-right">
                            {gap ? (
                              <Badge variant="destructive" className="gap-1">
                                <AlertTriangle className="h-3 w-3" /> Missing
                              </Badge>
                            ) : (
                              `$${Number(r.spend).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.impressions ? r.impressions.toLocaleString() : "—"}
                          </TableCell>
                          <TableCell>
                            {r.hasGeo ? (
                              <Badge variant="secondary" className="gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Loaded
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Pending</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
