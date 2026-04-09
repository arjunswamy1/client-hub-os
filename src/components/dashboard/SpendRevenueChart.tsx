import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Bar } from "recharts";
import { useDailyMetrics } from "@/hooks/useAdData";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SpendRevenueChart = () => {
  const { data: dailyData, isLoading } = useDailyMetrics();

  if (isLoading) {
    return <Skeleton className="h-80 rounded-xl" />;
  }

  const hasGoogle = dailyData?.some((d) => d.googleSpend > 0);
  const hasData = dailyData && dailyData.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Spend vs Revenue</CardTitle>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
            Meta Spend
          </div>
          {hasGoogle && (
            <div className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              Google Spend
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-primary" />
            Revenue
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-60 items-center justify-center">
            <p className="text-sm text-muted-foreground">No data for this period yet.</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <YAxis tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`} tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <Tooltip
                contentStyle={{ borderRadius: "8px", border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                formatter={(value: number, name: string) => {
                  if (name === "revenue") return [`$${value.toLocaleString()}`, "Revenue"];
                  return [`$${value.toLocaleString()}`, name === "metaSpend" ? "Meta Spend" : "Google Spend"];
                }}
              />
              <Area type="monotone" dataKey="metaSpend" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} />
              {hasGoogle && <Area type="monotone" dataKey="googleSpend" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} strokeWidth={2} />}
              <Bar dataKey="revenue" fill="hsl(var(--primary))" opacity={0.7} barSize={20} radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
};

export default SpendRevenueChart;
