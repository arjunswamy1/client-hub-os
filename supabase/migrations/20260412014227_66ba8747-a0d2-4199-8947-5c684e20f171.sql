-- Drop FK that points to trafficking_campaigns (we need this for Google Ads sync data)
ALTER TABLE public.campaign_keywords DROP CONSTRAINT campaign_keywords_campaign_id_fkey;

-- Make campaign_id nullable
ALTER TABLE public.campaign_keywords ALTER COLUMN campaign_id DROP NOT NULL;

-- Add campaign_name and platform columns for linking
ALTER TABLE public.campaign_keywords ADD COLUMN IF NOT EXISTS campaign_name text;
ALTER TABLE public.campaign_keywords ADD COLUMN IF NOT EXISTS platform text DEFAULT 'google';

-- Add unique constraint for upsert on campaign_keywords
ALTER TABLE public.campaign_keywords ADD CONSTRAINT campaign_keywords_unique 
  UNIQUE (client_id, platform_adset_id, keyword, date);

-- Add unique constraint for upsert on ad_sets
ALTER TABLE public.ad_sets ADD CONSTRAINT ad_sets_unique 
  UNIQUE (client_id, platform, campaign_name, adset_name, date);

-- Add unique constraint for upsert on search_terms  
ALTER TABLE public.search_terms ADD CONSTRAINT search_terms_unique 
  UNIQUE (client_id, platform_adset_id, search_term, date);

-- Update RLS policies for campaign_keywords to use client_id directly (no longer needs trafficking_campaigns join)
DROP POLICY IF EXISTS "Team members access assigned client keywords" ON public.campaign_keywords;
CREATE POLICY "Team members access assigned client keywords"
  ON public.campaign_keywords FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));