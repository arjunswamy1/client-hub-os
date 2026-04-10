
-- ============================================
-- ALTER creative_briefs: add new columns
-- ============================================
ALTER TABLE public.creative_briefs
  ADD COLUMN IF NOT EXISTS creative_types text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS sizes jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS funnel_stage text,
  ADD COLUMN IF NOT EXISTS num_concepts integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tone_style text,
  ADD COLUMN IF NOT EXISTS dos_and_donts text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS trafficked_by_id uuid,
  ADD COLUMN IF NOT EXISTS trafficked_at timestamptz,
  ADD COLUMN IF NOT EXISTS drive_wip_folder_id text,
  ADD COLUMN IF NOT EXISTS drive_approved_folder_id text,
  ADD COLUMN IF NOT EXISTS template_id uuid;

-- ============================================
-- ALTER creative_deliverables: add new columns
-- ============================================
ALTER TABLE public.creative_deliverables
  ADD COLUMN IF NOT EXISTS concept_label text,
  ADD COLUMN IF NOT EXISTS size_label text,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS revision_note text,
  ADD COLUMN IF NOT EXISTS approved_by_id uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz;

-- ============================================
-- ALTER creative_reviews: add deliverable_id
-- ============================================
ALTER TABLE public.creative_reviews
  ADD COLUMN IF NOT EXISTS deliverable_id uuid;

-- ============================================
-- creative_deliverable_versions
-- ============================================
CREATE TABLE public.creative_deliverable_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id uuid NOT NULL REFERENCES public.creative_deliverables(id) ON DELETE CASCADE,
  version integer NOT NULL,
  file_url text,
  drive_file_id text,
  drive_url text,
  file_name text,
  file_type text,
  file_size_bytes bigint,
  uploaded_by_id uuid REFERENCES public.team_members(id),
  uploaded_at timestamptz DEFAULT now()
);

ALTER TABLE public.creative_deliverable_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all deliverable versions" ON public.creative_deliverable_versions
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client deliverable versions" ON public.creative_deliverable_versions
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.creative_deliverables d
      JOIN public.creative_briefs b ON b.id = d.brief_id
      WHERE d.id = creative_deliverable_versions.deliverable_id
      AND public.has_client_access(auth.uid(), b.client_id)
    )
  );

-- ============================================
-- creative_brief_comments
-- ============================================
CREATE TABLE public.creative_brief_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid NOT NULL REFERENCES public.creative_briefs(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.team_members(id),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creative_brief_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all brief comments" ON public.creative_brief_comments
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client brief comments" ON public.creative_brief_comments
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.creative_briefs b
      WHERE b.id = creative_brief_comments.brief_id
      AND public.has_client_access(auth.uid(), b.client_id)
    )
  );

-- ============================================
-- creative_time_entries
-- ============================================
CREATE TABLE public.creative_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id uuid NOT NULL REFERENCES public.creative_briefs(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_minutes integer,
  is_manual boolean NOT NULL DEFAULT false,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creative_time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all time entries" ON public.creative_time_entries
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client time entries" ON public.creative_time_entries
  FOR ALL TO authenticated USING (
    public.has_client_access(auth.uid(), client_id)
  );

-- ============================================
-- creative_brief_templates
-- ============================================
CREATE TABLE public.creative_brief_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by_id uuid REFERENCES public.team_members(id),
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_global boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.creative_brief_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all templates" ON public.creative_brief_templates
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Users see global and own templates" ON public.creative_brief_templates
  FOR SELECT TO authenticated USING (
    is_global = true OR created_by_id = public.get_team_member_id(auth.uid())
  );

CREATE POLICY "Users create own templates" ON public.creative_brief_templates
  FOR INSERT TO authenticated WITH CHECK (
    created_by_id = public.get_team_member_id(auth.uid())
  );

CREATE POLICY "Users update own templates" ON public.creative_brief_templates
  FOR UPDATE TO authenticated USING (
    created_by_id = public.get_team_member_id(auth.uid())
  );

CREATE POLICY "Users delete own templates" ON public.creative_brief_templates
  FOR DELETE TO authenticated USING (
    created_by_id = public.get_team_member_id(auth.uid())
  );

-- ============================================
-- designer_monthly_caps
-- ============================================
CREATE TABLE public.designer_monthly_caps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  month date NOT NULL,
  cap_hours numeric(5,1) NOT NULL DEFAULT 80,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_member_id, month)
);

ALTER TABLE public.designer_monthly_caps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all caps" ON public.designer_monthly_caps
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Designers see own caps" ON public.designer_monthly_caps
  FOR SELECT TO authenticated USING (
    team_member_id = public.get_team_member_id(auth.uid())
  );

-- ============================================
-- client_drive_config
-- ============================================
CREATE TABLE public.client_drive_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) UNIQUE,
  drive_root_folder_id text NOT NULL,
  drive_root_folder_url text,
  folder_structure jsonb DEFAULT '{}'::jsonb,
  connected_by_id uuid REFERENCES public.team_members(id),
  connected_at timestamptz DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_drive_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all drive configs" ON public.client_drive_config
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Team members view assigned client drive config" ON public.client_drive_config
  FOR SELECT TO authenticated USING (
    public.has_client_access(auth.uid(), client_id)
  );

-- ============================================
-- notifications
-- ============================================
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.team_members(id),
  type text NOT NULL,
  title text NOT NULL,
  message text,
  brief_id uuid REFERENCES public.creative_briefs(id) ON DELETE CASCADE,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (
    recipient_id = public.get_team_member_id(auth.uid())
  );

CREATE POLICY "Users update own notifications" ON public.notifications
  FOR UPDATE TO authenticated USING (
    recipient_id = public.get_team_member_id(auth.uid())
  );

CREATE POLICY "Admins manage all notifications" ON public.notifications
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "Authenticated users can insert notifications" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================
-- Indexes for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_briefs_client_status ON public.creative_briefs(client_id, status);
CREATE INDEX IF NOT EXISTS idx_briefs_assigned ON public.creative_briefs(assigned_to_id, status);
CREATE INDEX IF NOT EXISTS idx_deliverables_brief ON public.creative_deliverables(brief_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_brief ON public.creative_time_entries(brief_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_member_month ON public.creative_time_entries(team_member_id, started_at);
CREATE INDEX IF NOT EXISTS idx_time_entries_client ON public.creative_time_entries(client_id, started_at);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliverable_versions ON public.creative_deliverable_versions(deliverable_id, version);
CREATE INDEX IF NOT EXISTS idx_brief_comments ON public.creative_brief_comments(brief_id, created_at);

-- ============================================
-- Enable realtime for notifications
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
