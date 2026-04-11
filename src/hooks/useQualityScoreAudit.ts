import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useClient } from "@/contexts/ClientContext";
import { useVertical } from "@/contexts/VerticalContext";
import { matchesVertical } from "@/config/billyVerticals";

export interface QSKeyword {
  keyword: string;
  matchType: string | null;
  qualityScore: number;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpc: number;
  ctr: number;
  cpa: number;
  adGroup: string;
  campaignId: string;
}

export interface QSDistribution {
  good: number; // ≥ 7
  fair: number; // 5-6
  poor: number; // < 5
  avgQS: number;
  totalKeywords: number;
  wastedSpend: number; // spend on QS < 5
}

export function useQualityScoreData() {
  const { activeClient } = useClient();
  const { activeVertical } = useVertical();
  const clientId = activeClient?.id;
  const verticalId = activeVertical.id;

  return useQuery({
    queryKey: ["qs-audit", clientId, verticalId],
    enabled: !!clientId,
    queryFn: async () => {
      // Fetch keywords that have quality scores
      const { data, error } = await supabase
        .from("campaign_keywords")
        .select("*, trafficking_campaigns:campaign_id(name, client_id)")
        .not("quality_score", "is", null);

      if (error) throw error;
      if (!data || data.length === 0) return { keywords: [] as QSKeyword[], distribution: null };

      // Filter by client and vertical
      const filtered = data.filter((row: any) => {
        const campaign = row.trafficking_campaigns;
        if (!campaign || campaign.client_id !== clientId) return false;
        if (verticalId === "all") return true;
        return matchesVertical(campaign.name, activeVertical, "google");
      });

      const keywords: QSKeyword[] = filtered.map((row: any) => ({
        keyword: row.keyword,
        matchType: row.match_type,
        qualityScore: row.quality_score,
        spend: Number(row.spend || 0),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        conversions: Number(row.conversions || 0),
        cpc: Number(row.cpc || 0),
        ctr: Number(row.ctr || 0),
        cpa: Number(row.cpa || 0),
        adGroup: row.ad_group,
        campaignId: row.campaign_id,
      }));

      const good = keywords.filter(k => k.qualityScore >= 7).length;
      const fair = keywords.filter(k => k.qualityScore >= 5 && k.qualityScore < 7).length;
      const poor = keywords.filter(k => k.qualityScore < 5).length;
      const avgQS = keywords.length > 0
        ? Math.round((keywords.reduce((sum, k) => sum + k.qualityScore, 0) / keywords.length) * 10) / 10
        : 0;
      const wastedSpend = Math.round(keywords.filter(k => k.qualityScore < 5).reduce((sum, k) => sum + k.spend, 0));

      const distribution: QSDistribution = { good, fair, poor, avgQS, totalKeywords: keywords.length, wastedSpend };

      return {
        keywords: keywords.filter(k => k.qualityScore < 7).sort((a, b) => b.spend - a.spend),
        distribution,
      };
    },
  });
}

/** Call the AI edge function to get recommendations */
export function useQSAuditRecommendations() {
  const { activeClient } = useClient();
  const { activeVertical } = useVertical();

  return useMutation({
    mutationFn: async (keywords: QSKeyword[]) => {
      const { data, error } = await supabase.functions.invoke("quality-score-audit", {
        body: {
          client_id: activeClient?.id,
          vertical_id: activeVertical.id,
          keywords: keywords.slice(0, 20), // Limit to top 20 by spend
        },
      });

      if (error) throw error;
      return data;
    },
  });
}
