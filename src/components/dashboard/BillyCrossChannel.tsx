import { useVerticalKPIs } from "@/hooks/useBillyData";
import { useRingbaByPlatform } from "@/hooks/useRingbaByPlatform";
import { useVertical } from "@/contexts/VerticalContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpRight, ArrowDownRight, TrendingUp, DollarSign, Target, BarChart3 } from "lucide-react";

function PlatformCard({
  name, spend, revenue, conversions, cpc, ctr, roas, cpa, spendPct,
  spendChange, revChange,
}: {
  name: string; spend: number; revenue: number; conversions: number;
  cpc: number; ctr: number; roas: number; cpa: number; spendPct: number;
  spendChange?: number | null; revChange?: number | null;
}) {
  const isProfitable = roas >= 1;
  return (
    <Card className={`${isProfitable ? "border-green-200 dark:border-green-900" : "border-destructive/30"}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{name}</h3>
          <Badge variant={isProfitable ? "default" : "destructive"} className="text-[10px]">
            {roas.toFixed(2)}x ROAS
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Spend</p>
            <p className="text-lg font-bold">${spend.toLocaleString()}</p>
            {spendChange != null && (
              <span className={`text-[10px] ${spendChange <= 0 ? "text-green-600" : "text-red-500"}`}>
                {spendChange >= 0 ? "+" : ""}{spendChange}%
              </span>
            )}
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase">Revenue</p>
            <p className="text-lg font-bold">${revenue.toLocaleString()}</p>
            {revChange != null && (
              <span className={`text-[10px] ${revChange >= 0 ? "text-green-600" : "text-red-500"}`}>
                {revChange >= 0 ? "+" : ""}{revChange}%
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 pt-2 border-t">
          <div>
            <p className="text-[10px] text-muted-foreground">CPA</p>
            <p className="text-xs font-bold">{cpa > 0 ? `$${cpa}` : "—"}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">CPC</p>
            <p className="text-xs font-bold">${cpc.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">CTR</p>
            <p className="text-xs font-bold">{ctr}%</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Conv.</p>
            <p className="text-xs font-bold">{conversions}</p>
          </div>
        </div>

        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Spend Share</span>
            <span>{spendPct}%</span>
          </div>
          <Progress value={spendPct} className="h-1.5" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function BillyCrossChannel() {
  const { data: metaKpis, isLoading: metaLoading } = useVerticalKPIs("meta");
  const { data: googleKpis, isLoading: googleLoading } = useVerticalKPIs("google");
  const { data: metaRingba, isLoading: metaRingbaLoading } = useRingbaByPlatform("meta");
  const { data: googleRingba, isLoading: googleRingbaLoading } = useRingbaByPlatform("google");
  const { activeVertical } = useVertical();

  const isLoading = metaLoading || googleLoading || metaRingbaLoading || googleRingbaLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 rounded-xl" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  const metaSpend = metaKpis?.spend ?? 0;
  const googleSpend = googleKpis?.spend ?? 0;
  const totalSpend = metaSpend + googleSpend;
  const metaSpendPct = totalSpend > 0 ? Math.round((metaSpend / totalSpend) * 100) : 0;
  const googleSpendPct = totalSpend > 0 ? Math.round((googleSpend / totalSpend) * 100) : 0;

  const metaRev = metaRingba?.revenue ?? 0;
  const googleRev = googleRingba?.revenue ?? 0;
  const totalRev = metaRev + googleRev;
  const totalProfit = totalRev - totalSpend;
  const totalRoas = totalSpend > 0 ? Math.round((totalRev / totalSpend) * 100) / 100 : 0;

  const metaConv = metaRingba?.convertedCalls ?? 0;
  const googleConv = googleRingba?.convertedCalls ?? 0;
  const totalConv = metaConv + googleConv;
  const blendedCpa = totalConv > 0 ? Math.round(totalSpend / totalConv) : 0;

  const metaCpc = metaKpis?.cpc ?? 0;
  const googleCpc = googleKpis?.cpc ?? 0;
  const metaCtr = metaKpis?.ctr ?? 0;
  const googleCtr = googleKpis?.ctr ?? 0;

  const metaCpa = metaConv > 0 ? Math.round((metaSpend / metaConv) * 100) / 100 : 0;
  const googleCpa = googleConv > 0 ? Math.round((googleSpend / googleConv) * 100) / 100 : 0;
  const metaRoas = metaSpend > 0 ? Math.round((metaRev / metaSpend) * 100) / 100 : 0;
  const googleRoas = googleSpend > 0 ? Math.round((googleRev / googleSpend) * 100) / 100 : 0;

  // Determine which platform is more efficient
  const winner = metaRoas > googleRoas ? "Meta" : googleRoas > metaRoas ? "Google" : "Tied";
  const bestCpa = metaCpa > 0 && googleCpa > 0 ? (metaCpa < googleCpa ? "Meta" : "Google") : metaCpa > 0 ? "Meta" : "Google";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">{activeVertical.emoji}</span>
        <div>
          <h2 className="text-base font-semibold">
            {activeVertical.id === "all" ? "All Verticals" : activeVertical.label} — Cross-Platform
          </h2>
          <p className="text-[11px] text-muted-foreground">Blended performance across Meta + Google with Ringba attribution</p>
        </div>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase">Total Spend</p>
            <p className="text-2xl font-bold">${totalSpend.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase">Total Revenue</p>
            <p className="text-2xl font-bold">${totalRev.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase">Net Profit</p>
            <p className={`text-2xl font-bold ${totalProfit >= 0 ? "text-green-600" : "text-destructive"}`}>
              {totalProfit >= 0 ? "" : "−"}${Math.abs(Math.round(totalProfit)).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase">Blended ROAS</p>
            <p className={`text-2xl font-bold ${totalRoas >= 1 ? "text-green-600" : "text-destructive"}`}>{totalRoas}x</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted-foreground uppercase">Blended CPA</p>
            <p className="text-2xl font-bold">{blendedCpa > 0 ? `$${blendedCpa}` : "—"}</p>
          </CardContent>
        </Card>
      </div>

      {/* Insights */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-2">
            <BarChart3 className="h-4 w-4 text-primary mt-0.5" />
            <div className="space-y-1 text-xs">
              <p><strong>Best ROAS:</strong> {winner} ({winner === "Meta" ? metaRoas : googleRoas}x)</p>
              <p><strong>Best CPA:</strong> {bestCpa} ({bestCpa === "Meta" ? `$${metaCpa}` : `$${googleCpa}`})</p>
              <p><strong>Budget Split:</strong> Meta {metaSpendPct}% / Google {googleSpendPct}%</p>
              {metaRoas > 0 && googleRoas > 0 && Math.abs(metaRoas - googleRoas) > 0.5 && (
                <p className="text-primary font-medium">
                  💡 Consider shifting more budget to {winner} — {Math.round(Math.abs(metaRoas - googleRoas) * 100) / 100}x ROAS gap
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Platform Cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PlatformCard
          name="Meta Ads"
          spend={metaSpend}
          revenue={metaRev}
          conversions={metaConv}
          cpc={metaCpc}
          ctr={metaCtr}
          roas={metaRoas}
          cpa={metaCpa}
          spendPct={metaSpendPct}
          spendChange={metaKpis?.changes.spend}
          revChange={metaRingba?.changes.revenue}
        />
        <PlatformCard
          name="Google Ads"
          spend={googleSpend}
          revenue={googleRev}
          conversions={googleConv}
          cpc={googleCpc}
          ctr={googleCtr}
          roas={googleRoas}
          cpa={googleCpa}
          spendPct={googleSpendPct}
          spendChange={googleKpis?.changes.spend}
          revChange={googleRingba?.changes.revenue}
        />
      </div>
    </div>
  );
}
