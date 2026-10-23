-- 0054 (DRAFT, not applied; renumbered from 0053 because live already has 0053_auto_execute_thresholds): cleanup. Notice/title text no longer mentions Charles/Slack; change-log trigger stops writing agent_alert_outbox (table kept).
-- Also (QA cond. 5 follow-up): agent_change_risk_report lists risk_flags in the order no_qa_ref, budget_over_500_per_day, rename_rule_or_naming_flag, then the rest (unchanged logic; only element order).
-- Recipients (AJ only), SECURITY DEFINER, search_path, owners unchanged. agent_write_direct_capture untouched.
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
   SELECT x,'agent_write_realtime_alert','Hub alert delivery FAILED after 5 tries',
     format('%s alert for request %s (%s on %s) could not be delivered: %s. Check the hub change log.', r.kind, r.request_id, r.action, r.account_id, left(p_error,100))
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
       CASE WHEN NEW.write_auto_execute THEN 'run without per-change approval (high-risk ones still queue)' ELSE 'all go to the approval queue' END,
       NEW.write_account_changes_per_day, NEW.write_account_net_increase_usd)
   FROM unnest(ARRAY[v_aj]) r;
 INSERT INTO agent_change_log(event,actor_team_member_id,detail) VALUES(v_event, v_actor,
   jsonb_build_object('auto_execute',NEW.write_auto_execute,'acct_changes_per_day',NEW.write_account_changes_per_day,'acct_net_increase_usd',NEW.write_account_net_increase_usd,'signed_in',v_uid IS NOT NULL));
 RETURN NEW;
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
   -- 0053: no longer written to agent_alert_outbox (nothing drains it; table kept).
  END IF;
 END IF;
 EXCEPTION WHEN OTHERS THEN
  BEGIN INSERT INTO agent_access_log(scope,event_type,outcome,detail,target) VALUES('write','write','change_log_insert_failed',left(SQLSTATE||' '||SQLERRM,300),NEW.id::text);
  EXCEPTION WHEN OTHERS THEN NULL; END;
 END;
 RETURN NULL; -- AFTER trigger: return value ignored
END $function$;

