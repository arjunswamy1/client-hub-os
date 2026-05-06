ALTER TABLE public.ai_video_clips
  ADD COLUMN IF NOT EXISTS transition_type TEXT NOT NULL DEFAULT 'hard_cut',
  ADD COLUMN IF NOT EXISTS transition_overlap_seconds NUMERIC(3,2) NOT NULL DEFAULT 0;