-- CREATIVE BRIEFS TABLE
CREATE TABLE public.creative_briefs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  creative_type TEXT NOT NULL DEFAULT 'static' CHECK (creative_type IN ('static', 'video', 'carousel', 'story_reel', 'ugc', 'other')),
  platforms TEXT[] DEFAULT '{}',
  objective TEXT CHECK (objective IN ('awareness', 'consideration', 'conversion', 'retargeting')),
  target_audience TEXT,
  key_message TEXT,
  copy_suggestions JSONB DEFAULT '[]',
  brand_guidelines_url TEXT,
  reference_assets JSONB DEFAULT '[]',
  due_date DATE,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  assigned_to_id UUID REFERENCES public.team_members(id),
  created_by_id UUID REFERENCES public.team_members(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'in_design', 'ready_for_review', 'revision_requested', 'approved', 'delivered')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.creative_briefs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_creative_briefs_updated_at BEFORE UPDATE ON public.creative_briefs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_creative_briefs_client_id ON public.creative_briefs(client_id);
CREATE INDEX idx_creative_briefs_assigned_to ON public.creative_briefs(assigned_to_id);

-- CREATIVE DELIVERABLES TABLE
CREATE TABLE public.creative_deliverables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brief_id UUID NOT NULL REFERENCES public.creative_briefs(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  drive_url TEXT,
  uploaded_by_id UUID REFERENCES public.team_members(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.creative_deliverables ENABLE ROW LEVEL SECURITY;

-- CREATIVE REVIEWS TABLE
CREATE TABLE public.creative_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  brief_id UUID NOT NULL REFERENCES public.creative_briefs(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES public.team_members(id),
  action TEXT NOT NULL CHECK (action IN ('approved', 'revision_requested')),
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.creative_reviews ENABLE ROW LEVEL SECURITY;

-- CONTEXT ITEMS TABLE
CREATE TABLE public.context_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('fathom', 'teams', 'slack', 'gmail', 'drive', 'meta_ads', 'google_ads', 'tiktok_ads', 'internal')),
  source_id TEXT,
  content_type TEXT NOT NULL CHECK (content_type IN ('message', 'email', 'transcript', 'document', 'metric', 'file', 'note')),
  title TEXT,
  content TEXT,
  metadata JSONB DEFAULT '{}',
  participants TEXT[] DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.context_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_context_items_client_id ON public.context_items(client_id);
CREATE INDEX idx_context_items_source ON public.context_items(source);
CREATE INDEX idx_context_items_occurred_at ON public.context_items(occurred_at DESC);

-- CONTEXT SYNC LOG TABLE
CREATE TABLE public.context_sync_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'in_progress')),
  items_synced INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.context_sync_log ENABLE ROW LEVEL SECURITY;

-- LANDING PAGES TABLE
CREATE TABLE public.landing_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  staging_url TEXT,
  status TEXT NOT NULL DEFAULT 'in_development' CHECK (status IN ('in_development', 'staging', 'live', 'testing', 'paused', 'archived')),
  platform_source TEXT DEFAULT 'custom' CHECK (platform_source IN ('lovable', 'custom')),
  notes TEXT,
  created_by_id UUID REFERENCES public.team_members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.landing_pages ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_landing_pages_updated_at BEFORE UPDATE ON public.landing_pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS POLICIES FOR ALL NEW TABLES
CREATE POLICY "Admins manage all briefs" ON public.creative_briefs FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client briefs" ON public.creative_briefs FOR ALL TO authenticated USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Admins manage all deliverables" ON public.creative_deliverables FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client deliverables" ON public.creative_deliverables FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.creative_briefs b WHERE b.id = brief_id AND public.has_client_access(auth.uid(), b.client_id)));

CREATE POLICY "Admins manage all reviews" ON public.creative_reviews FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client reviews" ON public.creative_reviews FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.creative_briefs b WHERE b.id = brief_id AND public.has_client_access(auth.uid(), b.client_id)));

CREATE POLICY "Admins manage all context items" ON public.context_items FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client context" ON public.context_items FOR ALL TO authenticated USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Admins manage all sync logs" ON public.context_sync_log FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client sync logs" ON public.context_sync_log FOR ALL TO authenticated USING (public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Admins manage all landing pages" ON public.landing_pages FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Team members access assigned client landing pages" ON public.landing_pages FOR ALL TO authenticated USING (public.has_client_access(auth.uid(), client_id));