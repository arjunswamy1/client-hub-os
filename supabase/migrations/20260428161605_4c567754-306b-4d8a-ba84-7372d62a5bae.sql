
-- =========================================================
-- TALENT ACTORS
-- =========================================================
CREATE TABLE public.talent_actors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  instagram_handle TEXT,
  city TEXT NOT NULL,
  headshot_url TEXT,
  additional_photos JSONB DEFAULT '[]'::jsonb,
  demo_reel_url TEXT,
  experience_level TEXT CHECK (experience_level IN ('professional','comedy_improv','content_creator','natural')),
  specialties TEXT[] DEFAULT '{}',
  languages TEXT[] DEFAULT ARRAY['english']::TEXT[],
  age_range_appearance TEXT,
  gender TEXT,
  weekly_availability JSONB DEFAULT '{}'::jsonb,
  has_transportation BOOLEAN DEFAULT false,
  travel_radius_miles INTEGER,
  bio TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','approved','active','inactive')),
  producer_rating INTEGER CHECK (producer_rating BETWEEN 1 AND 5),
  producer_notes TEXT,
  total_shoots INTEGER NOT NULL DEFAULT 0,
  last_shoot_date DATE,
  hourly_rate NUMERIC(8,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.talent_actors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can submit talent applications"
  ON public.talent_actors FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'new');

CREATE POLICY "Admins manage all actors"
  ON public.talent_actors FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Team members view actors"
  ON public.talent_actors FOR SELECT TO authenticated
  USING (public.get_team_member_id(auth.uid()) IS NOT NULL);

CREATE POLICY "Team members update actors"
  ON public.talent_actors FOR UPDATE TO authenticated
  USING (public.get_team_member_id(auth.uid()) IS NOT NULL);

CREATE TRIGGER trg_talent_actors_updated
  BEFORE UPDATE ON public.talent_actors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_talent_city_status ON public.talent_actors(city, status);
CREATE INDEX idx_talent_specialties ON public.talent_actors USING gin(specialties);

-- =========================================================
-- SHOOT LOCATIONS
-- =========================================================
CREATE TABLE public.shoot_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT NOT NULL,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  location_type TEXT,
  good_for_verticals TEXT[] DEFAULT '{}',
  cost_type TEXT CHECK (cost_type IN ('free','hourly','daily','flat')),
  cost_amount NUMERIC(8,2) DEFAULT 0,
  photos JSONB DEFAULT '[]'::jsonb,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  availability_notes TEXT,
  producer_notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','unavailable','needs_rescouting')),
  last_used_date DATE,
  created_by_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shoot_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all locations"
  ON public.shoot_locations FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Team members manage locations"
  ON public.shoot_locations FOR ALL TO authenticated
  USING (public.get_team_member_id(auth.uid()) IS NOT NULL)
  WITH CHECK (public.get_team_member_id(auth.uid()) IS NOT NULL);

CREATE TRIGGER trg_shoot_locations_updated
  BEFORE UPDATE ON public.shoot_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_locations_verticals ON public.shoot_locations USING gin(good_for_verticals);
CREATE INDEX idx_locations_city_status ON public.shoot_locations(city, status);

