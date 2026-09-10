import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, MapPin, Building2, Info } from "lucide-react";
import { toast } from "sonner";
import {
  CannaballCall, useCannaballBreakdowns, useSyncCannaballBreakdowns,
  useCannaballUniversalGeo, useSyncCannaballUniversalGeo,
} from "@/hooks/useCannaballData";

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Roku reports full state names; call records carry USPS codes. */
const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};

const toCode = (raw?: string | null) => {
  const s = (raw || "").trim();
  if (!s) return "—";
  if (s.length === 2) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase()] ?? s.toUpperCase();
};

interface Props {
  /** Calls already scoped to the dashboard date range. */
  calls: CannaballCall[];
  /** Which media channel the dashboard is filtered to. */
  channel: "all" | "roku" | "universal_ads";
}

export default function CannaballGeo({ calls, channel }: Props) {
  const { data: rows = [], isLoading, refetch } = useCannaballBreakdowns();
  const { data: uaRows = [], refetch: refetchUa } = useCannaballUniversalGeo();
  const sync = useSyncCannaballBreakdowns();
  const syncUniversal = useSyncCannaballUniversalGeo();
  const [syncing, setSyncing] = useState(false);

  const universalOnly = channel === "universal_ads";
  const useRoku = channel !== "universal_ads";
  const useUniversal = channel !== "roku";
  const uaScoped = useMemo(() => (useUniversal ? uaRows : []), [uaRows, useUniversal]);
  const uaBy = (entity: string) => uaScoped.filter((r) => r.entity === entity);
  /** Spend can only be attributed to calls on the same channel. */
  const geoCalls = useMemo(
    () => (channel === "all" ? calls : calls.filter((c) => c.platform === channel)),
    [calls, channel],
  );

  const runSync = async () => {
    setSyncing(true);
    try {
      const parts: string[] = [];
      if (useRoku) {
        const res = await sync(45);
        parts.push(...Object.entries(res?.results ?? {}).map(([k, v]) => `Roku ${k}: ${v}`));
      }
      if (useUniversal) {
        try {
          const ua = await syncUniversal(45);
          parts.push(...Object.entries(ua?.results ?? {}).map(([k, v]) => `Universal ${k}: ${v}`));
        } catch (e) {
          parts.push(`Universal: ${(e as Error).message}`);
        }
      }
      toast.success("Geo sync", { description: parts.length ? parts.join(" · ") : "Requested." });
      await Promise.all([refetch(), refetchUa()]);
    } catch (e) {
      toast.error("Sync failed", { description: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  };


  /** State-level spend from Roku joined to calls by caller state. */
  const states = useMemo(() => {
    const map = new Map<string, {
      state: string; spend: number; impressions: number;
      calls: number; connected: number; revenue: number;
    }>();
    const get = (code: string) => {
      const cur = map.get(code) ?? {
        state: code, spend: 0, impressions: 0, calls: 0, connected: 0, revenue: 0,
      };
      map.set(code, cur);
      return cur;
    };

    if (useRoku) {
      rows.filter((r) => r.entity === "state").forEach((r) => {
        const c = get(toCode(r.entity_name));
        c.spend += r.spend;
        c.impressions += r.impressions;
      });
    }
    uaBy("state").forEach((r) => {
      const c = get(toCode(r.entity_name));
      c.spend += r.spend;
      c.impressions += r.impressions;
    });

    geoCalls.forEach((call) => {
      const c = get(toCode(call.caller_state));
      c.calls += 1;
      if (call.connected) c.connected += 1;
      c.revenue += Number(call.payout || 0);
    });

    return Array.from(map.values())
      .map((r) => ({
        ...r,
        cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
        cpCall: r.calls > 0 ? r.spend / r.calls : 0,
        cpConn: r.connected > 0 ? r.spend / r.connected : 0,
        connectRate: r.calls > 0 ? r.connected / r.calls : 0,
        profit: r.revenue - r.spend,
      }))
      .sort((a, b) => b.spend - a.spend || b.calls - a.calls);
  }, [rows, uaScoped, geoCalls, useRoku]);

  /** Metro-market spend, with calls matched on caller city + state within the DMA name. */
  const dmas = useMemo(() => {
    const map = new Map<string, { name: string; spend: number; impressions: number; calls: number; connected: number; revenue: number }>();
    const addSpend = (name: string, spend: number, impressions: number) => {
      const cur = map.get(name) ?? { name, spend: 0, impressions: 0, calls: 0, connected: 0, revenue: 0 };
      cur.spend += spend;
      cur.impressions += impressions;
      map.set(name, cur);
    };
    if (useRoku) rows.filter((r) => r.entity === "dma").forEach((r) => addSpend(r.entity_name, r.spend, r.impressions));
    uaBy("dma").forEach((r) => addSpend(r.entity_name, r.spend, r.impressions));


    // Roku names DMAs after their anchor cities and appends state codes: "Raleigh-Durham (Fayetteville) NC".
    const cityIndex = Array.from(map.values()).map((d) => {
      const stateCodes = (d.name.match(/\b[A-Z]{2}\b/g) ?? []).map((s) => s.toUpperCase());
      const cities = d.name
        .replace(/\b[A-Z]{2}\b/g, " ")
        .toLowerCase()
        .split(/[-,/&()]| and /)
        .map((s) => s.trim())
        .filter(Boolean);
      return { key: d.name, cities, stateCodes };
    });

    let matched = 0;
    geoCalls.forEach((call) => {
      const city = (call.caller_city || "").trim().toLowerCase();
      if (!city) return;
      const state = toCode(call.caller_state);
      const hit =
        cityIndex.find((d) => d.cities.includes(city) && d.stateCodes.includes(state)) ??
        cityIndex.find((d) => d.cities.includes(city));
      if (!hit) return;
      const row = map.get(hit.key)!;
      row.calls += 1;
      if (call.connected) row.connected += 1;
      row.revenue += Number(call.payout || 0);
      matched += 1;
    });

    const total = Array.from(map.values()).reduce((s, r) => s + r.spend, 0);
    const list = Array.from(map.values())
      .map((r) => ({
        ...r,
        cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
        cpCall: r.calls > 0 ? r.spend / r.calls : 0,
        share: total > 0 ? r.spend / total : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
    return { list, matched };
  }, [rows, geoCalls]);

  /** ZIP-level call performance straight from CallGrid (no spend is reported per ZIP). */
  const zips = useMemo(() => {
    const map = new Map<string, {
      zip: string; state: string; city: string; calls: number; connected: number; revenue: number; talk: number;
    }>();
    geoCalls.forEach((call) => {
      const zip = (call.caller_zip || "").trim().slice(0, 5);
      if (!zip) return;
      const cur = map.get(zip) ?? {
        zip, state: toCode(call.caller_state), city: call.caller_city || "—",
        calls: 0, connected: 0, revenue: 0, talk: 0,
      };
      cur.calls += 1;
      if (call.connected) cur.connected += 1;
      cur.revenue += Number(call.payout || 0);
      cur.talk += Number(call.connection_duration_seconds || 0);
      map.set(zip, cur);
    });
    const list = Array.from(map.values())
      .map((r) => ({
        ...r,
        connectRate: r.calls > 0 ? r.connected / r.calls : 0,
        avgTalk: r.connected > 0 ? r.talk / r.connected : 0,
      }))
      .sort((a, b) => b.calls - a.calls || b.revenue - a.revenue);
    const withZip = geoCalls.filter((c) => (c.caller_zip || "").trim()).length;
    return { list, withZip };
  }, [geoCalls]);

  const placements = useMemo(() => {
    const map = new Map<string, { name: string; spend: number; impressions: number }>();
    rows.filter((r) => r.entity === "placement").forEach((r) => {
      const cur = map.get(r.entity_name) ?? { name: r.entity_name, spend: 0, impressions: 0 };
      cur.spend += r.spend;
      cur.impressions += r.impressions;
      map.set(r.entity_name, cur);
    });
    const total = Array.from(map.values()).reduce((s, r) => s + r.spend, 0);
    return Array.from(map.values())
      .map((r) => ({
        ...r,
        cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
        share: total > 0 ? r.spend / total : 0,
      }))
      .sort((a, b) => b.spend - a.spend);
  }, [rows]);

  const bestCpm = placements.length ? Math.min(...placements.map((p) => p.cpm).filter((v) => v > 0)) : 0;
  const hasSpend = states.some((s) => s.spend > 0);
  const spendTotal = states.reduce((s, r) => s + r.spend, 0);
  const callTotal = states.reduce((s, r) => s + r.calls, 0);
  const avgCpCall = callTotal > 0 ? spendTotal / callTotal : 0;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Geo performance</p>
          <p className="text-xs text-muted-foreground">
            Roku delivery by state, metro market (DMA) and placement, joined to CallGrid calls by
            caller location. Universal Ads geo joins in once its API access is approved.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={runSync} disabled={syncing}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync Roku geo"}
        </Button>
      </Card>

      {universalOnly && (
        <Card className="flex items-start gap-2 p-4 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Universal Ads spend by geo is not available yet — the app is pending access. Call counts by
            state below are live from CallGrid for Universal Ads numbers.
          </span>
        </Card>
      )}

      {!isLoading && !rows.length && !universalOnly && (
        <Card className="flex items-start gap-2 p-4 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            No Roku geo rows for this range yet. Run "Sync Roku geo" — Roku builds these reports
            asynchronously, so it may take up to a minute.
          </span>
        </Card>
      )}

      <Tabs defaultValue="states" className="space-y-4">
        <TabsList className="inline-flex w-auto bg-secondary/50">
          <TabsTrigger value="states" className="gap-1.5 text-xs"><MapPin className="h-3.5 w-3.5" /> States</TabsTrigger>
          <TabsTrigger value="dmas" className="gap-1.5 text-xs"><Building2 className="h-3.5 w-3.5" /> DMA / metro</TabsTrigger>
          <TabsTrigger value="zips" className="text-xs">ZIP codes</TabsTrigger>
          <TabsTrigger value="placement" className="text-xs">Placement</TabsTrigger>
        </TabsList>

        <TabsContent value="states" className="space-y-2">
          <Card className="overflow-hidden">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">State</th>
                    <th className="p-2 text-right">Spend</th>
                    <th className="p-2 text-right">Impressions</th>
                    <th className="p-2 text-right">CPM</th>
                    <th className="p-2 text-right">Calls</th>
                    <th className="p-2 text-right">Connected</th>
                    <th className="p-2 text-right">Connect %</th>
                    <th className="p-2 text-right">Cost / call</th>
                    <th className="p-2 text-right">Cost / conn.</th>
                    <th className="p-2 text-left">Read</th>
                  </tr>
                </thead>
                <tbody>
                  {states.map((s) => {
                    const efficient = avgCpCall > 0 && s.cpCall > 0 && s.cpCall < avgCpCall * 0.75;
                    const costly = avgCpCall > 0 && s.cpCall > avgCpCall * 1.5;
                    const wasted = s.spend > 0 && s.calls === 0;
                    return (
                      <tr key={s.state} className="border-t border-border">
                        <td className="p-2 font-medium">{s.state}</td>
                        <td className="p-2 text-right">{s.spend > 0 ? money(s.spend) : "—"}</td>
                        <td className="p-2 text-right">{s.impressions ? s.impressions.toLocaleString() : "—"}</td>
                        <td className="p-2 text-right">{s.cpm > 0 ? money2(s.cpm) : "—"}</td>
                        <td className="p-2 text-right">{s.calls || "—"}</td>
                        <td className="p-2 text-right">{s.connected || "—"}</td>
                        <td className="p-2 text-right">{s.calls ? `${(s.connectRate * 100).toFixed(0)}%` : "—"}</td>
                        <td className="p-2 text-right">{s.cpCall > 0 ? money2(s.cpCall) : "—"}</td>
                        <td className="p-2 text-right">{s.cpConn > 0 ? money2(s.cpConn) : "—"}</td>
                        <td className="p-2">
                          {wasted ? (
                            <Badge variant="outline" className="text-[10px] text-red-500">Spend, no calls</Badge>
                          ) : costly ? (
                            <Badge variant="outline" className="text-[10px] text-amber-600">Above-average cost</Badge>
                          ) : efficient ? (
                            <Badge variant="secondary" className="text-[10px]">Efficient — scale</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">In line</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!states.length && (
                    <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No geo data in range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          {!hasSpend && !!states.length && !universalOnly && (
            <p className="text-xs text-muted-foreground">
              Call counts by state are live. Spend by state needs the Roku state report synced above.
            </p>
          )}
          {avgCpCall > 0 && (
            <p className="text-xs text-muted-foreground">
              Blended cost per call across states in range: {money2(avgCpCall)} — states flagged
              "Efficient" are running 25%+ below it.
            </p>
          )}
        </TabsContent>

        <TabsContent value="dmas" className="space-y-2">
          <Card className="overflow-hidden">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Metro market (DMA)</th>
                    <th className="p-2 text-right">Spend</th>
                    <th className="p-2 text-right">Share</th>
                    <th className="p-2 text-right">Impressions</th>
                    <th className="p-2 text-right">CPM</th>
                    <th className="p-2 text-right">Calls</th>
                    <th className="p-2 text-right">Cost / call</th>
                  </tr>
                </thead>
                <tbody>
                  {dmas.list.map((d) => (
                    <tr key={d.name} className="border-t border-border">
                      <td className="p-2">{d.name}</td>
                      <td className="p-2 text-right">{money(d.spend)}</td>
                      <td className="p-2 text-right">{(d.share * 100).toFixed(1)}%</td>
                      <td className="p-2 text-right">{d.impressions.toLocaleString()}</td>
                      <td className="p-2 text-right">{money2(d.cpm)}</td>
                      <td className="p-2 text-right">{d.calls || "—"}</td>
                      <td className="p-2 text-right">{d.cpCall > 0 ? money2(d.cpCall) : "—"}</td>
                    </tr>
                  ))}
                  {!dmas.list.length && (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Sync Roku geo to populate metro markets.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-xs text-muted-foreground">
            Calls are matched to a metro by the caller's city ({dmas.matched} of {geoCalls.length} calls
            matched), so DMA cost per call is directional — state-level numbers are exact.
          </p>
        </TabsContent>

        <TabsContent value="zips" className="space-y-2">
          <Card className="overflow-hidden">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">ZIP</th>
                    <th className="p-2 text-left">City</th>
                    <th className="p-2 text-left">State</th>
                    <th className="p-2 text-right">Calls</th>
                    <th className="p-2 text-right">Connected</th>
                    <th className="p-2 text-right">Connect %</th>
                    <th className="p-2 text-right">Avg talk</th>
                    <th className="p-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {zips.list.map((z) => (
                    <tr key={z.zip} className="border-t border-border">
                      <td className="p-2 font-medium">{z.zip}</td>
                      <td className="p-2">{z.city}</td>
                      <td className="p-2">{z.state}</td>
                      <td className="p-2 text-right">{z.calls}</td>
                      <td className="p-2 text-right">{z.connected || "—"}</td>
                      <td className="p-2 text-right">{`${(z.connectRate * 100).toFixed(0)}%`}</td>
                      <td className="p-2 text-right">{z.avgTalk > 0 ? `${Math.round(z.avgTalk)}s` : "—"}</td>
                      <td className="p-2 text-right">{z.revenue > 0 ? money2(z.revenue) : "—"}</td>
                    </tr>
                  ))}
                  {!zips.list.length && (
                    <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No ZIP codes on calls in range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="text-xs text-muted-foreground">
            {zips.withZip} of {geoCalls.length} calls in range carry a caller ZIP. Roku reports spend by
            state, metro and placement only, so ZIP rows show call quality rather than cost.
          </p>
        </TabsContent>

        <TabsContent value="placement">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">Placement</th>
                  <th className="p-2 text-right">Spend</th>
                  <th className="p-2 text-right">Share of spend</th>
                  <th className="p-2 text-right">Impressions</th>
                  <th className="p-2 text-right">CPM</th>
                  <th className="p-2 text-left">Read</th>
                </tr>
              </thead>
              <tbody>
                {placements.map((p) => {
                  const premium = bestCpm > 0 && p.cpm > bestCpm * 1.25;
                  return (
                    <tr key={p.name} className="border-t border-border">
                      <td className="p-2">{p.name}</td>
                      <td className="p-2 text-right">{money(p.spend)}</td>
                      <td className="p-2 text-right">{(p.share * 100).toFixed(1)}%</td>
                      <td className="p-2 text-right">{p.impressions.toLocaleString()}</td>
                      <td className="p-2 text-right">{money2(p.cpm)}</td>
                      <td className="p-2">
                        {premium ? (
                          <Badge variant="outline" className="text-[10px] text-amber-600">Above-market CPM — trim</Badge>
                        ) : bestCpm > 0 && p.cpm === bestCpm ? (
                          <Badge variant="secondary" className="text-[10px]">Most efficient</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">In line</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!placements.length && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Sync Roku geo to populate placements.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
