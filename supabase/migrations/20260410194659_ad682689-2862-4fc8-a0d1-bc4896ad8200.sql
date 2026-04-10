
-- Content Calendar
CREATE TABLE public.content_calendar_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  week_of DATE NOT NULL,
  product_focus TEXT,
  creative_theme TEXT,
  ad_formats_planned TEXT[] DEFAULT '{}'::TEXT[],
  delivery_deadline DATE,
  launch_target DATE,
  status TEXT NOT NULL DEFAULT 'planning',
  notes TEXT,
  linked_brief_ids UUID[] DEFAULT '{}'::UUID[],
  created_by_id UUID REFERENCES public.team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.content_calendar_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all calendar entries" ON public.content_calendar_entries FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client calendar" ON public.content_calendar_entries FOR ALL TO authenticated USING (public.has_client_access(auth.uid(), client_id));

CREATE INDEX idx_content_calendar_client ON public.content_calendar_entries(client_id, week_of);

-- Trafficking Campaigns
CREATE TABLE public.trafficking_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  objective TEXT,
  location TEXT DEFAULT 'United States',
  bidding_strategy TEXT,
  start_date DATE,
  end_date DATE,
  total_budget DECIMAL(10,2),
  status TEXT NOT NULL DEFAULT 'planning',
  created_by_id UUID REFERENCES public.team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trafficking_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all campaigns" ON public.trafficking_campaigns FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client campaigns" ON public.trafficking_campaigns FOR ALL TO authenticated USING (public.has_client_access(auth.uid(), client_id));

-- Budget Phases
CREATE TABLE public.campaign_budget_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.trafficking_campaigns(id) ON DELETE CASCADE,
  phase_name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  daily_budget DECIMAL(10,2),
  phase_total DECIMAL(10,2),
  percentage_of_total DECIMAL(5,2),
  actual_spend DECIMAL(10,2) DEFAULT 0,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_budget_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all budget phases" ON public.campaign_budget_phases FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client budget phases" ON public.campaign_budget_phases FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.trafficking_campaigns c WHERE c.id = campaign_budget_phases.campaign_id AND public.has_client_access(auth.uid(), c.client_id)));

-- Campaign Keywords
CREATE TABLE public.campaign_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.trafficking_campaigns(id) ON DELETE CASCADE,
  ad_group TEXT NOT NULL,
  keyword TEXT NOT NULL,
  match_type TEXT,
  intent TEXT,
  is_negative BOOLEAN DEFAULT false,
  negative_category TEXT,
  quality_score INTEGER,
  impression_share DECIMAL(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all keywords" ON public.campaign_keywords FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client keywords" ON public.campaign_keywords FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.trafficking_campaigns c WHERE c.id = campaign_keywords.campaign_id AND public.has_client_access(auth.uid(), c.client_id)));

-- Campaign Extensions
CREATE TABLE public.campaign_extensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.trafficking_campaigns(id) ON DELETE CASCADE,
  extension_type TEXT NOT NULL,
  text TEXT NOT NULL,
  description TEXT,
  url TEXT,
  header TEXT,
  values_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_extensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all extensions" ON public.campaign_extensions FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client extensions" ON public.campaign_extensions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.trafficking_campaigns c WHERE c.id = campaign_extensions.campaign_id AND public.has_client_access(auth.uid(), c.client_id)));

-- Trafficking Ads (Core)
CREATE TABLE public.trafficking_ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES public.trafficking_campaigns(id) ON DELETE SET NULL,
  ad_name TEXT NOT NULL,
  ad_group TEXT,
  platform TEXT,
  format TEXT,
  brief_id UUID REFERENCES public.creative_briefs(id) ON DELETE SET NULL,
  deliverable_ids UUID[] DEFAULT '{}'::UUID[],
  asset_urls JSONB DEFAULT '[]'::JSONB,
  primary_text TEXT,
  headline TEXT,
  headline_2 TEXT,
  headline_3 TEXT,
  description TEXT,
  description_2 TEXT,
  cta TEXT,
  final_url TEXT,
  utm_parameters TEXT,
  creative_deadline DATE,
  launch_target DATE,
  preview_html TEXT,
  preview_url TEXT,
  preview_screenshots JSONB DEFAULT '[]'::JSONB,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by_id UUID REFERENCES public.team_members(id),
  approved_at TIMESTAMPTZ,
  launch_checklist JSONB DEFAULT '[]'::JSONB,
  platform_ad_id TEXT,
  platform_campaign_id TEXT,
  platform_adset_id TEXT,
  trafficked_by_id UUID REFERENCES public.team_members(id),
  trafficked_at TIMESTAMPTZ,
  launched_at TIMESTAMPTZ,
  notes TEXT,
  created_by_id UUID REFERENCES public.team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trafficking_ads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all trafficking ads" ON public.trafficking_ads FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client trafficking ads" ON public.trafficking_ads FOR ALL TO authenticated USING (public.has_client_access(auth.uid(), client_id));

CREATE INDEX idx_trafficking_ads_client_status ON public.trafficking_ads(client_id, status);
CREATE INDEX idx_trafficking_ads_campaign ON public.trafficking_ads(campaign_id);
CREATE INDEX idx_trafficking_ads_platform_id ON public.trafficking_ads(platform_ad_id);

-- Trafficking Ad Performance
CREATE TABLE public.trafficking_ad_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trafficking_ad_id UUID NOT NULL REFERENCES public.trafficking_ads(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  spend DECIMAL(10,2),
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr DECIMAL(6,4),
  conversions DECIMAL(10,2) DEFAULT 0,
  cpa DECIMAL(10,2),
  revenue DECIMAL(10,2) DEFAULT 0,
  roas DECIMAL(10,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(trafficking_ad_id, date)
);

ALTER TABLE public.trafficking_ad_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all ad performance" ON public.trafficking_ad_performance FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client ad performance" ON public.trafficking_ad_performance FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.trafficking_ads a WHERE a.id = trafficking_ad_performance.trafficking_ad_id AND public.has_client_access(auth.uid(), a.client_id)));

CREATE INDEX idx_trafficking_perf_ad_date ON public.trafficking_ad_performance(trafficking_ad_id, date);

-- AI Copy Generations
CREATE TABLE public.ai_copy_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  trafficking_ad_id UUID REFERENCES public.trafficking_ads(id) ON DELETE SET NULL,
  campaign_context JSONB DEFAULT '{}'::JSONB,
  ads_analyzed INTEGER DEFAULT 0,
  generated_options JSONB DEFAULT '[]'::JSONB,
  selected_option JSONB,
  created_by_id UUID REFERENCES public.team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_copy_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all AI generations" ON public.ai_copy_generations FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client AI generations" ON public.ai_copy_generations FOR ALL TO authenticated USING (public.has_client_access(auth.uid(), client_id));
