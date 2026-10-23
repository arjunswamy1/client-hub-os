-- DRAFT v2 00xx_auto_execute_and_change_log (2026-10-23). NOT APPLIED. Number it after the rename migration (if any).
-- Column names verified read-only against live DB 2026-10-23 ~11:45 AM PT (agent_write_requests, agent_gateway_settings,
-- agent_gateway_tokens.token_prefix, agent_grants, agents, agent_access_log, notifications, team_members).
-- Deploys with auto-execute OFF: identical to today's behaviour until AJ flips write_auto_execute.

-- 1. Settings. Per-account caps (all agents, America/Chicago day): 15 changes, +$1,000 net daily-budget increase.
ALTER TABLE public.agent_gateway_settings
  ADD COLUMN IF NOT EXISTS write_auto_execute boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS write_account_changes_per_day integer NOT NULL DEFAULT 15 CHECK (write_account_changes_per_day BETWEEN 1 AND 100),
  ADD COLUMN IF NOT EXISTS write_account_net_increase_usd numeric NOT NULL DEFAULT 1000 CHECK (write_account_net_increase_usd BETWEEN 0 AND 10000),
  ADD COLUMN IF NOT EXISTS write_auto_execute_set_by uuid,
  ADD COLUMN IF NOT EXISTS write_auto_execute_set_at timestamptz;

-- 2. Request columns. qa_ref: optional free text from the submitting bot (which team QA bot cleared it). Not verified.
ALTER TABLE public.agent_write_requests
  ADD COLUMN IF NOT EXISTS auto_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_queue_reasons text[],
  ADD COLUMN IF NOT EXISTS qa_ref text CHECK (qa_ref IS NULL OR char_length(qa_ref) BETWEEN 3 AND 200);

-- 3. Change log (append-only). Admins only.
CREATE TABLE IF NOT EXISTS public.agent_change_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  logged_at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL,                 -- write_executed | write_failed | auto_execute_on | auto_execute_off | auto_settings_changed
  request_id uuid REFERENCES public.agent_write_requests(id),
  agent_id uuid, agent_name text, agent_owner_id uuid,
  token_id uuid, token_prefix text, key_created_by_id uuid,   -- prefix only; never token/hash
  grant_id uuid, grant_mode text,
  account_id text, account_name text, account_label text,
  object_type text, object_id text, object_name text,
  action text, before jsonb, after jsonb, diff_text text, reason text, qa_ref text,
  approval_mode text, auto_queue_reasons text[], approved_by_id uuid,
  status text, failure_outcome text, result jsonb,
  requested_at timestamptz, executed_at timestamptz,
  actor_team_member_id uuid, detail jsonb
);
CREATE INDEX IF NOT EXISTS agent_change_log_logged_at ON public.agent_change_log(logged_at DESC);
CREATE INDEX IF NOT EXISTS agent_change_log_account ON public.agent_change_log(account_id, logged_at DESC);
ALTER TABLE public.agent_change_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_change_log FROM PUBLIC, anon, authenticated, sandbox_exec;
REVOKE ALL ON SEQUENCE public.agent_change_log_id_seq FROM PUBLIC, anon, authenticated, sandbox_exec;
GRANT SELECT ON public.agent_change_log TO authenticated;
CREATE POLICY agent_change_log_admin_read ON public.agent_change_log FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE OR REPLACE FUNCTION public.agent_change_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'agent_change_log is append-only'; END $$;
CREATE TRIGGER agent_change_log_immutable BEFORE UPDATE OR DELETE ON public.agent_change_log FOR EACH ROW EXECUTE FUNCTION public.agent_change_log_immutable();
CREATE TRIGGER agent_change_log_no_truncate BEFORE TRUNCATE ON public.agent_change_log FOR EACH STATEMENT EXECUTE FUNCTION public.agent_change_log_immutable();
ALTER TABLE public.agent_change_log ENABLE ALWAYS TRIGGER agent_change_log_immutable;
ALTER TABLE public.agent_change_log ENABLE ALWAYS TRIGGER agent_change_log_no_truncate;

