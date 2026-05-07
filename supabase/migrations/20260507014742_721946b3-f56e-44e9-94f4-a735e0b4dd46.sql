
-- Phase 3+4: targeted feedback engine + quick-fix overlays

ALTER TABLE public.ai_video_projects
  ADD COLUMN IF NOT EXISTS phone_overlay TEXT,
  ADD COLUMN IF NOT EXISTS cta_overlay TEXT,
  ADD COLUMN IF NOT EXISTS disclaimer_overlay TEXT,
  ADD COLUMN IF NOT EXISTS end_card_text TEXT,
  ADD COLUMN IF NOT EXISTS music_volume NUMERIC(3,2) DEFAULT 0.18;

ALTER TABLE public.ai_video_renders
  ADD COLUMN IF NOT EXISTS feedback_category TEXT,
  ADD COLUMN IF NOT EXISTS feedback_text TEXT,
  ADD COLUMN IF NOT EXISTS changes_applied JSONB,
  ADD COLUMN IF NOT EXISTS cost_estimate NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS is_quick_fix BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.ai_video_feedback_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.ai_video_projects(id) ON DELETE CASCADE,
  render_id UUID REFERENCES public.ai_video_renders(id) ON DELETE SET NULL,
  feedback_text TEXT NOT NULL,
  classification JSONB,
  action_taken TEXT,
  cost_actual NUMERIC(6,4),
  created_by_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_video_feedback_project ON public.ai_video_feedback_log(project_id, created_at DESC);

ALTER TABLE public.ai_video_feedback_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Access feedback via project" ON public.ai_video_feedback_log;
CREATE POLICY "Access feedback via project"
ON public.ai_video_feedback_log
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.ai_video_projects p
    WHERE p.id = ai_video_feedback_log.project_id
      AND (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), p.client_id))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.ai_video_projects p
    WHERE p.id = ai_video_feedback_log.project_id
      AND (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), p.client_id))
  )
);
