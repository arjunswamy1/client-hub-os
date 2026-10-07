CREATE TABLE IF NOT EXISTS public.agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  label text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['read','draft'],
  revoked_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.agent_query_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid REFERENCES public.agent_tokens(id),
  team_member_id uuid,
  tool_name text NOT NULL,
  arguments jsonb,
  client_id uuid,
  outcome text NOT NULL,
  withheld jsonb,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_query_log_created_idx ON public.agent_query_log (created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.agent_tokens TO authenticated;
GRANT ALL ON public.agent_tokens TO service_role;
GRANT SELECT ON public.agent_query_log TO authenticated;
GRANT ALL ON public.agent_query_log TO service_role;

ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_query_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read agent tokens" ON public.agent_tokens FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins mint agent tokens" ON public.agent_tokens FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins revoke agent tokens" ON public.agent_tokens FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins read agent query log" ON public.agent_query_log FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));