-- 4. Toggle lock + alert. Turning ON or changing per-account caps: only AJ, signed in (no service_role/sandbox/migration path).
--    Turning OFF: AJ, any admin, or a session with no signed-in user (service_role kill switch).
CREATE OR REPLACE FUNCTION public.agent_auto_execute_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_uid uuid := auth.uid(); v_actor uuid := public.get_team_member_id(auth.uid()); v_aj uuid := public.agent_gateway_write_owner();
        v_charles uuid := '014fa04a-80a5-41ce-9368-d1a81f6d2eec'; v_event text;
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
   FROM unnest(ARRAY[v_aj, v_charles]) r;
 INSERT INTO agent_change_log(event,actor_team_member_id,detail) VALUES(v_event, v_actor,
   jsonb_build_object('auto_execute',NEW.write_auto_execute,'acct_changes_per_day',NEW.write_account_changes_per_day,'acct_net_increase_usd',NEW.write_account_net_increase_usd,'signed_in',v_uid IS NOT NULL));
 RETURN NEW;
END $$;
CREATE TRIGGER agent_auto_execute_lock BEFORE UPDATE ON public.agent_gateway_settings FOR EACH ROW EXECUTE FUNCTION public.agent_auto_execute_lock();
ALTER TABLE public.agent_gateway_settings ENABLE ALWAYS TRIGGER agent_auto_execute_lock;

-- 5. Terminal outcomes -> change log; real-time alerts (night writes 9 PM-7 AM CT; rename read-back rollback failure).
CREATE OR REPLACE FUNCTION public.agent_write_to_change_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
    FROM unnest(ARRAY[public.agent_gateway_write_owner(), '014fa04a-80a5-41ce-9368-d1a81f6d2eec'::uuid]) r;
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
END $$;
ALTER FUNCTION public.agent_write_to_change_log() OWNER TO postgres;
CREATE TRIGGER agent_write_to_change_log AFTER UPDATE OF status ON public.agent_write_requests FOR EACH ROW EXECUTE FUNCTION public.agent_write_to_change_log();
ALTER TABLE public.agent_write_requests ENABLE ALWAYS TRIGGER agent_write_to_change_log;

