-- 0048: 'Allow all changes' per agent. Deployed inactive: nothing is armed, no grant gains write.
-- Keys: leaked flag, settable only by admins (ALWAYS trigger).
ALTER TABLE public.agent_gateway_tokens ADD COLUMN IF NOT EXISTS leaked boolean NOT NULL DEFAULT false;
ALTER TABLE public.agent_gateway_tokens ADD COLUMN IF NOT EXISTS leaked_marked_by uuid;
ALTER TABLE public.agent_gateway_tokens ADD COLUMN IF NOT EXISTS leaked_marked_at timestamptz;
CREATE OR REPLACE FUNCTION public.agent_gateway_token_leak_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.leaked) OR (TG_OP='UPDATE' AND NEW.leaked IS DISTINCT FROM OLD.leaked) THEN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'denied_leaked_flag_admin'; END IF;
  NEW.leaked_marked_by := public.get_team_member_id(auth.uid()); NEW.leaked_marked_at := now();
 ELSIF TG_OP='INSERT' THEN NEW.leaked_marked_by := NULL; NEW.leaked_marked_at := NULL;
 ELSE NEW.leaked_marked_by := OLD.leaked_marked_by; NEW.leaked_marked_at := OLD.leaked_marked_at;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_gateway_token_leak_lock BEFORE INSERT OR UPDATE ON public.agent_gateway_tokens FOR EACH ROW EXECUTE FUNCTION public.agent_gateway_token_leak_lock();
ALTER TABLE public.agent_gateway_tokens ENABLE ALWAYS TRIGGER agent_gateway_token_leak_lock;

