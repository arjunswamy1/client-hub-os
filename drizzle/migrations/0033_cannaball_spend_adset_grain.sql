ALTER TABLE public.cannaball_spend
  ADD COLUMN IF NOT EXISTS platform_adset_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS adset_name text,
  ADD COLUMN IF NOT EXISTS platform_ad_id text NOT NULL DEFAULT '';
COMMENT ON COLUMN public.cannaball_spend.platform_adset_id IS 'Platform ad set id (Universal Ads). Empty string for feeds without ad sets (Roku, uploads) and for legacy rows.';
COMMENT ON COLUMN public.cannaball_spend.platform_ad_id IS 'Platform ad id (Universal Ads entity_id). Empty string when not applicable.';
CREATE UNIQUE INDEX IF NOT EXISTS cannaball_spend_unique_row_v2 ON public.cannaball_spend
  (client_id, date, platform, campaign_name, creative_name, platform_adset_id, platform_ad_id) NULLS NOT DISTINCT;
DROP INDEX IF EXISTS public.cannaball_spend_unique_row;