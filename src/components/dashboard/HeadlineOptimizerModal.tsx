import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
// skeleton replaced with inline animated divs
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  landingPageUrl?: string;
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
    <button
      className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted shrink-0"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

function CharBadge({ len, max }: { len: number; max: number }) {
  return (
    <span className={`text-[10px] tabular-nums shrink-0 ${len <= max ? "text-muted-foreground" : "text-destructive font-medium"}`}>
      {len}/{max}
    </span>
  );
}

/** Headlines grid: 4 columns, full text visible */
function HeadlinesGrid({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  const cols = 4;
  const rows: string[][] = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(items.slice(i, i + cols));
  }
  const lastRow = rows[rows.length - 1];
  while (lastRow.length < cols) lastRow.push("");

  return (
    <div className="grid grid-cols-4 gap-px bg-border rounded-md overflow-hidden border">
      {rows.flatMap((row, ri) =>
        row.map((cell, ci) => (
          <div
            key={`${ri}-${ci}`}
            className="bg-background px-2.5 py-2 text-xs min-h-[36px]"
          >
            {cell ? (
              <div className="flex items-start gap-1.5">
                <span className="flex-1 break-words leading-snug">{cell}</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <CharBadge len={cell.length} max={30} />
                  <CopyButton text={cell} />
                </div>
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}

/** Descriptions grid: 2 columns, full text visible */
function DescriptionsGrid({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  const cols = 2;
  const rows: string[][] = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(items.slice(i, i + cols));
  }
  const lastRow = rows[rows.length - 1];
  while (lastRow.length < cols) lastRow.push("");

  return (
    <div className="grid grid-cols-2 gap-px bg-border rounded-md overflow-hidden border">
      {rows.flatMap((row, ri) =>
        row.map((cell, ci) => (
          <div
            key={`${ri}-${ci}`}
            className="bg-background px-2.5 py-2 text-xs min-h-[36px]"
          >
            {cell ? (
              <div className="flex items-start gap-1.5">
                <span className="flex-1 break-words leading-snug">{cell}</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <CharBadge len={cell.length} max={90} />
                  <CopyButton text={cell} />
                </div>
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
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
  landingPageUrl,
}: HeadlineOptimizerProps) {
  const [result, setResult] = useState<AIResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");

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
          landingPageUrl,
          customPrompt: customPrompt.trim() || undefined,
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

  const dedupedHeadlines = [...new Set(currentHeadlines)];
  const dedupedDescriptions = [...new Set(currentDescriptions)];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[1200px] max-h-[92vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-3 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Headline Optimizer
          </DialogTitle>
          <DialogDescription className="text-xs">
            Improve Quality Score by optimizing ad headlines for your keyword.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="px-6 pb-6 space-y-5">

            {/* ─── RESULTS VIEW ─── */}
            {result ? (
              <>
                {/* Compact keyword context bar */}
                <div className="flex items-center justify-between rounded-lg border px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">"{keyword}"</span>
                    {matchType && <Badge variant="outline" className="text-[10px]">{matchType}</Badge>}
                    {campaignName && (
                      <span className="text-xs text-muted-foreground ml-1">
                        {campaignName}{adGroupName ? ` → ${adGroupName}` : ""}
                      </span>
                    )}
                  </div>
                  {qualityScore != null && (
                    <span className={`text-lg font-bold ${qsColor}`}>{qualityScore}/10</span>
                  )}
                </div>

                {/* Analysis */}
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs font-semibold mb-1 flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    Analysis
                  </p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{result.analysis}</p>
                </div>

                <Separator />

                {/* Suggested Headlines */}
                <div>
                  <p className="text-sm font-semibold mb-2">Suggested Headlines</p>
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs w-[280px]">Headline</TableHead>
                          <TableHead className="text-xs w-[50px] text-center">Chars</TableHead>
                          <TableHead className="text-xs">Rationale</TableHead>
                          <TableHead className="text-xs w-[36px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.headlines.map((h, i) => (
                          <TableRow key={i}>
                            <TableCell className="py-2 font-medium text-sm">{h.text}</TableCell>
                            <TableCell className="py-2 text-center">
                              <CharBadge len={h.text.length} max={30} />
                            </TableCell>
                            <TableCell className="py-2 text-xs text-muted-foreground">{h.rationale}</TableCell>
                            <TableCell className="py-2"><CopyButton text={h.text} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <Separator />

                {/* Suggested Descriptions */}
                <div>
                  <p className="text-sm font-semibold mb-2">Suggested Descriptions</p>
                  <div className="rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Description</TableHead>
                          <TableHead className="text-xs w-[50px] text-center">Chars</TableHead>
                          <TableHead className="text-xs w-[340px]">Rationale</TableHead>
                          <TableHead className="text-xs w-[36px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.descriptions.map((d, i) => (
                          <TableRow key={i}>
                            <TableCell className="py-2 text-sm">{d.text}</TableCell>
                            <TableCell className="py-2 text-center">
                              <CharBadge len={d.text.length} max={90} />
                            </TableCell>
                            <TableCell className="py-2 text-xs text-muted-foreground">{d.rationale}</TableCell>
                            <TableCell className="py-2"><CopyButton text={d.text} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
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

                <Separator />

                {/* Refine section */}
                <div className="space-y-3">
                  <p className="text-xs font-semibold">Request Edits</p>
                  <Textarea
                    placeholder="e.g. Make headline #2 shorter, remove mention of price, add urgency to descriptions..."
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    className="text-xs min-h-[52px] resize-none"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button onClick={handleGenerate} className="flex-1 gap-2" disabled={loading}>
                      {loading ? (
                        <>
                          <Sparkles className="h-4 w-4 animate-pulse" />
                          Regenerating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          Regenerate
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setResult(null)}
                      className="text-xs"
                    >
                      ← Back to Input
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              /* ─── INPUT VIEW ─── */
              <>
                {/* Keyword Context — compact bar */}
                <div className="flex items-center justify-between rounded-lg border px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">"{keyword}"</span>
                    {matchType && <Badge variant="outline" className="text-[10px]">{matchType}</Badge>}
                    {campaignName && (
                      <span className="text-xs text-muted-foreground ml-1">
                        {campaignName}{adGroupName ? ` → ${adGroupName}` : ""}
                      </span>
                    )}
                  </div>
                  {qualityScore != null && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Quality Score:</span>
                      <span className={`text-lg font-bold ${qsColor}`}>{qualityScore}/10</span>
                    </div>
                  )}
                </div>

                {/* Landing Page URL */}
                {landingPageUrl && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border px-4 py-2">
                    <span className="font-medium text-foreground">Landing Page:</span>
                    <a href={landingPageUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">{landingPageUrl}</a>
                    <span className="text-[10px] shrink-0">• AI will analyze for keyword↔LP alignment</span>
                  </div>
                )}

                {/* Current Headlines */}
                {dedupedHeadlines.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2">Current Headlines ({dedupedHeadlines.length})</p>
                    <HeadlinesGrid items={dedupedHeadlines} />
                  </div>
                )}

                {/* Current Descriptions */}
                {dedupedDescriptions.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold mb-2">Current Descriptions ({dedupedDescriptions.length})</p>
                    <DescriptionsGrid items={dedupedDescriptions} />
                  </div>
                )}

                {dedupedHeadlines.length === 0 && dedupedDescriptions.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No existing ad copy found for this ad group. AI will generate fresh suggestions.</p>
                )}

                {/* Custom Prompt */}
                <div>
                  <label className="text-xs font-medium mb-1.5 block">
                    Additional direction <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <Textarea
                    placeholder="e.g. Focus on price savings, mention 24/7 customer support, emphasize same-day booking..."
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    className="text-xs min-h-[52px] resize-none"
                    rows={2}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Tell the AI what messaging angle or key selling points to emphasize.
                  </p>
                </div>

                {/* Generate Button */}
                <Button onClick={handleGenerate} className="w-full gap-2" disabled={loading}>
                  {loading ? (
                    <>
                      <Sparkles className="h-4 w-4 animate-pulse" />
                      Analyzing keyword & landing page...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Generate Optimized Headlines
                    </>
                  )}
                </Button>

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
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
