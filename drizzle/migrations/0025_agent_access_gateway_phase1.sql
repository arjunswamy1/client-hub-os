CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'ai_agent' CHECK (kind IN ('ai_agent','teammate_agent')),
  owner_team_member_id uuid REFERENCES public.team_members(id),
  team text CHECK (team IN ('media','creative','client','ops')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','killed')),
  killed_at timestamptz, killed_by_id uuid REFERENCES public.team_members(id), killed_reason text,
  notes text,
  created_by_id uuid REFERENCES public.team_members(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.agent_gateway_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text NOT NULL,
  label text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz, revoked_by_id uuid REFERENCES public.team_members(id),
  last_used_at timestamptz,
  created_by_id uuid REFERENCES public.team_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at <= created_at + interval '366 days')
);
CREATE TABLE public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  label text NOT NULL,
  client_id uuid REFERENCES public.clients(id),
  account_ref text,
  op_secret_ref text CHECK (op_secret_ref IS NULL OR op_secret_ref ~ '^op://[^/\s]+/[^/\s]+(/[^/\s]+)+$'),
  allowed_hosts text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT false,
  created_by_id uuid REFERENCES public.team_members(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.integrations.op_secret_ref IS 'Pointer to a 1Password item field only. Never a secret value.';
CREATE TABLE public.agent_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  account_ref text,
  scopes text[] NOT NULL DEFAULT '{read}' CHECK (scopes <@ ARRAY['read','write']::text[] AND cardinality(scopes) > 0),
  rate_per_minute int NOT NULL DEFAULT 30 CHECK (rate_per_minute BETWEEN 1 AND 600),
  rate_per_day int NOT NULL DEFAULT 2000 CHECK (rate_per_day BETWEEN 1 AND 100000),
  expires_at timestamptz,
  revoked_at timestamptz,
  reason text,
  granted_by_id uuid REFERENCES public.team_members(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, integration_id)
);
CREATE TABLE public.agent_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid, token_id uuid, integration_id uuid, grant_id uuid,
  action text, scope text,
  outcome text NOT NULL,
  detail text,
  request_fingerprint text,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_access_log_created ON public.agent_access_log (created_at DESC);
CREATE INDEX agent_access_log_agent ON public.agent_access_log (agent_id, created_at DESC);
CREATE TABLE public.agent_gateway_rate_counters (
  grant_id uuid NOT NULL REFERENCES public.agent_grants(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  bucket_start timestamptz NOT NULL,
  hits int NOT NULL DEFAULT 0,
  PRIMARY KEY (grant_id, bucket, bucket_start)
);
CREATE TABLE public.agent_gateway_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  gateway_enabled boolean NOT NULL DEFAULT false,
  updated_by_id uuid REFERENCES public.team_members(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.agent_gateway_settings (id) VALUES (1);

CREATE OR REPLACE FUNCTION public.agent_access_log_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'agent_access_log is append-only: % refused', TG_OP; END $$;
CREATE TRIGGER agent_access_log_no_change BEFORE UPDATE OR DELETE ON public.agent_access_log FOR EACH ROW EXECUTE FUNCTION public.agent_access_log_append_only();

CREATE OR REPLACE FUNCTION public.agent_gateway_hit(p_grant_id uuid, p_per_minute int, p_per_day int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m int; d int; mb timestamptz := date_trunc('minute', now()); db timestamptz := date_trunc('day', now());
BEGIN
  INSERT INTO agent_gateway_rate_counters VALUES (p_grant_id,'minute',mb,1)
    ON CONFLICT (grant_id,bucket,bucket_start) DO UPDATE SET hits = agent_gateway_rate_counters.hits + 1 RETURNING hits INTO m;
  INSERT INTO agent_gateway_rate_counters VALUES (p_grant_id,'day',db,1)
    ON CONFLICT (grant_id,bucket,bucket_start) DO UPDATE SET hits = agent_gateway_rate_counters.hits + 1 RETURNING hits INTO d;
  DELETE FROM agent_gateway_rate_counters WHERE grant_id = p_grant_id AND bucket_start < now() - interval '2 days';
  RETURN jsonb_build_object('allowed', m <= p_per_minute AND d <= p_per_day, 'minute', m, 'day', d);
END $$;
REVOKE ALL ON FUNCTION public.agent_gateway_hit(uuid,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_gateway_hit(uuid,int,int) TO service_role;

CREATE TRIGGER agents_updated BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER integrations_updated BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER agent_grants_updated BEFORE UPDATE ON public.agent_grants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agents, public.agent_gateway_tokens, public.integrations, public.agent_grants TO authenticated;
GRANT SELECT, UPDATE ON public.agent_gateway_settings TO authenticated;
GRANT SELECT ON public.agent_access_log TO authenticated;
GRANT ALL ON public.agents, public.agent_gateway_tokens, public.integrations, public.agent_grants, public.agent_access_log, public.agent_gateway_rate_counters, public.agent_gateway_settings TO service_role;

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_gateway_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_gateway_rate_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_gateway_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage agents" ON public.agents FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admins manage gateway tokens" ON public.agent_gateway_tokens FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admins manage integrations" ON public.integrations FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admins manage grants" ON public.agent_grants FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "admins read access log" ON public.agent_access_log FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "admins read gateway settings" ON public.agent_gateway_settings FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "admins update gateway settings" ON public.agent_gateway_settings FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));