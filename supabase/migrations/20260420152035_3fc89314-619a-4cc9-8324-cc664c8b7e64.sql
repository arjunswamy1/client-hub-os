-- Add platform column to campaign_builds to support Google + Bing
ALTER TABLE public.campaign_builds
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'google';

-- Optional check constraint (simple values; use trigger-free here)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_builds_platform_check'
  ) THEN
    ALTER TABLE public.campaign_builds
      ADD CONSTRAINT campaign_builds_platform_check
      CHECK (platform IN ('google', 'bing', 'both'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaign_builds_platform ON public.campaign_builds(platform);