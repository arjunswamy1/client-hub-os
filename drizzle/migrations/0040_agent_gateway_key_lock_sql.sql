-- Gateway key lock: only the write owner may create, rotate, re-point or reactivate keys for agents with write access
-- (all roles, replica sessions included). Every key records its creator; write requests snapshot the key and its creator,
-- and the key's creator may not decide the request. Grant deletes and write-scope removals alert like additions,
-- and owner changes are recorded so a re-grant can show them. (0039 was an accidental no-op; this is the substance.)

COMMENT ON COLUMN public.agent_gateway_tokens.created_by_id IS 'Team member who created the key; set from the signed-in user on insert and never changed.';
UPDATE public.agent_gateway_tokens t SET created_by_id = a.created_by_id
  FROM public.agents a WHERE a.id = t.agent_id AND t.created_by_id IS NULL AND a.created_by_id IS NOT NULL;
ALTER TABLE public.agent_gateway_tokens ADD CONSTRAINT agent_gateway_tokens_created_by_required CHECK (created_by_id IS NOT NULL) NOT VALID;

CREATE OR REPLACE FUNCTION public.agent_has_write_grant(p_agent uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM agent_grants g WHERE g.agent_id = p_agent AND g.revoked_at IS NULL AND 'write' = ANY(COALESCE(g.scopes, '{}')))
$$;
REVOKE ALL ON FUNCTION public.agent_has_write_grant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_has_write_grant(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.agent_gateway_token_write_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.get_team_member_id(auth.uid()); v_owner uuid := public.agent_gateway_write_owner();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_me IS NOT NULL THEN NEW.created_by_id := v_me; END IF;
    IF NEW.created_by_id IS NULL THEN RAISE EXCEPTION 'a gateway key must record who created it'; END IF;
    IF public.agent_has_write_grant(NEW.agent_id) AND v_me IS DISTINCT FROM v_owner THEN
      RAISE EXCEPTION 'only the write owner may create keys for an agent with write access';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.created_by_id IS DISTINCT FROM OLD.created_by_id THEN RAISE EXCEPTION 'a gateway key''s creator cannot be changed'; END IF;
  IF public.agent_has_write_grant(NEW.agent_id)
     AND (NEW.token_hash IS DISTINCT FROM OLD.token_hash
          OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
          OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
          OR NEW.expires_at > OLD.expires_at)
     AND v_me IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'only the write owner may rotate, move or reactivate keys for an agent with write access';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agent_gateway_token_write_lock ON public.agent_gateway_tokens;
CREATE TRIGGER agent_gateway_token_write_lock BEFORE INSERT OR UPDATE ON public.agent_gateway_tokens
  FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_token_write_lock();
ALTER TABLE public.agent_gateway_tokens ENABLE ALWAYS TRIGGER agent_gateway_token_write_lock;

ALTER TABLE public.agent_write_requests ADD COLUMN IF NOT EXISTS token_id uuid;
ALTER TABLE public.agent_write_requests ADD COLUMN IF NOT EXISTS token_created_by_id uuid;
COMMENT ON COLUMN public.agent_write_requests.token_id IS 'Gateway key the request arrived on.';
COMMENT ON COLUMN public.agent_write_requests.token_created_by_id IS 'Creator of that key at request creation; that person may not decide the request.';

CREATE OR REPLACE FUNCTION public.agent_write_request_create(p_row jsonb, p_per_day integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_agent uuid := (p_row->>'agent_id')::uuid; v_count integer; v_open record; v_id uuid; v_owner uuid;
        v_tok uuid := nullif(p_row->>'token_id', '')::uuid; v_tok_creator uuid;
BEGIN
  SELECT created_by_id INTO v_tok_creator FROM agent_gateway_tokens WHERE id = v_tok AND agent_id = v_agent;
  IF v_tok IS NULL OR v_tok_creator IS NULL THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_unknown_key'); END IF;
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
  INSERT INTO agent_write_requests (agent_id, agent_owner_team_member_id, token_id, token_created_by_id, grant_id, integration_id, action, account_id, account_name, currency,
    object_type, object_id, object_name, before, after, diff_text, reason, requested_at, decision_expires_at)
  VALUES (v_agent, v_owner, v_tok, v_tok_creator, (p_row->>'grant_id')::uuid, (p_row->>'integration_id')::uuid, p_row->>'action', p_row->>'account_id',
    p_row->>'account_name', p_row->>'currency', p_row->>'object_type', p_row->>'object_id', p_row->>'object_name',
    p_row->'before', p_row->'after', p_row->>'diff_text', p_row->>'reason', now(), (p_row->>'decision_expires_at')::timestamptz)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'id', v_id, 'token_created_by_id', v_tok_creator);
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
  v_owner := r.agent_owner_team_member_id;
  IF v_owner IS NULL AND p_approve THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_ownerless_agent'); END IF;
  IF v_owner = v_me AND v_me IS DISTINCT FROM public.agent_gateway_write_owner() THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_self_approval'); END IF;
  IF r.token_created_by_id = v_me THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_key_creator'); END IF;
  IF r.token_created_by_id IS NULL AND p_approve THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_unknown_key'); END IF;
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

ALTER TABLE public.agent_grants ADD COLUMN IF NOT EXISTS write_scope_removed_at timestamptz;
ALTER TABLE public.agent_grants ADD COLUMN IF NOT EXISTS write_scope_removed_owner_id uuid;
COMMENT ON COLUMN public.agent_grants.write_scope_removed_at IS 'When this grant last stopped holding write scope.';
COMMENT ON COLUMN public.agent_grants.write_scope_removed_owner_id IS 'Agent owner at that moment.';

CREATE OR REPLACE FUNCTION public.agent_grant_write_scope_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new boolean := 'write' = ANY(COALESCE(NEW.scopes, '{}')) AND NEW.revoked_at IS NULL;
        v_old boolean := TG_OP = 'UPDATE' AND 'write' = ANY(COALESCE(OLD.scopes, '{}')) AND OLD.revoked_at IS NULL;
BEGIN
  IF v_new AND NOT v_old AND public.get_team_member_id(auth.uid()) IS DISTINCT FROM public.agent_gateway_write_owner() THEN
    RAISE EXCEPTION 'only the write owner may give a grant write scope';
  END IF;
  IF v_old AND NOT v_new THEN
    NEW.write_scope_removed_at := now();
    NEW.write_scope_removed_owner_id := (SELECT owner_team_member_id FROM agents WHERE id = NEW.agent_id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.agent_gateway_write_change_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid := public.agent_gateway_write_owner(); v_who uuid := public.get_team_member_id(auth.uid()); v_what text;
        v_new boolean; v_old boolean; v_agent uuid; v_grant uuid;
BEGIN
  IF TG_TABLE_NAME = 'agent_gateway_settings' THEN
    IF (NEW.writes_enabled, NEW.write_approver_team_member_ids, NEW.write_max_budget_change_pct, NEW.write_max_daily_budget_usd,
        NEW.write_requests_per_day, NEW.write_pending_ttl_minutes, NEW.write_approval_ttl_minutes)
       IS NOT DISTINCT FROM
       (OLD.writes_enabled, OLD.write_approver_team_member_ids, OLD.write_max_budget_change_pct, OLD.write_max_daily_budget_usd,
        OLD.write_requests_per_day, OLD.write_pending_ttl_minutes, OLD.write_approval_ttl_minutes) THEN RETURN NULL; END IF;
    v_what := 'write settings changed; writes_enabled=' || NEW.writes_enabled::text;
  ELSIF TG_OP = 'DELETE' THEN
    v_agent := OLD.agent_id;
    v_what := CASE WHEN 'write' = ANY(COALESCE(OLD.scopes, '{}')) AND OLD.revoked_at IS NULL
                   THEN 'write scope removed: grant deleted ' ELSE 'grant deleted ' END || OLD.id::text;
  ELSE
    v_new := 'write' = ANY(COALESCE(NEW.scopes, '{}')) AND NEW.revoked_at IS NULL;
    v_old := TG_OP = 'UPDATE' AND 'write' = ANY(COALESCE(OLD.scopes, '{}')) AND OLD.revoked_at IS NULL;
    IF v_new = v_old THEN RETURN NULL; END IF;
    v_agent := NEW.agent_id; v_grant := NEW.id;
    v_what := CASE WHEN v_new THEN 'write scope added to grant ' ELSE 'write scope removed from grant ' END || NEW.id::text;
  END IF;
  INSERT INTO agent_access_log (scope, event_type, outcome, detail, admin_team_member_id, subject_table, agent_id, grant_id)
    VALUES ('write', 'admin', 'write_control_changed', v_what || CASE WHEN v_who IS NULL THEN ' (no signed-in user)' ELSE '' END, v_who, TG_TABLE_NAME,
            v_agent, v_grant);
  INSERT INTO notifications (recipient_id, type, title, message)
    VALUES (v_owner, 'agent_write_control', 'Agent change controls modified', v_what);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS agent_grants_write_alert ON public.agent_grants;
CREATE TRIGGER agent_grants_write_alert AFTER INSERT OR UPDATE OR DELETE ON public.agent_grants
  FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_write_change_alert();
ALTER TABLE public.agent_grants ENABLE ALWAYS TRIGGER agent_grants_write_alert;

CREATE TABLE IF NOT EXISTS public.agent_owner_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  old_owner_team_member_id uuid,
  new_owner_team_member_id uuid,
  changed_by_team_member_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_owner_history_agent_idx ON public.agent_owner_history (agent_id, changed_at);
GRANT SELECT ON public.agent_owner_history TO authenticated;
GRANT ALL ON public.agent_owner_history TO service_role;
ALTER TABLE public.agent_owner_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read agent owner history" ON public.agent_owner_history FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.agent_owner_history_record() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_team_member_id IS DISTINCT FROM OLD.owner_team_member_id THEN
    INSERT INTO agent_owner_history (agent_id, old_owner_team_member_id, new_owner_team_member_id, changed_by_team_member_id)
      VALUES (NEW.id, OLD.owner_team_member_id, NEW.owner_team_member_id, public.get_team_member_id(auth.uid()));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS agent_owner_history_record ON public.agents;
CREATE TRIGGER agent_owner_history_record AFTER UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.agent_owner_history_record();
ALTER TABLE public.agents ENABLE ALWAYS TRIGGER agent_owner_history_record;