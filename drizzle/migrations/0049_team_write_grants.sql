-- Migration 0049: team write grants (Option B allowlist), v2.2 2026-10-23 (rebased on live after the
-- 'Allow all changes' build: keeps write_by_default inheritance verbatim; adds agent_write_arm_blocker to the non-AJ path).
-- QA-cleared by CPM Build QA and approved by AJ on Oct 23, 2026. Transaction is managed by the Lovable migration tool.
-- AJ declined the two-person confirm and the 24h veto: an allowlisted non-AJ granter's write takes effect immediately.
-- Tested on local scratch Postgres 17 (team-grants tests 74/74; repo db-tests 105/105 + checks) before apply.
-- Unchanged on purpose (QA item 8): agent_gateway_write_owner(), agent_gateway_token_write_lock(),
--   agent_gateway_settings_write_lock(), agent_owner_write_lock(), agent_gateway_write_change_alert().
-- PREREQUISITE (QA item 7, AJ manual step, no code): before ANY agent is given write under this
--   migration, AJ revokes and re-mints every agent_gateway_tokens key minted before migration 0040
--   (their created_by_id values were backfilled and cannot be trusted for decide_agent_write_request).

-- 1. Audit columns on agent_grants (set by trigger only, never client-supplied)
ALTER TABLE public.agent_grants
  ADD COLUMN IF NOT EXISTS write_granted_by_id   uuid REFERENCES public.team_members(id),
  ADD COLUMN IF NOT EXISTS write_granted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS write_reason          text;

-- 2. Append-only audit table
CREATE TABLE public.agent_grant_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  grant_id uuid, agent_id uuid, request_id uuid,
  scopes_before text[], scopes_after text[],
  allowed_refs_before text[], allowed_refs_after text[],
  expires_before timestamptz, expires_after timestamptz,
  actor_team_member_id uuid, actor_db_role text NOT NULL DEFAULT current_user,
  confirmed_owner_id uuid, subject_team_member_id uuid,
  reason text, detail jsonb
);
ALTER TABLE public.agent_grant_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read grant audit" ON public.agent_grant_audit FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
REVOKE ALL ON public.agent_grant_audit FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.agent_grant_audit TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.agent_grant_audit_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.agent_grant_audit_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'agent_grant_audit is append-only (% blocked)', TG_OP; END $$;
CREATE TRIGGER agent_grant_audit_no_update BEFORE UPDATE OR DELETE ON public.agent_grant_audit
  FOR EACH ROW EXECUTE FUNCTION public.agent_grant_audit_append_only();
CREATE TRIGGER agent_grant_audit_no_truncate BEFORE TRUNCATE ON public.agent_grant_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent_grant_audit_append_only();
ALTER TABLE public.agent_grant_audit ENABLE ALWAYS TRIGGER agent_grant_audit_no_update, ENABLE ALWAYS TRIGGER agent_grant_audit_no_truncate;

-- Row audit of agent_grants
CREATE FUNCTION public.agent_grants_row_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO agent_grant_audit (action, grant_id, agent_id, scopes_before, scopes_after, allowed_refs_before, allowed_refs_after,
                                 expires_before, expires_after, actor_team_member_id, reason)
  VALUES ('grant_' || lower(TG_OP),
          COALESCE(NEW.id, OLD.id), COALESCE(NEW.agent_id, OLD.agent_id),
          CASE WHEN TG_OP <> 'INSERT' THEN OLD.scopes END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.scopes END,
          CASE WHEN TG_OP <> 'INSERT' THEN OLD.allowed_account_refs END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.allowed_account_refs END,
          CASE WHEN TG_OP <> 'INSERT' THEN OLD.expires_at END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.expires_at END,
          get_team_member_id(auth.uid()),
          CASE WHEN TG_OP <> 'DELETE' THEN NEW.write_reason END);
  RETURN NULL;
END $$;
CREATE TRIGGER agent_grants_row_audit AFTER INSERT OR UPDATE OR DELETE ON public.agent_grants
  FOR EACH ROW EXECUTE FUNCTION public.agent_grants_row_audit();
ALTER TABLE public.agent_grants ENABLE ALWAYS TRIGGER agent_grants_row_audit;

