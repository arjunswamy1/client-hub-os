-- Ad-level data synced from platform APIs (Meta creative assets, Google search ads)
CREATE TABLE public.ad_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform text NOT NULL, -- 'meta' or 'google'
  campaign_name text NOT NULL,
  ad_name text,
  platform_ad_id text, -- Meta ad ID or Google ad ID
  platform_campaign_id text,
  platform_adset_id text, -- Meta adset / Google ad group
  adset_name text, -- ad set or ad group name
  
  -- Creative content (Meta)
  creative_thumbnail_url text,
  creative_type text, -- 'image', 'video', 'carousel'
  primary_text text,
  headline text,
  description text,
  cta text,
  link_url text,
  video_url text,
  
  -- Ad copy (Google Search)
  headlines text[], -- RSA headlines
  descriptions text[], -- RSA descriptions
  final_url text,
  display_url text,
  
  -- Vertical classification
  vertical text, -- 'pest_control', 'flights', 'porta_potty', 'siding', etc.
  
  -- Aggregated performance (updated on each sync)
  spend numeric DEFAULT 0,
  impressions bigint DEFAULT 0,
  clicks bigint DEFAULT 0,
  conversions numeric DEFAULT 0,
  revenue numeric DEFAULT 0,
  ctr numeric,
  cpa numeric,
  roas numeric,
  
  -- Status
  status text DEFAULT 'active',
  
  -- Date range of performance data
  date_from date,
  date_to date,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(client_id, platform, platform_ad_id)
);

-- Indexes
CREATE INDEX idx_ad_creatives_client_platform ON ad_creatives(client_id, platform);
CREATE INDEX idx_ad_creatives_vertical ON ad_creatives(client_id, vertical);
CREATE INDEX idx_ad_creatives_status ON ad_creatives(client_id, status);

-- RLS
ALTER TABLE ad_creatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all ad creatives"
  ON ad_creatives FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client ad creatives"
  ON ad_creatives FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));

-- Updated_at trigger
CREATE TRIGGER update_ad_creatives_updated_at
  BEFORE UPDATE ON ad_creatives
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();