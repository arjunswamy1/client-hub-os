
-- ==============================================
-- 1. Ad Sets / Ad Groups table
-- ==============================================
CREATE TABLE public.ad_sets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  platform_campaign_id TEXT,
  adset_name TEXT NOT NULL,
  platform_adset_id TEXT,
  account_id TEXT,
  status TEXT DEFAULT 'active',
  spend NUMERIC NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  conversions BIGINT NOT NULL DEFAULT 0,
  cpc NUMERIC,
  ctr NUMERIC,
  cpa NUMERIC,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all ad sets"
  ON public.ad_sets FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client ad sets"
  ON public.ad_sets FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));

CREATE INDEX idx_ad_sets_lookup ON public.ad_sets (client_id, platform, date);
CREATE INDEX idx_ad_sets_campaign ON public.ad_sets (campaign_name, platform);

-- ==============================================
-- 2. Search Terms table (Google only)
-- ==============================================
CREATE TABLE public.search_terms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform_campaign_id TEXT,
  campaign_name TEXT,
  platform_adset_id TEXT NOT NULL,
  keyword_text TEXT,
  search_term TEXT NOT NULL,
  match_type TEXT,
  spend NUMERIC NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  conversions BIGINT NOT NULL DEFAULT 0,
  cpc NUMERIC,
  ctr NUMERIC,
  cpa NUMERIC,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.search_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all search terms"
  ON public.search_terms FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client search terms"
  ON public.search_terms FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));

CREATE INDEX idx_search_terms_lookup ON public.search_terms (client_id, platform_adset_id, date);
CREATE INDEX idx_search_terms_keyword ON public.search_terms (keyword_text, platform_adset_id);

-- ==============================================
-- 3. Add missing columns to ad_campaigns
-- ==============================================
ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS account_id TEXT,
  ADD COLUMN IF NOT EXISTS add_to_cart BIGINT DEFAULT 0;

-- ==============================================
-- 4. Add missing columns to ad_creatives (ads table)
-- ==============================================
ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS frequency NUMERIC,
  ADD COLUMN IF NOT EXISTS video_views_3s BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_views_25 BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_views_50 BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_views_95 BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS format TEXT;

-- ==============================================
-- 5. Add spend/performance columns to campaign_keywords
-- ==============================================
ALTER TABLE public.campaign_keywords
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id),
  ADD COLUMN IF NOT EXISTS platform_adset_id TEXT,
  ADD COLUMN IF NOT EXISTS spend NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS impressions BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicks BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversions BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cpc NUMERIC,
  ADD COLUMN IF NOT EXISTS ctr NUMERIC,
  ADD COLUMN IF NOT EXISTS cpa NUMERIC,
  ADD COLUMN IF NOT EXISTS date DATE;

-- ==============================================
-- 6. AI optimization recommendations table (for agent API)
-- ==============================================
CREATE TABLE public.ai_optimization_recommendations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  vertical_id TEXT,
  recommendation_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  entity_name TEXT,
  severity TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT,
  recommended_action JSONB DEFAULT '{}'::jsonb,
  current_metrics JSONB DEFAULT '{}'::jsonb,
  projected_impact JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_at TIMESTAMPTZ,
  resolved_by_id UUID REFERENCES public.team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_optimization_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all recommendations"
  ON public.ai_optimization_recommendations FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client recommendations"
  ON public.ai_optimization_recommendations FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));

CREATE INDEX idx_ai_recs_lookup ON public.ai_optimization_recommendations (client_id, platform, status);