-- 3. Allowlist (QA item 4)
CREATE TABLE public.agent_write_granters (
  team_member_id uuid PRIMARY KEY REFERENCES public.team_members(id),
  added_by uuid REFERENCES public.team_members(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  note text
);
ALTER TABLE public.agent_write_granters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read write granters" ON public.agent_write_granters FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
REVOKE ALL ON public.agent_write_granters FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.agent_write_granters TO authenticated;

-- Guard: only AJ edits; every add/remove audited and AJ notified.
CREATE FUNCTION public.agent_write_granters_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_me uuid := get_team_member_id(auth.uid()); v_subj uuid;
BEGIN
  IF v_me IS DISTINCT FROM agent_gateway_write_owner() THEN
    RAISE EXCEPTION 'only the write owner may edit the write-granter allowlist';
  END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'allowlist rows are not updatable; remove and re-add'; END IF;
  IF TG_OP = 'INSERT' THEN NEW.added_by := v_me; NEW.added_at := now(); v_subj := NEW.team_member_id;
  ELSE v_subj := OLD.team_member_id; END IF;
  INSERT INTO agent_grant_audit (action, actor_team_member_id, subject_team_member_id, reason)
    VALUES ('granter_' || CASE WHEN TG_OP = 'INSERT' THEN 'added' ELSE 'removed' END, v_me, v_subj,
            CASE WHEN TG_OP = 'INSERT' THEN NEW.note END);
  INSERT INTO notifications (recipient_id, type, title, message)
    VALUES (agent_gateway_write_owner(), 'agent_write_control', 'Write-granter allowlist changed',
            'team member ' || v_subj::text || CASE WHEN TG_OP = 'INSERT' THEN ' added to' ELSE ' removed from' END || ' the write-granter allowlist');
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_write_granters_guard BEFORE INSERT OR UPDATE OR DELETE ON public.agent_write_granters
  FOR EACH ROW EXECUTE FUNCTION public.agent_write_granters_guard();
CREATE TRIGGER agent_write_granters_no_truncate BEFORE TRUNCATE ON public.agent_write_granters
  FOR EACH STATEMENT EXECUTE FUNCTION public.agent_grant_audit_append_only();
ALTER TABLE public.agent_write_granters ENABLE ALWAYS TRIGGER agent_write_granters_guard, ENABLE ALWAYS TRIGGER agent_write_granters_no_truncate;

-- Seed (AJ, Charles, Juan, Belen). The guard is disabled only for this one statement inside the
-- migration transaction (no GUC bypass exists), then the seed is audited and AJ notified explicitly.
ALTER TABLE public.agent_write_granters DISABLE TRIGGER agent_write_granters_guard;
INSERT INTO public.agent_write_granters (team_member_id, note)
SELECT id, 'seed (migration)' FROM public.team_members WHERE id IN
  ('1fdd684e-6cb7-447e-b616-7e1b9c598971','014fa04a-80a5-41ce-9368-d1a81f6d2eec',
   '004cb16a-4a2b-4bef-9724-69655d901530','5a374007-f692-4dc4-9d27-205645386586');
ALTER TABLE public.agent_write_granters ENABLE ALWAYS TRIGGER agent_write_granters_guard;
INSERT INTO public.agent_grant_audit (action, subject_team_member_id, reason)
  SELECT 'granter_added', team_member_id, 'seed (migration)' FROM public.agent_write_granters;
INSERT INTO public.notifications (recipient_id, type, title, message)
  VALUES (public.agent_gateway_write_owner(), 'agent_write_control', 'Write-granter allowlist created',
          'seeded with ' || (SELECT count(*) FROM public.agent_write_granters) || ' members by migration');

-- Inactive members ignored automatically (joins team_members.is_active).
CREATE FUNCTION public.is_write_granter(p_tm uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_tm IS NOT NULL AND EXISTS (SELECT 1 FROM agent_write_granters w JOIN team_members t ON t.id = w.team_member_id
                                      WHERE w.team_member_id = p_tm AND t.is_active) $$;

-- 4. Revised lock trigger. AJ branch keeps the old behaviour. Non-AJ branch: active allowlisted granter,
--    not the agent owner, confirmed owner = live owner, expiry within 90 days. Enforced HERE (not only in
--    the RPC), so forging the confirmed-owner GUC on a direct UPDATE gains nothing the RPC wouldn't allow.
CREATE OR REPLACE FUNCTION public.agent_grant_write_scope_lock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_new boolean; v_old boolean;
        v_me uuid := get_team_member_id(auth.uid()); v_aj uuid := agent_gateway_write_owner();
        v_cur uuid; v_conf text := nullif(current_setting('cpm.write_grant_confirmed_owner', true), '');
        v_ag public.agents%ROWTYPE; v_inherit boolean := false; v_block text;
BEGIN
  -- audit columns are never client-writable
  IF TG_OP = 'INSERT' THEN
    NEW.write_granted_by_id := NULL; NEW.write_granted_at := NULL; NEW.write_reason := NULL;
  ELSE
    NEW.write_granted_by_id := OLD.write_granted_by_id; NEW.write_granted_at := OLD.write_granted_at; NEW.write_reason := OLD.write_reason;
  END IF;

  -- write_by_default inheritance: copied VERBATIM from live (migration 0047-0049, 'Allow all changes' build)
  IF TG_OP = 'INSERT' AND NEW.revoked_at IS NULL THEN
    SELECT * INTO v_ag FROM agents WHERE id = NEW.agent_id;
    IF FOUND AND v_ag.write_by_default
       AND v_ag.write_default_set_by = public.agent_gateway_write_owner()
       AND v_ag.owner_team_member_id IS NOT NULL AND v_ag.owner_team_member_id = v_ag.write_default_confirmed_owner_id
       AND v_ag.status = 'active'
       AND public.agent_write_arm_blocker(NEW.agent_id) IS NULL
       AND (NOT COALESCE(NEW.all_accounts, false) OR v_ag.write_default_all_accounts_confirmed)
       AND EXISTS (SELECT 1 FROM integrations WHERE id = NEW.integration_id AND provider = 'meta_ads') THEN
      v_inherit := true;
      NEW.scopes := (SELECT array_agg(DISTINCT s) FROM unnest(COALESCE(NEW.scopes, '{}') || '{write}'::text[]) s);
      IF NEW.expires_at IS NULL OR NEW.expires_at > now() + interval '90 days' THEN NEW.expires_at := now() + interval '90 days'; END IF;
      INSERT INTO notifications(recipient_id,type,title,message) VALUES(public.agent_gateway_write_owner(),'agent_write_inherited','New permission got changes automatically',
        'Agent '||v_ag.name||': permission '||NEW.id::text||' can now request changes (each still needs approval). Expires '||to_char(NEW.expires_at,'YYYY-MM-DD')||'.');
      INSERT INTO agent_access_log(scope,event_type,outcome,detail,subject_table,agent_id,grant_id,connection_id) VALUES('write','admin','write_scope_inherited','expires_at='||NEW.expires_at::text,'agent_grants',NEW.agent_id,NEW.id,NEW.integration_id);
      -- NEW (team grants): inherited write is attributed to the write owner who set write_by_default
      NEW.write_granted_by_id := v_ag.write_default_set_by; NEW.write_granted_at := now(); NEW.write_reason := 'inherited (write_by_default)';
    END IF;
  END IF;
  v_new := 'write' = ANY(COALESCE(NEW.scopes, '{}')) AND NEW.revoked_at IS NULL;
  v_old := TG_OP = 'UPDATE' AND 'write' = ANY(COALESCE(OLD.scopes, '{}')) AND OLD.revoked_at IS NULL;

  IF v_new AND NOT v_old AND NOT v_inherit THEN
    IF v_me IS NULL OR (v_me <> v_aj AND NOT is_write_granter(v_me)) THEN
      RAISE EXCEPTION 'only the write owner or an active allowlisted granter may give a grant write scope';
    END IF;
    SELECT owner_team_member_id INTO v_cur FROM agents WHERE id = NEW.agent_id;
    IF v_cur IS NULL THEN RAISE EXCEPTION 'an agent with no owner cannot be given write scope'; END IF;
    IF v_conf IS NULL OR v_conf::uuid IS DISTINCT FROM v_cur THEN
      RAISE EXCEPTION 'write scope needs a confirmed owner matching the agent''s current owner (use grant_agent_write_scope)';
    END IF;
    IF v_me <> v_aj THEN
      IF v_cur = v_me THEN RAISE EXCEPTION 'self-grant denied: you own this agent'; END IF;
      v_block := agent_write_arm_blocker(NEW.agent_id);   -- pre-0040 or leaked active keys block non-AJ arming
      IF v_block IS NOT NULL THEN RAISE EXCEPTION '%', v_block; END IF;
      IF NEW.expires_at IS NULL OR NEW.expires_at > now() + interval '90 days' OR NEW.expires_at <= now() THEN
        RAISE EXCEPTION 'a non-owner write grant needs expires_at within 90 days';
      END IF;
    END IF;
    NEW.write_granted_by_id := v_me; NEW.write_granted_at := now();
    NEW.write_reason := left(nullif(current_setting('cpm.write_grant_reason', true), ''), 500);
  ELSIF v_new AND v_old AND (v_me IS NULL OR v_me <> v_aj) THEN
    -- non-AJ may not extend a live write grant past 90 days or clear its expiry
    IF NEW.expires_at IS DISTINCT FROM OLD.expires_at
       AND (NEW.expires_at IS NULL OR NEW.expires_at > now() + interval '90 days') THEN
      RAISE EXCEPTION 'only the write owner may set a write grant expiry beyond 90 days';
    END IF;
  END IF;
  IF v_old AND NOT v_new THEN
    NEW.write_scope_removed_at := now();
    NEW.write_scope_removed_owner_id := (SELECT owner_team_member_id FROM agents WHERE id = NEW.agent_id);
  END IF;
  RETURN NEW;
END $function$;

-- 5. grant_agent_write_scope: same 2-arg call still works for AJ (new args default NULL); now SECURITY DEFINER
--    with explicit checks. Non-AJ granters must pass p_expires_at (<= now()+90d) and p_reason; effect is immediate.
--    The live (uuid,uuid) INVOKER version is dropped and replaced (a CREATE OR REPLACE can't change the signature).
DROP FUNCTION public.grant_agent_write_scope(uuid, uuid);
CREATE FUNCTION public.grant_agent_write_scope(p_grant_id uuid, p_confirmed_owner_id uuid,
                                               p_expires_at timestamptz DEFAULT NULL, p_reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_n integer; v_me uuid; v_aj uuid := agent_gateway_write_owner(); g record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in'; END IF;
  v_me := get_team_member_id(auth.uid());
  IF v_me IS NULL THEN RAISE EXCEPTION 'not an active team member'; END IF;
  IF v_me <> v_aj AND NOT is_write_granter(v_me) THEN RAISE EXCEPTION 'not on the write-granter allowlist'; END IF;
  IF p_confirmed_owner_id IS NULL THEN RAISE EXCEPTION 'confirmed_owner_id is required'; END IF;
  SELECT * INTO g FROM agent_grants WHERE id = p_grant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant not found'; END IF;
  IF v_me <> v_aj THEN
    IF p_expires_at IS NULL OR p_expires_at > now() + interval '90 days' OR p_expires_at <= now() THEN
      RAISE EXCEPTION 'a non-owner write grant needs expires_at within 90 days';
    END IF;
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN RAISE EXCEPTION 'reason is required'; END IF;
  END IF;
  PERFORM set_config('cpm.write_grant_confirmed_owner', p_confirmed_owner_id::text, true);
  PERFORM set_config('cpm.write_grant_reason', coalesce(p_reason, ''), true);
  UPDATE agent_grants SET scopes = (SELECT array_agg(DISTINCT s) FROM unnest(COALESCE(scopes, '{}') || '{write}'::text[]) s), revoked_at = NULL,
         expires_at = COALESCE(p_expires_at, expires_at)
    WHERE id = p_grant_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('cpm.write_grant_confirmed_owner', '', true);
  PERFORM set_config('cpm.write_grant_reason', '', true);
  IF v_n = 0 THEN RAISE EXCEPTION 'grant not found'; END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

-- AJ allowlist RPCs (the guard trigger is the real enforcement)
CREATE FUNCTION public.add_write_granter(p_team_member_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR get_team_member_id(auth.uid()) IS NULL THEN RAISE EXCEPTION 'not an active signed-in team member'; END IF;
  INSERT INTO agent_write_granters (team_member_id, note) VALUES (p_team_member_id, p_note);
  RETURN jsonb_build_object('ok', true);
END $$;
CREATE FUNCTION public.remove_write_granter(p_team_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR get_team_member_id(auth.uid()) IS NULL THEN RAISE EXCEPTION 'not an active signed-in team member'; END IF;
  DELETE FROM agent_write_granters WHERE team_member_id = p_team_member_id;
  RETURN jsonb_build_object('ok', true);
END $$;

-- 7. Separation of duties in decide_agent_write_request (QA item 2). Approver list (settings) unchanged = AJ + Charles.
CREATE OR REPLACE FUNCTION public.decide_agent_write_request(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_me uuid; s record; r record; v_owner uuid;
BEGIN
  -- no session keeps the existing outcome code (gateway/UI and the repo suite expect not_write_approver)
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'outcome', 'not_write_approver'); END IF;
  v_me := public.get_team_member_id(auth.uid());
  SELECT * INTO s FROM agent_gateway_settings WHERE id = 1;
  IF v_me IS NULL OR NOT (v_me = ANY(COALESCE(s.write_approver_team_member_ids, '{}'))) THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'not_write_approver');
  END IF;
  SELECT * INTO r FROM agent_write_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'outcome', 'not_found'); END IF;
  v_owner := r.agent_owner_team_member_id;
  IF v_owner IS NULL AND p_approve THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_ownerless_agent'); END IF;
  IF v_owner = v_me AND v_me IS DISTINCT FROM public.agent_gateway_write_owner() THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_self_approval'); END IF;
  IF r.token_created_by_id = v_me AND v_me IS DISTINCT FROM public.agent_gateway_write_owner() THEN RETURN jsonb_build_object('ok', false, 'outcome', 'denied_key_creator'); END IF;
  -- NEW: whoever granted write on this agent may not approve its requests. AJ exempt, as above.
  IF p_approve AND v_me IS DISTINCT FROM public.agent_gateway_write_owner() AND EXISTS (
       SELECT 1 FROM agent_grants g WHERE g.agent_id = r.agent_id AND g.write_granted_by_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'denied_granter_approval');
  END IF;
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
END $function$;

-- 8. EXECUTE grants (QA item 3)
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.grant_agent_write_scope(uuid,uuid,timestamptz,text)', 'public.add_write_granter(uuid,text)', 'public.remove_write_granter(uuid)',
    'public.decide_agent_write_request(uuid,boolean,text)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.is_write_granter(uuid)', 'public.agent_grants_row_audit()',
    'public.agent_write_granters_guard()', 'public.agent_grant_audit_append_only()'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;

-- 9. DDL watch (QA item 6). Lovable Cloud runs supautils, which lets the non-superuser `postgres`
--    role create event triggers (they are skipped for superuser sessions). Created LAST so this
--    migration doesn't alert on itself. If CREATE EVENT TRIGGER is refused on apply, drop section 9
--    and use the CI check in notes.md instead.
CREATE FUNCTION public.agent_lock_ddl_watch() RETURNS event_trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c record; v_hit text[] := '{}';
  v_watch text[] := ARRAY['agent_grant_write_scope_lock','grant_agent_write_scope','agent_gateway_write_owner',
    'agent_gateway_token_write_lock','agent_gateway_settings_write_lock','agent_owner_write_lock','agent_write_granters_guard',
    'agent_grant_audit_append_only','agent_grants_row_audit','decide_agent_write_request','is_write_granter',
    'grant_agent_write_scope_all','agent_write_arm_blocker','agent_write_default_lock','agent_gateway_token_leak_lock',
    'agent_write_granters','agent_grant_audit','agent_grants','agent_gateway_tokens','agent_gateway_settings','agents'];
BEGIN
  IF TG_EVENT = 'sql_drop' THEN
    FOR c IN SELECT object_type, object_identity FROM pg_event_trigger_dropped_objects() LOOP
      IF EXISTS (SELECT 1 FROM unnest(v_watch) w WHERE c.object_identity ~ ('(^|[ .])' || w || '([ (]|$)')) THEN
        v_hit := v_hit || (c.object_type || ' ' || c.object_identity);
      END IF;
    END LOOP;
  ELSE
    FOR c IN SELECT command_tag, object_type, object_identity FROM pg_event_trigger_ddl_commands() LOOP
      IF EXISTS (SELECT 1 FROM unnest(v_watch) w WHERE c.object_identity ~ ('(^|[ .])' || w || '([ (]|$)')) THEN
        v_hit := v_hit || (c.command_tag || ' ' || c.object_identity);
      END IF;
    END LOOP;
  END IF;
  IF cardinality(v_hit) > 0 THEN
    INSERT INTO agent_grant_audit (action, actor_team_member_id, detail)
      VALUES ('ddl_' || lower(TG_EVENT), get_team_member_id(auth.uid()),
              jsonb_build_object('tag', TG_TAG, 'objects', to_jsonb(v_hit), 'session_user', session_user));
    INSERT INTO notifications (recipient_id, type, title, message)
      VALUES (agent_gateway_write_owner(), 'agent_write_control', 'Agent write lock DDL changed',
              TG_TAG || ': ' || array_to_string(v_hit, ', '));
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.agent_lock_ddl_watch() FROM PUBLIC, anon, authenticated, service_role;
CREATE EVENT TRIGGER agent_lock_ddl_watch_end ON ddl_command_end EXECUTE FUNCTION public.agent_lock_ddl_watch();
CREATE EVENT TRIGGER agent_lock_ddl_watch_drop ON sql_drop EXECUTE FUNCTION public.agent_lock_ddl_watch();
