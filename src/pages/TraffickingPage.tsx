
import { useClient } from '@/contexts/ClientContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContentCalendar } from '@/components/trafficking/ContentCalendar';
import { CampaignList } from '@/components/trafficking/CampaignList';
import { InProgressAds } from '@/components/trafficking/InProgressAds';
import { LiveAdsTracker } from '@/components/trafficking/LiveAdsTracker';

export default function TraffickingPage() {
  const { activeClient } = useClient();

  if (!activeClient) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Select a client to manage trafficking.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Ad Trafficking</h1>
        <p className="text-sm text-muted-foreground">Plan, build, and launch ads from one place.</p>
      </div>

      <Tabs defaultValue="in-progress" className="space-y-4">
        <TabsList>
          <TabsTrigger value="calendar">Content Calendar</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="in-progress">🟡 In Progress</TabsTrigger>
          <TabsTrigger value="live">🟢 Live Ads</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar">
          <ContentCalendar clientId={activeClient.id} />
        </TabsContent>

        <TabsContent value="campaigns">
          <CampaignList clientId={activeClient.id} />
        </TabsContent>

        <TabsContent value="in-progress">
          <InProgressAds clientId={activeClient.id} />
        </TabsContent>

        <TabsContent value="live">
          <LiveAdsTracker clientId={activeClient.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
