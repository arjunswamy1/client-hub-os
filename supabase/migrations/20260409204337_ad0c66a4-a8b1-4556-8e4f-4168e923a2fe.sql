
-- Unique constraint for ad_daily_metrics upserts
CREATE UNIQUE INDEX IF NOT EXISTS ad_daily_metrics_client_platform_date_idx
  ON public.ad_daily_metrics (client_id, platform, date);

-- Unique constraint for ad_campaigns upserts
CREATE UNIQUE INDEX IF NOT EXISTS ad_campaigns_client_platform_campaign_date_idx
  ON public.ad_campaigns (client_id, platform, campaign_name, date);
