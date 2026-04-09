import { useVerticalDailyTrends } from "@/hooks/useBillyData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function BillyDailyTrends() {
  const { data: dailyData, isLoading } = useVerticalDailyTrends();

  if (isLoading) return <Skeleton className="h-80 rounded-xl" />;

  const hasData = dailyData && dailyData.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Daily Spend vs Revenue</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No trend data available</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <YAxis
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
                tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
              />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(value: number, name: string) => [`$${value.toLocaleString()}`, name]}
              />
              <Bar dataKey="spend" name="Spend" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} opacity={0.8} />
              <Area dataKey="revenue" name="Revenue" stroke="hsl(142, 71%, 45%)" fill="hsl(142, 71%, 45%)" fillOpacity={0.15} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
