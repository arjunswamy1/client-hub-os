ALTER TABLE public.ai_video_clips
  ADD COLUMN IF NOT EXISTS progress_pct integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_message text,
  ADD COLUMN IF NOT EXISTS progress_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;