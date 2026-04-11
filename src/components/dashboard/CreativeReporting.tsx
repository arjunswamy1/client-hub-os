import { useCreativePerformance, useFormatComparison, useFatigueAlerts } from "@/hooks/useCreativeReporting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Image, BarChart3, AlertTriangle } from "lucide-react";

export default function CreativeReporting() {
  const { data: creatives, isLoading } = useCreativePerformance();
  const formatComparison = useFormatComparison(creatives);
  const fatigueAlerts = useFatigueAlerts(creatives);

  if (isLoading) {
    return <Card><CardContent className="p-6"><Skeleton className="h-48 rounded-xl" /></CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
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
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="top" className="space-y-3">
          <TabsList className="bg-secondary/50">
            <TabsTrigger value="top" className="gap-1 text-xs">
              <Image className="h-3 w-3" />
              Top Creatives
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
            {!creatives || creatives.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No creative data available</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Creative</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">Rev.</TableHead>
                      <TableHead className="text-right">ROAS</TableHead>
                      <TableHead className="text-right">Conv.</TableHead>
                      <TableHead className="text-right">CPA</TableHead>
                      <TableHead className="text-right">CTR</TableHead>
                      <TableHead className="text-right">Freq.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creatives.slice(0, 15).map((c, i) => (
                      <TableRow key={i}>
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
    </Card>
  );
}
