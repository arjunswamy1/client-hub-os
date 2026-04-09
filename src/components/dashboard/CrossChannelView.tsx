import KPICard from "@/components/dashboard/KPICard";
import SpendRevenueChart from "@/components/dashboard/SpendRevenueChart";
import ChannelBreakdown from "@/components/dashboard/ChannelBreakdown";
import { useCrossChannelKPIs } from "@/hooks/useAdData";
import { Skeleton } from "@/components/ui/skeleton";

const CrossChannelView = () => {
  const { data: kpis, isLoading } = useCrossChannelKPIs();

  const primaryCards = [
    { show: true, title: "Total Spend", value: `$${(kpis?.totalSpend ?? 0).toLocaleString()}`, change: kpis?.changes.totalSpend, invert: true },
    { show: true, title: "Google Spend", value: `$${(kpis?.googleSpend ?? 0).toLocaleString()}`, change: kpis?.changes.googleSpend, invert: true },
    { show: true, title: "Meta Spend", value: `$${(kpis?.metaSpend ?? 0).toLocaleString()}`, change: kpis?.changes.metaSpend, invert: true },
    { show: true, title: "Total CAC", value: kpis?.totalCAC ? `$${kpis.totalCAC.toLocaleString()}` : "—", change: kpis?.changes.totalCAC, invert: true },
  ].filter(c => c.show);

  const secondaryCards = [
    { title: "Conversions", value: (kpis?.totalConversions ?? 0).toLocaleString(), change: kpis?.changes.totalConversions },
    { title: "Revenue", value: `$${(kpis?.totalRevenue ?? 0).toLocaleString()}`, change: kpis?.changes.totalRevenue },
    { title: "Blended ROAS", value: kpis?.blendedROAS ? `${kpis.blendedROAS}x` : "—", change: kpis?.changes.blendedROAS },
  ];

  return (
    <div className="space-y-6">
      {/* Primary KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          primaryCards.map((card) => (
            <KPICard key={card.title} title={card.title} value={card.value} change={card.change} invertColor={card.invert} />
          ))
        )}
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          secondaryCards.map((card) => (
            <KPICard key={card.title} title={card.title} value={card.value} change={card.change} />
          ))
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SpendRevenueChart />
        </div>
        <ChannelBreakdown />
      </div>
    </div>
  );
};

export default CrossChannelView;
