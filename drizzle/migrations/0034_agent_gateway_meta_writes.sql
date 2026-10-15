ALTER TABLE public.agent_gateway_settings
  ADD COLUMN writes_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN write_approver_team_member_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN write_max_budget_change_pct numeric NOT NULL DEFAULT 50,
  ADD COLUMN write_max_daily_budget_usd numeric NOT NULL DEFAULT 1000,
  ADD COLUMN write_requests_per_day integer NOT NULL DEFAULT 20,
  ADD COLUMN write_pending_ttl_minutes integer NOT NULL DEFAULT 1440,
  ADD COLUMN write_approval_ttl_minutes integer NOT NULL DEFAULT 30;

UPDATE public.agent_gateway_settings
  SET write_approver_team_member_ids = ARRAY['1fdd684e-6cb7-447e-b616-7e1b9c598971'::uuid, '014fa04a-80a5-41ce-9368-d1a81f6d2eec'::uuid]
  WHERE id = 1;

-- The one person who may change gateway write settings or give a grant write scope.
CREATE OR REPLACE FUNCTION public.agent_gateway_write_owner() RETURNS uuid
LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT '1fdd684e-6cb7-447e-b616-7e1b9c598971'::uuid $$;

CREATE OR REPLACE FUNCTION public.agent_gateway_settings_write_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service role / maintenance
  IF (NEW.writes_enabled, NEW.write_approver_team_member_ids, NEW.write_max_budget_change_pct, NEW.write_max_daily_budget_usd,
      NEW.write_requests_per_day, NEW.write_pending_ttl_minutes, NEW.write_approval_ttl_minutes)
     IS DISTINCT FROM
     (OLD.writes_enabled, OLD.write_approver_team_member_ids, OLD.write_max_budget_change_pct, OLD.write_max_daily_budget_usd,
      OLD.write_requests_per_day, OLD.write_pending_ttl_minutes, OLD.write_approval_ttl_minutes)
     AND public.get_team_member_id(auth.uid()) IS DISTINCT FROM public.agent_gateway_write_owner() THEN
    RAISE EXCEPTION 'only the write owner may change gateway write settings';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_gateway_settings_write_lock BEFORE UPDATE ON public.agent_gateway_settings
  FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_settings_write_lock();

CREATE OR REPLACE FUNCTION public.agent_grant_write_scope_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF 'write' = ANY(COALESCE(NEW.scopes, '{}'))
     AND (TG_OP = 'INSERT' OR NOT ('write' = ANY(COALESCE(OLD.scopes, '{}'))))
     AND public.get_team_member_id(auth.uid()) IS DISTINCT FROM public.agent_gateway_write_owner() THEN
    RAISE EXCEPTION 'only the write owner may give a grant write scope';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_grant_write_scope_lock BEFORE INSERT OR UPDATE ON public.agent_grants
  FOR EACH ROW EXECUTE FUNCTION public.agent_grant_write_scope_lock();

CREATE TABLE public.agent_write_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id),
  grant_id uuid NOT NULL REFERENCES public.agent_grants(id),
  integration_id uuid NOT NULL REFERENCES public.integrations(id),
  action text NOT NULL,
  account_id text NOT NULL,
  account_name text,
  currency text,
  object_type text NOT NULL CHECK (object_type IN ('campaign','adset','ad')),
  object_id text NOT NULL,
  object_name text,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  diff_text text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired','executing','executed','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decision_expires_at timestamptz NOT NULL,
  decided_by_id uuid REFERENCES public.team_members(id),
  decided_at timestamptz,
  decision_note text,
  approval_expires_at timestamptz,
  execution_started_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  failure_outcome text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agent_write_requests_one_open ON public.agent_write_requests (agent_id, action, object_id)
  WHERE status IN ('pending','approved','executing');
CREATE INDEX agent_write_requests_agent_day ON public.agent_write_requests (agent_id, requested_at);
GRANT SELECT ON public.agent_write_requests TO authenticated;
GRANT ALL ON public.agent_write_requests TO service_role;
ALTER TABLE public.agent_write_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read write requests" ON public.agent_write_requests FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.decide_agent_write_request(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.get_team_member_id(auth.uid()); s record; r record; v_owner uuid;
BEGIN
  SELECT * INTO s FROM agent_gateway_settings WHERE id = 1;
  IF v_me IS NULL OR NOT (v_me = ANY(COALESCE(s.write_approver_team_member_ids, '{}'))) THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'not_write_approver');
  END IF;
  SELECT * INTO r FROM agent_write_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'outcome', 'not_found'); END IF;
  SELECT owner_team_member_id INTO v_owner FROM agents WHERE id = r.agent_id;
  IF v_owner IS NOT DISTINCT FROM v_me THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_self_approval'); END IF;
  IF r.status <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'outcome', 'not_pending', 'status', r.status); END IF;
  IF r.decision_expires_at <= now() THEN
    UPDATE agent_write_requests SET status = 'expired', updated_at = now() WHERE id = r.id;
    INSERT INTO agent_access_log (agent_id, integration_id, grant_id, action, scope, event_type, outcome, target)
      VALUES (r.agent_id, r.integration_id, r.grant_id, r.action, 'write', 'write', 'write_expired', r.id::text);
    RETURN jsonb_build_object('ok', false, 'outcome', 'write_expired');
  END IF;
  UPDATE agent_write_requests SET
    status = CASE WHEN p_approve THEN 'approved' ELSE 'denied' END,
    decided_by_id = v_me, decided_at = now(), decision_note = left(p_note, 500), updated_at = now(),
    approval_expires_at = CASE WHEN p_approve THEN now() + make_interval(mins => s.write_approval_ttl_minutes) END
  WHERE id = r.id;
  INSERT INTO agent_access_log (agent_id, integration_id, grant_id, action, scope, event_type, outcome, target, approved_by_id, admin_team_member_id)
    VALUES (r.agent_id, r.integration_id, r.grant_id, r.action, 'write', 'write',
            CASE WHEN p_approve THEN 'write_approved' ELSE 'write_denied' END, r.id::text,
            CASE WHEN p_approve THEN v_me END, v_me);
  RETURN jsonb_build_object('ok', true, 'outcome', CASE WHEN p_approve THEN 'write_approved' ELSE 'write_denied' END);
END $$;
REVOKE ALL ON FUNCTION public.decide_agent_write_request(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_agent_write_request(uuid, boolean, text) TO authenticated;