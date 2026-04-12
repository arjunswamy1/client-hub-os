import { useState, useMemo } from "react";
import { useCreativePerformance, useFormatComparison, useFatigueAlerts, CreativeData } from "@/hooks/useCreativeReporting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Image, BarChart3, AlertTriangle, Eye, Play, ExternalLink } from "lucide-react";

function AdPreviewModal({ ad, open, onOpenChange }: { ad: CreativeData | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  if (!ad) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm truncate">{ad.adName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Thumbnail / Video */}
          {ad.thumbnailUrl ? (
            <div className="relative rounded-lg overflow-hidden bg-muted">
              <img src={ad.thumbnailUrl} alt={ad.adName} className="w-full object-contain max-h-[400px]" />
              {ad.format?.toLowerCase().includes("video") && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <div className="h-12 w-12 rounded-full bg-white/90 flex items-center justify-center">
                    <Play className="h-5 w-5 text-foreground ml-0.5" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="h-48 rounded-lg bg-muted flex items-center justify-center">
              <Image className="h-10 w-10 text-muted-foreground" />
            </div>
          )}

          {/* Ad copy */}
          <div className="space-y-2 text-sm">
            {ad.primaryText && (
              <p className="text-foreground leading-relaxed">{ad.primaryText}</p>
            )}
            {ad.headline && (
              <p className="font-semibold text-foreground">{ad.headline}</p>
            )}
            {ad.description && (
              <p className="text-muted-foreground text-xs">{ad.description}</p>
            )}
            {ad.linkUrl && (
              <a href={ad.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <ExternalLink className="h-3 w-3" />
                {ad.linkUrl}
              </a>
            )}
          </div>

          {/* Stats summary */}
          <div className="grid grid-cols-4 gap-3 border-t pt-3">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Spend</p>
              <p className="text-sm font-semibold">${ad.spend.toLocaleString()}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">ROAS</p>
              <p className="text-sm font-semibold">{ad.roas}x</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">CTR</p>
              <p className="text-sm font-semibold">{ad.ctr}%</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Freq.</p>
              <p className="text-sm font-semibold">{ad.frequency?.toFixed(1) ?? "—"}</p>
            </div>
          </div>

          {/* Format + Status */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">{ad.format}</Badge>
            {ad.status && (
              <Badge variant={ad.status === "ACTIVE" || ad.status === "active" ? "default" : "outline"} className="text-[10px]">
                {ad.status}
              </Badge>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CreativeReporting() {
  const { data: creatives, isLoading } = useCreativePerformance();
  const formatComparison = useFormatComparison(creatives);
  const fatigueAlerts = useFatigueAlerts(creatives);
  const [showActiveOnly, setShowActiveOnly] = useState(true);
  const [previewAd, setPreviewAd] = useState<CreativeData | null>(null);

  const filteredCreatives = useMemo(() => {
    if (!creatives) return [];
    if (!showActiveOnly) return creatives;
    return creatives.filter(c =>
      c.status?.toLowerCase() === "active" || c.status?.toLowerCase() === "enabled"
    );
  }, [creatives, showActiveOnly]);

  if (isLoading) {
    return <Card><CardContent className="p-6"><Skeleton className="h-48 rounded-xl" /></CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Image className="h-4 w-4" />
            Creative Performance
            {fatigueAlerts.length > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                <AlertTriangle className="h-3 w-3 mr-0.5" />
                {fatigueAlerts.length} fatigue
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Switch
              id="active-toggle"
              checked={showActiveOnly}
              onCheckedChange={setShowActiveOnly}
            />
            <Label htmlFor="active-toggle" className="text-xs text-muted-foreground cursor-pointer">
              Active only
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="top" className="space-y-3">
          <TabsList className="bg-secondary/50">
            <TabsTrigger value="top" className="gap-1 text-xs">
              <Image className="h-3 w-3" />
              Top Creatives
              <Badge variant="secondary" className="text-[9px] ml-1">{filteredCreatives.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="format" className="gap-1 text-xs">
              <BarChart3 className="h-3 w-3" />
              Format Comparison
            </TabsTrigger>
            <TabsTrigger value="fatigue" className="gap-1 text-xs">
              <AlertTriangle className="h-3 w-3" />
              Fatigue Alerts
            </TabsTrigger>
          </TabsList>

          {/* Top Creatives */}
          <TabsContent value="top">
            {filteredCreatives.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {showActiveOnly ? "No active ads found — toggle off to see all" : "No creative data available"}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <div className="max-h-[420px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Creative</TableHead>
                        <TableHead>Format</TableHead>
                        <TableHead className="text-right">Spend</TableHead>
                        <TableHead className="text-right">Rev.</TableHead>
                        <TableHead className="text-right">ROAS</TableHead>
                        <TableHead className="text-right">Conv.</TableHead>
                        <TableHead className="text-right">CPA</TableHead>
                        <TableHead className="text-right">CTR</TableHead>
                        <TableHead className="text-right">Freq.</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCreatives.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell className="w-8 pr-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => setPreviewAd(c)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                          <TableCell className="flex items-center gap-2 max-w-[200px]">
                            {c.thumbnailUrl ? (
                              <img src={c.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
                            ) : (
                              <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0">
                                <Image className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <span className="truncate text-xs font-medium">{c.adName}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px]">{c.format}</Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs">${c.spend.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs">${c.revenue.toLocaleString()}</TableCell>
                          <TableCell className="text-right text-xs">{c.roas}x</TableCell>
                          <TableCell className="text-right text-xs">{c.conversions}</TableCell>
                          <TableCell className="text-right text-xs">{c.cpa > 0 ? `$${c.cpa}` : "—"}</TableCell>
                          <TableCell className="text-right text-xs">{c.ctr}%</TableCell>
                          <TableCell className={`text-right text-xs ${c.frequency && c.frequency > 3 ? "text-destructive font-medium" : ""}`}>
                            {c.frequency != null ? c.frequency.toFixed(1) : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={c.status?.toLowerCase() === "active" ? "default" : "outline"} className="text-[10px]">
                              {c.status || "—"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Format Comparison */}
          <TabsContent value="format">
            {formatComparison.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No format data</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Format</TableHead>
                      <TableHead className="text-right">Ads</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">ROAS</TableHead>
                      <TableHead className="text-right">Conv.</TableHead>
                      <TableHead className="text-right">Avg CPC</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formatComparison.map(f => (
                      <TableRow key={f.format}>
                        <TableCell className="font-medium">{f.format}</TableCell>
                        <TableCell className="text-right">{f.count}</TableCell>
                        <TableCell className="text-right">${f.spend.toLocaleString()}</TableCell>
                        <TableCell className="text-right">${f.revenue.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{f.roas}x</TableCell>
                        <TableCell className="text-right">{f.conversions}</TableCell>
                        <TableCell className="text-right">${f.avgCpc}</TableCell>
                        <TableCell className="text-right">{f.ctr}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Fatigue Alerts */}
          <TabsContent value="fatigue">
            {fatigueAlerts.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-muted-foreground">✅ No fatigue alerts — all creatives look healthy</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Creative</TableHead>
                      <TableHead className="text-right">Frequency</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead className="text-right">CPA</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fatigueAlerts.map((c, i) => (
                      <TableRow key={i}>
                        <TableCell className="flex items-center gap-2 max-w-[200px]">
                          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                          <span className="truncate text-xs font-medium">{c.adName}</span>
                        </TableCell>
                        <TableCell className="text-right text-xs text-destructive font-medium">{c.frequency?.toFixed(1)}</TableCell>
                        <TableCell className="text-right text-xs">${c.spend.toLocaleString()}</TableCell>
                        <TableCell className="text-right text-xs">{c.ctr}%</TableCell>
                        <TableCell className="text-right text-xs">{c.cpa > 0 ? `$${c.cpa}` : "—"}</TableCell>
                        <TableCell><Badge variant="destructive" className="text-[10px]">High Frequency</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>

      <AdPreviewModal ad={previewAd} open={!!previewAd} onOpenChange={(o) => !o && setPreviewAd(null)} />
    </Card>
  );
}