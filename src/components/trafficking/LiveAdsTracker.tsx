import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { useDateRange } from '@/contexts/DateRangeContext';

interface Props {
  clientId: string;
}

const statusColors: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  enabled: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-yellow-100 text-yellow-800',
  removed: 'bg-red-100 text-red-800',
  unknown: 'bg-gray-100 text-gray-600',
};

export function LiveAdsTracker({ clientId }: Props) {
  const { dateRange } = useDateRange();
  const startStr = format(dateRange.from, 'yyyy-MM-dd');
  const endStr = format(dateRange.to, 'yyyy-MM-dd');

  // Pull from existing ad_campaigns table (already synced from APIs)
  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['live_campaigns', clientId, startStr, endStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ad_campaigns')
        .select('*')
        .eq('client_id', clientId)
        .gte('date', startStr)
        .lte('date', endStr)
        .order('spend', { ascending: false });
      if (error) throw error;

      // Aggregate by campaign name
      const grouped = new Map<string, any>();
      for (const row of (data || [])) {
        const key = `${row.campaign_name}_${row.platform}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            campaign_name: row.campaign_name,
            platform: row.platform,
            status: row.status || 'unknown',
            spend: 0,
            revenue: 0,
            impressions: 0,
            clicks: 0,
            conversions: 0,
            bidding_strategy_type: row.bidding_strategy_type,
            campaign_type: row.campaign_type,
          });
        }
        const g = grouped.get(key)!;
        g.spend += Number(row.spend);
        g.revenue += Number(row.revenue);
        g.impressions += Number(row.impressions);
        g.clicks += Number(row.clicks);
        g.conversions += Number(row.conversions);
      }
      return Array.from(grouped.values()).sort((a, b) => b.spend - a.spend);
    },
    enabled: !!clientId,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Live Ads — Synced from APIs</CardTitle>
        <p className="text-xs text-muted-foreground">Auto-populated from Meta & Google Ads. {format(dateRange.from, 'MMM d')} – {format(dateRange.to, 'MMM d, yyyy')}</p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No live campaign data found for this date range.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">ROAS</TableHead>
                <TableHead className="text-right">Impressions</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">Conv.</TableHead>
                <TableHead className="text-right">CPA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c: any, i: number) => {
                const roas = c.spend > 0 ? c.revenue / c.spend : 0;
                const ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
                const cpa = c.conversions > 0 ? c.spend / c.conversions : 0;

                return (
                  <TableRow key={i}>
                    <TableCell>
                      <p className="text-sm font-medium truncate max-w-[250px]">{c.campaign_name}</p>
                      {c.bidding_strategy_type && (
                        <span className="text-[10px] text-muted-foreground">{c.bidding_strategy_type}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{c.platform}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${statusColors[c.status] || statusColors.unknown}`}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm">${c.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell className="text-right text-sm">${c.revenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</TableCell>
                    <TableCell className="text-right text-sm font-medium">{roas.toFixed(2)}x</TableCell>
                    <TableCell className="text-right text-sm">{c.impressions.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-sm">{c.clicks.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-sm">{ctr.toFixed(1)}%</TableCell>
                    <TableCell className="text-right text-sm">{c.conversions.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-sm">{cpa > 0 ? `$${cpa.toFixed(2)}` : '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
