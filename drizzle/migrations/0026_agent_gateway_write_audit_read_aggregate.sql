ALTER TABLE public.agent_access_log
  ADD COLUMN event_type text NOT NULL DEFAULT 'denied' CHECK (event_type IN ('write','denied','admin')),
  ADD COLUMN target text,
  ADD COLUMN approved_by_id uuid,
  ADD COLUMN admin_team_member_id uuid,
  ADD COLUMN subject_table text,
  ADD COLUMN subject_id uuid;
CREATE INDEX agent_access_log_event ON public.agent_access_log (event_type, created_at DESC);
COMMENT ON TABLE public.agent_access_log IS 'Append-only, kept permanently. Every write-scope call, every refusal, and every admin change. Successful reads are counted in agent_read_usage_daily instead.';

CREATE TABLE public.agent_read_usage_daily (
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  integration_id uuid NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  action text NOT NULL,
  day date NOT NULL,
  count int NOT NULL DEFAULT 0,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, integration_id, action, day)
);
GRANT SELECT ON public.agent_read_usage_daily TO authenticated;
GRANT ALL ON public.agent_read_usage_daily TO service_role;
ALTER TABLE public.agent_read_usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read usage" ON public.agent_read_usage_daily FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.agent_gateway_count_read(p_agent_id uuid, p_integration_id uuid, p_action text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO agent_read_usage_daily (agent_id, integration_id, action, day, count, last_used_at)
  VALUES (p_agent_id, p_integration_id, p_action, (now() AT TIME ZONE 'utc')::date, 1, now())
  ON CONFLICT (agent_id, integration_id, action, day)
  DO UPDATE SET count = agent_read_usage_daily.count + 1, last_used_at = now();
$$;
REVOKE ALL ON FUNCTION public.agent_gateway_count_read(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_gateway_count_read(uuid,uuid,text) TO service_role;

-- Admin events: any change made by a signed-in person (gateway service writes have no auth.uid and are skipped).
CREATE OR REPLACE FUNCTION public.agent_gateway_admin_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'token_hash' END;
        n jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'token_hash' END;
        changed text; v_action text; v_id uuid; v_agent uuid; v_integ uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT string_agg(k || ': ' || coalesce(o->>k,'null') || ' -> ' || coalesce(n->>k,'null'), '; ' ORDER BY k) INTO changed
      FROM jsonb_object_keys(n) k
     WHERE k NOT IN ('updated_at','last_used_at') AND (o->k) IS DISTINCT FROM (n->k);
    IF changed IS NULL THEN RETURN NULL; END IF;
  END IF;
  v_action := TG_TABLE_NAME || '.' || CASE
    WHEN TG_TABLE_NAME = 'agents' AND TG_OP = 'UPDATE' AND (o->>'status') IS DISTINCT FROM (n->>'status') THEN
      CASE n->>'status' WHEN 'killed' THEN 'kill' WHEN 'suspended' THEN 'suspend' ELSE 'restore' END
    WHEN TG_TABLE_NAME = 'agent_gateway_tokens' AND TG_OP = 'UPDATE' AND (n->>'revoked_at') IS NOT NULL AND (o->>'revoked_at') IS NULL THEN 'revoke'
    WHEN TG_TABLE_NAME = 'agent_grants' AND TG_OP = 'UPDATE' AND (n->>'revoked_at') IS NOT NULL AND (o->>'revoked_at') IS NULL THEN 'remove'
    WHEN TG_OP = 'INSERT' THEN 'create' WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'change' END;
  v_id := CASE WHEN TG_TABLE_NAME = 'agent_gateway_settings' THEN NULL ELSE coalesce(n->>'id', o->>'id')::uuid END;
  v_agent := CASE WHEN TG_TABLE_NAME = 'agents' THEN v_id ELSE nullif(coalesce(n->>'agent_id', o->>'agent_id'),'')::uuid END;
  v_integ := CASE WHEN TG_TABLE_NAME = 'integrations' THEN v_id ELSE nullif(coalesce(n->>'integration_id', o->>'integration_id'),'')::uuid END;
  INSERT INTO agent_access_log (event_type, outcome, action, agent_id, integration_id, grant_id, token_id,
    admin_team_member_id, subject_table, subject_id, detail)
  VALUES ('admin', 'admin_' || lower(TG_OP), v_action, v_agent, v_integ,
    CASE WHEN TG_TABLE_NAME = 'agent_grants' THEN v_id END,
    CASE WHEN TG_TABLE_NAME = 'agent_gateway_tokens' THEN v_id END,
    public.get_team_member_id(auth.uid()), TG_TABLE_NAME, v_id, left(changed, 2000));
  RETURN NULL;
END $$;
CREATE TRIGGER agents_admin_audit AFTER INSERT OR UPDATE OR DELETE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_admin_audit();
CREATE TRIGGER agent_gateway_tokens_admin_audit AFTER INSERT OR UPDATE OR DELETE ON public.agent_gateway_tokens FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_admin_audit();
CREATE TRIGGER agent_grants_admin_audit AFTER INSERT OR UPDATE OR DELETE ON public.agent_grants FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_admin_audit();
CREATE TRIGGER integrations_admin_audit AFTER INSERT OR UPDATE OR DELETE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_admin_audit();
CREATE TRIGGER agent_gateway_settings_admin_audit AFTER UPDATE ON public.agent_gateway_settings FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_admin_audit();