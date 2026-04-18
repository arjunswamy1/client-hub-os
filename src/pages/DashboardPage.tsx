import { useClient } from '@/contexts/ClientContext';
import { DateRangeProvider } from '@/contexts/DateRangeContext';
import { useDashboardConfig } from '@/hooks/useDashboardConfig';
import CrossChannelView from '@/components/dashboard/CrossChannelView';
import GoogleDashboard from '@/components/dashboard/GoogleDashboard';
import MetaDashboard from '@/components/dashboard/MetaDashboard';
import BillyDashboard from '@/components/dashboard/BillyDashboard';
import DashboardHighlights from '@/components/dashboard/DashboardHighlights';
import DateRangePicker from '@/components/dashboard/DateRangePicker';
import { BookCallButton } from '@/components/portal/BookCallButton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Chrome, Facebook, Sparkles } from 'lucide-react';

/** Detect the fabricated demo client (Sample Client) — used to gate anonymized callouts. */
const SAMPLE_CLIENT_ID = '9cd00cfb-82a3-44ad-8639-342a51944343';

/** Detect if a client is Billy.com by slug or name */
function isBillyClient(client: { slug: string; name: string } | null): boolean {
  if (!client) return false;
  const slug = client.slug.toLowerCase();
  const name = client.name.toLowerCase();
  return slug.includes('billy') || name.includes('billy');
}

function DashboardContent() {
  const { activeClient } = useClient();
  const { data: config } = useDashboardConfig();

  if (!activeClient) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Select a client to view their dashboard</p>
      </div>
    );
  }

  const isBilly = isBillyClient(activeClient) || config?.revenue_source === 'ringba';

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{activeClient.name}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {isBilly ? 'Revenue Engine — Lead Generation' : 'Ad performance & analytics'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <BookCallButton variant="outline" size="sm" className="h-9 gap-1.5 text-xs" label="Book a call" />
          <DateRangePicker />
        </div>
      </div>

      {isBilly ? (
        <BillyDashboard />
      ) : (
        <Tabs defaultValue="highlights" className="space-y-4">
          {/* Horizontal-scrolling tabs on mobile so all 4 fit cleanly */}
          <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto scrollbar-none">
            <TabsList className="bg-secondary/50 inline-flex w-auto">
              <TabsTrigger value="highlights" className="gap-1.5 text-xs whitespace-nowrap">
                <Sparkles className="h-3.5 w-3.5" />
                Highlights
              </TabsTrigger>
              <TabsTrigger value="cross-channel" className="gap-1.5 text-xs whitespace-nowrap">
                <BarChart3 className="h-3.5 w-3.5" />
                Cross-Channel
              </TabsTrigger>
              <TabsTrigger value="google" className="gap-1.5 text-xs whitespace-nowrap">
                <Chrome className="h-3.5 w-3.5" />
                Google Ads
              </TabsTrigger>
              <TabsTrigger value="meta" className="gap-1.5 text-xs whitespace-nowrap">
                <Facebook className="h-3.5 w-3.5" />
                Meta Ads
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="highlights">
            <DashboardHighlights />
          </TabsContent>
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
      )}
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
