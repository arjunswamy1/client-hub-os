ALTER TABLE public.agent_gateway_tokens ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'gateway';
ALTER TABLE public.agent_gateway_tokens ADD CONSTRAINT agent_gateway_tokens_audience_check CHECK (audience IN ('gateway','hub'));

CREATE TABLE public.agent_client_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, client_id)
);
GRANT SELECT, INSERT, DELETE ON public.agent_client_scopes TO authenticated;
GRANT ALL ON public.agent_client_scopes TO service_role;
ALTER TABLE public.agent_client_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage agent client scopes" ON public.agent_client_scopes FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE TRIGGER agent_client_scopes_admin_audit AFTER INSERT OR UPDATE OR DELETE ON public.agent_client_scopes
  FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_admin_audit();

ALTER TABLE public.agent_access_log ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE public.agent_access_log ADD COLUMN IF NOT EXISTS tool text;
ALTER TABLE public.agent_access_log ADD COLUMN IF NOT EXISTS auth_surface text NOT NULL DEFAULT 'gateway';
ALTER TABLE public.agent_access_log ADD CONSTRAINT agent_access_log_surface_check CHECK (auth_surface IN ('gateway','hub'));

CREATE TABLE public.agent_hub_read_usage_daily (
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  tool text NOT NULL,
  client_key text NOT NULL DEFAULT '',
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, tool, client_key, day)
);
GRANT SELECT ON public.agent_hub_read_usage_daily TO authenticated;
GRANT ALL ON public.agent_hub_read_usage_daily TO service_role;
ALTER TABLE public.agent_hub_read_usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read hub usage" ON public.agent_hub_read_usage_daily FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.agent_hub_count_read(p_agent_id uuid, p_tool text, p_client_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO agent_hub_read_usage_daily (agent_id, tool, client_key, day, count, last_used_at)
  VALUES (p_agent_id, p_tool, coalesce(p_client_id::text, ''), (now() AT TIME ZONE 'utc')::date, 1, now())
  ON CONFLICT (agent_id, tool, client_key, day)
  DO UPDATE SET count = agent_hub_read_usage_daily.count + 1, last_used_at = now();
$$;
REVOKE ALL ON FUNCTION public.agent_hub_count_read(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_hub_count_read(uuid, text, uuid) TO service_role;