
-- Ad daily metrics table
CREATE TABLE public.ad_daily_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  platform TEXT NOT NULL, -- 'meta', 'google'
  spend NUMERIC NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  conversions BIGINT NOT NULL DEFAULT 0,
  add_to_cart BIGINT NOT NULL DEFAULT 0,
  cost_per_conversion NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ad_daily_metrics_client_date ON public.ad_daily_metrics(client_id, date);
CREATE INDEX idx_ad_daily_metrics_platform ON public.ad_daily_metrics(platform);

ALTER TABLE public.ad_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all ad metrics" ON public.ad_daily_metrics
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client ad metrics" ON public.ad_daily_metrics
  FOR ALL TO authenticated USING (has_client_access(auth.uid(), client_id));

-- Ad campaigns table
CREATE TABLE public.ad_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  campaign_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  spend NUMERIC NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  conversions BIGINT NOT NULL DEFAULT 0,
  roas NUMERIC,
  status TEXT DEFAULT 'unknown',
  impression_share NUMERIC,
  bidding_strategy_type TEXT,
  campaign_type TEXT,
  bid_strategy_details JSONB,
  daily_budget NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ad_campaigns_client_date ON public.ad_campaigns(client_id, date);

ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all campaigns" ON public.ad_campaigns
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client campaigns" ON public.ad_campaigns
  FOR ALL TO authenticated USING (has_client_access(auth.uid(), client_id));

-- Dashboard configs table
CREATE TABLE public.dashboard_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE UNIQUE,
  enabled_platforms TEXT[] NOT NULL DEFAULT '{meta,google}',
  enabled_kpis TEXT[] NOT NULL DEFAULT '{spend,revenue,roas,conversions}',
  custom_metrics JSONB DEFAULT '[]',
  revenue_source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dashboard_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all dashboard configs" ON public.dashboard_configs
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client configs" ON public.dashboard_configs
  FOR SELECT TO authenticated USING (has_client_access(auth.uid(), client_id));

-- Platform connections table
CREATE TABLE public.platform_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  token_expires_at TIMESTAMPTZ,
  refresh_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all platform connections" ON public.platform_connections
  FOR ALL TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Team members view assigned client connections" ON public.platform_connections
  FOR SELECT TO authenticated USING (has_client_access(auth.uid(), client_id));

-- Trigger for updated_at
CREATE TRIGGER update_dashboard_configs_updated_at
  BEFORE UPDATE ON public.dashboard_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_platform_connections_updated_at
  BEFORE UPDATE ON public.platform_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
