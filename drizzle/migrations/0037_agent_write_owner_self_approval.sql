-- AJ decision 2026-10-15: the write owner may approve his own bots' requests (Charles is backup). Other approvers still may not approve their own bots.
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