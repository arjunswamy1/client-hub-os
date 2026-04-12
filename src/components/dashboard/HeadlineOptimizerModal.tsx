import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Sparkles, Copy, Check, Lightbulb, AlertTriangle, FileText } from "lucide-react";

interface HeadlineOptimizerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyword: string;
  matchType?: string;
  qualityScore?: number | null;
  currentHeadlines?: string[];
  currentDescriptions?: string[];
  campaignName?: string;
  adGroupName?: string;
}

interface Suggestion {
  text: string;
  rationale: string;
}

interface AIResult {
  analysis: string;
  headlines: Suggestion[];
  descriptions: Suggestion[];
  tips: string[];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 w-6 p-0 shrink-0"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

export default function HeadlineOptimizerModal({
  open,
  onOpenChange,
  keyword,
  matchType,
  qualityScore,
  currentHeadlines = [],
  currentDescriptions = [],
  campaignName,
  adGroupName,
}: HeadlineOptimizerProps) {
  const [result, setResult] = useState<AIResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("optimize-headlines", {
        body: {
          keyword,
          matchType,
          qualityScore,
          currentHeadlines,
          currentDescriptions,
          campaignName,
          adGroupName,
        },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      setResult(data as AIResult);
    } catch (e: any) {
      const msg = e?.message || "Failed to generate suggestions";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const qsColor =
    qualityScore != null
      ? qualityScore < 5
        ? "text-destructive"
        : qualityScore >= 7
        ? "text-green-600"
        : "text-foreground"
      : "text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] p-0">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Headline Optimizer
          </DialogTitle>
          <DialogDescription>
            Improve Quality Score by optimizing ad headlines for your keyword.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="px-6 pb-6 space-y-4">
            {/* Keyword Context */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">"{keyword}"</span>
                  {matchType && (
                    <Badge variant="outline" className="text-[10px]">
                      {matchType}
                    </Badge>
                  )}
                </div>
                {qualityScore != null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Quality Score:</span>
                    <span className={`text-lg font-bold ${qsColor}`}>{qualityScore}/10</span>
                  </div>
                )}
              </div>
              {campaignName && (
                <p className="text-xs text-muted-foreground">
                  {campaignName} {adGroupName ? `→ ${adGroupName}` : ""}
                </p>
              )}

              {currentHeadlines.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Current Headlines:</p>
                  <div className="flex flex-wrap gap-1">
                    {currentHeadlines.map((h, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] font-normal">
                        {h}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Generate Button */}
            {!result && !loading && (
              <Button onClick={handleGenerate} className="w-full gap-2">
                <Sparkles className="h-4 w-4" />
                Generate Optimized Headlines
              </Button>
            )}

            {/* Loading */}
            {loading && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 animate-pulse text-primary" />
                  Analyzing keyword and generating suggestions...
                </div>
                <Skeleton className="h-20 rounded-lg" />
                <Skeleton className="h-32 rounded-lg" />
                <Skeleton className="h-24 rounded-lg" />
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4">
                <p className="text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  {error}
                </p>
                <Button onClick={handleGenerate} variant="outline" size="sm" className="mt-2">
                  Retry
                </Button>
              </div>
            )}

            {/* Results */}
            {result && (
              <>
                {/* Analysis */}
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs font-semibold mb-1 flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Analysis
                  </p>
                  <p className="text-sm text-muted-foreground">{result.analysis}</p>
                </div>

                <Separator />

                {/* Headlines */}
                <div>
                  <p className="text-sm font-semibold mb-2">Suggested Headlines</p>
                  <div className="space-y-2">
                    {result.headlines.map((h, i) => (
                      <div key={i} className="rounded-lg border p-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{h.text}</span>
                            <Badge
                              variant={h.text.length <= 30 ? "secondary" : "destructive"}
                              className="text-[9px] shrink-0"
                            >
                              {h.text.length}/30
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{h.rationale}</p>
                        </div>
                        <CopyButton text={h.text} />
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Descriptions */}
                <div>
                  <p className="text-sm font-semibold mb-2">Suggested Descriptions</p>
                  <div className="space-y-2">
                    {result.descriptions.map((d, i) => (
                      <div key={i} className="rounded-lg border p-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{d.text}</span>
                            <Badge
                              variant={d.text.length <= 90 ? "secondary" : "destructive"}
                              className="text-[9px] shrink-0"
                            >
                              {d.text.length}/90
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{d.rationale}</p>
                        </div>
                        <CopyButton text={d.text} />
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Tips */}
                {result.tips?.length > 0 && (
                  <div className="rounded-lg border bg-primary/5 p-4">
                    <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                      <Lightbulb className="h-3.5 w-3.5 text-primary" />
                      Quality Score Tips
                    </p>
                    <ul className="space-y-1">
                      {result.tips.map((tip, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                          <span className="text-primary mt-0.5">•</span>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Regenerate */}
                <Button onClick={handleGenerate} variant="outline" size="sm" className="gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Regenerate
                </Button>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
