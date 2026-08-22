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
import { ChevronRight, ChevronDown, Search, Download, Phone } from "lucide-react";
import { useMojaCalls, useRRMSpend, MojaCall } from "@/hooks/useRRMData";
import {
  useRRMAdSets, useRRMKeywords, useRRMSearchTerms, useRRMCreatives, useRRMAttribution,
  DrillRow, RRMAttribution,
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
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  calls: number;
  converted: number;
  revenue: number;
}

/** Estimated calls allocated to a sub-level by its share of campaign spend. */
function estCalls(levelSpend: number, campaignSpend: number, campaignCalls: number) {
  if (campaignSpend <= 0 || campaignCalls <= 0) return 0;
  return (levelSpend / campaignSpend) * campaignCalls;
}

/**
 * Calls + cost per call for a sub-campaign row.
 * When Moja passed UTMs we can attribute exactly (`exact`), otherwise we model by spend share.
 */
function CallsCell({
  levelSpend, campaign, exact,
}: { levelSpend: number; campaign: CampaignAgg; exact: MojaCall[] | null }) {
  if (exact) {
    const n = exact.length;
    const converted = exact.filter((c) => c.converted).length;
    const cpc = n > 0 ? levelSpend / n : 0;
    return (
      <>
        <TableCell className="text-right text-xs">
          {n > 0 ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger className="font-medium">{n}</TooltipTrigger>
                <TooltipContent className="max-w-[240px] text-xs">
                  Matched from Moja UTMs — {n} call{n === 1 ? "" : "s"}, {converted} converted. Exact attribution, not
                  modeled.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            "0"
          )}
        </TableCell>
        <TableCell className="text-right text-xs">{cpc > 0 ? money2(cpc) : "—"}</TableCell>
      </>
    );
  }

  const calls = estCalls(levelSpend, campaign.spend, campaign.calls);
  const cpc = calls > 0 ? levelSpend / calls : 0;
  return (
    <>
      <TableCell className="text-right text-xs">
        {calls > 0 ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className="underline decoration-dotted">~{calls.toFixed(1)}</TooltipTrigger>
              <TooltipContent className="max-w-[240px] text-xs">
                Estimated: this row's share of campaign spend applied to {campaign.calls} tracked calls. No Moja UTM
                data on these calls, so the split is modeled.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell className="text-right text-xs">{cpc > 0 ? money2(cpc) : "—"}</TableCell>
    </>
  );
}


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
            🔍 {st.name}
          </TableCell>
          <TableCell className="text-right text-xs">{money2(st.spend)}</TableCell>
          <TableCell className="text-right text-xs">{num(st.impressions)}</TableCell>
          <TableCell className="text-right text-xs">{st.clicks}</TableCell>
          <TableCell className="text-right text-xs">{st.conversions}</TableCell>
          <CallsCell levelSpend={st.spend} campaign={campaign} exact={null} />
          <TableCell />
        </TableRow>
      ))}
    </>
  );
}

function KeywordRows({
  platformAdsetId, campaign, colSpan, attr,
}: { platformAdsetId: string; campaign: CampaignAgg; colSpan: number; attr: RRMAttribution }) {
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
      {data.map((kw) => (
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
            <CallsCell levelSpend={kw.spend} campaign={campaign} exact={attr.keywordCalls(kw.name)} />
            <TableCell />
          </TableRow>
          {open === kw.key && (
            <SearchTermRows platformAdsetId={platformAdsetId} keyword={kw.name} campaign={campaign} colSpan={colSpan} />
          )}
        </Fragment>
      ))}
    </>
  );
}

function CreativeRows({
  platformAdsetId, campaign, colSpan, attr,
}: { platformAdsetId: string; campaign: CampaignAgg; colSpan: number; attr: RRMAttribution }) {
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
          <CallsCell
            levelSpend={ad.spend}
            campaign={campaign}
            exact={attr.creativeCalls(ad.extra?.platformAdId, ad.name)}
          />
          <TableCell />
        </TableRow>
      ))}
    </>
  );
}