-- =========================================================
-- SHOOT BRIEFS
-- =========================================================
CREATE TABLE public.shoot_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  client_ids UUID[] DEFAULT '{}',
  verticals TEXT[] DEFAULT '{}',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent','high','medium','low')),
  shoot_deadline DATE,
  content_deadline DATE,
  assigned_producer_id UUID,
  shoot_types TEXT[] DEFAULT '{}',
  num_scripts INTEGER DEFAULT 1,
  target_script_length TEXT,
  takes_per_script INTEGER DEFAULT 3,
  platforms TEXT[] DEFAULT '{}',
  orientations TEXT[] DEFAULT '{}',
  branding TEXT NOT NULL DEFAULT 'unbranded' CHECK (branding IN ('unbranded','branded')),
  num_actors INTEGER DEFAULT 1,
  gender_preference TEXT,
  age_range TEXT,
  specialties_needed TEXT[] DEFAULT '{}',
  new_actor_ok BOOLEAN DEFAULT true,
  location_id UUID REFERENCES public.shoot_locations(id) ON DELETE SET NULL,
  location_type TEXT,
  location_notes TEXT,
  location_confirmed BOOLEAN DEFAULT false,
  location_cost NUMERIC(8,2) DEFAULT 0,
  camera_setup TEXT,
  audio_setup TEXT,
  lighting_notes TEXT,
  support_crew_notes TEXT,
  broll_shot_list JSONB DEFAULT '[]'::jsonb,
  estimated_actor_cost NUMERIC(8,2),
  estimated_location_cost NUMERIC(8,2),
  estimated_crew_cost NUMERIC(8,2),
  estimated_equipment_cost NUMERIC(8,2),
  estimated_travel_cost NUMERIC(8,2),
  estimated_total NUMERIC(8,2),
  actual_total NUMERIC(8,2),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','submitted','scripts_approved','actors_cast','location_confirmed',
    'scheduled','in_production','footage_uploaded','in_post_production',
    'delivered','archived','canceled'
  )),
  shoot_date DATE,
  shoot_start_time TIME,
  shoot_end_time TIME,
  estimated_shoot_hours NUMERIC(4,1),
  drive_footage_folder_url TEXT,
  linked_creative_brief_id UUID,
  created_by_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shoot_briefs ENABLE ROW LEVEL SECURITY;

-- Admins
CREATE POLICY "Admins manage all shoot briefs"
  ON public.shoot_briefs FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Team members: any active team member can create/manage briefs.
-- Visibility further constrained by client assignment when client_ids are set.
CREATE POLICY "Team members view shoot briefs"
  ON public.shoot_briefs FOR SELECT TO authenticated
  USING (
    public.get_team_member_id(auth.uid()) IS NOT NULL
    AND (
      cardinality(client_ids) = 0
      OR EXISTS (
        SELECT 1 FROM unnest(client_ids) cid
        WHERE public.has_client_access(auth.uid(), cid)
      )
      OR assigned_producer_id = public.get_team_member_id(auth.uid())
      OR created_by_id = public.get_team_member_id(auth.uid())
    )
  );

CREATE POLICY "Team members insert shoot briefs"
  ON public.shoot_briefs FOR INSERT TO authenticated
  WITH CHECK (public.get_team_member_id(auth.uid()) IS NOT NULL);

CREATE POLICY "Team members update shoot briefs"
  ON public.shoot_briefs FOR UPDATE TO authenticated
  USING (
    public.get_team_member_id(auth.uid()) IS NOT NULL
    AND (
      cardinality(client_ids) = 0
      OR EXISTS (
        SELECT 1 FROM unnest(client_ids) cid
        WHERE public.has_client_access(auth.uid(), cid)
      )
      OR assigned_producer_id = public.get_team_member_id(auth.uid())
      OR created_by_id = public.get_team_member_id(auth.uid())
    )
  );

CREATE POLICY "Team members delete shoot briefs"
  ON public.shoot_briefs FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR created_by_id = public.get_team_member_id(auth.uid())
  );

-- Designers see briefs linked to a creative brief assigned to them
CREATE POLICY "Designers view linked shoot briefs"
  ON public.shoot_briefs FOR SELECT TO authenticated
  USING (
    linked_creative_brief_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.creative_briefs cb
      WHERE cb.id = linked_creative_brief_id
        AND cb.assigned_to_id = public.get_team_member_id(auth.uid())
    )
  );

CREATE TRIGGER trg_shoot_briefs_updated
  BEFORE UPDATE ON public.shoot_briefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_briefs_producer ON public.shoot_briefs(assigned_producer_id, status);
CREATE INDEX idx_briefs_shoot_date ON public.shoot_briefs(shoot_date);
CREATE INDEX idx_briefs_clients ON public.shoot_briefs USING gin(client_ids);

-- =========================================================
-- SHOOT SCRIPTS
-- =========================================================
CREATE TABLE public.shoot_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id UUID NOT NULL REFERENCES public.shoot_briefs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  full_script TEXT NOT NULL DEFAULT '',
  hook_line TEXT,
  cta_line TEXT,
  key_phrases TEXT[] DEFAULT '{}',
  tone_direction TEXT,
  duration_estimate_seconds INTEGER,
  client_ids UUID[] DEFAULT '{}',
  verticals TEXT[] DEFAULT '{}',
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shoot_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all scripts"
  ON public.shoot_scripts FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Team members access scripts via brief"
  ON public.shoot_scripts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shoot_briefs b WHERE b.id = brief_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.shoot_briefs b WHERE b.id = brief_id));

