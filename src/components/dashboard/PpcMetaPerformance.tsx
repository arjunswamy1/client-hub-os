import { Fragment, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, Image as ImageIcon, Info, Layers, Sparkles, Target, Users } from "lucide-react";
import {
  usePpcAdSets,
  usePpcAds,
  usePpcCalls,
  usePpcCampaignConfigs,
  ppcVerticalForCampaign,
  type PpcAdRow,
  type PpcAdSetRow,
  type PpcCall,
  type PpcCampaignConfigRow,
} from "@/hooks/usePpcMediaData";

const money = (n: number) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const money2 = (n: number) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toFixed(2);
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Media metrics only. Calls never enter here — they join at campaign level, never per ad. */
interface Media {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number;
  ctr: number;
  cpc: number;
  cpm: number;
}

function media(rows: { spend?: number | null; impressions?: number | null; clicks?: number | null; reach?: number | null; frequency?: number | null }[]): Media {
  let spend = 0, impressions = 0, clicks = 0, reach = 0, freqWeighted = 0;
  for (const r of rows) {
    spend += Number(r.spend) || 0;
    impressions += Number(r.impressions) || 0;
    clicks += Number(r.clicks) || 0;
    reach = Math.max(reach, Number(r.reach) || 0);
    freqWeighted += (Number(r.frequency) || 0) * (Number(r.impressions) || 0);
  }
  return {
    spend, impressions, clicks, reach,
    frequency: impressions > 0 && freqWeighted > 0 ? freqWeighted / impressions : 0,
    ctr: impressions > 0 ? clicks / impressions : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
  };
}

const BID_LABELS: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: "Highest volume (no cap)",
  LOWEST_COST_WITH_BID_CAP: "Bid cap",
  COST_CAP: "Cost per result cap",
  LOWEST_COST_WITH_MIN_ROAS: "Minimum ROAS",
  TARGET_COST: "Target cost",
};
const GOAL_LABELS: Record<string, string> = {
  QUALITY_CALL: "Quality calls",
  LEAD_GENERATION: "Leads",
  OFFSITE_CONVERSIONS: "Conversions on site",
  LINK_CLICKS: "Link clicks",
  LANDING_PAGE_VIEWS: "Landing page views",
  IMPRESSIONS: "Impressions",
  REACH: "Reach",
  THRUPLAY: "Video plays",
};
const bidLabel = (v: string | null) => (v ? BID_LABELS[v] || v.replace(/_/g, " ").toLowerCase() : "—");
const goalLabel = (v: string | null) => (v ? GOAL_LABELS[v] || v.replace(/_/g, " ").toLowerCase() : "—");

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const s = status.toLowerCase();
  const tone = s === "active" ? "border-emerald-300 text-emerald-700 dark:text-emerald-400"
    : s === "paused" ? "border-amber-300 text-amber-700 dark:text-amber-400"
    : "border-muted text-muted-foreground";
  return <Badge variant="outline" className={`text-[10px] capitalize ${tone}`}>{s}</Badge>;
}

function MediaCells({ m }: { m: Media }) {
  return (
    <>
      <td className="p-3 text-right">{money2(m.spend)}</td>
      <td className="p-3 text-right">{num(m.impressions)}</td>
      <td className="p-3 text-right">{m.reach ? num(m.reach) : "—"}</td>
      <td className="p-3 text-right">{m.frequency ? m.frequency.toFixed(2) : "—"}</td>
      <td className="p-3 text-right">{num(m.clicks)}</td>
      <td className="p-3 text-right">{m.impressions ? pct(m.ctr) : "—"}</td>
      <td className="p-3 text-right">{m.clicks ? money2(m.cpc) : "—"}</td>
      <td className="p-3 text-right">{m.impressions ? money2(m.cpm) : "—"}</td>
    </>
  );
}

const MEDIA_HEADS = ["Spend", "Impr.", "Reach", "Freq.", "Clicks", "CTR", "CPC", "CPM"];

