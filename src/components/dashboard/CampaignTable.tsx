import { useState } from "react";
import { useTopCampaigns } from "@/hooks/useAdData";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const CampaignTable = ({ platform }: { platform?: string }) => {
  const { data: campaigns, isLoading } = useTopCampaigns(platform);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-64" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {platform ? `${platform === "google" ? "Google" : "Meta"} Campaigns` : "All Campaigns"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {!campaigns || campaigns.length === 0 ? (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm text-muted-foreground">No campaign data yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Campaign</TableHead>
                  <TableHead className="text-xs text-right">Spend</TableHead>
                  <TableHead className="text-xs text-right">Revenue</TableHead>
                  <TableHead className="text-xs text-right">ROAS</TableHead>
                  <TableHead className="text-xs text-right">Clicks</TableHead>
                  <TableHead className="text-xs text-right">Conv.</TableHead>
                  <TableHead className="text-xs text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.name} className="text-sm">
                    <TableCell className="max-w-[200px] truncate font-medium">{campaign.name}</TableCell>
                    <TableCell className="text-right">${campaign.spend.toLocaleString()}</TableCell>
                    <TableCell className="text-right">${campaign.revenue.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{campaign.roas}x</TableCell>
                    <TableCell className="text-right">{campaign.clicks.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{campaign.conversions}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={campaign.status === "active" ? "default" : "secondary"}
                        className="text-[10px] px-1.5"
                      >
                        {campaign.status}
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
};

export default CampaignTable;
