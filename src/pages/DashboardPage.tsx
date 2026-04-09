import { useClient } from '@/contexts/ClientContext';
import { DateRangeProvider } from '@/contexts/DateRangeContext';
import CrossChannelView from '@/components/dashboard/CrossChannelView';
import GoogleDashboard from '@/components/dashboard/GoogleDashboard';
import MetaDashboard from '@/components/dashboard/MetaDashboard';
import DateRangePicker from '@/components/dashboard/DateRangePicker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Chrome, Facebook } from 'lucide-react';

function DashboardContent() {
  const { activeClient } = useClient();

  if (!activeClient) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Select a client to view their dashboard</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{activeClient.name}</h1>
          <p className="text-sm text-muted-foreground">Ad performance & analytics</p>
        </div>
        <DateRangePicker />
      </div>

      <Tabs defaultValue="cross-channel" className="space-y-4">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="cross-channel" className="gap-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5" />
            Cross-Channel
          </TabsTrigger>
          <TabsTrigger value="google" className="gap-1.5 text-xs">
            <Chrome className="h-3.5 w-3.5" />
            Google Ads
          </TabsTrigger>
          <TabsTrigger value="meta" className="gap-1.5 text-xs">
            <Facebook className="h-3.5 w-3.5" />
            Meta Ads
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cross-channel">
          <CrossChannelView />
        </TabsContent>
        <TabsContent value="google">
          <GoogleDashboard />
        </TabsContent>
        <TabsContent value="meta">
          <MetaDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <DateRangeProvider>
      <DashboardContent />
    </DateRangeProvider>
  );
}
