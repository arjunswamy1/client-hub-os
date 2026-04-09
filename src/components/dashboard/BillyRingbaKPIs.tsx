import { useRingbaRevenue } from "@/hooks/useRingbaData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, PhoneCall, PhoneForwarded, Clock, TrendingUp } from "lucide-react";

export default function BillyRingbaKPIs() {
  const { data: ringba, isLoading } = useRingbaRevenue();

  if (isLoading) return <Skeleton className="h-24 rounded-xl" />;
  if (!ringba || ringba.totalCalls === 0) return null;

  const stats = [
    { label: "Total Calls", value: ringba.totalCalls.toLocaleString(), icon: Phone, change: ringba.changes.totalCalls },
    { label: "Connected", value: ringba.connectedCalls.toLocaleString(), icon: PhoneCall, sub: `${ringba.connectRate}% rate` },
    { label: "Converted", value: ringba.convertedCalls.toLocaleString(), icon: PhoneForwarded, change: ringba.changes.convertedCalls, sub: `${ringba.conversionRate}% rate` },
    { label: "Avg Duration", value: `${Math.floor(ringba.avgDuration / 60)}m ${ringba.avgDuration % 60}s`, icon: Clock },
    { label: "Payout", value: `$${ringba.payout.toLocaleString()}`, icon: TrendingUp, change: ringba.changes.payout },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="h-4 w-4" />
          Ringba Call Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {stats.map((stat) => (
            <div key={stat.label} className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <stat.icon className="h-3 w-3" />
                {stat.label}
              </div>
              <div className="text-lg font-semibold">{stat.value}</div>
              {stat.change != null && (
                <span className={`text-xs ${stat.change >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {stat.change >= 0 ? "+" : ""}{stat.change}%
                </span>
              )}
              {stat.sub && <span className="text-xs text-muted-foreground">{stat.sub}</span>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
