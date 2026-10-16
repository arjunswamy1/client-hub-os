-- Key creator can no longer be supplied by a caller without a signed-in user (service role / cron / maintenance are refused),
-- creator immutable for every role, keys on or moved off write agents are write-owner-managed,
-- and giving a grant write scope requires a server-side owner confirmation that matches the agent's current owner.

CREATE OR REPLACE FUNCTION public.agent_gateway_token_write_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.get_team_member_id(auth.uid()); v_owner uuid := public.agent_gateway_write_owner();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_me IS NULL THEN RAISE EXCEPTION 'a gateway key can only be created by a signed-in team member'; END IF;
    NEW.created_by_id := v_me;
    IF public.agent_has_write_grant(NEW.agent_id) AND v_me IS DISTINCT FROM v_owner THEN
      RAISE EXCEPTION 'only the write owner may create keys for an agent with write access';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.created_by_id IS DISTINCT FROM OLD.created_by_id THEN RAISE EXCEPTION 'a gateway key''s creator cannot be changed'; END IF;
  IF (public.agent_has_write_grant(NEW.agent_id) OR public.agent_has_write_grant(OLD.agent_id))
     AND (NEW.token_hash IS DISTINCT FROM OLD.token_hash
          OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
          OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
          OR NEW.expires_at > OLD.expires_at)
     AND v_me IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'only the write owner may rotate, move or reactivate keys for an agent with write access';
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE public.agent_gateway_tokens ENABLE ALWAYS TRIGGER agent_gateway_token_write_lock;

CREATE OR REPLACE FUNCTION public.agent_grant_write_scope_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new boolean := 'write' = ANY(COALESCE(NEW.scopes, '{}')) AND NEW.revoked_at IS NULL;
        v_old boolean := TG_OP = 'UPDATE' AND 'write' = ANY(COALESCE(OLD.scopes, '{}')) AND OLD.revoked_at IS NULL;
        v_cur uuid; v_conf text := nullif(current_setting('cpm.write_grant_confirmed_owner', true), '');
BEGIN
  IF v_new AND NOT v_old THEN
    IF public.get_team_member_id(auth.uid()) IS DISTINCT FROM public.agent_gateway_write_owner() THEN
      RAISE EXCEPTION 'only the write owner may give a grant write scope';
    END IF;
    SELECT owner_team_member_id INTO v_cur FROM agents WHERE id = NEW.agent_id;
    IF v_cur IS NULL THEN RAISE EXCEPTION 'an agent with no owner cannot be given write scope'; END IF;
    IF v_conf IS NULL OR v_conf::uuid IS DISTINCT FROM v_cur THEN
      RAISE EXCEPTION 'write scope needs a confirmed owner matching the agent''s current owner (use grant_agent_write_scope)';
    END IF;
  END IF;
  IF v_old AND NOT v_new THEN
    NEW.write_scope_removed_at := now();
    NEW.write_scope_removed_owner_id := (SELECT owner_team_member_id FROM agents WHERE id = NEW.agent_id);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.grant_agent_write_scope(p_grant_id uuid, p_confirmed_owner_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  IF p_confirmed_owner_id IS NULL THEN RAISE EXCEPTION 'confirmed_owner_id is required'; END IF;
  PERFORM set_config('cpm.write_grant_confirmed_owner', p_confirmed_owner_id::text, true);
  UPDATE agent_grants SET scopes = (SELECT array_agg(DISTINCT s) FROM unnest(COALESCE(scopes, '{}') || '{write}'::text[]) s), revoked_at = NULL
    WHERE id = p_grant_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('cpm.write_grant_confirmed_owner', '', true);
  IF v_n = 0 THEN RAISE EXCEPTION 'grant not found'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.grant_agent_write_scope(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_agent_write_scope(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.grant_agent_write_scope(uuid, uuid) IS 'Only path that gives a grant write scope; caller names the confirmed current owner.';