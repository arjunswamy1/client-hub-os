CREATE TABLE public.ai_video_renders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.ai_video_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  shotstack_id TEXT,
  shotstack_env TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL DEFAULT 'queued',
  edit_json JSONB,
  output_url TEXT,
  poster_url TEXT,
  duration_seconds NUMERIC,
  error_message TEXT,
  requested_by_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_video_renders_project ON public.ai_video_renders(project_id, version);
CREATE INDEX idx_video_renders_status ON public.ai_video_renders(status);

ALTER TABLE public.ai_video_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access renders via project"
  ON public.ai_video_renders
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ai_video_projects p
    WHERE p.id = ai_video_renders.project_id
      AND (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), p.client_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ai_video_projects p
    WHERE p.id = ai_video_renders.project_id
      AND (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), p.client_id))
  ));

CREATE TRIGGER trg_ai_video_renders_updated
  BEFORE UPDATE ON public.ai_video_renders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();