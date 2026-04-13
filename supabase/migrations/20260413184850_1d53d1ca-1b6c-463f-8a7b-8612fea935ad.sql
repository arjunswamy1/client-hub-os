
-- Campaign build sessions
CREATE TABLE public.campaign_builds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title TEXT,
  vertical TEXT,
  goal TEXT,
  audience_description TEXT,
  landing_page_url TEXT,
  landing_page_analysis JSONB,
  budget_monthly NUMERIC(10,2),
  location TEXT,
  schedule TEXT,
  campaign_types TEXT[] DEFAULT '{}'::text[],
  additional_context TEXT,
  conversation_history JSONB DEFAULT '[]'::jsonb,
  campaign_structure JSONB,
  optimization_notes TEXT,
  generated_files JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','generated','downloaded','imported')),
  created_by_id UUID REFERENCES public.team_members(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_builds_client ON public.campaign_builds(client_id);
CREATE INDEX idx_campaign_builds_creator ON public.campaign_builds(created_by_id);

ALTER TABLE public.campaign_builds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all campaign builds"
  ON public.campaign_builds FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client builds"
  ON public.campaign_builds FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id));

-- Campaign build templates
CREATE TABLE public.campaign_build_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  vertical TEXT,
  template_structure JSONB DEFAULT '{}'::jsonb,
  default_negatives TEXT[] DEFAULT '{}'::text[],
  default_extensions JSONB DEFAULT '{}'::jsonb,
  created_by_id UUID REFERENCES public.team_members(id),
  is_global BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_build_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all build templates"
  ON public.campaign_build_templates FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Users see global and own build templates"
  ON public.campaign_build_templates FOR SELECT TO authenticated
  USING (is_global = true OR created_by_id = get_team_member_id(auth.uid()));

CREATE POLICY "Users create own build templates"
  ON public.campaign_build_templates FOR INSERT TO authenticated
  WITH CHECK (created_by_id = get_team_member_id(auth.uid()));

CREATE POLICY "Users update own build templates"
  ON public.campaign_build_templates FOR UPDATE TO authenticated
  USING (created_by_id = get_team_member_id(auth.uid()));

CREATE POLICY "Users delete own build templates"
  ON public.campaign_build_templates FOR DELETE TO authenticated
  USING (created_by_id = get_team_member_id(auth.uid()));

-- Storage bucket for generated CSV files
INSERT INTO storage.buckets (id, name, public) VALUES ('campaign-build-files', 'campaign-build-files', true);

CREATE POLICY "Authenticated users can upload campaign files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'campaign-build-files');

CREATE POLICY "Anyone can read campaign files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'campaign-build-files');

CREATE POLICY "Authenticated users can delete own campaign files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'campaign-build-files');
