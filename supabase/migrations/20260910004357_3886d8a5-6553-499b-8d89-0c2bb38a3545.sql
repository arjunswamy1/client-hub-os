ALTER TABLE public.cannaball_spend DROP CONSTRAINT IF EXISTS cannaball_spend_client_id_date_platform_campaign_name_creat_key;
CREATE UNIQUE INDEX IF NOT EXISTS cannaball_spend_unique_row
  ON public.cannaball_spend (client_id, date, platform, campaign_name, creative_name) NULLS NOT DISTINCT;