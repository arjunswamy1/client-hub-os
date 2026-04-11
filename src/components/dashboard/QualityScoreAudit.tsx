import { useState } from "react";
import { useQualityScoreData, useQSAuditRecommendations } from "@/hooks/useQualityScoreAudit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BarChart3, Sparkles, ChevronDown, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function QualityScoreAudit() {
  const { data, isLoading } = useQualityScoreData();
  const auditMutation = useQSAuditRecommendations();
  const [recommendations, setRecommendations] = useState<any>(null);
  const [expandedRec, setExpandedRec] = useState<string | null>(null);

  if (isLoading) {
    return <Card><CardContent className="p-6"><Skeleton className="h-32 rounded-xl" /></CardContent></Card>;
  }

  const dist = data?.distribution;
  const keywords = data?.keywords || [];

  if (!dist || dist.totalKeywords === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No keyword quality score data available. Sync Google Ads data to see QS insights.
        </CardContent>
      </Card>
    );
  }

  const goodPct = Math.round((dist.good / dist.totalKeywords) * 100);
  const fairPct = Math.round((dist.fair / dist.totalKeywords) * 100);

  const handleRunAudit = async () => {
    try {
      const result = await auditMutation.mutateAsync(keywords);
      setRecommendations(result);
      toast.success("AI audit complete — see recommendations below");
    } catch {
      toast.error("Failed to run audit. Please try again.");
    }
  };

  const exportCSV = () => {
    const headers = ["Keyword", "Match Type", "QS", "Spend", "CPC", "CTR", "Conversions"];
    const rows = keywords.map(k => [k.keyword, k.matchType || "", k.qualityScore, k.spend, k.cpc, k.ctr, k.conversions]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quality-score-audit.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Overview Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Quality Score Audit
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs" onClick={exportCSV}>
                <Download className="h-3 w-3 mr-1" />
                Export CSV
              </Button>
              <Button
                size="sm"
                className="text-xs"
                onClick={handleRunAudit}
                disabled={auditMutation.isPending || keywords.length === 0}
              >
                {auditMutation.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Run AI Audit
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Avg Quality Score</p>
              <p className="text-2xl font-bold">{dist.avgQS}/10</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Keywords Audited</p>
              <p className="text-2xl font-bold">{dist.totalKeywords}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Distribution</p>
              <div className="mt-1 space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-green-600">Good (≥7)</span>
                  <span className="font-medium">{dist.good}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Fair (5-6)</span>
                  <span className="font-medium">{dist.fair}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-destructive">Poor (&lt;5)</span>
                  <span className="font-medium">{dist.poor} ⚠️</span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Est. Wasted Spend</p>
              <p className="text-2xl font-bold text-destructive">${dist.wastedSpend.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">On keywords with QS &lt; 5</p>
            </div>
          </div>
          <div className="mt-3">
            <Progress value={goodPct} className="h-2" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>{goodPct}% good</span>
              <span>{fairPct}% fair</span>
              <span>{100 - goodPct - fairPct}% poor</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Low QS Keywords Table */}
      {keywords.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Low Quality Score Keywords</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Keyword</TableHead>
                    <TableHead>Match</TableHead>
                    <TableHead className="text-center">QS</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">CPC</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                    <TableHead className="text-right">Conv.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keywords.slice(0, 20).map((kw, i) => {
                    const qsColor = kw.qualityScore < 5 ? "text-destructive" : "text-foreground";
                    return (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium max-w-[200px] truncate">{kw.keyword}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{kw.matchType || "—"}</Badge></TableCell>
                        <TableCell className={`text-center font-bold ${qsColor}`}>{kw.qualityScore}/10</TableCell>
                        <TableCell className="text-right text-xs">${kw.spend.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-xs">${kw.cpc.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-xs">{kw.ctr}%</TableCell>
                        <TableCell className="text-right text-xs">{kw.conversions}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Recommendations */}
      {recommendations && recommendations.recommendations && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Recommendations
            </CardTitle>
            {recommendations.summary && (
              <p className="text-xs text-muted-foreground mt-1">{recommendations.summary}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {recommendations.recommendations.map((rec: any, i: number) => (
              <Collapsible
                key={i}
                open={expandedRec === rec.keyword}
                onOpenChange={() => setExpandedRec(expandedRec === rec.keyword ? null : rec.keyword)}
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={rec.priority === "High" ? "destructive" : rec.priority === "Medium" ? "default" : "secondary"}
                      className="text-[10px]"
                    >
                      {rec.priority}
                    </Badge>
                    <span className="text-sm font-medium">{rec.keyword}</span>
                    <span className="text-xs text-muted-foreground">QS: {rec.currentQS}/10</span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </CollapsibleTrigger>
                <CollapsibleContent className="border-x border-b rounded-b-lg p-4 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground">Issue</p>
                    <p className="text-sm">{rec.issue}</p>
                  </div>
                  {rec.suggestedHeadline && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground">Suggested Headline</p>
                      <p className="text-sm font-medium text-primary">{rec.suggestedHeadline}</p>
                    </div>
                  )}
                  {rec.suggestedDescription && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground">Suggested Description</p>
                      <p className="text-sm">{rec.suggestedDescription}</p>
                    </div>
                  )}
                  {rec.matchTypeAdvice && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground">Match Type</p>
                      <p className="text-sm">{rec.matchTypeAdvice}</p>
                    </div>
                  )}
                  {rec.estimatedImpact && (
                    <div className="rounded bg-primary/10 p-2">
                      <p className="text-xs text-primary font-medium">💡 {rec.estimatedImpact}</p>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
