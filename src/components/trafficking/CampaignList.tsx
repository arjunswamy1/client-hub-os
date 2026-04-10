import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import { format } from 'date-fns';
import { useCampaigns } from '@/hooks/useTrafficking';
import { CampaignDetail } from './CampaignDetail';
import { CreateCampaignDialog } from './CreateCampaignDialog';

interface Props {
  clientId: string;
}

const platformColors: Record<string, string> = {
  meta: 'bg-blue-100 text-blue-800',
  google: 'bg-green-100 text-green-800',
  tiktok: 'bg-pink-100 text-pink-800',
};

const statusColors: Record<string, string> = {
  planning: 'bg-muted text-muted-foreground',
  active: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-gray-100 text-gray-600',
};

export function CampaignList({ clientId }: Props) {
  const { data: campaigns = [] } = useCampaigns(clientId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const selected = (campaigns as any[]).find((c: any) => c.id === selectedId);

  if (selected) {
    return <CampaignDetail campaign={selected} onBack={() => setSelectedId(null)} clientId={clientId} />;
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Campaigns</CardTitle>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Campaign
          </Button>
        </CardHeader>
        <CardContent>
          {(campaigns as any[]).length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No campaigns yet. Create one to start planning.</p>
          ) : (
            <div className="space-y-2">
              {(campaigns as any[]).map((campaign: any) => (
                <div
                  key={campaign.id}
                  className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                  onClick={() => setSelectedId(campaign.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{campaign.name}</p>
                      <Badge className={`text-[10px] ${platformColors[campaign.platform] || 'bg-muted'}`}>{campaign.platform}</Badge>
                      <Badge className={`text-[10px] ${statusColors[campaign.status] || 'bg-muted'}`}>{campaign.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {campaign.start_date && campaign.end_date
                        ? `${format(new Date(campaign.start_date), 'MMM d')} – ${format(new Date(campaign.end_date), 'MMM d, yyyy')}`
                        : 'No dates set'}
                      {campaign.total_budget ? ` • $${Number(campaign.total_budget).toLocaleString()} budget` : ''}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">{campaign.objective || ''}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateCampaignDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} clientId={clientId} />
    </>
  );
}
