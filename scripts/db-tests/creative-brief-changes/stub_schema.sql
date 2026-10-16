-- Minimal pre-0043 shape of creative_briefs/comments plus Supabase stand-ins.
DO $$ BEGIN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, is_active boolean NOT NULL DEFAULT true, is_service_account boolean NOT NULL DEFAULT false, name text);
CREATE FUNCTION public.get_team_member_id(check_user_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.team_members WHERE user_id = check_user_id AND is_active LIMIT 1 $$;
CREATE FUNCTION public.is_admin(u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.has_client_access(u uuid, c uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TABLE public.creative_briefs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid, title text, status text DEFAULT 'draft',
  assigned_to_id uuid, due_date date, scheduled_date date, priority text, objective text, target_audience text, key_message text, notes text,
  tone_style text, dos_and_donts text, copy_suggestions jsonb, creative_type text, creative_types text[], platforms text[], sizes jsonb,
  num_concepts int, funnel_stage text, video_scripts jsonb, brand_guidelines_url text, reference_assets jsonb, raw_footage_url text,
  final_assets_url text, drive_wip_folder_id text, drive_approved_folder_id text, deleted_at timestamptz, updated_at timestamptz DEFAULT now(),
  CONSTRAINT creative_briefs_status_check CHECK (status IN ('draft','submitted','in_design','ready_for_review','revision_requested','approved','delivered')));
CREATE TABLE public.creative_brief_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brief_id uuid REFERENCES public.creative_briefs(id), author_id uuid, content text, created_at timestamptz DEFAULT now());
INSERT INTO public.team_members VALUES
  ('a0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001', true, false, 'Charles')
ON CONFLICT DO NOTHING;
INSERT INTO public.team_members VALUES ('a0000000-0000-4000-8000-000000000002', NULL, true, true, 'Grokbot');
INSERT INTO public.creative_briefs (id, title, status, due_date, brand_guidelines_url) VALUES ('b0000000-0000-4000-8000-000000000001', 'Spring static', 'draft', '2026-10-01', 'https://a');