-- Risk report: flag order only.
CREATE OR REPLACE FUNCTION public.agent_change_risk_report(p_day date DEFAULT ((now() AT TIME ZONE 'America/Chicago')::date - 1))
RETURNS TABLE(change_id bigint, logged_at timestamptz, agent_name text, token_prefix text, account_id text, account_name text,
  action text, object_id text, object_name text, diff_text text, qa_ref text, approval_mode text, auto_queue_reasons text[],
  status text, failure_outcome text, risk_flags text[], risk_score int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_from timestamptz := p_day::timestamp AT TIME ZONE 'America/Chicago'; v_to timestamptz := (p_day+1)::timestamp AT TIME ZONE 'America/Chicago';
BEGIN
 IF NOT (COALESCE(auth.role(),'')='service_role' OR COALESCE(public.is_admin(auth.uid()),false)) THEN RAISE EXCEPTION 'denied_admins_only'; END IF;
 RETURN QUERY SELECT * FROM (
 WITH day AS (SELECT * FROM agent_change_log c WHERE c.request_id IS NOT NULL AND c.logged_at>=v_from AND c.logged_at<v_to),
 per_acct AS (SELECT d.account_id, count(*) n FROM day d GROUP BY 1),
 rb AS (SELECT l.target FROM agent_access_log l WHERE l.outcome IN ('rename_rollback_ok','rename_rollback_failed') AND l.created_at>=v_from-interval '1 day' AND l.created_at<v_to)
 SELECT d.id, d.logged_at, d.agent_name, d.token_prefix, d.account_id, d.account_name, d.action, d.object_id, d.object_name, d.diff_text,
   d.qa_ref, d.approval_mode, d.auto_queue_reasons, d.status, d.failure_outcome, f.flags AS rf, COALESCE(array_length(f.flags,1),0) AS rs
 FROM day d JOIN per_acct p ON p.account_id IS NOT DISTINCT FROM d.account_id
 CROSS JOIN LATERAL (SELECT array_remove(ARRAY[
   CASE WHEN d.qa_ref IS NULL AND d.event LIKE 'write_%' THEN 'no_qa_ref' END,
   CASE WHEN d.action LIKE '%update_budget' AND (d.after->>'daily_budget')::numeric>50000 THEN 'budget_over_500_per_day' END,
   CASE WHEN jsonb_array_length(COALESCE(d.before->'rename_flags','[]'::jsonb))>0 THEN 'rename_rule_or_naming_flag' END,
   CASE WHEN d.action LIKE '%update_budget' AND (d.before->>'daily_budget')::numeric>0
         AND abs((d.after->>'daily_budget')::numeric-(d.before->>'daily_budget')::numeric)/(d.before->>'daily_budget')::numeric>=0.30 THEN 'large_budget_move' END,
   CASE WHEN d.action LIKE '%.activate' AND d.before->>'status' IN ('PAUSED','ARCHIVED') THEN 'activated_paused_object' END,
   CASE WHEN p.n>=5 THEN 'many_changes_on_account' END,
   CASE WHEN extract(hour FROM d.logged_at AT TIME ZONE 'America/Chicago')>=21 OR extract(hour FROM d.logged_at AT TIME ZONE 'America/Chicago')<7
          OR extract(isodow FROM d.logged_at AT TIME ZONE 'America/Chicago') IN (6,7) THEN 'off_hours' END,
   CASE WHEN d.status='failed' THEN 'failed:'||COALESCE(d.failure_outcome,'?') END,
   CASE WHEN d.failure_outcome IN ('failed_upstream_timeout','failed_upstream_unreachable','failed_stuck_executing') THEN 'outcome_unknown_verify_in_meta' END,
   CASE WHEN d.request_id::text IN (SELECT target FROM rb) OR d.failure_outcome LIKE 'failed_readback%' THEN 'rollback' END,
   CASE WHEN d.account_label='UNMAPPED' THEN 'unmapped_account' END,
   CASE WHEN d.action LIKE '%.duplicate' THEN 'campaign_duplicated' END,
   CASE WHEN d.event='write_executed' AND d.executor_id IS NULL THEN 'missing_executor_id' END,
   CASE WHEN d.event LIKE 'direct_write%' THEN 'direct_db_write:'||COALESCE(d.db_session_user,'?')||'/'||COALESCE(d.db_role,'?') END,
   CASE WHEN d.approval_mode='human' AND d.auto_queue_reasons IS NOT NULL AND array_length(d.auto_queue_reasons,1)>0 THEN 'was_high_risk_queued' END
 ], NULL) flags) f
 UNION ALL
 -- Reconciliation: executed requests in the window with no write_executed log row (log insert failed or trigger bypassed).
 SELECT NULL::bigint, q.executed_at, a.name, NULL::text, q.account_id, q.account_name, q.action, q.object_id, q.object_name, q.diff_text,
   q.qa_ref, CASE WHEN q.auto_approved THEN 'auto' ELSE 'human' END, q.auto_queue_reasons, q.status, q.failure_outcome,
   ARRAY['change_log_missing','missing_executor_id']||CASE WHEN q.qa_ref IS NULL THEN ARRAY['no_qa_ref'] ELSE '{}'::text[] END, 2 + (q.qa_ref IS NULL)::int
 FROM agent_write_requests q LEFT JOIN agents a ON a.id=q.agent_id
 WHERE q.status='executed' AND q.executed_at>=v_from AND q.executed_at<v_to
   AND NOT EXISTS (SELECT 1 FROM agent_change_log c WHERE c.request_id=q.id AND c.event='write_executed')
 ) u ORDER BY ('no_qa_ref' = ANY(u.rf)) DESC, u.rs DESC, 2;
END $$;
REVOKE ALL ON FUNCTION public.agent_change_risk_report(date) FROM PUBLIC, anon, sandbox_exec;
GRANT EXECUTE ON FUNCTION public.agent_change_risk_report(date) TO authenticated, service_role;