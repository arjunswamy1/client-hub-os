import { useVerticalKPIs } from "@/hooks/useBillyData";
import { useRingbaByPlatform } from "@/hooks/useRingbaByPlatform";
import { useVertical } from "@/contexts/VerticalContext";
import { useClient } from "@/contexts/ClientContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import KPICard from "@/components/dashboard/KPICard";
import DrillDownCampaignTable from "@/components/dashboard/DrillDownCampaignTable";
import QualityScoreAudit from "@/components/dashboard/QualityScoreAudit";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export default function BillyGoogleDashboard() {
  const { activeClient } = useClient();
  const { data: kpis, isLoading: kpiLoading } = useVerticalKPIs("google");
  const { data: ringba, isLoading: ringbaLoading } = useRingbaByPlatform("google");
  const { activeVertical } = useVertical();
  const { data: googleConnection } = useQuery({
    queryKey: ["google-connection-health", activeClient?.id],
    enabled: !!activeClient?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_connections_safe")
        .select("last_synced_at, last_sync_records, sync_error, token_expires_at")
        .eq("client_id", activeClient!.id)
        .eq("platform", "google")
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const isLoading = kpiLoading || ringbaLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  const spend = kpis?.spend ?? 0;
  const clicks = kpis?.clicks ?? 0;
  const impressions = kpis?.impressions ?? 0;

  const ringbaConversions = ringba?.convertedCalls ?? 0;
  const ringbaRevenue = ringba?.revenue ?? 0;
  const ringbaCPA = ringbaConversions > 0 ? Math.round((spend / ringbaConversions) * 100) / 100 : 0;
  const platformConversions = kpis?.conversions ?? 0;
  const cpc = clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0;
  const ctr = impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0;
  const roas = spend > 0 ? Math.round((ringbaRevenue / spend) * 100) / 100 : 0;
  const profit = ringbaRevenue - spend;
  const cpm = impressions > 0 ? Math.round((spend / impressions) * 1000 * 100) / 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{activeVertical.emoji}</span>
        <h2 className="text-base font-semibold">
          {activeVertical.id === "all" ? "All Verticals" : activeVertical.label} — Google Ads
        </h2>
      </div>

      {googleConnection?.sync_error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Google Ads sync needs attention</AlertTitle>
          <AlertDescription>
            {googleConnection.sync_error} The dashboard is showing the latest stored Google data, which may be stale.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard title="Google Spend" value={`$${spend.toLocaleString()}`} change={kpis?.changes.spend} invertColor />
        <KPICard title="Ringba Revenue" value={`$${ringbaRevenue.toLocaleString()}`} change={ringba?.changes.revenue} />
        <KPICard title="ROAS (Ringba)" value={roas > 0 ? `${roas}x` : "—"} subtitle="Revenue ÷ Spend" />
        <KPICard
          title="Net Profit"
          value={`${profit >= 0 ? "" : "−"}$${Math.abs(Math.round(profit)).toLocaleString()}`}
          subtitle={profit >= 0 ? "Profitable ✓" : "Unprofitable ✗"}
        />
        <KPICard title="Ringba Conv." value={ringbaConversions.toLocaleString()} change={ringba?.changes.convertedCalls} />
        <KPICard title="CPA (Ringba)" value={ringbaCPA > 0 ? `$${ringbaCPA}` : "—"} invertColor subtitle="Spend ÷ Conversions" />
        <KPICard title="Platform Conv." value={platformConversions.toLocaleString()} change={kpis?.changes.conversions} subtitle="Google-reported" />
        <KPICard title="CPC" value={`$${cpc.toFixed(2)}`} change={kpis?.changes.cpc} invertColor />
        <KPICard title="CTR" value={`${ctr}%`} change={kpis?.changes.ctr} />
        <KPICard title="CPM" value={`$${cpm.toFixed(2)}`} invertColor subtitle="Cost per 1K impressions" />
        <KPICard title="Clicks" value={clicks.toLocaleString()} />
        <KPICard title="Impressions" value={impressions.toLocaleString()} />
      </div>

      <QualityScoreAudit />

      <DrillDownCampaignTable platform="google" />
    </div>
  );
}
