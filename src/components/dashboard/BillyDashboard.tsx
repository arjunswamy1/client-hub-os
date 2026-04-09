import { VerticalProvider } from "@/contexts/VerticalContext";
import { BillyVerticalSelector } from "@/components/dashboard/BillyVerticalSelector";
import BillyDailyTrends from "@/components/dashboard/BillyDailyTrends";
import BillyCampaignTable from "@/components/dashboard/BillyCampaignTable";
import BillyRingbaKPIs from "@/components/dashboard/BillyRingbaKPIs";
import KPICard from "@/components/dashboard/KPICard";
import { useVerticalKPIs } from "@/hooks/useBillyData";
import { useRingbaRevenue } from "@/hooks/useRingbaData";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Chrome, Facebook, Phone } from "lucide-react";

function BillyOverview() {
  const { data: adKpis, isLoading: adLoading } = useVerticalKPIs();
  const { data: ringba, isLoading: ringbaLoading } = useRingbaRevenue();
  const isLoading = adLoading || ringbaLoading;

  // Use Ringba revenue as the source of truth for Billy
  const revenue = ringba?.revenue ?? 0;
  const spend = adKpis?.spend ?? 0;
  const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0;
  const cac = ringba?.convertedCalls && ringba.convertedCalls > 0
    ? Math.round((spend / ringba.convertedCalls) * 100) / 100
    : 0;

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KPICard title="Ad Spend" value={`$${spend.toLocaleString()}`} change={adKpis?.changes.spend} invertColor />
          <KPICard title="Call Revenue" value={`$${revenue.toLocaleString()}`} change={ringba?.changes.revenue} />
          <KPICard title="Converted Calls" value={(ringba?.convertedCalls ?? 0).toLocaleString()} change={ringba?.changes.convertedCalls} />
          <KPICard title="CAC" value={cac ? `$${cac}` : "—"} invertColor />
          <KPICard title="ROAS" value={roas ? `${roas}x` : "—"} />
        </div>
      )}

      <BillyRingbaKPIs />
      <BillyDailyTrends />
      <BillyCampaignTable />
    </div>
  );
}

function BillyMetaTab() {
  const { data: kpis, isLoading } = useVerticalKPIs("meta");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <KPICard title="Meta Spend" value={`$${(kpis?.spend ?? 0).toLocaleString()}`} change={kpis?.changes.spend} invertColor />
            <KPICard title="Conversions" value={(kpis?.conversions ?? 0).toLocaleString()} change={kpis?.changes.conversions} />
            <KPICard title="CAC" value={kpis?.cac ? `$${kpis.cac}` : "—"} change={kpis?.changes.cac} invertColor />
            <KPICard title="CTR" value={`${kpis?.ctr ?? 0}%`} change={kpis?.changes.ctr} />
          </>
        )}
      </div>
      <BillyCampaignTable platform="meta" />
    </div>
  );
}

function BillyGoogleTab() {
  const { data: kpis, isLoading } = useVerticalKPIs("google");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <KPICard title="Google Spend" value={`$${(kpis?.spend ?? 0).toLocaleString()}`} change={kpis?.changes.spend} invertColor />
            <KPICard title="Conversions" value={(kpis?.conversions ?? 0).toLocaleString()} change={kpis?.changes.conversions} />
            <KPICard title="CPC" value={kpis?.cpc ? `$${kpis.cpc}` : "—"} change={kpis?.changes.cpc} invertColor />
            <KPICard title="CTR" value={`${kpis?.ctr ?? 0}%`} change={kpis?.changes.ctr} />
          </>
        )}
      </div>
      <BillyCampaignTable platform="google" />
    </div>
  );
}

function BillyDashboardInner() {
  return (
    <div className="space-y-4">
      <BillyVerticalSelector />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="overview" className="gap-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5" />
            Revenue Engine
          </TabsTrigger>
          <TabsTrigger value="meta" className="gap-1.5 text-xs">
            <Facebook className="h-3.5 w-3.5" />
            Meta Ads
          </TabsTrigger>
          <TabsTrigger value="google" className="gap-1.5 text-xs">
            <Chrome className="h-3.5 w-3.5" />
            Google Ads
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <BillyOverview />
        </TabsContent>
        <TabsContent value="meta">
          <BillyMetaTab />
        </TabsContent>
        <TabsContent value="google">
          <BillyGoogleTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function BillyDashboard() {
  return (
    <VerticalProvider>
      <BillyDashboardInner />
    </VerticalProvider>
  );
}
