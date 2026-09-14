import { useClient } from '@/contexts/ClientContext';
import { DateRangeProvider } from '@/contexts/DateRangeContext';
import { useDashboardConfig } from '@/hooks/useDashboardConfig';
import CrossChannelView from '@/components/dashboard/CrossChannelView';
import GoogleDashboard from '@/components/dashboard/GoogleDashboard';
import MetaDashboard from '@/components/dashboard/MetaDashboard';
import BillyDashboard from '@/components/dashboard/BillyDashboard';
import FourJsDashboard from '@/components/dashboard/FourJsDashboard';
import CannaballDashboard from '@/components/dashboard/CannaballDashboard';
import JacuzziDashboard from '@/components/dashboard/JacuzziDashboard';
import RRMDashboard from '@/components/dashboard/RRMDashboard';
import BuyologyDashboard from '@/components/dashboard/BuyologyDashboard';
import DashboardHighlights from '@/components/dashboard/DashboardHighlights';
import DateRangePicker from '@/components/dashboard/DateRangePicker';
import { BookCallButton } from '@/components/portal/BookCallButton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, Chrome, Facebook, Sparkles } from 'lucide-react';

/** Detect if a client is Billy.com by slug or name */
function isBillyClient(client: { slug: string; name: string } | null): boolean {
  if (!client) return false;
  const slug = client.slug.toLowerCase();
  const name = client.name.toLowerCase();
  return slug.includes('billy') || name.includes('billy');
}

/** Detect 4Js Final Expense client */
function isFourJsClient(client: { slug: string; name: string } | null): boolean {
  if (!client) return false;
  const slug = client.slug.toLowerCase();
  const name = client.name.toLowerCase();
  return slug === '4js' || slug.includes('four-j') || name.includes('4js') || name.includes("four j");
}

/** Detect Cannaball client */
function isCannaballClient(client: { slug: string; name: string } | null): boolean {
  if (!client) return false;
  return client.slug.toLowerCase() === 'cannaball' || client.name.toLowerCase().includes('cannaball');
}

/** Detect Jacuzzi client */
function isJacuzziClient(client: { slug: string; name: string } | null): boolean {
  if (!client) return false;
  return client.slug.toLowerCase().includes('jacuzzi') || client.name.toLowerCase().includes('jacuzzi');
}

/** Detect RRM (River Road Marketing) client */
function isRRMClient(client: { slug: string; name: string } | null): boolean {
  if (!client) return false;
  return client.slug.toLowerCase() === 'rrm' || client.name.toLowerCase().includes('river road');
}

/** Detect BuyologyIQ client */
function isBuyologyClient(client: { slug: string; name: string } | null): boolean {
  if (!client) return false;
  return client.slug.toLowerCase().includes('buyology') || client.name.toLowerCase().includes('buyology');
}

/** Detect Spektrafin client */
function isSpektrafinClient(client: { slug: string; name: string } | null): boolean {
  if (!client) return false;
  return client.slug.toLowerCase().includes('spektrafin') || client.name.toLowerCase().includes('spektrafin');
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
  const isFourJs = isFourJsClient(activeClient);
  const isCannaball = isCannaballClient(activeClient);
  const isJacuzzi = isJacuzziClient(activeClient);
  const isRRM = isRRMClient(activeClient);
  const isBuyology = isBuyologyClient(activeClient);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{activeClient.name}</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {isBuyology ? 'Meta Ads — Ringba Pay-per-Call Attribution' : isRRM ? 'Windows (Meta) & Plumbing (Google) — Moja Call Tracking' : isJacuzzi ? 'Bath Remodel CTV — Cost-per-Lead (Calls + QR Scans)' : isCannaball ? 'Roku CTV — Pay-per-Call Attribution' : isFourJs ? 'Final Expense — Pay-per-Call Attribution' : isBilly ? 'Revenue Engine — Lead Generation' : 'Ad performance & analytics'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <BookCallButton variant="outline" size="sm" className="h-9 gap-1.5 text-xs" label="Book a call" />
          <DateRangePicker />
        </div>
      </div>

      {isBuyology ? (
        <BuyologyDashboard />
      ) : isRRM ? (
        <RRMDashboard />
      ) : isJacuzzi ? (
        <JacuzziDashboard />
      ) : isCannaball ? (
        <CannaballDashboard />
      ) : isFourJs ? (
        <FourJsDashboard />
      ) : isBilly ? (
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