function AdSetRows({
  campaign, platform, colSpan, attr,
}: { campaign: CampaignAgg; platform: "google" | "meta"; colSpan: number; attr: RRMAttribution }) {
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
            <CallsCell levelSpend={as.spend} campaign={campaign} exact={attr.adsetCalls(as.platformAdsetId)} />
            <TableCell />
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
  const attr = useRRMAttribution(platform, calls);
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const campaigns = useMemo<CampaignAgg[]>(() => {
    const map = new Map<string, CampaignAgg>();
    for (const r of spendRows) {
      if ((r.platform || "").toLowerCase() !== platform) continue;
      const name = r.campaign_name || "Unnamed campaign";
      const cur = map.get(name) || {
        name, spend: 0, impressions: 0, clicks: 0, conversions: 0, calls: 0, converted: 0, revenue: 0,
      };
      cur.spend += Number(r.spend || 0);
      cur.impressions += Number(r.impressions || 0);
      cur.clicks += Number(r.clicks || 0);
      cur.conversions += Number(r.conversions || 0);
      map.set(name, cur);
    }
    const matchCalls = (name: string) =>
      calls.filter((c: MojaCall) => {
        const cn = (c.campaign_name || "").toLowerCase().trim();
        const uc = (c.utm_campaign as string | undefined)?.toLowerCase().trim() || "";
        const target = name.toLowerCase().trim();
        return cn === target || uc === target;
      });
    for (const c of map.values()) {
      const matched = matchCalls(c.name);
      c.calls = matched.length;
      c.converted = matched.filter((m) => m.converted).length;
      c.revenue = matched.reduce((s, m) => s + Number(m.revenue || 0), 0);
    }
    return Array.from(map.values())
      .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.spend - a.spend);
  }, [spendRows, calls, platform, search]);

  const totals = useMemo(
    () =>
      campaigns.reduce(
        (t, c) => ({
          spend: t.spend + c.spend,
          impressions: t.impressions + c.impressions,
          clicks: t.clicks + c.clicks,
          conversions: t.conversions + c.conversions,
          calls: t.calls + c.calls,
          revenue: t.revenue + c.revenue,
        }),
        { spend: 0, impressions: 0, clicks: 0, conversions: 0, calls: 0, revenue: 0 },
      ),
    [campaigns],
  );

  const exportCsv = () => {
    const header = ["Campaign", "Spend", "Impressions", "Clicks", "Platform conv", "Calls", "Cost per call", "Revenue"];
    const rows = campaigns.map((c) => [
      c.name, c.spend.toFixed(2), c.impressions, c.clicks, c.conversions, c.calls,
      c.calls ? (c.spend / c.calls).toFixed(2) : "", c.revenue.toFixed(2),
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `rrm-${platform}-campaigns.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const colSpan = 8;
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
            {platform === "google" ? "Google Ads — campaigns → ad groups → keywords → search terms" : "Meta Ads — campaigns → ad sets → creatives"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {money(totals.spend)} spend · {totals.calls} tracked calls ·{" "}
            {totals.calls ? money2(totals.spend / totals.calls) : "—"} blended cost per call
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

      {campaigns.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">
          No {platform === "google" ? "Google" : "Meta"} spend in this date range. Connect the account and run a sync.
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
                <TableHead className="text-right text-xs">Calls</TableHead>
                <TableHead className="text-right text-xs">Cost / call</TableHead>
                <TableHead className="text-right text-xs">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <Fragment key={c.name}>
                  <TableRow className="cursor-pointer font-medium hover:bg-muted/30" onClick={() => setOpen(open === c.name ? null : c.name)}>
                    <TableCell className="max-w-[320px] truncate text-xs">
                      {open === c.name ? <ChevronDown className="mr-1 inline h-3.5 w-3.5" /> : <ChevronRight className="mr-1 inline h-3.5 w-3.5" />}
                      {c.name}
                    </TableCell>
                    <TableCell className="text-right text-xs">{money(c.spend)}</TableCell>
                    <TableCell className="text-right text-xs">{num(c.impressions)}</TableCell>
                    <TableCell className="text-right text-xs">{c.clicks}</TableCell>
                    <TableCell className="text-right text-xs">{c.conversions}</TableCell>
                    <TableCell className="text-right text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        {c.calls}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs">{c.calls ? money2(c.spend / c.calls) : "—"}</TableCell>
                    <TableCell className="text-right text-xs">{money(c.revenue)}</TableCell>
                  </TableRow>
                  {open === c.name && <AdSetRows campaign={c} platform={platform} colSpan={colSpan} attr={attr} />}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Campaign-level calls are matched from Moja by campaign name. Below campaign level, calls are matched exactly
        from Moja's UTM term/content — {platform === "google" ? "keyword text and ad id" : "ad id and creative name"}.
        Rows where the call has no UTM data fall back to an estimate from its share of campaign spend (shown with ~).
      </p>
    </Card>
  );
}