-- 6. System approval (service_role only). Re-checks everything it can see in the DB; returns queue_reasons instead of approving.
CREATE OR REPLACE FUNCTION public.agent_write_auto_approve(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; r record; g record; a record; v_day timestamptz; v_cnt int; v_net numeric; v_inc numeric := 0; v_q text[] := '{}'; v_blk text;
BEGIN
 SELECT * INTO s FROM agent_gateway_settings WHERE id=1 FOR SHARE;
 IF NOT COALESCE(s.write_auto_execute,false) OR NOT COALESCE(s.writes_enabled,false) THEN RETURN jsonb_build_object('ok',false,'outcome','denied_auto_execute_off'); END IF;
 SELECT * INTO r FROM agent_write_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RETURN jsonb_build_object('ok',false,'outcome','denied_not_pending'); END IF;
 SELECT * INTO g FROM agent_grants WHERE id=r.grant_id;
 IF NOT FOUND OR g.revoked_at IS NOT NULL OR (g.expires_at IS NOT NULL AND g.expires_at<=now()) OR NOT ('write'=ANY(COALESCE(g.scopes,'{}'))) THEN
  RETURN jsonb_build_object('ok',false,'outcome','denied_grant_no_write'); END IF;
 SELECT * INTO a FROM agents WHERE id=r.agent_id;
 IF a.owner_team_member_id IS NULL OR a.status<>'active' THEN RETURN jsonb_build_object('ok',false,'outcome','denied_agent_not_active_or_ownerless'); END IF;
 v_blk := public.agent_write_arm_blocker(r.agent_id);
 IF v_blk IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'outcome',v_blk); END IF;
 -- High-risk reasons the DB can see (the edge function also checks reactivation age and rename flags with live Meta data).
 IF r.account_label='UNMAPPED' THEN v_q := array_append(v_q,'unmapped_account'); END IF;
 IF g.all_accounts AND NOT (r.account_id = ANY(SELECT regexp_replace(x,'^act_','') FROM unnest(COALESCE(g.allowed_account_refs,'{}')) x)) THEN v_q := array_append(v_q,'all_accounts_only_account'); END IF;
 IF r.action LIKE '%.duplicate' THEN v_q := array_append(v_q,'duplicate'); END IF;
 IF r.action LIKE '%.rename' AND jsonb_array_length(COALESCE(r.before->'rename_flags','[]'::jsonb))>0 THEN v_q := array_append(v_q,'rename_flagged'); END IF;
 IF r.action LIKE '%.activate' THEN
   IF COALESCE(r.auto_queue_reasons,'{}') @> ARRAY['reactivation_paused_7d_or_unknown'] THEN v_q := array_append(v_q,'reactivation_paused_7d_or_unknown'); END IF;
 END IF;
 IF r.action LIKE '%.update_budget' THEN
   v_inc := COALESCE((r.after->>'daily_budget')::numeric,0) - COALESCE((r.before->>'daily_budget')::numeric,0);
   IF (r.after->>'daily_budget')::numeric > 50000 THEN v_q := array_append(v_q,'budget_over_500_per_day'); END IF;
   IF COALESCE((r.before->>'daily_budget')::numeric,0)>0 AND v_inc*100 > 50*(r.before->>'daily_budget')::numeric THEN v_q := array_append(v_q,'budget_increase_over_50pct'); END IF;
 END IF;
 -- Per-account caps across all agents; serialize per account so two agents can't both slip under.
 PERFORM pg_advisory_xact_lock(hashtext('agent_acct_cap:'||r.account_id));
 v_day := date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago';
 SELECT count(*), COALESCE(sum(CASE WHEN status='executed' AND action LIKE '%.update_budget'
          THEN COALESCE((after->>'daily_budget')::numeric,0)-COALESCE((before->>'daily_budget')::numeric,0) END),0)
   INTO v_cnt, v_net FROM agent_write_requests
  WHERE account_id=r.account_id AND id<>r.id AND status IN ('approved','executing','executed') AND requested_at>=v_day;
 IF v_cnt+1 > s.write_account_changes_per_day THEN v_q := array_append(v_q,'account_daily_change_cap'); END IF;
 IF v_inc>0 AND v_net+v_inc > s.write_account_net_increase_usd*100 THEN v_q := array_append(v_q,'account_daily_net_increase_cap'); END IF;
 IF array_length(v_q,1)>0 THEN
   UPDATE agent_write_requests SET auto_queue_reasons=(SELECT array_agg(DISTINCT x) FROM unnest(COALESCE(auto_queue_reasons,'{}')||v_q) x), updated_at=now() WHERE id=r.id;
   RETURN jsonb_build_object('ok',false,'outcome','queued_high_risk','queue_reasons',to_jsonb(v_q));
 END IF;
 UPDATE agent_write_requests SET status='approved', auto_approved=true, decided_by_id=NULL, decided_at=now(), decision_note='auto-execute',
   approval_expires_at=now()+interval '5 minutes', updated_at=now() WHERE id=r.id;
 INSERT INTO agent_access_log(agent_id,integration_id,grant_id,token_id,action,scope,event_type,outcome,target)
   VALUES(r.agent_id,r.integration_id,r.grant_id,r.token_id,r.action,'write','write','write_auto_approved',r.id::text);
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.agent_write_auto_approve(uuid) FROM PUBLIC, anon, authenticated, sandbox_exec;
GRANT EXECUTE ON FUNCTION public.agent_write_auto_approve(uuid) TO service_role;

-- 7. Daily risk report (read-only). Callable by service_role (cpm-hub MCP tool) and by admins in the hub.
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
   CASE WHEN d.action LIKE '%update_budget' AND (d.before->>'daily_budget')::numeric>0
         AND abs((d.after->>'daily_budget')::numeric-(d.before->>'daily_budget')::numeric)/(d.before->>'daily_budget')::numeric>=0.30 THEN 'large_budget_move' END,
   CASE WHEN d.action LIKE '%update_budget' AND (d.after->>'daily_budget')::numeric>50000 THEN 'budget_over_500_per_day' END,
   CASE WHEN d.action LIKE '%.activate' AND d.before->>'status' IN ('PAUSED','ARCHIVED') THEN 'activated_paused_object' END,
   CASE WHEN p.n>=5 THEN 'many_changes_on_account' END,
   CASE WHEN extract(hour FROM d.logged_at AT TIME ZONE 'America/Chicago')>=21 OR extract(hour FROM d.logged_at AT TIME ZONE 'America/Chicago')<7
          OR extract(isodow FROM d.logged_at AT TIME ZONE 'America/Chicago') IN (6,7) THEN 'off_hours' END,
   CASE WHEN jsonb_array_length(COALESCE(d.before->'rename_flags','[]'::jsonb))>0 THEN 'rename_rule_or_naming_flag' END,
   CASE WHEN d.status='failed' THEN 'failed:'||COALESCE(d.failure_outcome,'?') END,
   CASE WHEN d.failure_outcome IN ('failed_upstream_timeout','failed_upstream_unreachable','failed_stuck_executing') THEN 'outcome_unknown_verify_in_meta' END,
   CASE WHEN d.request_id::text IN (SELECT target FROM rb) OR d.failure_outcome LIKE 'failed_readback%' THEN 'rollback' END,
   CASE WHEN d.qa_ref IS NULL AND d.event LIKE 'write_%' THEN 'no_qa_ref' END,
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