CREATE INDEX idx_scripts_brief ON public.shoot_scripts(brief_id);

-- =========================================================
-- SHOOT CAST
-- =========================================================
CREATE TABLE public.shoot_cast (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id UUID NOT NULL REFERENCES public.shoot_briefs(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES public.talent_actors(id) ON DELETE CASCADE,
  role_description TEXT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','interested','confirmed','declined','no_show')),
  hourly_rate NUMERIC(8,2),
  estimated_hours NUMERIC(4,1),
  actual_hours NUMERIC(4,1),
  total_payment NUMERIC(8,2),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid')),
  is_first_shoot BOOLEAN DEFAULT false,
  producer_rating_for_shoot INTEGER CHECK (producer_rating_for_shoot BETWEEN 1 AND 5),
  producer_notes_for_shoot TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shoot_cast ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all cast"
  ON public.shoot_cast FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Team members access cast via brief"
  ON public.shoot_cast FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shoot_briefs b WHERE b.id = brief_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.shoot_briefs b WHERE b.id = brief_id));

CREATE INDEX idx_cast_brief ON public.shoot_cast(brief_id);
CREATE INDEX idx_cast_actor ON public.shoot_cast(actor_id);

-- =========================================================
-- SHOOT FOOTAGE
-- =========================================================
CREATE TABLE public.shoot_footage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id UUID NOT NULL REFERENCES public.shoot_briefs(id) ON DELETE CASCADE,
  script_id UUID REFERENCES public.shoot_scripts(id) ON DELETE SET NULL,
  file_url TEXT NOT NULL,
  drive_file_id TEXT,
  drive_url TEXT,
  file_name TEXT,
  file_type TEXT,
  file_size_bytes BIGINT,
  duration_seconds INTEGER,
  thumbnail_url TEXT,
  clip_type TEXT CHECK (clip_type IN ('scripted_take','broll','blooper','other')),
  take_number INTEGER,
  is_best_take BOOLEAN DEFAULT false,
  is_usable BOOLEAN DEFAULT true,
  producer_notes TEXT,
  uploaded_by_id UUID,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.shoot_footage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all footage"
  ON public.shoot_footage FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Team members access footage via brief"
  ON public.shoot_footage FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shoot_briefs b WHERE b.id = brief_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.shoot_briefs b WHERE b.id = brief_id));

CREATE POLICY "Designers view footage for linked briefs"
  ON public.shoot_footage FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shoot_briefs b
    JOIN public.creative_briefs cb ON cb.id = b.linked_creative_brief_id
    WHERE b.id = shoot_footage.brief_id
      AND cb.assigned_to_id = public.get_team_member_id(auth.uid())
  ));

CREATE INDEX idx_footage_brief ON public.shoot_footage(brief_id);
CREATE INDEX idx_footage_script ON public.shoot_footage(script_id);

-- =========================================================
-- STORAGE: talent-photos (public)
-- =========================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('talent-photos', 'talent-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Talent photos public read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'talent-photos');

CREATE POLICY "Anyone can upload talent photos"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'talent-photos');

CREATE POLICY "Team members manage talent photos"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'talent-photos' AND public.get_team_member_id(auth.uid()) IS NOT NULL)
  WITH CHECK (bucket_id = 'talent-photos' AND public.get_team_member_id(auth.uid()) IS NOT NULL);

-- =========================================================
-- STORAGE: shoot-footage (private — team only)
-- =========================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('shoot-footage', 'shoot-footage', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Team members read shoot footage"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'shoot-footage' AND public.get_team_member_id(auth.uid()) IS NOT NULL);

CREATE POLICY "Team members upload shoot footage"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shoot-footage' AND public.get_team_member_id(auth.uid()) IS NOT NULL);

CREATE POLICY "Team members delete shoot footage"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'shoot-footage' AND public.get_team_member_id(auth.uid()) IS NOT NULL);
