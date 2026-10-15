-- Owner-swap fix: snapshot the requesting bot's owner on each write request, approve against the snapshot,
-- and lock owner changes on write-scoped agents to the write owner (all roles, replica sessions included).
ALTER TABLE public.agent_write_requests ADD COLUMN IF NOT EXISTS agent_owner_team_member_id uuid;
COMMENT ON COLUMN public.agent_write_requests.agent_owner_team_member_id IS 'Owner of the requesting agent at request creation; approval rules use this, never the live agents row.';
UPDATE public.agent_write_requests r SET agent_owner_team_member_id = a.owner_team_member_id
  FROM public.agents a WHERE a.id = r.agent_id AND r.agent_owner_team_member_id IS NULL;

CREATE OR REPLACE FUNCTION public.agent_write_request_create(p_row jsonb, p_per_day integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_agent uuid := (p_row->>'agent_id')::uuid; v_count integer; v_open record; v_id uuid; v_owner uuid;
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
  SELECT owner_team_member_id INTO v_owner FROM agents WHERE id = v_agent;
  INSERT INTO agent_write_requests (agent_id, agent_owner_team_member_id, grant_id, integration_id, action, account_id, account_name, currency,
    object_type, object_id, object_name, before, after, diff_text, reason, requested_at, decision_expires_at)
  VALUES (v_agent, v_owner, (p_row->>'grant_id')::uuid, (p_row->>'integration_id')::uuid, p_row->>'action', p_row->>'account_id',
    p_row->>'account_name', p_row->>'currency', p_row->>'object_type', p_row->>'object_id', p_row->>'object_name',
    p_row->'before', p_row->'after', p_row->>'diff_text', p_row->>'reason', now(), (p_row->>'decision_expires_at')::timestamptz)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.agent_write_request_create(jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_write_request_create(jsonb, integer) TO service_role;

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
  v_owner := r.agent_owner_team_member_id;  -- snapshot at creation; never the live agents row
  IF v_owner IS NULL AND p_approve THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_ownerless_agent'); END IF;
  IF v_owner = v_me AND v_me IS DISTINCT FROM public.agent_gateway_write_owner() THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_self_approval'); END IF;
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

CREATE OR REPLACE FUNCTION public.agent_owner_write_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_team_member_id IS DISTINCT FROM OLD.owner_team_member_id
     AND EXISTS (SELECT 1 FROM agent_grants g WHERE g.agent_id = OLD.id AND 'write' = ANY(COALESCE(g.scopes, '{}')))
     AND public.get_team_member_id(auth.uid()) IS DISTINCT FROM public.agent_gateway_write_owner() THEN
    RAISE EXCEPTION 'only the write owner may change the owner of an agent with write access';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agent_owner_write_lock ON public.agents;
CREATE TRIGGER agent_owner_write_lock BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.agent_owner_write_lock();
ALTER TABLE public.agents ENABLE ALWAYS TRIGGER agent_owner_write_lock;
