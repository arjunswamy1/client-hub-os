import { useChannelBreakdown } from "@/hooks/useAdData";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ChannelBreakdown = () => {
  const { data: channelData, isLoading } = useChannelBreakdown();

  if (isLoading) {
    return <Skeleton className="h-80 rounded-xl" />;
  }

  const totalSpend = (channelData || []).reduce((sum, c) => sum + c.spend, 0);

  const colorMap: Record<string, string> = {
    meta: "bg-blue-500",
    google: "bg-amber-500",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Channel Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        {(!channelData || channelData.length === 0) ? (
          <div className="flex h-60 items-center justify-center">
            <p className="text-sm text-muted-foreground">No channel data available yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {channelData.map((ch) => {
              const pct = totalSpend > 0 ? ((ch.spend / totalSpend) * 100).toFixed(0) : "0";
              return (
                <div key={ch.channel} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`h-3 w-3 rounded-full ${colorMap[ch.color] || "bg-muted"}`} />
                      <span className="text-sm font-medium">{ch.channel}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{pct}% of spend</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full ${colorMap[ch.color] || "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>Spend: <span className="font-medium text-foreground">${ch.spend.toLocaleString()}</span></div>
                    <div>Revenue: <span className="font-medium text-foreground">${ch.revenue.toLocaleString()}</span></div>
                    <div>ROAS: <span className="font-medium text-foreground">{ch.roas}x</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ChannelBreakdown;
