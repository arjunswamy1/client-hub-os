\set ON_ERROR_STOP 1
\i fixtures.sql
CREATE TEMP TABLE results (name text, pass boolean);
CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', u, false) $$;
CREATE FUNCTION pg_temp.ok(n text, c boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO results VALUES (n, coalesce(c, false)) $$;
CREATE FUNCTION pg_temp.raises(q text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN raise_exception THEN RETURN true; END $$;
-- users: AJ ...01, Charles ...02, Juan ...03
DO $$ DECLARE r uuid; o jsonb; BEGIN
  r := pg_temp.req('b0000000-0000-4000-8000-00000000000a', '1');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000003');
  PERFORM pg_temp.ok('approval: non-approver (Juan) refused', decide_agent_write_request(r, true)->>'outcome' = 'not_write_approver');
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.ok('approval: no signed-in user refused', decide_agent_write_request(r, true)->>'outcome' = 'not_write_approver');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  o := decide_agent_write_request(r, true);
  PERFORM pg_temp.ok('approval: AJ approves Juan bot request', o->>'outcome' = 'write_approved'
     AND (SELECT status = 'approved' AND approval_expires_at > now() AND decided_by_id = '1fdd684e-6cb7-447e-b616-7e1b9c598971' FROM agent_write_requests WHERE id = r));
  PERFORM pg_temp.ok('approval: approval is logged', EXISTS (SELECT 1 FROM agent_access_log WHERE target = r::text AND outcome = 'write_approved'));
  PERFORM pg_temp.ok('approval: second decision refused (not_pending)', decide_agent_write_request(r, false)->>'outcome' = 'not_pending');

  r := pg_temp.req('b0000000-0000-4000-8000-00000000000c', '2');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('self-approval: Charles cannot approve his own bot', decide_agent_write_request(r, true)->>'outcome' = 'denied_self_approval');
  PERFORM pg_temp.ok('self-approval: Charles cannot deny his own bot either', decide_agent_write_request(r, false)->>'outcome' = 'denied_self_approval');
  PERFORM pg_temp.ok('self-approval: request still pending', (SELECT status FROM agent_write_requests WHERE id = r) = 'pending');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.ok('self-approval: AJ may approve Charles bot', decide_agent_write_request(r, true)->>'outcome' = 'write_approved');

  r := pg_temp.req('b0000000-0000-4000-8000-00000000000d', '3');
  PERFORM pg_temp.ok('owner: AJ (write owner) may approve his own bot', decide_agent_write_request(r, true)->>'outcome' = 'write_approved'
     AND (SELECT status = 'approved' AND decided_by_id = '1fdd684e-6cb7-447e-b616-7e1b9c598971' FROM agent_write_requests WHERE id = r));
  r := pg_temp.req('b0000000-0000-4000-8000-00000000000d', '3b');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('backup: Charles may approve AJ bot', decide_agent_write_request(r, true)->>'outcome' = 'write_approved');
  r := pg_temp.req('b0000000-0000-4000-8000-00000000000a', '3c');
  PERFORM pg_temp.ok('other owner: Charles may approve Juan bot', decide_agent_write_request(r, true)->>'outcome' = 'write_approved');

  r := pg_temp.req('b0000000-0000-4000-8000-00000000000e', '4');
  PERFORM pg_temp.ok('ownerless: Charles cannot approve', decide_agent_write_request(r, true)->>'outcome' = 'denied_ownerless_agent');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.ok('ownerless: AJ cannot approve', decide_agent_write_request(r, true)->>'outcome' = 'denied_ownerless_agent');
  PERFORM pg_temp.ok('ownerless: AJ may deny', decide_agent_write_request(r, false)->>'outcome' = 'write_denied');

  r := pg_temp.req('b0000000-0000-4000-8000-00000000000a', '5');
  UPDATE agent_write_requests SET decision_expires_at = now() - interval '1 minute' WHERE id = r;
  PERFORM pg_temp.ok('expiry: expired pending request cannot be approved', decide_agent_write_request(r, true)->>'outcome' = 'write_expired');
  PERFORM pg_temp.ok('expiry: request marked expired', (SELECT status FROM agent_write_requests WHERE id = r) = 'expired');
END $$;

-- Chicago day boundary
SELECT pg_temp.ok('day start: 04:30Z on 15 Oct (CDT) belongs to 14 Oct Chicago', agent_write_day_start('2026-10-15 04:30Z') = '2026-10-14 05:00Z');
SELECT pg_temp.ok('day start: 05:30Z on 15 Oct is 15 Oct Chicago', agent_write_day_start('2026-10-15 05:30Z') = '2026-10-15 05:00Z');
SELECT pg_temp.ok('day start: winter (CST) boundary is 06:00Z', agent_write_day_start('2026-12-15 12:00Z') = '2026-12-15 06:00Z');

-- Atomic create + limit
DO $$ DECLARE a uuid := 'b0000000-0000-4000-8000-00000000000a'; g uuid; o jsonb; k int; BEGIN
  DELETE FROM agent_write_requests WHERE agent_id = a;
  SELECT id INTO g FROM agent_grants WHERE agent_id = a;
  FOR k IN 1..20 LOOP PERFORM pg_temp.req(a, 'y' || k, 'denied', agent_write_day_start(now()) - interval '1 second'); END LOOP;
  o := agent_write_request_create(jsonb_build_object('agent_id', a, 'grant_id', g, 'integration_id', '55694453-95b2-4c49-829b-517a50952d7b', 'action', 'meta.ad.pause',
       'account_id', '111', 'object_type', 'ad', 'object_id', 'n1', 'before', '{}'::jsonb, 'after', '{}'::jsonb, 'diff_text', 'd', 'decision_expires_at', now() + interval '1 day'), 20);
  PERFORM pg_temp.ok('limit: yesterday (Chicago) requests do not count', (o->>'ok')::boolean AND NOT (o->>'duplicate')::boolean);
  o := agent_write_request_create(jsonb_build_object('agent_id', a, 'grant_id', g, 'integration_id', '55694453-95b2-4c49-829b-517a50952d7b', 'action', 'meta.ad.pause',
       'account_id', '111', 'object_type', 'ad', 'object_id', 'n1', 'before', '{}'::jsonb, 'after', '{}'::jsonb, 'diff_text', 'd', 'decision_expires_at', now() + interval '1 day'), 20);
  PERFORM pg_temp.ok('limit: open request on same object returned, not duplicated', (o->>'duplicate')::boolean AND (SELECT count(*) FROM agent_write_requests WHERE agent_id = a AND object_id = 'n1') = 1);
  FOR k IN 1..19 LOOP PERFORM pg_temp.req(a, 't' || k, 'denied'); END LOOP;
  o := agent_write_request_create(jsonb_build_object('agent_id', a, 'grant_id', g, 'integration_id', '55694453-95b2-4c49-829b-517a50952d7b', 'action', 'meta.ad.pause',
       'account_id', '111', 'object_type', 'ad', 'object_id', 'n21', 'before', '{}'::jsonb, 'after', '{}'::jsonb, 'diff_text', 'd', 'decision_expires_at', now() + interval '1 day'), 20);
  PERFORM pg_temp.ok('limit: 21st request today refused', o->>'outcome' = 'write_rate_limited');
END $$;

-- Stuck sweep
DO $$ DECLARE a uuid := 'b0000000-0000-4000-8000-00000000000c'; r1 uuid; r2 uuid; n int; BEGIN
  r1 := pg_temp.req(a, 's1', 'executing'); UPDATE agent_write_requests SET execution_started_at = now() - interval '11 minutes' WHERE id = r1;
  r2 := pg_temp.req(a, 's2', 'executing'); UPDATE agent_write_requests SET execution_started_at = now() - interval '5 minutes' WHERE id = r2;
  n := sweep_stuck_agent_writes();
  PERFORM pg_temp.ok('sweep: >10 min executing becomes failed', n = 1 AND (SELECT status = 'failed' AND failure_outcome = 'failed_stuck_executing' FROM agent_write_requests WHERE id = r1));
  PERFORM pg_temp.ok('sweep: 5 min executing untouched', (SELECT status FROM agent_write_requests WHERE id = r2) = 'executing');
  PERFORM pg_temp.ok('sweep: audit row written', EXISTS (SELECT 1 FROM agent_access_log WHERE target = r1::text AND outcome = 'failed_stuck_executing'));
  PERFORM pg_temp.ok('sweep: scheduled every 10 minutes', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-write-stuck-sweep' AND schedule = '*/10 * * * *'));
END $$;

-- Lock triggers: no role bypass
SELECT pg_temp.as_user('');
SELECT pg_temp.ok('lock: service role / no user cannot turn writes on', pg_temp.raises('UPDATE agent_gateway_settings SET writes_enabled = true WHERE id = 1'));
SET session_replication_role = replica;
SELECT pg_temp.ok('lock: replica (maintenance) session cannot turn writes on', pg_temp.raises('UPDATE agent_gateway_settings SET writes_enabled = true WHERE id = 1'));
SELECT pg_temp.ok('lock: replica session cannot add write scope', pg_temp.raises($q$UPDATE agent_grants SET scopes = '{read,write}' WHERE agent_id = 'b0000000-0000-4000-8000-00000000000a'$q$));
SET session_replication_role = origin;
SELECT pg_temp.ok('lock: service role cannot add write scope', pg_temp.raises($q$UPDATE agent_grants SET scopes = '{read,write}' WHERE agent_id = 'b0000000-0000-4000-8000-00000000000a'$q$));
SELECT pg_temp.ok('lock: service role cannot insert a write grant', pg_temp.raises($q$INSERT INTO agent_grants (agent_id, integration_id, scopes) VALUES ('b0000000-0000-4000-8000-00000000000a', '55694453-95b2-4c49-829b-517a50952d7b', '{write}')$q$));
SELECT pg_temp.ok('lock: service role can still change non-write settings', NOT pg_temp.raises('UPDATE agent_gateway_settings SET gateway_enabled = false WHERE id = 1'));
SELECT pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
SELECT pg_temp.ok('lock: Charles (approver, not owner) cannot change caps', pg_temp.raises('UPDATE agent_gateway_settings SET write_max_daily_budget_usd = 5000 WHERE id = 1'));
SELECT pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
SELECT pg_temp.ok('lock: AJ can change write settings', NOT pg_temp.raises('UPDATE agent_gateway_settings SET write_requests_per_day = 19 WHERE id = 1'));
SELECT pg_temp.ok('alert: AJ change logged and notified', EXISTS (SELECT 1 FROM agent_access_log WHERE outcome = 'write_control_changed' AND admin_team_member_id = '1fdd684e-6cb7-447e-b616-7e1b9c598971')
   AND EXISTS (SELECT 1 FROM notifications WHERE type = 'agent_write_control'));
SELECT pg_temp.ok('lock: triggers fire ALWAYS', (SELECT bool_and(tgenabled = 'A') FROM pg_trigger WHERE tgname IN ('agent_gateway_settings_write_lock','agent_grant_write_scope_lock','agent_gateway_settings_write_alert','agent_grants_write_alert')) AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('agent_gateway_settings_write_lock','agent_grant_write_scope_lock','agent_gateway_settings_write_alert','agent_grants_write_alert')) = 4);

SELECT (CASE WHEN pass THEN 'PASS ' ELSE 'FAIL ' END) || name FROM results;
