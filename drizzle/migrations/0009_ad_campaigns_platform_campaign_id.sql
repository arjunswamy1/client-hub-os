ALTER TABLE public.ad_campaigns ADD COLUMN IF NOT EXISTS platform_campaign_id text;
COMMENT ON COLUMN public.ad_campaigns.platform_campaign_id IS 'The ad platform''s own campaign id. Identity key for Meta rows; campaign_name holds the latest name and may change on rename.';
CREATE UNIQUE INDEX IF NOT EXISTS ad_campaigns_client_platform_cid_date_idx
  ON public.ad_campaigns (client_id, platform, platform_campaign_id, date);