-- Minimal pre-0034 shape of the tables the gateway write migrations touch, plus Supabase stand-ins.
DO $$ BEGIN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job VALUES (n, s, c); SELECT 1::bigint $$;
CREATE TABLE public.team_members (id uuid PRIMARY KEY, user_id uuid, is_active boolean NOT NULL DEFAULT true, name text);
CREATE FUNCTION public.get_team_member_id(check_user_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.team_members WHERE user_id = check_user_id AND is_active = true LIMIT 1 $$;
CREATE FUNCTION public.is_admin(check_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE TABLE public.agents (id uuid PRIMARY KEY, name text, owner_team_member_id uuid, created_by_id uuid);
CREATE TABLE public.integrations (id uuid PRIMARY KEY);
CREATE TABLE public.agent_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid, integration_id uuid, scopes text[] NOT NULL DEFAULT '{read}', revoked_at timestamptz);
CREATE TABLE public.agent_gateway_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid NOT NULL, token_hash text NOT NULL, token_prefix text, label text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '90 days', revoked_at timestamptz, revoked_by_id uuid, last_used_at timestamptz, created_by_id uuid, created_at timestamptz NOT NULL DEFAULT now(), audience text NOT NULL DEFAULT 'gateway');
CREATE TABLE public.agent_gateway_settings (id integer PRIMARY KEY, gateway_enabled boolean NOT NULL DEFAULT false);
INSERT INTO public.agent_gateway_settings VALUES (1, true);
CREATE TABLE public.agent_access_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid, token_id uuid, integration_id uuid, grant_id uuid,
  action text, scope text, outcome text NOT NULL, detail text, created_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL CHECK (event_type IN ('write','denied','admin','handoff')), target text, approved_by_id uuid, admin_team_member_id uuid,
  subject_table text, subject_id uuid, auth_surface text NOT NULL DEFAULT 'gateway' CHECK (auth_surface IN ('gateway','hub')));
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid NOT NULL, type text NOT NULL, title text NOT NULL, message text);
