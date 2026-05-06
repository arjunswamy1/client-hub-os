ALTER TABLE public.ai_video_renders
  ADD COLUMN IF NOT EXISTS caption_validation jsonb,
  ADD COLUMN IF NOT EXISTS caption_realign_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parent_render_id uuid REFERENCES public.ai_video_renders(id) ON DELETE SET NULL;