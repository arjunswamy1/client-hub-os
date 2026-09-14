ALTER TABLE public.media_brain_economics
  ADD COLUMN IF NOT EXISTS publisher_scoping text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS publisher_scoping_verified_at date,
  ADD COLUMN IF NOT EXISTS publisher_scoping_verified_by text,
  ADD COLUMN IF NOT EXISTS publisher_scoping_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_brain_economics_publisher_scoping_chk'
  ) THEN
    ALTER TABLE public.media_brain_economics
      ADD CONSTRAINT media_brain_economics_publisher_scoping_chk
      CHECK (publisher_scoping IN ('required', 'not_required_dedicated_campaigns', 'unknown'));
  END IF;
END $$;

COMMENT ON COLUMN public.media_brain_economics.publisher_scoping IS
  'Whether publisher filtering is required for this vertical. required = attributed_publishers must be configured or the pull stops. not_required_dedicated_campaigns = a recorded human decision that the tracking campaign receives only our traffic. unknown = no answer yet, and the pull stops exactly as an unconfigured publisher list does.';
COMMENT ON COLUMN public.media_brain_economics.publisher_scoping_verified_at IS
  'When the dedicated-campaign claim was last verified. A campaign dedicated today can quietly gain a second publisher tomorrow and nothing in the feed announces it.';