export default function PpcMetaPerformance() {
  const { data: campaigns = [], isLoading: cLoading } = usePpcCampaignConfigs();
  const { data: adSets = [], isLoading: sLoading } = usePpcAdSets();
  const { data: ads = [], isLoading: aLoading } = usePpcAds();
  const { data: calls = [] } = usePpcCalls();

  const [openCampaigns, setOpenCampaigns] = useState<Record<string, boolean>>({});
  const [openAdSets, setOpenAdSets] = useState<Record<string, boolean>>({});

  /** Calls per campaign name — the deepest level the click-to-call tracking can name. */
  const callsByCampaign = useMemo(() => {
    const map = new Map<string, PpcCall[]>();
    for (const c of calls) {
      const key = c.campaign_name || "(untagged)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [calls]);

  const structure = useMemo(() => {
    const byCampaign = new Map<string, {
      name: string;
      rows: PpcCampaignConfigRow[];
      sets: Map<string, PpcAdSetRow[]>;
    }>();
    const touch = (name: string) => {
      if (!byCampaign.has(name)) byCampaign.set(name, { name, rows: [], sets: new Map() });
      return byCampaign.get(name)!;
    };
    for (const r of campaigns) touch(r.campaign_name || "(unnamed)").rows.push(r);
    for (const s of adSets) {
      const c = touch(s.campaign_name || "(unnamed)");
      const key = s.adset_name || "Unnamed ad set";
      if (!c.sets.has(key)) c.sets.set(key, []);
      c.sets.get(key)!.push(s);
    }
    const adsBySet = new Map<string, PpcAdRow[]>();
    for (const a of ads) {
      const key = `${a.campaign_name || "(unnamed)"}||${a.adset_name || "Unnamed ad set"}`;
      if (!adsBySet.has(key)) adsBySet.set(key, []);
      adsBySet.get(key)!.push(a);
    }
    return [...byCampaign.values()].map((c) => {
      const cm = media(c.rows);
      const campaignCalls = callsByCampaign.get(c.name) || [];
      const latest = c.rows.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
      return {
        name: c.name,
        vertical: ppcVerticalForCampaign(c.name),
        status: latest?.status ?? null,
        objective: latest?.objective ?? latest?.bidding_strategy_type ?? null,
        bidStrategy: latest?.bid_strategy ?? null,
        dailyBudget: latest?.daily_budget ?? null,
        lifetimeBudget: latest?.lifetime_budget ?? null,
        buyingType: latest?.campaign_type ?? null,
        m: cm,
        calls: campaignCalls.length,
        revenue: campaignCalls.reduce((s, x) => s + (x.payout || 0), 0),
        costPerCall: campaignCalls.length ? cm.spend / campaignCalls.length : 0,
        sets: [...c.sets.entries()].map(([setName, rows]) => {
          const last = rows.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
          return {
            name: setName,
            status: last?.status ?? null,
            bidStrategy: last?.bid_strategy ?? null,
            bidAmount: last?.bid_amount ?? null,
            billingEvent: last?.billing_event ?? null,
            goal: last?.optimization_goal ?? null,
            dailyBudget: last?.daily_budget ?? null,
            audience: last?.audience_summary ?? null,
            m: media(rows),
            ads: (adsBySet.get(`${c.name}||${setName}`) || []).sort((x, y) => (y.spend || 0) - (x.spend || 0)),
          };
        }).sort((x, y) => y.m.spend - x.m.spend),
      };
    }).sort((a, b) => b.m.spend - a.m.spend);
  }, [campaigns, adSets, ads, callsByCampaign]);

  const byBidStrategy = useMemo(() => {
    const map = new Map<string, PpcAdSetRow[]>();
    for (const s of adSets) {
      const key = `${bidLabel(s.bid_strategy)} → ${goalLabel(s.optimization_goal)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].map(([key, rows]) => ({
      key,
      sets: new Set(rows.map((r) => r.adset_name)).size,
      billing: [...new Set(rows.map((r) => r.billing_event).filter(Boolean))].join(", ") || "—",
      m: media(rows),
    })).sort((a, b) => b.m.spend - a.m.spend);
  }, [adSets]);

  const byAudience = useMemo(() => {
    const map = new Map<string, { audience: string; rows: PpcAdSetRow[]; sets: Set<string> }>();
    for (const s of adSets) {
      const key = s.audience_summary || "(targeting not synced yet)";
      if (!map.has(key)) map.set(key, { audience: key, rows: [], sets: new Set() });
      const e = map.get(key)!;
      e.rows.push(s);
      e.sets.add(`${s.campaign_name} · ${s.adset_name}`);
    }
    return [...map.values()].map((e) => ({
      audience: e.audience,
      where: [...e.sets],
      m: media(e.rows),
    })).sort((a, b) => b.m.spend - a.m.spend);
  }, [adSets]);

  const creatives = useMemo(
    () => ads.slice().sort((a, b) => (b.spend || 0) - (a.spend || 0)),
    [ads],
  );

  if (cLoading || sLoading || aLoading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Loading Meta performance…</div>;
  }

  const targetingMissing = adSets.length > 0 && adSets.every((s) => !s.audience_summary);

  return (
    <div className="space-y-4">
      <Card className="border-sky-200 bg-sky-50/60 p-4 dark:bg-sky-950/20">
        <div className="flex gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <p className="text-xs text-muted-foreground">
            Calls and payouts are matched on the campaign name, so cost per call sits at campaign level only.
            Ad sets, audiences and creatives are judged on the media metrics — reach, frequency, CTR, CPC, CPM —
            because click-to-call ads carry no tag that names which ad the caller saw. A creative is never
            credited with a call it cannot be proven to have produced.
            {targetingMissing && " Audience details fill in on the next Meta sync."}
          </p>
        </div>
      </Card>

      <Tabs defaultValue="structure" className="space-y-4">
        <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-auto bg-secondary/50">
            <TabsTrigger value="structure" className="gap-1.5 text-xs whitespace-nowrap">
              <Layers className="h-3.5 w-3.5" />Campaign → ad set → ad
            </TabsTrigger>
            <TabsTrigger value="bids" className="gap-1.5 text-xs whitespace-nowrap">
              <Target className="h-3.5 w-3.5" />Bid strategies
            </TabsTrigger>
            <TabsTrigger value="audiences" className="gap-1.5 text-xs whitespace-nowrap">
              <Users className="h-3.5 w-3.5" />Audiences
            </TabsTrigger>
            <TabsTrigger value="creatives" className="gap-1.5 text-xs whitespace-nowrap">
              <Sparkles className="h-3.5 w-3.5" />Creatives
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="structure">
          <Card className="overflow-hidden">
            <div className="border-b p-4">
              <h3 className="text-sm font-semibold">Full structure, top to bottom</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Click a campaign to open its ad sets, and an ad set to see the ads inside it, with the bid
                strategy, budget, optimisation goal and audience each one is running on.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">Campaign / ad set / ad</th>
                    <th className="p-3 text-left">Settings</th>
                    {MEDIA_HEADS.map((h) => <th key={h} className="p-3 text-right">{h}</th>)}
                    <th className="p-3 text-right">Calls</th>
                    <th className="p-3 text-right">Cost / call</th>
                  </tr>
                </thead>
                <tbody>
                  {structure.map((c) => {
                    const open = !!openCampaigns[c.name];
                    return (
                      <Fragment key={c.name}>
                        <tr
                          className="cursor-pointer border-t bg-muted/20 hover:bg-muted/40"
                          onClick={() => setOpenCampaigns((p) => ({ ...p, [c.name]: !p[c.name] }))}
                        >
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              <span className="font-medium">{c.name}</span>
                              <StatusBadge status={c.status} />
                              <Badge variant="secondary" className="text-[10px]">{c.vertical}</Badge>
                            </div>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {[
                              c.objective,
                              bidLabel(c.bidStrategy) !== "—" ? bidLabel(c.bidStrategy) : null,
                              c.dailyBudget ? `${money2(c.dailyBudget)}/day` : c.lifetimeBudget ? `${money(c.lifetimeBudget)} lifetime` : null,
                              c.buyingType,
                            ].filter(Boolean).join(" · ") || "—"}
                          </td>
                          <MediaCells m={c.m} />
                          <td className="p-3 text-right">{c.calls ? num(c.calls) : "—"}</td>
                          <td className="p-3 text-right font-medium">{c.calls ? money2(c.costPerCall) : "—"}</td>
                        </tr>

                        {open && c.sets.map((s) => {
                          const setKey = `${c.name}||${s.name}`;
                          const setOpen = !!openAdSets[setKey];
                          return (
                            <Fragment key={setKey}>
                              <tr
                                className="cursor-pointer border-t hover:bg-muted/30"
                                onClick={() => setOpenAdSets((p) => ({ ...p, [setKey]: !p[setKey] }))}
                              >
                                <td className="p-3 pl-9">
                                  <div className="flex items-center gap-2">
                                    {s.ads.length > 0 && (setOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
                                    <span>{s.name}</span>
                                    <StatusBadge status={s.status} />
                                  </div>
                                  {s.audience && (
                                    <p className="mt-1 pl-5 text-[11px] text-muted-foreground">{s.audience}</p>
                                  )}
                                </td>
                                <td className="p-3 text-xs text-muted-foreground">
                                  {[
                                    goalLabel(s.goal) !== "—" ? goalLabel(s.goal) : null,
                                    bidLabel(s.bidStrategy) !== "—" ? bidLabel(s.bidStrategy) : null,
                                    s.bidAmount ? `bid ${money2(s.bidAmount)}` : null,
                                    s.dailyBudget ? `${money2(s.dailyBudget)}/day` : null,
                                    s.billingEvent ? s.billingEvent.replace(/_/g, " ").toLowerCase() : null,
                                  ].filter(Boolean).join(" · ") || "—"}
                                </td>
                                <MediaCells m={s.m} />
                                <td className="p-3 text-right text-muted-foreground">—</td>
                                <td className="p-3 text-right text-muted-foreground">—</td>
                              </tr>

                              {setOpen && s.ads.map((a) => (
                                <tr key={`${setKey}||${a.platform_ad_id || a.ad_name}`} className="border-t bg-muted/5">
                                  <td className="p-3 pl-16">
                                    <div className="flex items-center gap-2">
                                      {a.creative_thumbnail_url ? (
                                        <img src={a.creative_thumbnail_url} alt="" className="h-8 w-8 rounded object-cover" />
                                      ) : (
                                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                      )}
                                      <div className="min-w-0">
                                        <p className="truncate text-xs font-medium">{a.ad_name || "Unnamed ad"}</p>
                                        <p className="truncate text-[11px] text-muted-foreground">{a.headline || "—"}</p>
                                      </div>
                                      <StatusBadge status={a.status} />
                                    </div>
                                  </td>
                                  <td className="p-3 text-xs text-muted-foreground">
                                    {[a.creative_type, a.cta].filter(Boolean).join(" · ") || "—"}
                                  </td>
                                  <MediaCells m={media([a])} />
                                  <td className="p-3 text-right text-muted-foreground">—</td>
                                  <td className="p-3 text-right text-muted-foreground">—</td>
                                </tr>
                              ))}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="bids">
          <Card className="overflow-hidden">
            <div className="border-b p-4">
              <h3 className="text-sm font-semibold">How Meta is being told to buy</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Ad sets grouped by bid strategy and what they optimise for, so a cheap CPM bought on the wrong
                goal is visible rather than flattering.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">Bid strategy → goal</th>
                    <th className="p-3 text-left">Charged on</th>
                    <th className="p-3 text-right">Ad sets</th>
                    {MEDIA_HEADS.map((h) => <th key={h} className="p-3 text-right">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {byBidStrategy.map((r) => (
                    <tr key={r.key} className="border-t">
                      <td className="p-3 font-medium capitalize">{r.key}</td>
                      <td className="p-3 text-xs capitalize text-muted-foreground">
                        {r.billing.replace(/_/g, " ").toLowerCase()}
                      </td>
                      <td className="p-3 text-right">{r.sets}</td>
                      <MediaCells m={r.m} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="audiences">
          <Card className="overflow-hidden">
            <div className="border-b p-4">
              <h3 className="text-sm font-semibold">Who each ad set is reaching</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Ages, gender, places and interest sets as they are set in Meta. Identical targeting across
                campaigns is grouped, so overlap between the four campaigns shows up here.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">Audience</th>
                    <th className="p-3 text-left">Used by</th>
                    {MEDIA_HEADS.map((h) => <th key={h} className="p-3 text-right">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {byAudience.map((r) => (
                    <tr key={r.audience} className="border-t">
                      <td className="p-3 max-w-md">{r.audience}</td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {r.where.slice(0, 3).join(" · ")}
                        {r.where.length > 3 ? ` +${r.where.length - 3}` : ""}
                      </td>
                      <MediaCells m={r.m} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="creatives">
          <Card className="overflow-hidden">
            <div className="border-b p-4">
              <h3 className="text-sm font-semibold">Every ad, ranked by spend</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Meta's own snapshot per ad, with the hook and call to action it ran. Compare ads inside the same
                ad set — across ad sets the audience differs, so the comparison is not like for like.
              </p>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {creatives.map((a) => {
                const m = media([a]);
                return (
                  <div key={a.platform_ad_id || a.ad_name} className="rounded-lg border p-3">
                    <div className="flex gap-3">
                      {a.creative_thumbnail_url ? (
                        <img src={a.creative_thumbnail_url} alt="" className="h-20 w-20 rounded object-cover" />
                      ) : (
                        <div className="flex h-20 w-20 items-center justify-center rounded bg-muted">
                          <ImageIcon className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-xs font-medium">{a.ad_name || "Unnamed ad"}</p>
                          <StatusBadge status={a.status} />
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs">{a.headline || "—"}</p>
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{a.primary_text || ""}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {[a.creative_type, a.cta].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2 border-t pt-2 text-center text-[11px]">
                      <div><p className="text-muted-foreground">Spend</p><p className="font-medium">{money2(m.spend)}</p></div>
                      <div><p className="text-muted-foreground">CTR</p><p className="font-medium">{m.impressions ? pct(m.ctr) : "—"}</p></div>
                      <div><p className="text-muted-foreground">CPC</p><p className="font-medium">{m.clicks ? money2(m.cpc) : "—"}</p></div>
                      <div><p className="text-muted-foreground">CPM</p><p className="font-medium">{m.impressions ? money2(m.cpm) : "—"}</p></div>
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {a.campaign_name} · {a.adset_name}
                      {a.date_from ? ` · ${a.date_from} → ${a.date_to}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
