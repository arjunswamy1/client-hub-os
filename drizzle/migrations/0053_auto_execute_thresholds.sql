-- 0054 (DRAFT, NOT APPLIED): auto-execute thresholds per AJ policy 2026-10-23 ~1:15 PM PT.
--   * Renames: no longer queued for naming/rule flags (rename_flagged removed). Rule-scope-breaking renames are still
--     hard-DENIED by the gateway (409 denied_rule_scope_change); the 10 renames/agent/day limit stays in the gateway.
--   * Budgets: queue only when |new - old| >= $1,000/day (100000 cents) or the per-account +$1,000/day net cap would be
--     exceeded. budget_over_500_per_day and budget_increase_over_50pct removed from the queue rules.
--   * Unchanged: unmapped / all_accounts-only account, duplicate, stale re-activation, per-account 15 changes/day.
--   * Gateway hard limits (±50%/request, <=$1,000/day, USD-only) are NOT touched (enforced in planChange/executionCheck).
-- Lovable: no BEGIN/COMMIT. Only agent_write_auto_approve(uuid) is replaced; signature, owner, grants unchanged.
CREATE OR REPLACE FUNCTION public.agent_write_auto_approve(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; r record; g record; a record; v_day timestamptz; v_cnt int; v_net numeric; v_inc numeric := 0; v_q text[] := '{}'; v_blk text;
        c_swing_cents constant numeric := 100000; -- 0054: |daily budget change| >= $1,000 -> human queue
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
 IF r.account_label='UNMAPPED' THEN v_q := array_append(v_q,'unmapped_account'); END IF;
 IF g.all_accounts AND NOT (r.account_id = ANY(SELECT regexp_replace(x,'^act_','') FROM unnest(COALESCE(g.allowed_account_refs,'{}')) x)) THEN v_q := array_append(v_q,'all_accounts_only_account'); END IF;
 IF r.action LIKE '%.duplicate' THEN v_q := array_append(v_q,'duplicate'); END IF;
 -- 0054: rename_flagged rule removed (renames auto-execute; blocking rule-scope changes are denied upstream).
 IF r.action LIKE '%.activate' THEN
   IF COALESCE(r.auto_queue_reasons,'{}') @> ARRAY['reactivation_paused_7d_or_unknown'] THEN v_q := array_append(v_q,'reactivation_paused_7d_or_unknown'); END IF;
 END IF;
 IF r.action LIKE '%.update_budget' THEN
   v_inc := COALESCE((r.after->>'daily_budget')::numeric,0) - COALESCE((r.before->>'daily_budget')::numeric,0);
   IF abs(v_inc) >= c_swing_cents THEN v_q := array_append(v_q,'budget_swing_1000_plus'); END IF;
 END IF;
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
