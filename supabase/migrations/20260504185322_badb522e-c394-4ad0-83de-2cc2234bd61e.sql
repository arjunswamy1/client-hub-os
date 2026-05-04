
-- ============ ai_video_brand_kits ============
CREATE TABLE public.ai_video_brand_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  logo_url TEXT,
  logo_animation_url TEXT,
  fonts JSONB DEFAULT '{}'::jsonb,
  colors JSONB DEFAULT '{}'::jsonb,
  default_voice_id TEXT,
  default_voice_name TEXT,
  style_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  intro_template JSONB,
  outro_template JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ ai_video_projects ============
CREATE TABLE public.ai_video_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,

  -- Brief
  vertical TEXT,
  objective TEXT,
  target_audience TEXT,
  key_message TEXT,
  cta TEXT,
  landing_page_url TEXT,
  landing_page_analysis JSONB,
  tone_mood TEXT[] DEFAULT ARRAY[]::TEXT[],
  visual_style TEXT[] DEFAULT ARRAY[]::TEXT[],
  target_length_seconds INTEGER DEFAULT 30,
  target_platforms TEXT[] DEFAULT ARRAY[]::TEXT[],
  aspect_ratio TEXT DEFAULT '9:16',
  reference_video_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  reference_image_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  additional_direction TEXT,
  freeform_brief TEXT,

  -- AI Director output
  shot_list JSONB,
  vo_script TEXT,
  vo_voice_id TEXT,
  vo_settings JSONB,
  music_prompt TEXT,
  music_settings JSONB,
  overlay_plan JSONB,

  status TEXT NOT NULL DEFAULT 'briefing'
    CHECK (status IN ('briefing','shot_list_review','generating','preview','feedback','regenerating','approved','exported')),
  current_version INTEGER NOT NULL DEFAULT 1,

  brand_kit JSONB,

  created_by_id UUID REFERENCES public.team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_projects_client ON public.ai_video_projects(client_id);
CREATE INDEX idx_video_projects_status ON public.ai_video_projects(status);

-- ============ ai_video_clips ============
CREATE TABLE public.ai_video_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.ai_video_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  clip_number INTEGER NOT NULL,

  veo_prompt TEXT NOT NULL,
  veo_negative_prompt TEXT,
  veo_model TEXT DEFAULT 'veo-3.1-generate-preview',
  veo_aspect_ratio TEXT,
  veo_resolution TEXT DEFAULT '1080p',
  reference_image_urls TEXT[] DEFAULT ARRAY[]::TEXT[],

  generated_options JSONB DEFAULT '[]'::jsonb,
  selected_option_index INTEGER,

  is_override BOOLEAN NOT NULL DEFAULT false,
  override_video_url TEXT,
  override_source TEXT,

  text_overlay JSONB,
  vo_text TEXT,
  vo_start_ms INTEGER,
  vo_end_ms INTEGER,

  feedback TEXT,
  feedback_applied BOOLEAN NOT NULL DEFAULT false,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','generating','generated','selected','regenerating','approved','failed')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_clips_project ON public.ai_video_clips(project_id, version, clip_number);

-- ============ ai_video_versions ============
CREATE TABLE public.ai_video_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.ai_video_projects(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  clip_selections JSONB,
  vo_audio_url TEXT,
  music_audio_url TEXT,
  composition_settings JSONB,
  preview_video_url TEXT,
  exports JSONB DEFAULT '[]'::jsonb,
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_versions_project ON public.ai_video_versions(project_id, version_number);

-- ============ ai_video_audio ============
CREATE TABLE public.ai_video_audio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.ai_video_projects(id) ON DELETE CASCADE,
  audio_type TEXT NOT NULL CHECK (audio_type IN ('voiceover','music')),
  version INTEGER NOT NULL DEFAULT 1,
  elevenlabs_voice_id TEXT,
  elevenlabs_model TEXT,
  script_text TEXT,
  prompt TEXT,
  settings JSONB,
  audio_url TEXT,
  duration_ms INTEGER,
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_audio_project ON public.ai_video_audio(project_id, audio_type, version);

-- ============ updated_at triggers ============
CREATE TRIGGER trg_ai_video_projects_updated
  BEFORE UPDATE ON public.ai_video_projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_ai_video_brand_kits_updated
  BEFORE UPDATE ON public.ai_video_brand_kits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ RLS ============
ALTER TABLE public.ai_video_projects   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_video_clips      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_video_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_video_audio      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_video_brand_kits ENABLE ROW LEVEL SECURITY;

-- Projects
CREATE POLICY "Admins manage all video projects"
  ON public.ai_video_projects FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Team can view assigned client projects"
  ON public.ai_video_projects FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Team can insert projects for assigned clients"
  ON public.ai_video_projects FOR INSERT TO authenticated
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Team can update assigned client projects"
  ON public.ai_video_projects FOR UPDATE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id))
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

-- Clips / versions / audio — gated through parent project
CREATE POLICY "Access clips via project"
  ON public.ai_video_clips FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_video_projects p WHERE p.id = project_id
    AND (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), p.client_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_video_projects p WHERE p.id = project_id
    AND (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), p.client_id))));

CREATE POLICY "Access versions via project"
  ON public.ai_video_versions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_video_projects p WHERE p.id = project_id
    AND (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), p.client_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_video_projects p WHERE p.id = project_id
    AND (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), p.client_id))));

CREATE POLICY "Access audio via project"
  ON public.ai_video_audio FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_video_projects p WHERE p.id = project_id
    AND (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), p.client_id))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_video_projects p WHERE p.id = project_id
    AND (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), p.client_id))));

-- Brand kits
CREATE POLICY "Admins manage brand kits"
  ON public.ai_video_brand_kits FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Team views brand kits for assigned clients"
  ON public.ai_video_brand_kits FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Team upserts brand kits for assigned clients"
  ON public.ai_video_brand_kits FOR INSERT TO authenticated
  WITH CHECK (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Team updates brand kits for assigned clients"
  ON public.ai_video_brand_kits FOR UPDATE TO authenticated
  USING (public.has_client_access(auth.uid(), client_id))
  WITH CHECK (public.has_client_access(auth.uid(), client_id));