-- 8. (QA cond. 5) Slack outbox for URGENT / overnight alerts. Drained by edge function agent-alert-slack (cron, every minute).
--    MUST be deployed and verified (test alert reached Charles) BEFORE write_auto_execute is switched ON.
CREATE TABLE IF NOT EXISTS public.agent_alert_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid, kind text NOT NULL CHECK (kind IN ('urgent_rollback_failed','overnight_execution','test')),
  action text, account_id text, object_type text, object_id text, object_name text, old_value text, new_value text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  claimed_at timestamptz, sent_at timestamptz, attempts int NOT NULL DEFAULT 0, last_error text, slack_ts text);
CREATE INDEX IF NOT EXISTS agent_alert_outbox_pending ON public.agent_alert_outbox(created_at) WHERE status IN ('pending','sending');

-- Claim (idempotent, concurrency-safe): FOR UPDATE SKIP LOCKED; a 'sending' row is reclaimable after 2 min (crashed drain).
-- Per-minute cap: at most p_per_minute DMs sent in any rolling minute.
CREATE OR REPLACE FUNCTION public.agent_alert_outbox_claim(p_per_minute int DEFAULT 10) RETURNS SETOF public.agent_alert_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_room int;
BEGIN
 SELECT GREATEST(0, LEAST(p_per_minute,10) - count(*)) INTO v_room FROM agent_alert_outbox WHERE sent_at > now()-interval '1 minute';
 IF v_room=0 THEN RETURN; END IF;
 RETURN QUERY UPDATE agent_alert_outbox o SET status='sending', claimed_at=now(), attempts=o.attempts+1
  WHERE o.id IN (SELECT id FROM agent_alert_outbox WHERE (status='pending' OR (status='sending' AND claimed_at < now()-interval '2 minutes')) AND attempts<5
                 ORDER BY (kind='urgent_rollback_failed') DESC, created_at LIMIT v_room FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
END $$;
-- Result: mark sent only on Slack ok; else back to pending, or failed after 5 attempts with an in-hub alert to AJ + Charles.
CREATE OR REPLACE FUNCTION public.agent_alert_outbox_result(p_id bigint, p_ok boolean, p_error text DEFAULT NULL, p_ts text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
   FROM unnest(ARRAY[public.agent_gateway_write_owner(), '014fa04a-80a5-41ce-9368-d1a81f6d2eec'::uuid]) x;
  RETURN 'failed';
 END IF;
 UPDATE agent_alert_outbox SET status='pending', last_error=left(p_error,200) WHERE id=p_id; RETURN 'retry';
END $$;
REVOKE ALL ON FUNCTION public.agent_alert_outbox_claim(int), public.agent_alert_outbox_result(bigint,boolean,text,text) FROM PUBLIC, anon, authenticated, sandbox_exec;
GRANT EXECUTE ON FUNCTION public.agent_alert_outbox_claim(int), public.agent_alert_outbox_result(bigint,boolean,text,text) TO service_role;
ALTER TABLE public.agent_alert_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_alert_outbox FROM PUBLIC, anon, authenticated, sandbox_exec;
REVOKE ALL ON SEQUENCE public.agent_alert_outbox_id_seq FROM PUBLIC, anon, authenticated, sandbox_exec;
GRANT SELECT ON public.agent_alert_outbox TO authenticated;
CREATE POLICY agent_alert_outbox_admin_read ON public.agent_alert_outbox FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
-- (moved above the change-log trigger at apply time is not needed: plpgsql resolves the table at run time)

-- 9. (QA cond. 6) Executor id + capture of direct writes (e.g. Lovable's postgres tool, psql, sandbox_exec).
ALTER TABLE public.agent_write_requests ADD COLUMN IF NOT EXISTS executor_id text;
ALTER TABLE public.agent_change_log ADD COLUMN IF NOT EXISTS executor_id text, ADD COLUMN IF NOT EXISTS db_session_user text, ADD COLUMN IF NOT EXISTS db_role text;
CREATE OR REPLACE FUNCTION public.agent_write_direct_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
   FROM unnest(ARRAY[public.agent_gateway_write_owner(), '014fa04a-80a5-41ce-9368-d1a81f6d2eec'::uuid]) r;
 EXCEPTION WHEN OTHERS THEN
  BEGIN INSERT INTO agent_access_log(scope,event_type,outcome,detail,target) VALUES('write','write','direct_capture_failed',left(SQLSTATE||' '||SQLERRM,300),COALESCE(n->>'id',o->>'id'));
  EXCEPTION WHEN OTHERS THEN NULL; END;
 END;
 RETURN NULL;
END $$;
ALTER FUNCTION public.agent_write_direct_capture() OWNER TO postgres;
-- The change-log FK would block logging a DELETE; direct-write rows keep request_id as a plain value.
ALTER TABLE public.agent_change_log DROP CONSTRAINT IF EXISTS agent_change_log_request_id_fkey;
CREATE TRIGGER agent_write_direct_capture AFTER INSERT OR UPDATE OR DELETE ON public.agent_write_requests FOR EACH ROW EXECUTE FUNCTION public.agent_write_direct_capture();
ALTER TABLE public.agent_write_requests ENABLE ALWAYS TRIGGER agent_write_direct_capture;
-- Known gap: a superuser session can still DISABLE these triggers or drop them. That itself is DDL; see README.

-- 10. (QA cond. 4) Counts by agent and by account for one day: total writes and writes without qa_ref.
CREATE OR REPLACE FUNCTION public.agent_change_risk_summary(p_day date DEFAULT ((now() AT TIME ZONE 'America/Chicago')::date - 1))
RETURNS TABLE(dimension text, key text, label text, writes bigint, no_qa_ref bigint, flagged bigint, direct_writes bigint, missing_executor bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_from timestamptz := p_day::timestamp AT TIME ZONE 'America/Chicago'; v_to timestamptz := (p_day+1)::timestamp AT TIME ZONE 'America/Chicago';
BEGIN
 IF NOT (COALESCE(auth.role(),'')='service_role' OR COALESCE(public.is_admin(auth.uid()),false)) THEN RAISE EXCEPTION 'denied_admins_only'; END IF;
 RETURN QUERY
 WITH c AS (SELECT * FROM agent_change_log WHERE request_id IS NOT NULL AND logged_at>=v_from AND logged_at<v_to),
 r AS (SELECT change_id, risk_score FROM public.agent_change_risk_report(p_day))
 SELECT 'agent', c.agent_id::text, max(c.agent_name), count(*) FILTER (WHERE c.event LIKE 'write_%'),
   count(*) FILTER (WHERE c.event LIKE 'write_%' AND c.qa_ref IS NULL), count(*) FILTER (WHERE r.risk_score>0),
   count(*) FILTER (WHERE c.event LIKE 'direct_write%'), count(*) FILTER (WHERE c.event='write_executed' AND c.executor_id IS NULL)
 FROM c LEFT JOIN r ON r.change_id=c.id GROUP BY c.agent_id
 UNION ALL
 SELECT 'account', c.account_id, max(c.account_name), count(*) FILTER (WHERE c.event LIKE 'write_%'),
   count(*) FILTER (WHERE c.event LIKE 'write_%' AND c.qa_ref IS NULL), count(*) FILTER (WHERE r.risk_score>0),
   count(*) FILTER (WHERE c.event LIKE 'direct_write%'), count(*) FILTER (WHERE c.event='write_executed' AND c.executor_id IS NULL)
 FROM c LEFT JOIN r ON r.change_id=c.id GROUP BY c.account_id
 ORDER BY 1, 5 DESC, 4 DESC;
END $$;
REVOKE ALL ON FUNCTION public.agent_change_risk_summary(date) FROM PUBLIC, anon, sandbox_exec;
GRANT EXECUTE ON FUNCTION public.agent_change_risk_summary(date) TO authenticated, service_role;

-- Enable later (AJ signed in to the hub, after QA): UPDATE agent_gateway_settings SET write_auto_execute=true WHERE id=1;
