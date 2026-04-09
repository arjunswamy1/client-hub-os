import KPICard from "@/components/dashboard/KPICard";
import CampaignTable from "@/components/dashboard/CampaignTable";
import { useKPIs } from "@/hooks/useAdData";
import { Skeleton } from "@/components/ui/skeleton";

const GoogleDashboard = () => {
  const { data: kpis, isLoading } = useKPIs("google");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <KPICard title="Spend" value={`$${(kpis?.totalSpend ?? 0).toLocaleString()}`} change={kpis?.changes.spend} invertColor />
            <KPICard title="Conversions" value={(kpis?.totalConversions ?? 0).toLocaleString()} change={kpis?.changes.conversions} />
            <KPICard title="CPC" value={`$${kpis?.cpc ?? 0}`} change={kpis?.changes.cpc} invertColor />
            <KPICard title="CTR" value={`${kpis?.ctr ?? 0}%`} change={kpis?.changes.ctr} />
          </>
        )}
      </div>
      <CampaignTable platform="google" />
    </div>
  );
};

export default GoogleDashboard;
