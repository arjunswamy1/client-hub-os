-- Add Meta push tracking columns to trafficking_campaigns
ALTER TABLE public.trafficking_campaigns
  ADD COLUMN IF NOT EXISTS meta_campaign_id text,
  ADD COLUMN IF NOT EXISTS meta_adset_id text,
  ADD COLUMN IF NOT EXISTS meta_ad_account_id text,
  ADD COLUMN IF NOT EXISTS meta_page_id text,
  ADD COLUMN IF NOT EXISTS meta_instagram_actor_id text,
  ADD COLUMN IF NOT EXISTS meta_pixel_id text,
  ADD COLUMN IF NOT EXISTS meta_pushed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS meta_pushed_by_id uuid REFERENCES public.team_members(id),
  ADD COLUMN IF NOT EXISTS meta_push_error text,
  ADD COLUMN IF NOT EXISTS targeting_spec jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS optimization_goal text,
  ADD COLUMN IF NOT EXISTS billing_event text DEFAULT 'IMPRESSIONS';

CREATE INDEX IF NOT EXISTS idx_trafficking_campaigns_meta_campaign_id 
  ON public.trafficking_campaigns(meta_campaign_id) WHERE meta_campaign_id IS NOT NULL;

-- Add Meta creative tracking to trafficking_ads
ALTER TABLE public.trafficking_ads
  ADD COLUMN IF NOT EXISTS meta_creative_id text,
  ADD COLUMN IF NOT EXISTS meta_image_hash text,
  ADD COLUMN IF NOT EXISTS meta_video_id text,
  ADD COLUMN IF NOT EXISTS meta_pushed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS meta_pushed_by_id uuid REFERENCES public.team_members(id),
  ADD COLUMN IF NOT EXISTS meta_push_error text,
  ADD COLUMN IF NOT EXISTS meta_last_synced_at timestamp with time zone;

-- Audit log of every push attempt
CREATE TABLE IF NOT EXISTS public.meta_push_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  trafficking_campaign_id uuid REFERENCES public.trafficking_campaigns(id) ON DELETE SET NULL,
  trafficking_ad_id uuid REFERENCES public.trafficking_ads(id) ON DELETE SET NULL,
  entity_type text NOT NULL, -- 'campaign' | 'adset' | 'ad' | 'creative' | 'image' | 'video'
  action text NOT NULL,      -- 'create' | 'update' | 'pause' | 'sync'
  status text NOT NULL,      -- 'success' | 'error'
  meta_entity_id text,       -- the ID Meta returned
  request_payload jsonb,
  response_payload jsonb,
  error_message text,
  pushed_by_id uuid REFERENCES public.team_members(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_push_log_client ON public.meta_push_log(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_push_log_campaign ON public.meta_push_log(trafficking_campaign_id);
CREATE INDEX IF NOT EXISTS idx_meta_push_log_ad ON public.meta_push_log(trafficking_ad_id);

ALTER TABLE public.meta_push_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all meta push logs"
  ON public.meta_push_log FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client meta push logs"
  ON public.meta_push_log FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id))
  WITH CHECK (has_client_access(auth.uid(), client_id));