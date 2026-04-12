import { useState, useMemo, Fragment } from "react";
import { useVerticalCampaigns } from "@/hooks/useBillyData";
import { useRingbaByPlatform } from "@/hooks/useRingbaByPlatform";
import { useCampaignAdSets, useAdGroupKeywords, useSearchTerms, useAdSetAds } from "@/hooks/useDrillDown";
import { useVertical } from "@/contexts/VerticalContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BidStrategyPopover from "./BidStrategyPopover";
import HeadlineOptimizerModal from "./HeadlineOptimizerModal";
import {
  ChevronRight, ChevronDown, Search, Download, Filter,
  ArrowUpDown, ArrowUp, ArrowDown, Eye, EyeOff, Pause, Play, Sparkles
} from "lucide-react";
import type { CampaignRow } from "@/hooks/useAdData";

interface Props {
  platform: "meta" | "google";
}

type SortKey = "spend" | "clicks" | "impressions" | "conversions" | "cpc" | "ctr" | "roas" | "name" | "is" | "cpa";
type SortDir = "asc" | "desc";

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

// ─── Budget Pacing Bar ───
function BudgetPacing({ spend, dailyBudget, days }: { spend: number; dailyBudget: number | null; days?: number }) {
  if (!dailyBudget || dailyBudget <= 0) return <span className="text-muted-foreground text-xs">—</span>;
  const expectedSpend = dailyBudget * (days || 1);
  const pct = Math.min(Math.round((spend / expectedSpend) * 100), 150);
  const isOver = pct > 110;
  const isUnder = pct < 70;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="w-20">
            <div className="flex items-center justify-between text-[10px] mb-0.5">
              <span>${dailyBudget.toLocaleString()}/d</span>
              <span className={isOver ? "text-destructive" : isUnder ? "text-amber-500" : "text-muted-foreground"}>{pct}%</span>
            </div>
            <Progress
              value={Math.min(pct, 100)}
              className={`h-1.5 ${isOver ? "[&>div]:bg-destructive" : isUnder ? "[&>div]:bg-amber-500" : ""}`}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p>Budget: ${dailyBudget}/day</p>
          <p>Spent: ${spend.toLocaleString()}</p>
          <p>Pacing: {pct}% of expected</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Status Badge with icon ───
function StatusBadge({ status }: { status: string }) {
  const isActive = status === "active" || status === "enabled";
  return (
    <Badge variant={isActive ? "default" : "secondary"} className="gap-0.5 text-[10px]">
      {isActive ? <Play className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}
      {status}
    </Badge>
  );
}

// ─── Sortable Header ───
function SortableHead({
  label, sortKey, currentSort, currentDir, onSort, align = "left",
}: {
  label: string; sortKey: SortKey; currentSort: SortKey; currentDir: SortDir;
  onSort: (key: SortKey) => void; align?: "left" | "right";
}) {
  const isActive = currentSort === sortKey;
  return (
    <TableHead
      className={`cursor-pointer select-none hover:text-foreground transition-colors ${align === "right" ? "text-right" : ""}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {isActive ? (
          currentDir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </TableHead>
  );
}

// ─── Sub-components for drill-down levels ───

function SearchTermRows({ platformAdsetId, keywordText }: { platformAdsetId: string; keywordText?: string }) {
  const { data, isLoading } = useSearchTerms(platformAdsetId, keywordText || null);
  if (isLoading) return <TableRow><TableCell colSpan={12}><Skeleton className="h-6" /></TableCell></TableRow>;
  if (!data || data.length === 0) return <TableRow><TableCell colSpan={12} className="text-center text-xs text-muted-foreground py-2">No search terms</TableCell></TableRow>;

  return (
    <>
      {data.slice(0, 20).map((st, i) => (
        <TableRow key={i} className="bg-muted/20">
          <TableCell />
          <TableCell className="pl-16 text-xs max-w-[220px] truncate">
            <Badge variant="outline" className="mr-1.5 text-[9px] px-1 py-0 font-normal text-muted-foreground border-muted-foreground/30">Search Term</Badge>
            🔍 {st.searchTerm}
          </TableCell>
          <TableCell className="text-right text-xs">${st.spend}</TableCell>
          <TableCell className="text-right text-xs">{st.clicks}</TableCell>
          <TableCell className="text-right text-xs">{formatNum(st.impressions)}</TableCell>
          <TableCell className="text-right text-xs">{st.ctr}%</TableCell>
          <TableCell className="text-right text-xs">${st.cpc}</TableCell>
          <TableCell className="text-right text-xs">{st.conversions}</TableCell>
          <TableCell colSpan={4} />
        </TableRow>
      ))}
    </>
  );
}

function KeywordRows({ platformAdsetId }: { platformAdsetId: string }) {
  const { data, isLoading } = useAdGroupKeywords(platformAdsetId);
  const [expandedKw, setExpandedKw] = useState<string | null>(null);

  if (isLoading) return <TableRow><TableCell colSpan={12}><Skeleton className="h-6" /></TableCell></TableRow>;
  if (!data || data.length === 0) return <TableRow><TableCell colSpan={12} className="text-center text-xs text-muted-foreground py-2">No keywords</TableCell></TableRow>;

  return (
    <>
      {data.slice(0, 25).map((kw) => {
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
              <TableCell className="text-xs max-w-[260px] truncate">
                <Badge variant="outline" className="mr-1.5 text-[9px] px-1 py-0 font-normal text-blue-500 border-blue-500/30">Keyword</Badge>
                {kw.isNegative && <Badge variant="destructive" className="mr-1 text-[9px] px-1">NEG</Badge>}
                {kw.keyword}
                {kw.matchType && <Badge variant="outline" className="ml-1.5 text-[10px]">{kw.matchType}</Badge>}
                {kw.qualityScore != null && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`ml-1.5 font-medium ${qsColor} cursor-help`}>QS {kw.qualityScore}/10</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        <p className="font-semibold">Quality Score: {kw.qualityScore}/10</p>
                        <p className="text-muted-foreground">Google's rating of keyword relevance, ad quality, and landing page experience</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </TableCell>
              <TableCell className="text-right text-xs">${kw.spend.toLocaleString()}</TableCell>
              <TableCell className="text-right text-xs">{kw.clicks}</TableCell>
              <TableCell className="text-right text-xs">{formatNum(kw.impressions)}</TableCell>
              <TableCell className="text-right text-xs">{kw.ctr}%</TableCell>
              <TableCell className="text-right text-xs">${kw.cpc}</TableCell>
              <TableCell className="text-right text-xs">{kw.conversions}</TableCell>
              <TableCell colSpan={4} />
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

  if (isLoading) return <TableRow><TableCell colSpan={12}><Skeleton className="h-6" /></TableCell></TableRow>;
  if (!data || data.length === 0) return <TableRow><TableCell colSpan={12} className="text-center text-xs text-muted-foreground py-2">No ads</TableCell></TableRow>;

  return (
    <>
      {data.map((ad, i) => (
        <TableRow key={i} className="bg-muted/20">
          <TableCell />
          <TableCell className="pl-12 text-xs max-w-[200px] truncate">
            <div className="flex items-center gap-2">
              {ad.thumbnailUrl ? (
                <img src={ad.thumbnailUrl} className="h-8 w-8 rounded object-cover shrink-0" alt="" />
              ) : (
                <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0 text-[10px] text-muted-foreground">AD</div>
              )}
              <div className="min-w-0">
                <span className="block truncate font-medium">{ad.adName}</span>
                {ad.format && <Badge variant="secondary" className="text-[9px] mt-0.5">{ad.format}</Badge>}
              </div>
            </div>
          </TableCell>
          <TableCell className="text-right text-xs">${ad.spend.toLocaleString()}</TableCell>
          <TableCell className="text-right text-xs">${ad.revenue.toLocaleString()}</TableCell>
          <TableCell className="text-right text-xs">{formatNum(ad.impressions)}</TableCell>
          <TableCell className="text-right text-xs">{ad.clicks}</TableCell>
          <TableCell className="text-right text-xs">{ad.roas}x</TableCell>
          <TableCell className="text-right text-xs">{ad.conversions}</TableCell>
          <TableCell colSpan={3} />
          <TableCell>
            <StatusBadge status={ad.status || "unknown"} />
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

  if (isLoading) return <TableRow><TableCell colSpan={12}><Skeleton className="h-6" /></TableCell></TableRow>;
  if (!data || data.length === 0) return <TableRow><TableCell colSpan={12} className="text-center text-xs text-muted-foreground py-2">No {platform === "google" ? "ad groups" : "ad sets"}</TableCell></TableRow>;

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
              <TableCell className="text-xs max-w-[260px] truncate font-medium">
                <Badge variant="outline" className="mr-1.5 text-[9px] px-1 py-0 font-normal text-amber-500 border-amber-500/30">
                  {platform === "google" ? "Ad Group" : "Ad Set"}
                </Badge>
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
                    SQR
                  </Button>
                )}
              </TableCell>
              <TableCell className="text-right text-xs">${adSet.spend.toLocaleString()}</TableCell>
              <TableCell className="text-right text-xs">{adSet.clicks.toLocaleString()}</TableCell>
              <TableCell className="text-right text-xs">{formatNum(adSet.impressions)}</TableCell>
              <TableCell className="text-right text-xs">{adSet.ctr}%</TableCell>
              <TableCell className="text-right text-xs">${adSet.cpc}</TableCell>
              <TableCell className="text-right text-xs">{adSet.conversions}</TableCell>
              <TableCell colSpan={3} />
              <TableCell>
                <StatusBadge status={adSet.status || "unknown"} />
              </TableCell>
            </TableRow>

            {isShowingSearchTerms && adSet.platformAdsetId && (
              <TableRow>
                <TableCell colSpan={12} className="p-0">
                  <div className="border-l-2 border-primary ml-6 pl-2 py-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1 px-4">Search Query Report — {adSet.adsetName}</p>
                    <Table>
                      <TableBody>
                        <SearchTermRows platformAdsetId={adSet.platformAdsetId} />
                      </TableBody>
                    </Table>
                  </div>
                </TableCell>
              </TableRow>
            )}

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

export default function DrillDownCampaignTable({ platform }: Props) {
  const { data: campaigns, isLoading } = useVerticalCampaigns(platform);
  const { data: ringba } = useRingbaByPlatform(platform);
  const { activeVertical } = useVertical();
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showPaused, setShowPaused] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const isGoogle = platform === "google";

  const totalRingbaRevenue = ringba?.revenue ?? 0;
  const totalRingbaConversions = ringba?.convertedCalls ?? 0;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  // Filter & sort campaigns
  const filtered = useMemo(() => {
    if (!campaigns) return [];
    let result = campaigns;

    // Status filter
    if (!showPaused) {
      result = result.filter(c => c.status === "active" || c.status === "enabled");
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.campaignType || "").toLowerCase().includes(q) ||
        (c.biddingStrategy || "").toLowerCase().includes(q)
      );
    }

    // Sort
    const totalSpend = result.reduce((s, c) => s + c.spend, 0) || 1;
    return [...result].sort((a, b) => {
      const mul = sortDir === "desc" ? -1 : 1;
      switch (sortKey) {
        case "name": return mul * a.name.localeCompare(b.name);
        case "spend": return mul * (a.spend - b.spend);
        case "clicks": return mul * (a.clicks - b.clicks);
        case "impressions": return mul * (a.impressions - b.impressions);
        case "conversions": return mul * (a.conversions - b.conversions);
        case "cpc": {
          const aCpc = a.clicks > 0 ? a.spend / a.clicks : 0;
          const bCpc = b.clicks > 0 ? b.spend / b.clicks : 0;
          return mul * (aCpc - bCpc);
        }
        case "ctr": {
          const aCtr = a.impressions > 0 ? a.clicks / a.impressions : 0;
          const bCtr = b.impressions > 0 ? b.clicks / b.impressions : 0;
          return mul * (aCtr - bCtr);
        }
        case "roas": {
          const aRev = totalRingbaRevenue * (a.spend / totalSpend);
          const bRev = totalRingbaRevenue * (b.spend / totalSpend);
          const aRoas = a.spend > 0 ? aRev / a.spend : 0;
          const bRoas = b.spend > 0 ? bRev / b.spend : 0;
          return mul * (aRoas - bRoas);
        }
        case "is": return mul * ((a.impressionShare ?? 0) - (b.impressionShare ?? 0));
        case "cpa": {
          const aCpa = a.conversions > 0 ? a.spend / a.conversions : 999999;
          const bCpa = b.conversions > 0 ? b.spend / b.conversions : 999999;
          return mul * (aCpa - bCpa);
        }
        default: return 0;
      }
    });
  }, [campaigns, searchQuery, showPaused, sortKey, sortDir, totalRingbaRevenue]);

  const totalSpend = filtered.reduce((s, c) => s + c.spend, 0) || 1;
  const activeCount = campaigns?.filter(c => c.status === "active" || c.status === "enabled").length ?? 0;
  const pausedCount = (campaigns?.length ?? 0) - activeCount;

  // Export
  const handleExport = () => {
    if (!filtered.length) return;
    const headers = isGoogle
      ? ["Campaign", "Status", "Spend", "Budget/Day", "Type", "Bid Strategy", "Conv", "CPA", "Clicks", "Impressions", "CPC", "CTR", "IS%"]
      : ["Campaign", "Status", "Spend", "Est Rev", "ROAS", "Conv", "CPA", "Type", "Clicks", "Impressions"];
    const rows = filtered.map(c => {
      const spendShare = c.spend / totalSpend;
      const campRev = Math.round(totalRingbaRevenue * spendShare);
      const campConv = Math.round(totalRingbaConversions * spendShare);
      const campRoas = c.spend > 0 ? (campRev / c.spend).toFixed(2) : "0";
      const campCpa = campConv > 0 ? (c.spend / campConv).toFixed(2) : "—";
      const cpc = c.clicks > 0 ? (c.spend / c.clicks).toFixed(2) : "0";
      const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : "0";
      const is = c.impressionShare != null ? Math.round(c.impressionShare * 100) : "";

      if (isGoogle) {
        return [c.name, c.status, c.spend, c.dailyBudget || "", c.campaignType || "", c.biddingStrategy || "", c.conversions, c.conversions > 0 ? (c.spend / c.conversions).toFixed(2) : "—", c.clicks, c.impressions, cpc, ctr, is];
      }
      return [c.name, c.status, c.spend, campRev, campRoas, campConv, campCpa, c.campaignType || "", c.clicks, c.impressions];
    });
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${platform}-campaigns.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return <Card><CardContent className="p-6"><Skeleton className="h-48" /></CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            {isGoogle ? "Google" : "Meta"} Campaigns
            {activeVertical.id !== "all" && (
              <Badge variant="outline" className="text-xs font-normal">
                {activeVertical.emoji} {activeVertical.label}
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px] font-normal">
              {activeCount} active{pausedCount > 0 ? ` · ${pausedCount} paused` : ""}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="text-xs gap-1" onClick={() => setShowPaused(!showPaused)}>
              {showPaused ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {showPaused ? "Hide Paused" : "Show Paused"}
            </Button>
            <Button size="sm" variant="outline" className="text-xs gap-1" onClick={handleExport}>
              <Download className="h-3 w-3" />
              Export
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search campaigns, types, strategies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          {searchQuery && (
            <Badge variant="secondary" className="text-[10px]">
              <Filter className="h-2.5 w-2.5 mr-0.5" />
              {filtered.length} results
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {searchQuery ? "No campaigns match your search" : "No campaigns found"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <SortableHead label="Campaign" sortKey="name" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} />
                  <SortableHead label="Spend" sortKey="spend" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                  {isGoogle ? (
                    <>
                      <TableHead className="text-right">Pacing</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Bid Strategy</TableHead>
                      <SortableHead label="Conv." sortKey="conversions" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <SortableHead label="CPA" sortKey="cpa" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <SortableHead label="Clicks" sortKey="clicks" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <SortableHead label="Impr." sortKey="impressions" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <SortableHead label="CPC" sortKey="cpc" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <SortableHead label="IS%" sortKey="is" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <TableHead>Status</TableHead>
                    </>
                  ) : (
                    <>
                      <SortableHead label="Rev (Ringba)" sortKey="roas" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <TableHead className="text-right">ROAS</TableHead>
                      <SortableHead label="Conv." sortKey="conversions" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <SortableHead label="CPA" sortKey="cpa" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <TableHead>Type</TableHead>
                      <TableHead>Bid Strategy</TableHead>
                      <SortableHead label="Clicks" sortKey="clicks" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <SortableHead label="CTR" sortKey="ctr" currentSort={sortKey} currentDir={sortDir} onSort={handleSort} align="right" />
                      <TableHead>Status</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Totals Row */}
                <TableRow className="bg-muted/50 font-medium border-b-2">
                  <TableCell />
                  <TableCell className="text-sm">TOTAL ({filtered.length})</TableCell>
                  <TableCell className="text-right text-sm">{formatCurrency(totalSpend)}</TableCell>
                  {isGoogle ? (
                    <>
                      <TableCell />
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right text-sm">{filtered.reduce((s, c) => s + c.conversions, 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-sm">
                        {filtered.reduce((s, c) => s + c.conversions, 0) > 0
                          ? `$${Math.round(totalSpend / filtered.reduce((s, c) => s + c.conversions, 0))}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm">{filtered.reduce((s, c) => s + c.clicks, 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-sm">{formatNum(filtered.reduce((s, c) => s + c.impressions, 0))}</TableCell>
                      <TableCell className="text-right text-sm">
                        ${(totalSpend / Math.max(filtered.reduce((s, c) => s + c.clicks, 0), 1)).toFixed(2)}
                      </TableCell>
                      <TableCell />
                      <TableCell />
                    </>
                  ) : (
                    <>
                      <TableCell className="text-right text-sm">{formatCurrency(totalRingbaRevenue)}</TableCell>
                      <TableCell className="text-right text-sm">{totalSpend > 0 ? `${(totalRingbaRevenue / totalSpend).toFixed(2)}x` : "—"}</TableCell>
                      <TableCell className="text-right text-sm">{totalRingbaConversions}</TableCell>
                      <TableCell className="text-right text-sm">
                        {totalRingbaConversions > 0 ? `$${Math.round(totalSpend / totalRingbaConversions)}` : "—"}
                      </TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right text-sm">{filtered.reduce((s, c) => s + c.clicks, 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-sm">
                        {filtered.reduce((s, c) => s + c.impressions, 0) > 0
                          ? `${((filtered.reduce((s, c) => s + c.clicks, 0) / filtered.reduce((s, c) => s + c.impressions, 0)) * 100).toFixed(2)}%`
                          : "—"}
                      </TableCell>
                      <TableCell />
                    </>
                  )}
                </TableRow>

                {filtered.map((c) => {
                  const isExpanded = expandedCampaign === c.name;
                  const spendShare = totalSpend > 0 ? c.spend / totalSpend : 0;
                  const campRingbaRev = Math.round(totalRingbaRevenue * spendShare);
                  const campRingbaConv = Math.round(totalRingbaConversions * spendShare);
                  const campRoas = c.spend > 0 ? Math.round((campRingbaRev / c.spend) * 100) / 100 : 0;
                  const campCpa = campRingbaConv > 0 ? Math.round((c.spend / campRingbaConv) * 100) / 100 : 0;
                  const is = c.impressionShare != null ? Math.round(c.impressionShare * 100) : null;
                  const cpc = c.clicks > 0 ? (c.spend / c.clicks).toFixed(2) : "0.00";
                  const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : "0";
                  const isInactive = c.status !== "active" && c.status !== "enabled";

                  return (
                    <Fragment key={c.name}>
                      <TableRow
                        className={`cursor-pointer hover:bg-accent/50 ${isInactive ? "opacity-60" : ""}`}
                        onClick={() => setExpandedCampaign(isExpanded ? null : c.name)}
                      >
                        <TableCell className="w-8">
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>

                        {isGoogle ? (
                          <>
                            <TableCell className="max-w-[280px] truncate font-medium text-sm">{c.name}</TableCell>
                            <TableCell className="text-right">${c.spend.toLocaleString()}</TableCell>
                            <TableCell><BudgetPacing spend={c.spend} dailyBudget={c.dailyBudget} /></TableCell>
                            <TableCell><Badge variant="secondary" className="text-[10px]">{c.campaignType || "—"}</Badge></TableCell>
                            <TableCell><BidStrategyPopover strategy={c.biddingStrategy} details={c.bidStrategyDetails} /></TableCell>
                            <TableCell className="text-right">{c.conversions}</TableCell>
                            <TableCell className="text-right">{c.conversions > 0 ? `$${Math.round(c.spend / c.conversions)}` : "—"}</TableCell>
                            <TableCell className="text-right">{c.clicks.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{formatNum(c.impressions)}</TableCell>
                            <TableCell className="text-right">${cpc}</TableCell>
                            <TableCell className={`text-right ${is != null && is < 50 ? "text-destructive font-medium" : ""}`}>{is != null ? `${is}%` : "—"}</TableCell>
                            <TableCell><StatusBadge status={c.status} /></TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="max-w-[280px] truncate font-medium text-sm">{c.name}</TableCell>
                            <TableCell className="text-right">${c.spend.toLocaleString()}</TableCell>
                            <TableCell className="text-right">${campRingbaRev.toLocaleString()}</TableCell>
                            <TableCell className={`text-right font-medium ${campRoas >= 1 ? "text-green-600" : campRoas > 0 ? "text-destructive" : ""}`}>{campRoas}x</TableCell>
                            <TableCell className="text-right">{campRingbaConv}</TableCell>
                            <TableCell className="text-right">{campCpa > 0 ? `$${campCpa}` : "—"}</TableCell>
                            <TableCell><Badge variant="secondary" className="text-[10px]">{c.campaignType || "—"}</Badge></TableCell>
                            <TableCell><BidStrategyPopover strategy={c.biddingStrategy} details={c.bidStrategyDetails} /></TableCell>
                            <TableCell className="text-right">{c.clicks.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{ctr}%</TableCell>
                            <TableCell><StatusBadge status={c.status} /></TableCell>
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
