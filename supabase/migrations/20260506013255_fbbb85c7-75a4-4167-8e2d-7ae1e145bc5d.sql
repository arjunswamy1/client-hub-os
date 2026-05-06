
ALTER TABLE public.ai_video_projects
  ADD COLUMN IF NOT EXISTS ad_framework text DEFAULT 'PAS',
  ADD COLUMN IF NOT EXISTS characters jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS hook_variants jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS selected_hook_index integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS caption_style text DEFAULT 'tiktok';
