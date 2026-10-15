-- lovable-cron-fallback-reviewed: user explicitly required a scheduled sweep of requests stuck executing >10 minutes; no event fires when an executor dies, so time-based polling is the only signal.
-- Gateway write hardening: atomic Chicago-day request limit, stuck-executor sweep,
-- ownerless-agent refusal, and lock triggers that apply to every role (no service-role bypass).

CREATE OR REPLACE FUNCTION public.agent_write_day_start(p_at timestamptz DEFAULT now()) RETURNS timestamptz
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (date_trunc('day', p_at AT TIME ZONE 'America/Chicago')) AT TIME ZONE 'America/Chicago'
$$;

CREATE OR REPLACE FUNCTION public.agent_write_request_create(p_row jsonb, p_per_day integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_agent uuid := (p_row->>'agent_id')::uuid; v_count integer; v_open record; v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('agent_write_request:' || v_agent::text));
  SELECT id, status, diff_text, decision_expires_at INTO v_open FROM agent_write_requests
    WHERE agent_id = v_agent AND action = p_row->>'action' AND object_id = p_row->>'object_id'
      AND status IN ('pending','approved','executing') LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'id', v_open.id, 'status', v_open.status,
      'diff_text', v_open.diff_text, 'decision_expires_at', v_open.decision_expires_at);
  END IF;
  SELECT count(*) INTO v_count FROM agent_write_requests
    WHERE agent_id = v_agent AND requested_at >= public.agent_write_day_start(now());
  IF v_count >= p_per_day THEN RETURN jsonb_build_object('ok', false, 'outcome', 'write_rate_limited', 'count', v_count); END IF;
  INSERT INTO agent_write_requests (agent_id, grant_id, integration_id, action, account_id, account_name, currency,
    object_type, object_id, object_name, before, after, diff_text, reason, requested_at, decision_expires_at)
  VALUES (v_agent, (p_row->>'grant_id')::uuid, (p_row->>'integration_id')::uuid, p_row->>'action', p_row->>'account_id',
    p_row->>'account_name', p_row->>'currency', p_row->>'object_type', p_row->>'object_id', p_row->>'object_name',
    p_row->'before', p_row->'after', p_row->>'diff_text', p_row->>'reason', now(), (p_row->>'decision_expires_at')::timestamptz)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.agent_write_request_create(jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_write_request_create(jsonb, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.sweep_stuck_agent_writes() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN UPDATE agent_write_requests SET status = 'failed', failure_outcome = 'failed_stuck_executing', updated_at = now()
           WHERE status = 'executing' AND execution_started_at < now() - interval '10 minutes'
           RETURNING id, agent_id, integration_id, grant_id, action, decided_by_id LOOP
    INSERT INTO agent_access_log (agent_id, integration_id, grant_id, action, scope, event_type, outcome, detail, target, approved_by_id)
      VALUES (r.agent_id, r.integration_id, r.grant_id, r.action, 'write', 'write', 'failed_stuck_executing',
              'executing > 10 minutes; Meta outcome unknown, verify the object', r.id::text, r.decided_by_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.sweep_stuck_agent_writes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stuck_agent_writes() TO service_role;

SELECT cron.schedule('agent-write-stuck-sweep', '*/10 * * * *', 'SELECT public.sweep_stuck_agent_writes()');

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
  IF v_owner IS NULL AND p_approve THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_ownerless_agent'); END IF;
  IF v_owner = v_me THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_self_approval'); END IF;
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

CREATE OR REPLACE FUNCTION public.agent_gateway_settings_write_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.agent_grant_write_scope_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF 'write' = ANY(COALESCE(NEW.scopes, '{}'))
     AND (TG_OP = 'INSERT' OR NOT ('write' = ANY(COALESCE(OLD.scopes, '{}'))))
     AND public.get_team_member_id(auth.uid()) IS DISTINCT FROM public.agent_gateway_write_owner() THEN
    RAISE EXCEPTION 'only the write owner may give a grant write scope';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.agent_gateway_write_change_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid := public.agent_gateway_write_owner(); v_who uuid := public.get_team_member_id(auth.uid()); v_what text;
BEGIN
  IF TG_TABLE_NAME = 'agent_gateway_settings' THEN
    IF (NEW.writes_enabled, NEW.write_approver_team_member_ids, NEW.write_max_budget_change_pct, NEW.write_max_daily_budget_usd,
        NEW.write_requests_per_day, NEW.write_pending_ttl_minutes, NEW.write_approval_ttl_minutes)
       IS NOT DISTINCT FROM
       (OLD.writes_enabled, OLD.write_approver_team_member_ids, OLD.write_max_budget_change_pct, OLD.write_max_daily_budget_usd,
        OLD.write_requests_per_day, OLD.write_pending_ttl_minutes, OLD.write_approval_ttl_minutes) THEN RETURN NEW; END IF;
    v_what := 'write settings changed; writes_enabled=' || NEW.writes_enabled::text;
  ELSE
    IF ('write' = ANY(COALESCE(NEW.scopes, '{}'))) IS NOT DISTINCT FROM
       (TG_OP = 'UPDATE' AND 'write' = ANY(COALESCE(OLD.scopes, '{}'))) THEN RETURN NEW; END IF;
    v_what := CASE WHEN 'write' = ANY(COALESCE(NEW.scopes, '{}')) THEN 'write scope added to grant ' ELSE 'write scope removed from grant ' END || NEW.id::text;
  END IF;
  INSERT INTO agent_access_log (scope, event_type, outcome, detail, admin_team_member_id, subject_table)
    VALUES ('write', 'admin', 'write_control_changed', v_what || CASE WHEN v_who IS NULL THEN ' (no signed-in user)' ELSE '' END, v_who, TG_TABLE_NAME);
  INSERT INTO notifications (recipient_id, type, title, message)
    VALUES (v_owner, 'agent_write_control', 'Agent change controls modified', v_what);
  RETURN NEW;
END $$;
CREATE TRIGGER agent_gateway_settings_write_alert AFTER UPDATE ON public.agent_gateway_settings
  FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_write_change_alert();
CREATE TRIGGER agent_grants_write_alert AFTER INSERT OR UPDATE ON public.agent_grants
  FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_write_change_alert();

ALTER TABLE public.agent_gateway_settings ENABLE ALWAYS TRIGGER agent_gateway_settings_write_lock;
ALTER TABLE public.agent_gateway_settings ENABLE ALWAYS TRIGGER agent_gateway_settings_write_alert;
ALTER TABLE public.agent_grants ENABLE ALWAYS TRIGGER agent_grant_write_scope_lock;
ALTER TABLE public.agent_grants ENABLE ALWAYS TRIGGER agent_grants_write_alert;