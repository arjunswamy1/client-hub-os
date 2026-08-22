import { Fragment, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronRight, ChevronDown, Search, Download, Info } from "lucide-react";
import {
  useMojaCalls, useRRMSpend, MojaCall, classifyCampaign, callMetrics, RRMLine,
} from "@/hooks/useRRMData";
import {
  useRRMAdSets, useRRMKeywords, useRRMSearchTerms, useRRMCreatives, useRRMCallAttribution,
  DrillRow, RRMAttributionIndex,
} from "@/hooks/useRRMDrillDown";

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number) => `$${n.toFixed(2)}`;
const num = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : n.toLocaleString();

interface Props {
  platform: "google" | "meta";
}

interface CampaignAgg {
  name: string;
  line: RRMLine;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  /** Calls joined by UTM keyword / creative */
  exactCalls: MojaCall[];
  /** Unattributed line calls modelled onto this campaign by spend share */
  estCalls: number;
  raw: number;
  connected: number;
  converted: number;
  revenue: number;
  costPerRawCall: number;
  costPerConnectedCall: number;
  revenuePerRawCall: number;
}

/** Five call/cost cells shared by every drill level. */
function CallCells({
  levelSpend, exact, estimated, estRevenue,
}: { levelSpend: number; exact: MojaCall[]; estimated: number; estRevenue: number }) {
  const m = callMetrics(exact, levelSpend);
  const raw = m.raw + estimated;
  // Connected/revenue only scale on the modelled portion when there is one.
  const connected = m.connected + estimated * (m.raw > 0 ? m.connectRate : 0);
  const revenue = m.revenue + estRevenue;
  const div = (a: number, b: number) => (b > 0 ? a / b : 0);
  const modelled = estimated > 0.05;

  return (
    <>
      <TableCell className="text-right text-xs">
        {raw > 0 ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className={modelled ? "underline decoration-dotted" : "font-medium"}>
                {modelled ? `~${raw.toFixed(1)}` : raw}
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] text-xs">
                {m.raw} call{m.raw === 1 ? "" : "s"} matched exactly from Moja UTMs
                {modelled && ` · ${estimated.toFixed(1)} modelled from this row's share of spend`}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-right text-xs">{connected > 0 ? (modelled ? connected.toFixed(1) : connected) : "—"}</TableCell>
      <TableCell className="text-right text-xs">{raw > 0 ? money2(div(levelSpend, raw)) : "—"}</TableCell>
      <TableCell className="text-right text-xs">{connected > 0 ? money2(div(levelSpend, connected)) : "—"}</TableCell>
      <TableCell className="text-right text-xs">{raw > 0 ? money2(div(revenue, raw)) : "—"}</TableCell>
      <TableCell className="text-right text-xs">{revenue > 0 ? money(revenue) : "—"}</TableCell>
    </>
  );
}

/** Share of a campaign's modelled calls that belongs to a sub-row. */
const share = (levelSpend: number, campaign: CampaignAgg) =>
  campaign.spend > 0 ? levelSpend / campaign.spend : 0;

function SearchTermRows({
  platformAdsetId, keyword, campaign, colSpan,
}: { platformAdsetId: string; keyword?: string | null; campaign: CampaignAgg; colSpan: number }) {
  const { data = [], isLoading } = useRRMSearchTerms(platformAdsetId, keyword);
  if (isLoading) return <TableRow><TableCell colSpan={colSpan}><Skeleton className="h-5" /></TableCell></TableRow>;
  if (!data.length)
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="py-2 text-center text-xs text-muted-foreground">
          No search terms in this range
        </TableCell>
      </TableRow>
    );
  return (
    <>
      {data.slice(0, 25).map((st) => (
        <TableRow key={st.key} className="bg-muted/20">
          <TableCell className="max-w-[280px] truncate pl-20 text-xs">
            <Badge variant="outline" className="mr-1.5 px-1 py-0 text-[9px] font-normal">Search term</Badge>
            {st.name}
          </TableCell>
          <TableCell className="text-right text-xs">{money2(st.spend)}</TableCell>
          <TableCell className="text-right text-xs">{num(st.impressions)}</TableCell>
          <TableCell className="text-right text-xs">{st.clicks}</TableCell>
          <TableCell className="text-right text-xs">{st.conversions}</TableCell>
          <CallCells
            levelSpend={st.spend}
            exact={[]}
            estimated={share(st.spend, campaign) * campaign.raw}
            estRevenue={share(st.spend, campaign) * campaign.revenue}
          />
        </TableRow>
      ))}
    </>
  );
}

