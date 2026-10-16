-- Pre-0043 shape of the creative tables, with the REAL access functions copied
-- verbatim from the live database (is_admin, has_client_access, get_team_member_id
-- are not stubbed) and the real creative_briefs RLS policies.
DO $$ BEGIN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

CREATE TABLE public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL, status text NOT NULL DEFAULT 'active');
CREATE TABLE public.team_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, name text NOT NULL, email text NOT NULL DEFAULT '', role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true, is_service_account boolean NOT NULL DEFAULT false, is_creative_lead boolean NOT NULL DEFAULT false, slack_user_id text);
CREATE TABLE public.client_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE, team_member_id uuid NOT NULL, role_on_account text);

CREATE OR REPLACE FUNCTION public.get_team_member_id(check_user_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT id FROM public.team_members WHERE user_id = check_user_id AND is_active = true LIMIT 1;
$function$;
CREATE OR REPLACE FUNCTION public.has_client_access(check_user_id uuid, check_client_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.client_assignments ca ON ca.team_member_id = tm.id
    WHERE tm.user_id = check_user_id AND ca.client_id = check_client_id AND tm.is_active = true
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_admin(check_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE user_id = check_user_id AND role = 'admin' AND is_active = true);
$function$;

CREATE TABLE public.creative_briefs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE, title text NOT NULL, creative_type text NOT NULL DEFAULT 'static',
  platforms text[] DEFAULT '{}', objective text, target_audience text, key_message text, copy_suggestions jsonb DEFAULT '[]', brand_guidelines_url text, reference_assets jsonb DEFAULT '[]',
  due_date date, priority text NOT NULL DEFAULT 'medium', assigned_to_id uuid, created_by_id uuid, status text NOT NULL DEFAULT 'draft', notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), creative_types text[] DEFAULT '{}', sizes jsonb DEFAULT '[]', funnel_stage text,
  num_concepts int DEFAULT 1, tone_style text, dos_and_donts text, submitted_at timestamptz, approved_at timestamptz, delivered_at timestamptz, trafficked_by_id uuid, trafficked_at timestamptz,
  drive_wip_folder_id text, drive_approved_folder_id text, template_id uuid, video_scripts jsonb DEFAULT '[]', estimated_hours numeric, scheduled_date date, deleted_at timestamptz,
  raw_footage_url text, final_assets_url text, presumed_complete_at timestamptz, presumed_complete_reason text, completion_confirmed_by_id uuid, accepted_by_id uuid, accepted_at timestamptz,
  accepted_via text, closed_out_at timestamptz, closed_out_by_id uuid, closed_out_note text,
  CONSTRAINT creative_briefs_status_check CHECK (status IN ('draft','submitted','in_design','ready_for_review','revision_requested','approved','delivered')));
CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER touch BEFORE UPDATE ON public.creative_briefs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creative_briefs TO authenticated;
ALTER TABLE public.creative_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage all briefs" ON public.creative_briefs FOR ALL TO authenticated USING (is_admin(auth.uid()));
CREATE POLICY "Team members access briefs" ON public.creative_briefs FOR ALL TO authenticated
  USING (has_client_access(auth.uid(), client_id) OR (client_id IS NULL) OR (assigned_to_id = get_team_member_id(auth.uid())) OR (created_by_id = get_team_member_id(auth.uid())));

CREATE TABLE public.creative_brief_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brief_id uuid NOT NULL REFERENCES public.creative_briefs(id) ON DELETE CASCADE, author_id uuid NOT NULL, content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.creative_brief_status_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brief_id uuid NOT NULL REFERENCES public.creative_briefs(id) ON DELETE CASCADE, from_status text, to_status text NOT NULL,
  changed_by_id uuid, via text NOT NULL DEFAULT 'hub', note text, forced boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION public.creative_brief_log_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_actor uuid; v_via text; v_note text; v_forced boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  v_actor := NULLIF(current_setting('app.actor_id', true), '')::uuid;
  IF v_actor IS NULL AND auth.uid() IS NOT NULL THEN v_actor := public.get_team_member_id(auth.uid()); END IF;
  v_via := COALESCE(NULLIF(current_setting('app.via', true), ''), 'hub');
  v_note := NULLIF(current_setting('app.note', true), '');
  v_forced := COALESCE(NULLIF(current_setting('app.forced', true), '')::boolean, false);
  INSERT INTO public.creative_brief_status_history (brief_id, from_status, to_status, changed_by_id, via, note, forced)
  VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, COALESCE(NEW.status, 'draft'), v_actor, v_via, v_note, v_forced);
  RETURN NEW;
END $function$;
CREATE TRIGGER creative_brief_status_log AFTER INSERT OR UPDATE ON public.creative_briefs FOR EACH ROW EXECUTE FUNCTION public.creative_brief_log_status();

-- Tables the mcp-hub creative tools read.
CREATE TABLE public.creative_deliverables (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brief_id uuid REFERENCES public.creative_briefs(id) ON DELETE CASCADE, uploaded_at timestamptz);
CREATE TABLE public.creative_time_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brief_id uuid, team_member_id uuid, client_id uuid, duration_minutes int, started_at timestamptz, deleted_at timestamptz);
CREATE TABLE public.creative_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brief_id uuid, reviewer_id uuid, action text, comments text, deliverable_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.designer_monthly_caps (team_member_id uuid, month date, cap_hours numeric);
CREATE TABLE public.designer_checkins (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_member_id uuid, checkin_date date, asked_at timestamptz, responded_at timestamptz, raw_reply text,
  working_on text[], blocked_on text, capacity_note text, brief_ids uuid[], source text);
CREATE TABLE public.creative_followups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), brief_id uuid, rule text, stage text, recipient_id uuid, sent_at timestamptz, resolved_at timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE public.agent_query_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_id uuid, team_member_id uuid, tool_name text, outcome text, arguments jsonb, created_at timestamptz DEFAULT now());

-- Pre-0044 agent write function (0044 replaces it).
CREATE OR REPLACE FUNCTION public.agent_write_creative_brief(p_brief_id uuid, p_actor_id uuid, p_expected_updated_at timestamp with time zone, p_patch jsonb, p_comment text, p_via text, p_note text, p_forced boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN RETURN jsonb_build_object('outcome', 'not_found'); END $function$;

INSERT INTO public.clients (id, name, slug) VALUES ('c1000000-0000-4000-8000-000000000001', 'Alpha', 'alpha'), ('c1000000-0000-4000-8000-000000000002', 'Beta', 'beta');
INSERT INTO public.team_members (id, user_id, name, role, is_service_account) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Charles', 'admin', false),
  ('a0000000-0000-4000-8000-000000000002', NULL, 'Grokbot', 'account_manager', true),
  ('a0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003', 'Amy', 'account_manager', false),
  ('a0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000004', 'Dana', 'designer', false),
  ('a0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000005', 'Cara', 'account_manager', false),
  ('a0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000006', 'Olly', 'account_manager', false);
-- Amy is assigned to Alpha only. Dana, Cara and Olly have no client assignments.
INSERT INTO public.client_assignments (client_id, team_member_id) VALUES ('c1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003');
INSERT INTO public.creative_briefs (id, client_id, title, status, due_date, brand_guidelines_url) VALUES ('b0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'Spring static', 'draft', '2026-10-01', 'https://a');
-- A Beta brief assigned to Dana, created by Cara.
INSERT INTO public.creative_briefs (id, client_id, title, status, due_date, assigned_to_id, created_by_id) VALUES ('b0000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'Beta video', 'in_design', '2026-10-05', 'a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005');
