ALTER TABLE public.ai_video_clips
  ADD COLUMN IF NOT EXISTS actual_duration_seconds NUMERIC(5,2);