function KeywordRows({
  platformAdsetId, campaign, colSpan, attr,
}: { platformAdsetId: string; campaign: CampaignAgg; colSpan: number; attr: RRMAttributionIndex }) {
  const { data = [], isLoading } = useRRMKeywords(platformAdsetId);
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) return <TableRow><TableCell colSpan={colSpan}><Skeleton className="h-5" /></TableCell></TableRow>;
  if (!data.length)
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="py-2 text-center text-xs text-muted-foreground">
          No keywords synced for this ad group
        </TableCell>
      </TableRow>
    );

  return (
    <>
      {data.map((kw) => {
        const exact = attr.keywordCalls(kw.name);
        return (
          <Fragment key={kw.key}>
            <TableRow className="cursor-pointer bg-muted/10 hover:bg-muted/30" onClick={() => setOpen(open === kw.key ? null : kw.key)}>
              <TableCell className="max-w-[280px] truncate pl-14 text-xs">
                {open === kw.key ? <ChevronDown className="mr-1 inline h-3 w-3" /> : <ChevronRight className="mr-1 inline h-3 w-3" />}
                <Badge variant="outline" className="mr-1.5 px-1 py-0 text-[9px] font-normal">Keyword</Badge>
                {kw.name}
                {kw.extra?.matchType && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">[{kw.extra.matchType}]</span>
                )}
                {kw.extra?.qualityScore != null && (
                  <Badge variant="secondary" className="ml-1.5 px-1 py-0 text-[9px]">QS {kw.extra.qualityScore}</Badge>
                )}
              </TableCell>
              <TableCell className="text-right text-xs">{money2(kw.spend)}</TableCell>
              <TableCell className="text-right text-xs">{num(kw.impressions)}</TableCell>
              <TableCell className="text-right text-xs">{kw.clicks}</TableCell>
              <TableCell className="text-right text-xs">{kw.conversions}</TableCell>
              <CallCells
                levelSpend={kw.spend}
                exact={exact}
                estimated={share(kw.spend, campaign) * campaign.estCalls}
                estRevenue={0}
              />
            </TableRow>
            {open === kw.key && (
              <SearchTermRows platformAdsetId={platformAdsetId} keyword={kw.name} campaign={campaign} colSpan={colSpan} />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function CreativeRows({
  platformAdsetId, campaign, colSpan, attr,
}: { platformAdsetId: string; campaign: CampaignAgg; colSpan: number; attr: RRMAttributionIndex }) {
  const { data = [], isLoading } = useRRMCreatives(platformAdsetId);
  if (isLoading) return <TableRow><TableCell colSpan={colSpan}><Skeleton className="h-5" /></TableCell></TableRow>;
  if (!data.length)
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="py-2 text-center text-xs text-muted-foreground">
          No creatives synced for this ad set
        </TableCell>
      </TableRow>
    );
  return (
    <>
      {data.map((ad) => (
        <TableRow key={ad.key} className="bg-muted/10">
          <TableCell className="max-w-[320px] pl-14 text-xs">
            <div className="flex items-center gap-2">
              {ad.extra?.thumbnailUrl ? (
                <img src={ad.extra.thumbnailUrl} alt={ad.name} loading="lazy" className="h-8 w-8 rounded object-cover" />
              ) : (
                <div className="h-8 w-8 rounded bg-muted" />
              )}
              <div className="min-w-0">
                <p className="truncate">{ad.name}</p>
                {ad.extra?.headline && <p className="truncate text-[10px] text-muted-foreground">{ad.extra.headline}</p>}
              </div>
              {ad.extra?.format && (
                <Badge variant="outline" className="px-1 py-0 text-[9px] font-normal">{ad.extra.format}</Badge>
              )}
            </div>
          </TableCell>
          <TableCell className="text-right text-xs">{money2(ad.spend)}</TableCell>
          <TableCell className="text-right text-xs">{num(ad.impressions)}</TableCell>
          <TableCell className="text-right text-xs">{ad.clicks}</TableCell>
          <TableCell className="text-right text-xs">{ad.conversions}</TableCell>
          <CallCells
            levelSpend={ad.spend}
            exact={attr.creativeCalls(ad.extra?.platformAdId, ad.name)}
            estimated={share(ad.spend, campaign) * campaign.estCalls}
            estRevenue={0}
          />
        </TableRow>
      ))}
    </>
  );
}

function AdSetRows({
  campaign, platform, colSpan, attr,
}: { campaign: CampaignAgg; platform: "google" | "meta"; colSpan: number; attr: RRMAttributionIndex }) {
  const { data = [], isLoading } = useRRMAdSets(campaign.name, platform);
  const [open, setOpen] = useState<string | null>(null);
  const label = platform === "google" ? "Ad group" : "Ad set";

  if (isLoading) return <TableRow><TableCell colSpan={colSpan}><Skeleton className="h-5" /></TableCell></TableRow>;
  if (!data.length)
    return (
      <TableRow>
        <TableCell colSpan={colSpan} className="py-2 text-center text-xs text-muted-foreground">
          No {label.toLowerCase()} data in this range — run a sync.
        </TableCell>
      </TableRow>
    );

  return (
    <>
      {data.map((as: DrillRow) => (
        <Fragment key={as.key}>
          <TableRow className="cursor-pointer hover:bg-muted/30" onClick={() => setOpen(open === as.key ? null : as.key)}>
            <TableCell className="max-w-[300px] truncate pl-8 text-xs">
              {open === as.key ? <ChevronDown className="mr-1 inline h-3 w-3" /> : <ChevronRight className="mr-1 inline h-3 w-3" />}
              <Badge variant="outline" className="mr-1.5 px-1 py-0 text-[9px] font-normal">{label}</Badge>
              {as.name}
            </TableCell>
            <TableCell className="text-right text-xs">{money2(as.spend)}</TableCell>
            <TableCell className="text-right text-xs">{num(as.impressions)}</TableCell>
            <TableCell className="text-right text-xs">{as.clicks}</TableCell>
            <TableCell className="text-right text-xs">{as.conversions}</TableCell>
            <CallCells
              levelSpend={as.spend}
              exact={attr.adsetCalls(as.platformAdsetId)}
              estimated={share(as.spend, campaign) * campaign.estCalls}
              estRevenue={0}
            />
          </TableRow>
          {open === as.key &&
            (as.platformAdsetId ? (
              platform === "google" ? (
                <KeywordRows platformAdsetId={as.platformAdsetId} campaign={campaign} colSpan={colSpan} attr={attr} />
              ) : (
                <CreativeRows platformAdsetId={as.platformAdsetId} campaign={campaign} colSpan={colSpan} attr={attr} />
              )
            ) : (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-2 text-center text-xs text-muted-foreground">
                  Missing platform ID — re-sync to enable deeper drill-down.
                </TableCell>
              </TableRow>
            ))}
        </Fragment>
      ))}
    </>
  );
}

export default function RRMPlatformPanel({ platform }: Props) {
  const { data: spendRows = [], isLoading: spendLoading } = useRRMSpend();
  const { data: calls = [], isLoading: callsLoading } = useMojaCalls();
  const attr = useRRMCallAttribution(calls);
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { campaigns, excludedSpend, excludedNames } = useMemo(() => {
    const map = new Map<string, CampaignAgg>();
    let excludedSpend = 0;
    const excludedNames = new Set<string>();

    for (const r of spendRows) {
      if ((r.platform || "").toLowerCase() !== platform) continue;
      const name = r.campaign_name || "Unnamed campaign";
      const line = classifyCampaign(name, r.platform);
      if (line === "excluded") {
        excludedSpend += Number(r.spend || 0);
        excludedNames.add(name);
        continue;
      }
      const cur =
        map.get(name) ||
        ({
          name, line, spend: 0, impressions: 0, clicks: 0, conversions: 0,
          exactCalls: [], estCalls: 0, raw: 0, connected: 0, converted: 0, revenue: 0,
          costPerRawCall: 0, costPerConnectedCall: 0, revenuePerRawCall: 0,
        } as CampaignAgg);
      cur.spend += Number(r.spend || 0);
      cur.impressions += Number(r.impressions || 0);
      cur.clicks += Number(r.clicks || 0);
      cur.conversions += Number(r.conversions || 0);
      map.set(name, cur);
    }

    const list = Array.from(map.values());

    // Exact UTM matches first, then spread the line's unattributed calls across
    // campaigns by spend share so nothing goes missing from the totals.
    for (const c of list) list.push, (c.exactCalls = attr.campaignCalls(c.name));

    const byLine = (line: RRMLine) => list.filter((c) => c.line === line);
    for (const line of ["windows", "plumbing"] as RRMLine[]) {
      const inLine = byLine(line);
      const lineSpend = inLine.reduce((s, c) => s + c.spend, 0);
      const loose = attr.unattributed(line).filter(
        (c) => ((c.platform || "").toLowerCase() === "meta") === (platform === "meta"),
      );
      const looseRevenue = loose.reduce((s, c) => s + Number(c.revenue || 0), 0);
      const looseConnected = loose.filter((c) => c.connected).length;
      for (const c of inLine) {
        const w = lineSpend > 0 ? c.spend / lineSpend : inLine.length ? 1 / inLine.length : 0;
        const m = callMetrics(c.exactCalls, c.spend);
        c.estCalls = loose.length * w;
        c.raw = m.raw + c.estCalls;
        c.connected = m.connected + looseConnected * w;
        c.converted = m.converted;
        c.revenue = m.revenue + looseRevenue * w;
        c.costPerRawCall = c.raw > 0 ? c.spend / c.raw : 0;
        c.costPerConnectedCall = c.connected > 0 ? c.spend / c.connected : 0;
        c.revenuePerRawCall = c.raw > 0 ? c.revenue / c.raw : 0;
      }
    }

    return {
      campaigns: list
        .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => b.spend - a.spend),
      excludedSpend,
      excludedNames: Array.from(excludedNames),
    };
  }, [spendRows, platform, search, attr]);

  const totals = useMemo(
    () =>
      campaigns.reduce(
        (t, c) => ({
          spend: t.spend + c.spend,
          raw: t.raw + c.raw,
          connected: t.connected + c.connected,
          revenue: t.revenue + c.revenue,
        }),
        { spend: 0, raw: 0, connected: 0, revenue: 0 },
      ),
    [campaigns],
  );

  const exportCsv = () => {
    const header = [
      "Campaign", "Service line", "Spend", "Impressions", "Clicks", "Platform conv",
      "Raw calls", "Connected calls", "Cost per raw call", "Cost per connected call",
      "Revenue per call", "Revenue",
    ];
    const rows = campaigns.map((c) => [
      c.name, c.line, c.spend.toFixed(2), c.impressions, c.clicks, c.conversions,
      c.raw.toFixed(1), c.connected.toFixed(1), c.costPerRawCall.toFixed(2),
      c.costPerConnectedCall.toFixed(2), c.revenuePerRawCall.toFixed(2), c.revenue.toFixed(2),
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `rrm-${platform}-campaigns.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const colSpan = 11;
  const isLoading = spendLoading || callsLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            {platform === "google"
              ? "Google Ads — Plumbing: campaigns → ad groups → keywords → search terms"
              : "Meta Ads — Windows: campaigns → ad sets → creatives"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {money(totals.spend)} spend · {totals.raw.toFixed(0)} raw calls ·{" "}
            {totals.raw ? money2(totals.spend / totals.raw) : "—"} cost per raw call ·{" "}
            {totals.connected ? money2(totals.spend / totals.connected) : "—"} cost per connected call
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter campaigns"
              className="h-8 w-44 pl-7 text-xs"
            />
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </div>

      {excludedSpend > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {money(excludedSpend)} of spend in this ad account is excluded because it is not an RRM service line:{" "}
            {excludedNames.join(", ")}.
          </span>
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No {platform === "google" ? "Google" : "Meta"} RRM spend in this date range. Connect the account and run a sync.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-right text-xs">Spend</TableHead>
                <TableHead className="text-right text-xs">Impr.</TableHead>
                <TableHead className="text-right text-xs">Clicks</TableHead>
                <TableHead className="text-right text-xs">Platform conv.</TableHead>
                <TableHead className="text-right text-xs">Raw calls</TableHead>
                <TableHead className="text-right text-xs">Connected</TableHead>
                <TableHead className="text-right text-xs">Cost / raw call</TableHead>
                <TableHead className="text-right text-xs">Cost / conn. call</TableHead>
                <TableHead className="text-right text-xs">Rev / call</TableHead>
                <TableHead className="text-right text-xs">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <Fragment key={c.name}>
                  <TableRow className="cursor-pointer font-medium hover:bg-muted/30" onClick={() => setOpen(open === c.name ? null : c.name)}>
                    <TableCell className="max-w-[320px] truncate text-xs">
                      {open === c.name ? <ChevronDown className="mr-1 inline h-3 w-3" /> : <ChevronRight className="mr-1 inline h-3 w-3" />}
                      <Badge variant="secondary" className="mr-1.5 px-1 py-0 text-[9px] font-normal capitalize">{c.line}</Badge>
                      {c.name}
                    </TableCell>
                    <TableCell className="text-right text-xs">{money2(c.spend)}</TableCell>
                    <TableCell className="text-right text-xs">{num(c.impressions)}</TableCell>
                    <TableCell className="text-right text-xs">{num(c.clicks)}</TableCell>
                    <TableCell className="text-right text-xs">{c.conversions}</TableCell>
                    <CallCells
                      levelSpend={c.spend}
                      exact={c.exactCalls}
                      estimated={c.estCalls}
                      estRevenue={c.revenue - c.exactCalls.reduce((s, m) => s + Number(m.revenue || 0), 0)}
                    />
                  </TableRow>
                  {open === c.name && (
                    <AdSetRows campaign={c} platform={platform} colSpan={colSpan} attr={attr} />
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Bold call counts are matched exactly from the Moja call record —{" "}
        {platform === "google" ? "utm_term carries the Google keyword" : "utm_content carries the Meta ad name"}.
        Dotted counts are modelled: calls that arrived without UTMs are spread across rows by share of spend so the
        service-line totals always reconcile. {attr.attributedCount} of {attr.totalCount} calls in this range carry
        exact keyword/creative attribution.
      </p>
    </Card>
  );
}
