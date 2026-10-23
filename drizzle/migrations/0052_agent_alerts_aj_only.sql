-- 0052 (draft): hub alerts from 0051 functions go to AJ only (AJ 12:19 PM PT). Only recipient lists change. Existing notification rows untouched.
CREATE OR REPLACE FUNCTION public.agent_alert_outbox_result(p_id bigint, p_ok boolean, p_error text DEFAULT NULL::text, p_ts text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r agent_alert_outbox;
BEGIN
 SELECT * INTO r FROM agent_alert_outbox WHERE id=p_id AND status='sending' FOR UPDATE;
 IF NOT FOUND THEN RETURN 'not_claimed'; END IF;
 IF p_ok THEN UPDATE agent_alert_outbox SET status='sent', sent_at=now(), slack_ts=left(p_ts,40), last_error=NULL WHERE id=p_id; RETURN 'sent'; END IF;
 IF r.attempts>=5 THEN
  UPDATE agent_alert_outbox SET status='failed', last_error=left(p_error,200) WHERE id=p_id;
  INSERT INTO notifications(recipient_id,type,title,message)
   SELECT x,'agent_write_realtime_alert','Slack alert to Charles FAILED after 5 tries',
     format('%s alert for request %s (%s on %s) could not be sent to Slack: %s. Check the hub change log.', r.kind, r.request_id, r.action, r.account_id, left(p_error,100))
   FROM unnest(ARRAY[public.agent_gateway_write_owner()]) x;
  RETURN 'failed';
 END IF;
 UPDATE agent_alert_outbox SET status='pending', last_error=left(p_error,200) WHERE id=p_id; RETURN 'retry';
END $function$;
CREATE OR REPLACE FUNCTION public.agent_auto_execute_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_actor uuid := public.get_team_member_id(auth.uid()); v_aj uuid := public.agent_gateway_write_owner();
        v_event text;
BEGIN
 IF NEW.write_auto_execute IS NOT DISTINCT FROM OLD.write_auto_execute
    AND (NEW.write_account_changes_per_day, NEW.write_account_net_increase_usd) IS NOT DISTINCT FROM (OLD.write_account_changes_per_day, OLD.write_account_net_increase_usd) THEN
   NEW.write_auto_execute_set_by := OLD.write_auto_execute_set_by; NEW.write_auto_execute_set_at := OLD.write_auto_execute_set_at; RETURN NEW;
 END IF;
 IF (NEW.write_auto_execute AND NOT OLD.write_auto_execute)
    OR (NEW.write_account_changes_per_day, NEW.write_account_net_increase_usd) IS DISTINCT FROM (OLD.write_account_changes_per_day, OLD.write_account_net_increase_usd) THEN
   IF v_uid IS NULL OR v_actor IS NULL OR v_actor IS DISTINCT FROM v_aj THEN RAISE EXCEPTION 'denied_auto_execute_owner'; END IF;
 ELSIF v_uid IS NOT NULL AND v_actor IS DISTINCT FROM v_aj AND NOT COALESCE(public.is_admin(v_uid), false) THEN
   RAISE EXCEPTION 'denied_auto_execute_owner';
 END IF;
 v_event := CASE WHEN NEW.write_auto_execute AND NOT OLD.write_auto_execute THEN 'auto_execute_on'
                 WHEN OLD.write_auto_execute AND NOT NEW.write_auto_execute THEN 'auto_execute_off' ELSE 'auto_settings_changed' END;
 NEW.write_auto_execute_set_by := v_actor; NEW.write_auto_execute_set_at := now();
 INSERT INTO agent_access_log(scope,event_type,outcome,detail,admin_team_member_id,subject_table)
   VALUES('write','admin',v_event, format('auto_execute=%s acct_changes=%s acct_net_usd=%s', NEW.write_auto_execute, NEW.write_account_changes_per_day, NEW.write_account_net_increase_usd)
          || CASE WHEN v_uid IS NULL THEN ' (no signed-in user)' ELSE '' END, v_actor, 'agent_gateway_settings');
 INSERT INTO notifications(recipient_id,type,title,message)
   SELECT r, 'agent_auto_execute_changed',
     CASE v_event WHEN 'auto_execute_on' THEN 'Auto-execute switched ON' WHEN 'auto_execute_off' THEN 'Auto-execute switched OFF' ELSE 'Auto-execute caps changed' END,
     format('Agent writes %s. Per-account caps: %s changes, +$%s/day net budget.',
       CASE WHEN NEW.write_auto_execute THEN 'run without per-change approval (high-risk ones still queue)' ELSE 'all go to the AJ/Charles approval queue' END,
       NEW.write_account_changes_per_day, NEW.write_account_net_increase_usd)
   FROM unnest(ARRAY[v_aj]) r;
 INSERT INTO agent_change_log(event,actor_team_member_id,detail) VALUES(v_event, v_actor,
   jsonb_build_object('auto_execute',NEW.write_auto_execute,'acct_changes_per_day',NEW.write_account_changes_per_day,'acct_net_increase_usd',NEW.write_account_net_increase_usd,'signed_in',v_uid IS NOT NULL));
 RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.agent_write_direct_capture()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_role text := COALESCE(NULLIF(current_setting('role', true),'none'), session_user::text); o jsonb; n jsonb;
BEGIN
 -- The gateway/executor and hub UI go through PostgREST as service_role/authenticated. Anything else is a direct write.
 IF v_role IN ('service_role','authenticated') THEN RETURN NULL; END IF;
 -- No recursion: this function never writes agent_write_requests (only agent_change_log, notifications, agent_access_log).
 BEGIN
 o := CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END; n := CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END;
 INSERT INTO agent_change_log(event,request_id,agent_id,account_id,object_id,action,status,before,after,executor_id,db_session_user,db_role,detail)
 VALUES('direct_write_'||lower(TG_OP), COALESCE(n->>'id',o->>'id')::uuid, COALESCE(n->>'agent_id',o->>'agent_id')::uuid,
   COALESCE(n->>'account_id',o->>'account_id'), COALESCE(n->>'object_id',o->>'object_id'), COALESCE(n->>'action',o->>'action'),
   n->>'status', o, n, n->>'executor_id', session_user::text, v_role,
   jsonb_build_object('old_status',o->>'status','new_status',n->>'status'));
 INSERT INTO notifications(recipient_id,type,title,message)
   SELECT r,'agent_write_realtime_alert','Direct database write to agent_write_requests',
     format('%s by %s/%s on request %s (status %s → %s). Not via the gateway.', TG_OP, session_user, v_role, COALESCE(n->>'id',o->>'id'), o->>'status', n->>'status')
   FROM unnest(ARRAY[public.agent_gateway_write_owner()]) r;
 EXCEPTION WHEN OTHERS THEN
  BEGIN INSERT INTO agent_access_log(scope,event_type,outcome,detail,target) VALUES('write','write','direct_capture_failed',left(SQLSTATE||' '||SQLERRM,300),COALESCE(n->>'id',o->>'id'));
  EXCEPTION WHEN OTHERS THEN NULL; END;
 END;
 RETURN NULL;
END $function$;
CREATE OR REPLACE FUNCTION public.agent_write_to_change_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_hr int; v_title text;
BEGIN
 -- Never blocks the write: any failure here is swallowed and noted; the report then shows change_log_missing + missing_executor_id.
 BEGIN
 IF NEW.status IN ('executed','failed') AND OLD.status IS DISTINCT FROM NEW.status THEN
  INSERT INTO agent_change_log(event,request_id,agent_id,agent_name,agent_owner_id,token_id,token_prefix,key_created_by_id,grant_id,grant_mode,
    account_id,account_name,account_label,object_type,object_id,object_name,action,before,after,diff_text,reason,qa_ref,
    approval_mode,auto_queue_reasons,approved_by_id,status,failure_outcome,result,requested_at,executed_at,executor_id,db_session_user,db_role)
  SELECT 'write_'||NEW.status, NEW.id, NEW.agent_id, a.name, a.owner_team_member_id, NEW.token_id, t.token_prefix, COALESCE(NEW.token_created_by_id,t.created_by_id), NEW.grant_id,
    CASE WHEN g.all_accounts THEN 'all_accounts' WHEN COALESCE(array_length(g.allowed_account_refs,1),0)>0 THEN 'explicit' ELSE 'legacy' END,
    NEW.account_id, NEW.account_name, NEW.account_label, NEW.object_type, NEW.object_id, NEW.object_name, NEW.action,
    NEW.before - 'name_scoped_rules', NEW.after, NEW.diff_text, NEW.reason, NEW.qa_ref,
    CASE WHEN NEW.auto_approved THEN 'auto' ELSE 'human' END, NEW.auto_queue_reasons, NEW.decided_by_id, NEW.status, NEW.failure_outcome, NEW.result,
    NEW.requested_at, NEW.executed_at, NEW.executor_id, session_user::text, COALESCE(NULLIF(current_setting('role', true),'none'), session_user::text)
  FROM (SELECT 1) x LEFT JOIN agents a ON a.id=NEW.agent_id LEFT JOIN agent_gateway_tokens t ON t.id=NEW.token_id LEFT JOIN agent_grants g ON g.id=NEW.grant_id;

  v_hr := extract(hour FROM COALESCE(NEW.executed_at, now()) AT TIME ZONE 'America/Chicago');
  v_title := CASE
    WHEN NEW.failure_outcome='failed_readback_rollback_failed' THEN 'URGENT: rename read-back rollback FAILED'
    WHEN NEW.status='executed' AND (v_hr >= 21 OR v_hr < 7) THEN 'Agent change executed overnight (9 PM-7 AM CT)' END;
  IF v_title IS NOT NULL THEN
   INSERT INTO notifications(recipient_id,type,title,message)
    SELECT r, 'agent_write_realtime_alert', v_title,
      left(format('%s · %s · %s · %s. qa_ref=%s. Request %s.', COALESCE(NEW.diff_text, NEW.action), NEW.account_id, NEW.status,
        COALESCE(NEW.failure_outcome,'ok'), COALESCE(NEW.qa_ref,'none'), NEW.id), 1000)
    FROM unnest(ARRAY[public.agent_gateway_write_owner()]) r;
   -- Slack copy for Charles, delivered by edge function agent-alert-slack (not the executor).
   -- Slack copy for Charles (recipient is a constant in agent-alert-slack, never from this row). Structured fields only.
   INSERT INTO agent_alert_outbox(request_id, kind, action, account_id, object_type, object_id, object_name, old_value, new_value)
    VALUES (NEW.id, CASE WHEN NEW.failure_outcome='failed_readback_rollback_failed' THEN 'urgent_rollback_failed' ELSE 'overnight_execution' END,
      NEW.action, NEW.account_id, NEW.object_type, NEW.object_id, left(NEW.object_name,200),
      left(COALESCE(NEW.before->>'daily_budget', NEW.before->>'status', NEW.before->>'name'),200),
      left(COALESCE(NEW.after->>'daily_budget', NEW.after->>'status', NEW.after->>'name'),200));
  END IF;
 END IF;
 EXCEPTION WHEN OTHERS THEN
  BEGIN INSERT INTO agent_access_log(scope,event_type,outcome,detail,target) VALUES('write','write','change_log_insert_failed',left(SQLSTATE||' '||SQLERRM,300),NEW.id::text);
  EXCEPTION WHEN OTHERS THEN NULL; END;
 END;
 RETURN NULL; -- AFTER trigger: return value ignored
END $function$;