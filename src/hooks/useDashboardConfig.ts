import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClient } from "@/contexts/ClientContext";

export interface DashboardConfig {
  enabled_platforms: string[];
  enabled_kpis: string[];
  custom_metrics: any[];
  revenue_source: string;
}

export function useDashboardConfig() {
  const { activeClient } = useClient();
  const clientId = activeClient?.id;

  return useQuery({
    queryKey: ["dashboard-config", clientId],
    enabled: !!clientId,
    queryFn: async (): Promise<DashboardConfig | null> => {
      if (!clientId) return null;

      const { data, error } = await supabase
        .from("dashboard_configs")
        .select("*")
        .eq("client_id", clientId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return { enabled_platforms: ["meta", "google"], enabled_kpis: ["spend", "revenue", "roas", "conversions"], custom_metrics: [], revenue_source: "manual" };

      return {
        enabled_platforms: data.enabled_platforms || ["meta", "google"],
        enabled_kpis: data.enabled_kpis || ["spend", "revenue", "roas", "conversions"],
        custom_metrics: data.custom_metrics as any[] || [],
        revenue_source: data.revenue_source || "manual",
      };
    },
  });
}
