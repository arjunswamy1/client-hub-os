import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, MapPin, LayoutGrid, Info } from "lucide-react";
import { toast } from "sonner";
import {
  useRokuBreakdowns, useSyncRokuBreakdowns, useJacuzziRingfuelGeo, JacuzziLead,
} from "@/hooks/useJacuzziData";

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number) =>
  `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Full state names Roku returns -> USPS codes used by the client's lead sheet. */
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

const toCode = (raw: string) => {
  const s = (raw || "").trim();
  if (!s) return "—";
  if (s.length === 2) return s.toUpperCase();
  return STATE_CODES[s.toLowerCase()] ?? s.toUpperCase();
};

interface Props {
  /** Recognized leads already scoped to the dashboard's date range + filters. */
  leads: JacuzziLead[];
}

export default function JacuzziGeoPlacement({ leads }: Props) {
  const { data: rows = [], isLoading, refetch } = useRokuBreakdowns();
  const { data: rfCalls = [] } = useJacuzziRingfuelGeo();
  const sync = useSyncRokuBreakdowns();
  const [syncing, setSyncing] = useState(false);

  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await sync(90);
      const parts = Object.entries(res?.results ?? {}).map(([k, v]) => `${k}: ${v}`);
      toast.success("Roku breakdown sync", {
        description: parts.length
          ? `${parts.join(" · ")}. Reports are async — press again in ~1 min to collect finished ones.`
          : "Requested.",
      });
      await refetch();
    } catch (e) {
      toast.error("Sync failed", { description: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  };

  /** Roku geo spend + client-recognized leads + raw tracked calls, joined on state. */
  const geo = useMemo(() => {
    const map = new Map<string, {
      state: string; spend: number; impressions: number;
      leads: number; calls: number; qr: number; revenue: number; rawCalls: number;
    }>();
    const get = (code: string) => {
      const cur = map.get(code) ?? {
        state: code, spend: 0, impressions: 0, leads: 0, calls: 0, qr: 0, revenue: 0, rawCalls: 0,
      };
      map.set(code, cur);
      return cur;
    };

    rows.filter((r) => r.entity === "state").forEach((r) => {
      const c = get(toCode(r.entity_name));
      c.spend += r.spend;
      c.impressions += r.impressions;
    });
    leads.forEach((l) => {
      const c = get(toCode(l.billing_state || ""));
      c.leads += 1;
      if (l.lead_type === "qr") c.qr += 1; else c.calls += 1;
      c.revenue += Number(l.payout_rate || 0);
    });
    rfCalls.forEach((r) => {
      get(toCode(r.caller_state || "")).rawCalls += 1;
    });

    return Array.from(map.values())
      .map((r) => ({
        ...r,
        cpl: r.leads > 0 ? r.spend / r.leads : 0,
        cpCall: r.calls > 0 ? r.spend / r.calls : 0,
        cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : 0,
        profit: r.revenue - r.spend,
        margin: r.revenue > 0 ? (r.revenue - r.spend) / r.revenue : 0,
      }))
      .sort((a, b) => b.spend - a.spend || b.leads - a.leads);
  }, [rows, leads, rfCalls]);

  const hasGeoSpend = geo.some((g) => g.spend > 0);

  const group = (entity: string) => {
    const map = new Map<string, { name: string; spend: number; impressions: number }>();
    rows.filter((r) => r.entity === entity).forEach((r) => {
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
  };

  const dmas = useMemo(() => group("dma"), [rows]);
  const placements = useMemo(() => group("placement"), [rows]);
  const creatives = useMemo(() => group("creative"), [rows]);

  /** Leads by DMA aren't available, so metro reads are efficiency-of-delivery only. */
  const bestCpm = placements.length ? Math.min(...placements.map((p) => p.cpm).filter((v) => v > 0)) : 0;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Geo &amp; placement performance</p>
          <p className="text-xs text-muted-foreground">
            Roku spend broken out by state, metro market, placement and creative, joined to
            client-recognized leads by billing state and to RingFuel tracked calls by caller state.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={runSync} disabled={syncing}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync Roku breakdowns"}
        </Button>
      </Card>

      {!isLoading && !rows.length && (
        <Card className="flex items-start gap-2 p-4 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            No Roku breakdown rows yet for this range. Hit "Sync Roku breakdowns" — Roku builds these
            reports asynchronously, so press it a second time after about a minute to collect them.
            Lead-side geo below still works from the imported client sheet.
          </span>
        </Card>
      )}

      <Tabs defaultValue="states" className="space-y-4">
        <TabsList className="inline-flex w-auto bg-secondary/50">
          <TabsTrigger value="states" className="gap-1.5 text-xs"><MapPin className="h-3.5 w-3.5" /> States</TabsTrigger>
          <TabsTrigger value="metros" className="text-xs">Metro markets</TabsTrigger>
          <TabsTrigger value="placement" className="gap-1.5 text-xs"><LayoutGrid className="h-3.5 w-3.5" /> Placement</TabsTrigger>
          <TabsTrigger value="creative" className="text-xs">Creative</TabsTrigger>
        </TabsList>

        <TabsContent value="states">
          <Card className="overflow-hidden">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">State</th>
                    <th className="p-2 text-right">Spend</th>
                    <th className="p-2 text-right">Impressions</th>
                    <th className="p-2 text-right">CPM</th>
                    <th className="p-2 text-right">Tracked calls</th>
                    <th className="p-2 text-right">Recognized leads</th>
                    <th className="p-2 text-right">Cost / lead</th>
                    <th className="p-2 text-right">Cost / call</th>
                    <th className="p-2 text-right">Revenue</th>
                    <th className="p-2 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {geo.map((g) => (
                    <tr key={g.state} className="border-t border-border">
                      <td className="p-2 font-medium">{g.state}</td>
                      <td className="p-2 text-right">{g.spend > 0 ? money(g.spend) : "—"}</td>
                      <td className="p-2 text-right">{g.impressions ? g.impressions.toLocaleString() : "—"}</td>
                      <td className="p-2 text-right">{g.cpm > 0 ? money2(g.cpm) : "—"}</td>
                      <td className="p-2 text-right">{g.rawCalls || "—"}</td>
                      <td className="p-2 text-right">
                        {g.leads || "—"}
                        {g.qr > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({g.qr} QR)</span>}
                      </td>
                      <td className="p-2 text-right">{g.cpl > 0 ? money2(g.cpl) : "—"}</td>
                      <td className="p-2 text-right">{g.cpCall > 0 ? money2(g.cpCall) : "—"}</td>
                      <td className="p-2 text-right">{g.revenue > 0 ? money(g.revenue) : "—"}</td>
                      <td className={`p-2 text-right ${g.spend > 0 && g.profit < 0 ? "text-red-500" : g.profit > 0 ? "text-green-600" : ""}`}>
                        {g.spend > 0 || g.revenue > 0 ? money(g.profit) : "—"}
                      </td>
                    </tr>
                  ))}
                  {!geo.length && (
                    <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No geo data in range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          {!hasGeoSpend && !!geo.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              Spend by state is empty for this range — cost per call in TX vs FL needs the Roku state
              report synced above. Lead and tracked-call counts by state are live now.
            </p>
          )}
        </TabsContent>

        <TabsContent value="metros">
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
                  </tr>
                </thead>
                <tbody>
                  {dmas.map((d) => (
                    <tr key={d.name} className="border-t border-border">
                      <td className="p-2">{d.name}</td>
                      <td className="p-2 text-right">{money(d.spend)}</td>
                      <td className="p-2 text-right">{(d.share * 100).toFixed(1)}%</td>
                      <td className="p-2 text-right">{d.impressions.toLocaleString()}</td>
                      <td className="p-2 text-right">{money2(d.cpm)}</td>
                    </tr>
                  ))}
                  {!dmas.length && (
                    <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Sync Roku breakdowns to populate metro markets.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="placement" className="space-y-3">
          <Card className="flex items-start gap-2 p-4 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Roku's reporting API does not expose content genre — the available breakdowns are
              placement, metro market, state, postal code and creative. Placement is the lever for
              inventory-mix optimization: shift budget toward placements delivering impressions at a
              lower CPM while calls hold, and cap the expensive tail.
            </span>
          </Card>
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
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Sync Roku breakdowns to populate placements.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="creative">
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-2 text-left">Creative</th>
                  <th className="p-2 text-right">Spend</th>
                  <th className="p-2 text-right">Share</th>
                  <th className="p-2 text-right">Impressions</th>
                  <th className="p-2 text-right">CPM</th>
                </tr>
              </thead>
              <tbody>
                {creatives.map((c) => (
                  <tr key={c.name} className="border-t border-border">
                    <td className="p-2">{c.name}</td>
                    <td className="p-2 text-right">{money(c.spend)}</td>
                    <td className="p-2 text-right">{(c.share * 100).toFixed(1)}%</td>
                    <td className="p-2 text-right">{c.impressions.toLocaleString()}</td>
                    <td className="p-2 text-right">{money2(c.cpm)}</td>
                  </tr>
                ))}
                {!creatives.length && (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Sync Roku breakdowns to populate creatives.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