-- Keys made before migration 0040 (creator attribution was backfilled) or flagged leaked block arming.
CREATE OR REPLACE FUNCTION public.agent_key_lock_cutoff() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ SELECT '2026-10-15 23:14:09.016+00'::timestamptz $$;
CREATE OR REPLACE FUNCTION public.agent_write_arm_blocker(p_agent_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE
  WHEN EXISTS (SELECT 1 FROM agent_gateway_tokens WHERE agent_id=p_agent_id AND revoked_at IS NULL AND expires_at>now() AND created_at<public.agent_key_lock_cutoff()) THEN 'denied_pre_0040_key'
  WHEN EXISTS (SELECT 1 FROM agent_gateway_tokens WHERE agent_id=p_agent_id AND revoked_at IS NULL AND expires_at>now() AND leaked) THEN 'denied_leaked_key'
 END $$;

-- Agents: write_by_default, AJ-only to switch on; any owner change clears it.
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS write_by_default boolean NOT NULL DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS write_default_set_by uuid;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS write_default_set_at timestamptz;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS write_default_confirmed_owner_id uuid;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS write_default_all_accounts_confirmed boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.agent_write_default_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_aj uuid := public.agent_gateway_write_owner(); v_actor uuid := public.get_team_member_id(auth.uid()); v_block text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.owner_team_member_id IS DISTINCT FROM OLD.owner_team_member_id THEN
  IF OLD.write_by_default THEN
   INSERT INTO agent_access_log(scope,event_type,outcome,detail,admin_team_member_id,subject_table,agent_id) VALUES('write','admin','write_default_cleared','owner changed',v_actor,'agents',NEW.id);
   INSERT INTO notifications(recipient_id,type,title,message) VALUES(v_aj,'agent_write_default_changed','Allow all changes switched off','Agent '||NEW.name||': owner changed, so new permissions no longer get changes automatically.');
  END IF;
  NEW.write_by_default:=false; NEW.write_default_set_by:=NULL; NEW.write_default_set_at:=NULL; NEW.write_default_confirmed_owner_id:=NULL; NEW.write_default_all_accounts_confirmed:=false;
  RETURN NEW;
 END IF;
 IF NOT NEW.write_by_default THEN
  IF TG_OP='UPDATE' AND OLD.write_by_default THEN
   INSERT INTO agent_access_log(scope,event_type,outcome,detail,admin_team_member_id,subject_table,agent_id) VALUES('write','admin','write_default_cleared','switched off',v_actor,'agents',NEW.id);
  END IF;
  NEW.write_default_set_by:=NULL; NEW.write_default_set_at:=NULL; NEW.write_default_confirmed_owner_id:=NULL; NEW.write_default_all_accounts_confirmed:=false;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND OLD.write_by_default
    AND NEW.write_default_set_by IS NOT DISTINCT FROM OLD.write_default_set_by AND NEW.write_default_set_at IS NOT DISTINCT FROM OLD.write_default_set_at
    AND NEW.write_default_confirmed_owner_id IS NOT DISTINCT FROM OLD.write_default_confirmed_owner_id
    AND NEW.write_default_all_accounts_confirmed IS NOT DISTINCT FROM OLD.write_default_all_accounts_confirmed THEN
  RETURN NEW;
 END IF;
 IF auth.uid() IS NULL OR v_actor IS DISTINCT FROM v_aj THEN RAISE EXCEPTION 'denied_write_default_owner'; END IF;
 IF NEW.owner_team_member_id IS NULL THEN RAISE EXCEPTION 'denied_ownerless_agent'; END IF;
 IF NEW.write_default_confirmed_owner_id IS DISTINCT FROM NEW.owner_team_member_id THEN RAISE EXCEPTION 'denied_owner_mismatch'; END IF;
 IF NEW.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'denied_agent_not_active'; END IF;
 v_block := public.agent_write_arm_blocker(NEW.id);
 IF v_block IS NOT NULL THEN RAISE EXCEPTION '%', v_block; END IF;
 NEW.write_default_set_by := v_aj; NEW.write_default_set_at := now();
 INSERT INTO agent_access_log(scope,event_type,outcome,detail,admin_team_member_id,subject_table,agent_id) VALUES('write','admin','write_default_set','all_accounts_confirmed='||NEW.write_default_all_accounts_confirmed::text,v_actor,'agents',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER agent_write_default_lock BEFORE INSERT OR UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.agent_write_default_lock();
ALTER TABLE public.agents ENABLE ALWAYS TRIGGER agent_write_default_lock;

-- Per-grant lock: unchanged except one narrow INSERT-only inheritance exception.
CREATE OR REPLACE FUNCTION public.agent_grant_write_scope_lock()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_new boolean; v_old boolean; v_cur uuid; v_conf text := nullif(current_setting('cpm.write_grant_confirmed_owner', true), '');
        v_ag public.agents%ROWTYPE; v_inherit boolean := false;
BEGIN
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
    END IF;
  END IF;
  v_new := 'write' = ANY(COALESCE(NEW.scopes, '{}')) AND NEW.revoked_at IS NULL;
  v_old := TG_OP = 'UPDATE' AND 'write' = ANY(COALESCE(OLD.scopes, '{}')) AND OLD.revoked_at IS NULL;
  IF v_new AND NOT v_old AND NOT v_inherit THEN
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
END $function$;

-- Give every active Meta grant of one agent write scope, all-or-nothing, through the per-grant function.
CREATE OR REPLACE FUNCTION public.grant_agent_write_scope_all(p_agent_id uuid, p_confirmed_owner_id uuid, p_reason text, p_confirm_all_accounts boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE v_ag record; g record; v_granted int := 0; v_skipped int := 0; v_block text;
BEGIN
  IF auth.uid() IS NULL OR public.get_team_member_id(auth.uid()) IS DISTINCT FROM public.agent_gateway_write_owner() THEN RAISE EXCEPTION 'denied_not_write_owner'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT id, owner_team_member_id, status INTO v_ag FROM agents WHERE id = p_agent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_not_found'; END IF;
  IF v_ag.owner_team_member_id IS NULL THEN RAISE EXCEPTION 'denied_ownerless_agent'; END IF;
  IF p_confirmed_owner_id IS DISTINCT FROM v_ag.owner_team_member_id THEN RAISE EXCEPTION 'denied_owner_mismatch'; END IF;
  IF v_ag.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'denied_agent_not_active'; END IF;
  v_block := public.agent_write_arm_blocker(p_agent_id);
  IF v_block IS NOT NULL THEN RAISE EXCEPTION '%', v_block; END IF;
  IF NOT COALESCE(p_confirm_all_accounts, false) AND EXISTS (
    SELECT 1 FROM agent_grants gr JOIN integrations i ON i.id = gr.integration_id
    WHERE gr.agent_id = p_agent_id AND gr.revoked_at IS NULL AND (gr.expires_at IS NULL OR gr.expires_at > now()) AND i.provider = 'meta_ads'
      AND gr.all_accounts AND NOT ('write' = ANY(COALESCE(gr.scopes, '{}')))) THEN
    RAISE EXCEPTION 'denied_all_accounts_unconfirmed';
  END IF;
  FOR g IN SELECT gr.id, gr.scopes FROM agent_grants gr JOIN integrations i ON i.id = gr.integration_id
    WHERE gr.agent_id = p_agent_id AND gr.revoked_at IS NULL AND (gr.expires_at IS NULL OR gr.expires_at > now()) AND i.provider = 'meta_ads'
    ORDER BY gr.created_at FOR UPDATE OF gr LOOP
    IF 'write' = ANY(COALESCE(g.scopes, '{}')) THEN v_skipped := v_skipped + 1;
    ELSE PERFORM public.grant_agent_write_scope(g.id, p_confirmed_owner_id); v_granted := v_granted + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'granted', v_granted, 'skipped', v_skipped);
END $$;

-- Any admin can remove change permission from every grant of an agent and switch off write_by_default.
CREATE OR REPLACE FUNCTION public.revoke_agent_write_scope_all(p_agent_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE v_n int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'denied_not_admin'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE agent_grants SET scopes = array_remove(scopes, 'write') WHERE agent_id = p_agent_id AND 'write' = ANY(COALESCE(scopes, '{}'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE agents SET write_by_default = false WHERE id = p_agent_id AND write_by_default;
  RETURN jsonb_build_object('ok', true, 'revoked', v_n);
END $$;
