import { useVerticalCampaigns } from "@/hooks/useBillyData";
import { useVertical } from "@/contexts/VerticalContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Props {
  platform?: "meta" | "google";
}

export default function BillyCampaignTable({ platform }: Props) {
  const { data: campaigns, isLoading } = useVerticalCampaigns(platform);
  const { activeVertical } = useVertical();

  const title = platform === "google"
    ? "Google Campaigns"
    : platform === "meta"
      ? "Meta Campaigns"
      : "All Campaigns";

  if (isLoading) {
    return <Card><CardContent className="p-6"><Skeleton className="h-48 rounded-xl" /></CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {title}
          {activeVertical.id !== "all" && (
            <Badge variant="outline" className="text-xs font-normal">
              {activeVertical.emoji} {activeVertical.label}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!campaigns || campaigns.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No active campaigns for this vertical
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">ROAS</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Conv.</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="max-w-[240px] truncate font-medium">{c.name}</TableCell>
                    <TableCell className="text-right">${c.spend.toLocaleString()}</TableCell>
                    <TableCell className="text-right">${c.revenue.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{c.roas}x</TableCell>
                    <TableCell className="text-right">{c.clicks.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{c.conversions}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "active" || c.status === "enabled" ? "default" : "secondary"} className="text-xs">
                        {c.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
