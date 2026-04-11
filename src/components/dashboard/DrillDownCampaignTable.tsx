import { useState } from "react";
import { useVerticalCampaigns } from "@/hooks/useBillyData";
import { useRingbaByPlatform } from "@/hooks/useRingbaByPlatform";
import { useCampaignAdSets, useAdGroupKeywords, useSearchTerms, useAdSetAds } from "@/hooks/useDrillDown";
import { useVertical } from "@/contexts/VerticalContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import BidStrategyPopover from "./BidStrategyPopover";
import { ChevronRight, ChevronDown, Search } from "lucide-react";

interface Props {
  platform: "meta" | "google";
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ─── Sub-components for drill-down levels ───

function SearchTermRows({ platformAdsetId, keywordText }: { platformAdsetId: string; keywordText?: string }) {
  const { data, isLoading } = useSearchTerms(platformAdsetId, keywordText || null);
  if (isLoading) return <TableRow><TableCell colSpan={8}><Skeleton className="h-6" /></TableCell></TableRow>;
  if (!data || data.length === 0) return <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-2">No search terms</TableCell></TableRow>;

  return (
    <>
      {data.slice(0, 15).map((st, i) => (
        <TableRow key={i} className="bg-muted/20">
          <TableCell />
          <TableCell className="pl-16 text-xs max-w-[220px] truncate">🔍 {st.searchTerm}</TableCell>
          <TableCell className="text-right text-xs">${st.spend}</TableCell>
          <TableCell className="text-right text-xs">{st.clicks}</TableCell>
          <TableCell className="text-right text-xs">{formatNum(st.impressions)}</TableCell>
          <TableCell className="text-right text-xs">{st.ctr}%</TableCell>
          <TableCell className="text-right text-xs">${st.cpc}</TableCell>
          <TableCell className="text-right text-xs">{st.conversions}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

function KeywordRows({ platformAdsetId }: { platformAdsetId: string }) {
  const { data, isLoading } = useAdGroupKeywords(platformAdsetId);
  const [expandedKw, setExpandedKw] = useState<string | null>(null);

  if (isLoading) return <TableRow><TableCell colSpan={8}><Skeleton className="h-6" /></TableCell></TableRow>;
  if (!data || data.length === 0) return <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-2">No keywords</TableCell></TableRow>;

  return (
    <>
      {data.slice(0, 20).map((kw) => {
        const isExpanded = expandedKw === kw.keyword;
        const qsColor = kw.qualityScore != null
          ? kw.qualityScore < 5 ? "text-destructive" : kw.qualityScore >= 7 ? "text-green-600" : "text-foreground"
          : "text-muted-foreground";

        return (
          <Fragment key={kw.keyword}>
            <TableRow
              className="cursor-pointer hover:bg-accent/50"
              onClick={() => setExpandedKw(isExpanded ? null : kw.keyword)}
            >
              <TableCell className="w-8 pl-10">
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </TableCell>
              <TableCell className="text-xs max-w-[200px] truncate">
                {kw.keyword}
                {kw.matchType && <Badge variant="outline" className="ml-1.5 text-[10px]">{kw.matchType}</Badge>}
                {kw.qualityScore != null && <span className={`ml-1.5 font-medium ${qsColor}`}>{kw.qualityScore}/10</span>}
              </TableCell>
              <TableCell className="text-right text-xs">${kw.spend.toLocaleString()}</TableCell>
              <TableCell className="text-right text-xs">{kw.clicks}</TableCell>
              <TableCell className="text-right text-xs">{formatNum(kw.impressions)}</TableCell>
              <TableCell className="text-right text-xs">{kw.ctr}%</TableCell>
              <TableCell className="text-right text-xs">${kw.cpc}</TableCell>
              <TableCell className="text-right text-xs">{kw.conversions}</TableCell>
            </TableRow>
            {isExpanded && <SearchTermRows platformAdsetId={platformAdsetId} keywordText={kw.keyword} />}
          </Fragment>
        );
      })}
    </>
  );
}

function AdRows({ platformAdsetId }: { platformAdsetId: string }) {
  const { data, isLoading } = useAdSetAds(platformAdsetId);

  if (isLoading) return <TableRow><TableCell colSpan={8}><Skeleton className="h-6" /></TableCell></TableRow>;
  if (!data || data.length === 0) return <TableRow><TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-2">No ads</TableCell></TableRow>;

  return (
    <>
      {data.map((ad, i) => (
        <TableRow key={i} className="bg-muted/20">
          <TableCell />
          <TableCell className="pl-12 text-xs max-w-[200px] truncate flex items-center gap-2">
            {ad.thumbnailUrl && <img src={ad.thumbnailUrl} className="h-6 w-6 rounded object-cover" alt="" />}
            {ad.adName}
            {ad.format && <Badge variant="secondary" className="text-[10px]">{ad.format}</Badge>}
          </TableCell>
          <TableCell className="text-right text-xs">${ad.spend.toLocaleString()}</TableCell>
          <TableCell className="text-right text-xs">${ad.revenue.toLocaleString()}</TableCell>
          <TableCell className="text-right text-xs">{ad.roas}x</TableCell>
          <TableCell className="text-right text-xs">{ad.conversions}</TableCell>
          <TableCell />
          <TableCell>
            <Badge variant={ad.status === "active" ? "default" : "secondary"} className="text-[10px]">{ad.status}</Badge>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function AdSetRows({ campaignName, platform }: { campaignName: string; platform: "meta" | "google" }) {
  const { data, isLoading } = useCampaignAdSets(campaignName, platform);
  const [expandedAdSet, setExpandedAdSet] = useState<string | null>(null);
  const [showSearchTerms, setShowSearchTerms] = useState<string | null>(null);

  if (isLoading) return <TableRow><TableCell colSpan={10}><Skeleton className="h-6" /></TableCell></TableRow>;
  if (!data || data.length === 0) return <TableRow><TableCell colSpan={10} className="text-center text-xs text-muted-foreground py-2">No ad groups</TableCell></TableRow>;

  return (
    <>
      {data.map((adSet) => {
        const isExpanded = expandedAdSet === adSet.adsetName;
        const isShowingSearchTerms = showSearchTerms === adSet.adsetName;

        return (
          <Fragment key={adSet.adsetName}>
            <TableRow
              className="cursor-pointer bg-muted/30 hover:bg-accent/50"
              onClick={() => setExpandedAdSet(isExpanded ? null : adSet.adsetName)}
            >
              <TableCell className="w-8 pl-6">
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </TableCell>
              <TableCell className="text-xs max-w-[220px] truncate font-medium">
                {adSet.adsetName}
                {platform === "google" && adSet.platformAdsetId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-2 h-5 px-1.5 text-[10px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowSearchTerms(isShowingSearchTerms ? null : adSet.adsetName);
                    }}
                  >
                    <Search className="h-3 w-3 mr-0.5" />
                    Search Terms
                  </Button>
                )}
              </TableCell>
              <TableCell className="text-right text-xs">${adSet.spend.toLocaleString()}</TableCell>
              <TableCell className="text-right text-xs">{adSet.clicks.toLocaleString()}</TableCell>
              <TableCell className="text-right text-xs">{formatNum(adSet.impressions)}</TableCell>
              <TableCell className="text-right text-xs">{adSet.ctr}%</TableCell>
              <TableCell className="text-right text-xs">${adSet.cpc}</TableCell>
              <TableCell className="text-right text-xs">{adSet.conversions}</TableCell>
              <TableCell />
              <TableCell>
                <Badge variant={adSet.status === "active" ? "default" : "secondary"} className="text-[10px]">{adSet.status}</Badge>
              </TableCell>
            </TableRow>

            {/* All search terms for ad group */}
            {isShowingSearchTerms && adSet.platformAdsetId && (
              <TableRow>
                <TableCell colSpan={10} className="p-0">
                  <div className="border-l-2 border-primary ml-6 pl-2 py-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1 px-4">All Search Terms — {adSet.adsetName}</p>
                    <Table>
                      <TableBody>
                        <SearchTermRows platformAdsetId={adSet.platformAdsetId} />
                      </TableBody>
                    </Table>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {/* Drill-down: Keywords (Google) or Ads (Meta) */}
            {isExpanded && adSet.platformAdsetId && (
              platform === "google"
                ? <KeywordRows platformAdsetId={adSet.platformAdsetId} />
                : <AdRows platformAdsetId={adSet.platformAdsetId} />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

// ─── Main component ───

import { Fragment } from "react";

export default function DrillDownCampaignTable({ platform }: Props) {
  const { data: campaigns, isLoading } = useVerticalCampaigns(platform);
  const { data: ringba } = useRingbaByPlatform(platform);
  const { activeVertical } = useVertical();
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);

  const isGoogle = platform === "google";

  // For Meta: proportional Ringba attribution per campaign
  const totalSpend = campaigns?.reduce((s, c) => s + c.spend, 0) || 1;
  const totalRingbaRevenue = ringba?.revenue ?? 0;
  const totalRingbaConversions = ringba?.convertedCalls ?? 0;

  if (isLoading) {
    return <Card><CardContent className="p-6"><Skeleton className="h-48" /></CardContent></Card>;
  }

  const googleHeaders = (
    <TableRow>
      <TableHead className="w-8" />
      <TableHead>Campaign</TableHead>
      <TableHead className="text-right">Spend</TableHead>
      <TableHead className="text-right">Budget/Day</TableHead>
      <TableHead>Type</TableHead>
      <TableHead>Bid Strategy</TableHead>
      <TableHead className="text-right">Conv.</TableHead>
      <TableHead className="text-right">CPA</TableHead>
      <TableHead className="text-right">Clicks</TableHead>
      <TableHead className="text-right">Impr.</TableHead>
      <TableHead className="text-right">CPC</TableHead>
      <TableHead className="text-right">IS%</TableHead>
      <TableHead>Status</TableHead>
    </TableRow>
  );

  const metaHeaders = (
    <TableRow>
      <TableHead className="w-8" />
      <TableHead>Campaign</TableHead>
      <TableHead className="text-right">Spend</TableHead>
      <TableHead className="text-right">Rev (Ringba)</TableHead>
      <TableHead className="text-right">ROAS</TableHead>
      <TableHead className="text-right">Conv.</TableHead>
      <TableHead className="text-right">CPA</TableHead>
      <TableHead>Type</TableHead>
      <TableHead>Bid Strategy</TableHead>
      <TableHead>Status</TableHead>
    </TableRow>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {isGoogle ? "Google" : "Meta"} Campaigns
          {activeVertical.id !== "all" && (
            <Badge variant="outline" className="text-xs font-normal">
              {activeVertical.emoji} {activeVertical.label}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!campaigns || campaigns.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No active campaigns</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>{isGoogle ? googleHeaders : metaHeaders}</TableHeader>
              <TableBody>
                {campaigns.map((c) => {
                  const isExpanded = expandedCampaign === c.name;
                  const spendShare = totalSpend > 0 ? c.spend / totalSpend : 0;
                  const campRingbaRev = Math.round(totalRingbaRevenue * spendShare);
                  const campRingbaConv = Math.round(totalRingbaConversions * spendShare);
                  const campRoas = c.spend > 0 ? Math.round((campRingbaRev / c.spend) * 100) / 100 : 0;
                  const campCpa = campRingbaConv > 0 ? Math.round((c.spend / campRingbaConv) * 100) / 100 : 0;
                  const is = c.impressionShare != null ? Math.round(c.impressionShare * 100) : null;

                  return (
                    <Fragment key={c.name}>
                      <TableRow
                        className="cursor-pointer hover:bg-accent/50"
                        onClick={() => setExpandedCampaign(isExpanded ? null : c.name)}
                      >
                        <TableCell className="w-8">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>

                        {isGoogle ? (
                          <>
                            <TableCell className="max-w-[280px] truncate font-medium text-sm">{c.name}</TableCell>
                            <TableCell className="text-right">${c.spend.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{c.dailyBudget != null ? `$${c.dailyBudget.toLocaleString()}` : "—"}</TableCell>
                            <TableCell><Badge variant="secondary" className="text-[10px]">{c.campaignType || "—"}</Badge></TableCell>
                            <TableCell><BidStrategyPopover strategy={c.biddingStrategy} /></TableCell>
                            <TableCell className="text-right">{c.conversions}</TableCell>
                            <TableCell className="text-right">{c.conversions > 0 ? `$${Math.round(c.spend / c.conversions)}` : "—"}</TableCell>
                            <TableCell className="text-right">{c.clicks.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{formatNum(c.impressions)}</TableCell>
                            <TableCell className="text-right">${c.clicks > 0 ? (c.spend / c.clicks).toFixed(2) : "0"}</TableCell>
                            <TableCell className={`text-right ${is != null && is < 50 ? "text-destructive font-medium" : ""}`}>{is != null ? `${is}%` : "—"}</TableCell>
                            <TableCell><Badge variant={c.status === "active" || c.status === "enabled" ? "default" : "secondary"} className="text-xs">{c.status}</Badge></TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="max-w-[280px] truncate font-medium text-sm">{c.name}</TableCell>
                            <TableCell className="text-right">${c.spend.toLocaleString()}</TableCell>
                            <TableCell className="text-right">${campRingbaRev.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{campRoas}x</TableCell>
                            <TableCell className="text-right">{campRingbaConv}</TableCell>
                            <TableCell className="text-right">{campCpa > 0 ? `$${campCpa}` : "—"}</TableCell>
                            <TableCell><Badge variant="secondary" className="text-[10px]">{c.campaignType || "—"}</Badge></TableCell>
                            <TableCell><BidStrategyPopover strategy={c.biddingStrategy} /></TableCell>
                            <TableCell><Badge variant={c.status === "active" ? "default" : "secondary"} className="text-xs">{c.status}</Badge></TableCell>
                          </>
                        )}
                      </TableRow>
                      {isExpanded && <AdSetRows campaignName={c.name} platform={platform} />}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
