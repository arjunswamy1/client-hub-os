\set ON_ERROR_STOP 1
\i fixtures.sql
CREATE TEMP TABLE results (name text, pass boolean);
CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('request.jwt.claim.sub', u, false) $$;
CREATE FUNCTION pg_temp.ok(n text, c boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO results VALUES (n, coalesce(c, false)) $$;
CREATE FUNCTION pg_temp.raises(q text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN EXECUTE q; RETURN false; EXCEPTION WHEN raise_exception THEN RETURN true; END $$;
CREATE FUNCTION pg_temp.give_write(p_agents uuid[]) RETURNS void LANGUAGE plpgsql AS $$ DECLARE g record; BEGIN
  FOR g IN SELECT gr.id, a.owner_team_member_id o FROM agent_grants gr JOIN agents a ON a.id = gr.agent_id WHERE gr.agent_id = ANY(p_agents) LOOP
    PERFORM grant_agent_write_scope(g.id, g.o); END LOOP; END $$;
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
  o := decide_agent_write_request(r, true);
  PERFORM pg_temp.ok('owner: AJ (write owner) may approve his own bot', o->>'outcome' = 'write_approved'
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
  o := agent_write_request_create(jsonb_build_object('agent_id', a, 'token_id', pg_temp.tok(a), 'grant_id', g, 'integration_id', '55694453-95b2-4c49-829b-517a50952d7b', 'action', 'meta.ad.pause',
       'account_id', '111', 'object_type', 'ad', 'object_id', 'n1', 'before', '{}'::jsonb, 'after', '{}'::jsonb, 'diff_text', 'd', 'decision_expires_at', now() + interval '1 day'), 20);
  PERFORM pg_temp.ok('limit: yesterday (Chicago) requests do not count', (o->>'ok')::boolean AND NOT (o->>'duplicate')::boolean);
  o := agent_write_request_create(jsonb_build_object('agent_id', a, 'token_id', pg_temp.tok(a), 'grant_id', g, 'integration_id', '55694453-95b2-4c49-829b-517a50952d7b', 'action', 'meta.ad.pause',
       'account_id', '111', 'object_type', 'ad', 'object_id', 'n1', 'before', '{}'::jsonb, 'after', '{}'::jsonb, 'diff_text', 'd', 'decision_expires_at', now() + interval '1 day'), 20);
  PERFORM pg_temp.ok('limit: open request on same object returned, not duplicated', (o->>'duplicate')::boolean AND (SELECT count(*) FROM agent_write_requests WHERE agent_id = a AND object_id = 'n1') = 1);
  FOR k IN 1..19 LOOP PERFORM pg_temp.req(a, 't' || k, 'denied'); END LOOP;
  o := agent_write_request_create(jsonb_build_object('agent_id', a, 'token_id', pg_temp.tok(a), 'grant_id', g, 'integration_id', '55694453-95b2-4c49-829b-517a50952d7b', 'action', 'meta.ad.pause',
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

-- Owner snapshot + owner lock (migration 0038)
DO $$ DECLARE rc uuid; rj uuid; BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.give_write(ARRAY['b0000000-0000-4000-8000-00000000000c','b0000000-0000-4000-8000-00000000000a']::uuid[]);
  PERFORM pg_temp.as_user('');
  rc := (agent_write_request_create(jsonb_build_object('agent_id','b0000000-0000-4000-8000-00000000000c','token_id',pg_temp.tok('b0000000-0000-4000-8000-00000000000c'),'grant_id',(SELECT id FROM agent_grants WHERE agent_id='b0000000-0000-4000-8000-00000000000c'),
     'integration_id','55694453-95b2-4c49-829b-517a50952d7b','action','meta.ad.pause','account_id','111','object_type','ad','object_id','own1',
     'before','{}'::jsonb,'after','{}'::jsonb,'diff_text','d','decision_expires_at',now()+interval '1 day'), 1000)->>'id')::uuid;
  PERFORM pg_temp.ok('snapshot: create stores the bot owner (Charles)', (SELECT agent_owner_team_member_id FROM agent_write_requests WHERE id = rc) = '014fa04a-80a5-41ce-9368-d1a81f6d2eec');
  rj := pg_temp.req('b0000000-0000-4000-8000-00000000000a', 'own2');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('owner lock: Charles cannot change his write bot owner', pg_temp.raises($q$UPDATE agents SET owner_team_member_id = '004cb16a-0000-4000-8000-000000000003' WHERE id = 'b0000000-0000-4000-8000-00000000000c'$q$));
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.ok('owner lock: service role cannot change it', pg_temp.raises($q$UPDATE agents SET owner_team_member_id = NULL WHERE id = 'b0000000-0000-4000-8000-00000000000c'$q$));
  SET LOCAL session_replication_role = replica;
  PERFORM pg_temp.ok('owner lock: replica session cannot change it', pg_temp.raises($q$UPDATE agents SET owner_team_member_id = NULL WHERE id = 'b0000000-0000-4000-8000-00000000000c'$q$));
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.ok('owner lock: agent without write grant still editable', NOT pg_temp.raises($q$UPDATE agents SET name = 'AJ bot 2', owner_team_member_id = owner_team_member_id WHERE id = 'b0000000-0000-4000-8000-00000000000d'$q$)
     AND NOT pg_temp.raises($q$UPDATE agents SET owner_team_member_id = '1fdd684e-6cb7-447e-b616-7e1b9c598971' WHERE id = 'b0000000-0000-4000-8000-00000000000e'$q$));
  UPDATE agents SET owner_team_member_id = NULL WHERE id = 'b0000000-0000-4000-8000-00000000000e';
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.ok('owner lock: AJ can change it', NOT pg_temp.raises($q$UPDATE agents SET owner_team_member_id = '004cb16a-0000-4000-8000-000000000003' WHERE id = 'b0000000-0000-4000-8000-00000000000c'$q$));
  UPDATE agents SET owner_team_member_id = '014fa04a-80a5-41ce-9368-d1a81f6d2eec' WHERE id = 'b0000000-0000-4000-8000-00000000000a';
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('snapshot: after AJ moves Charles bot to Juan, Charles still cannot approve its earlier request', decide_agent_write_request(rc, true)->>'outcome' = 'denied_self_approval');
  PERFORM pg_temp.ok('snapshot: after AJ moves Juan bot to Charles, Charles may still approve its earlier request', decide_agent_write_request(rj, true)->>'outcome' = 'write_approved');
END $$;
SELECT pg_temp.ok('owner lock: trigger fires ALWAYS', (SELECT tgenabled = 'A' FROM pg_trigger WHERE tgname = 'agent_owner_write_lock'));

-- Key lock, key creator, grant delete/removal alerts, owner history (migration 0039)
-- Here agents a (Juan bot) and c (Charles bot) hold write scope; d (AJ bot) and e do not.
DO $$ DECLARE ka uuid; kd uuid; r uuid; o jsonb; BEGIN
  ka := pg_temp.tok('b0000000-0000-4000-8000-00000000000a');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('key lock: Charles cannot mint a key for a write bot', pg_temp.raises($q$INSERT INTO agent_gateway_tokens (agent_id, token_hash) VALUES ('b0000000-0000-4000-8000-00000000000a', 'x1')$q$));
  PERFORM pg_temp.ok('key lock: Charles cannot rotate a write bot key', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET token_hash = 'x2' WHERE id = %L$q$, ka)));
  PERFORM pg_temp.ok('key lock: Charles cannot extend a write bot key', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET expires_at = expires_at + interval '30 days' WHERE id = %L$q$, ka)));
  PERFORM pg_temp.ok('key lock: Charles may revoke a write bot key', NOT pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET revoked_at = now() WHERE id = %L$q$, ka)));
  PERFORM pg_temp.ok('key lock: Charles cannot reactivate a write bot key', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET revoked_at = NULL WHERE id = %L$q$, ka)));
  PERFORM pg_temp.ok('key lock: Charles cannot move a read-bot key onto a write bot', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET agent_id = 'b0000000-0000-4000-8000-00000000000a' WHERE id = %L$q$, pg_temp.tok('b0000000-0000-4000-8000-00000000000d'))));
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.ok('key lock: service role cannot mint for a write bot', pg_temp.raises($q$INSERT INTO agent_gateway_tokens (agent_id, token_hash, created_by_id) VALUES ('b0000000-0000-4000-8000-00000000000a', 'x3', '1fdd684e-6cb7-447e-b616-7e1b9c598971')$q$));
  PERFORM pg_temp.ok('key lock: service role cannot reactivate', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET revoked_at = NULL WHERE id = %L$q$, ka)));
  PERFORM pg_temp.ok('key record: service-role key without a creator refused', pg_temp.raises($q$INSERT INTO agent_gateway_tokens (agent_id, token_hash) VALUES ('b0000000-0000-4000-8000-00000000000e', 'x4')$q$));
  SET LOCAL session_replication_role = replica;
  PERFORM pg_temp.ok('key lock: replica session cannot mint for a write bot', pg_temp.raises($q$INSERT INTO agent_gateway_tokens (agent_id, token_hash, created_by_id) VALUES ('b0000000-0000-4000-8000-00000000000a', 'x5', '1fdd684e-6cb7-447e-b616-7e1b9c598971')$q$));
  PERFORM pg_temp.ok('key lock: replica session cannot rotate', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET token_hash = 'x6' WHERE id = %L$q$, ka)));
  PERFORM pg_temp.ok('key lock: replica session cannot reactivate', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET revoked_at = NULL WHERE id = %L$q$, ka)));
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.ok('key lock: AJ may reactivate, rotate and mint for a write bot',
    NOT pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET revoked_at = NULL WHERE id = %L$q$, ka))
    AND NOT pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET token_hash = 'x7' WHERE id = %L$q$, ka))
    AND NOT pg_temp.raises($q$INSERT INTO agent_gateway_tokens (agent_id, token_hash) VALUES ('b0000000-0000-4000-8000-00000000000a', 'x8')$q$));
  PERFORM pg_temp.ok('key record: creator is the signed-in user, not a supplied value',
    (SELECT created_by_id FROM agent_gateway_tokens WHERE token_hash = 'x8') = '1fdd684e-6cb7-447e-b616-7e1b9c598971');
  PERFORM pg_temp.ok('key record: creator cannot be changed, even by AJ', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET created_by_id = '014fa04a-80a5-41ce-9368-d1a81f6d2eec' WHERE id = %L$q$, ka)));

  -- Charles mints a key for AJ's read-only bot (allowed), then AJ gives that bot write scope.
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
  INSERT INTO agent_gateway_tokens (agent_id, token_hash, created_by_id) VALUES ('b0000000-0000-4000-8000-00000000000d', 'charles-key', '1fdd684e-6cb7-447e-b616-7e1b9c598971') RETURNING id INTO kd;
  PERFORM pg_temp.ok('key record: Charles key records Charles even when AJ is supplied', (SELECT created_by_id FROM agent_gateway_tokens WHERE id = kd) = '014fa04a-80a5-41ce-9368-d1a81f6d2eec');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.give_write(ARRAY['b0000000-0000-4000-8000-00000000000d']::uuid[]);
  PERFORM pg_temp.as_user('');
  o := agent_write_request_create(jsonb_build_object('agent_id','b0000000-0000-4000-8000-00000000000d','token_id',kd,'grant_id',(SELECT id FROM agent_grants WHERE agent_id='b0000000-0000-4000-8000-00000000000d'),
     'integration_id','55694453-95b2-4c49-829b-517a50952d7b','action','meta.ad.pause','account_id','111','object_type','ad','object_id','kc1',
     'before','{}'::jsonb,'after','{}'::jsonb,'diff_text','d','decision_expires_at',now()+interval '1 day'), 1000);
  r := (o->>'id')::uuid;
  PERFORM pg_temp.ok('key snapshot: request stores key and its creator', (SELECT token_id = kd AND token_created_by_id = '014fa04a-80a5-41ce-9368-d1a81f6d2eec' FROM agent_write_requests WHERE id = r));
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('key creator: Charles (made the key) cannot approve', decide_agent_write_request(r, true)->>'outcome' = 'denied_key_creator');
  PERFORM pg_temp.ok('key creator: Charles cannot deny either', decide_agent_write_request(r, false)->>'outcome' = 'denied_key_creator');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.ok('key creator: AJ (not the key creator) may approve', decide_agent_write_request(r, true)->>'outcome' = 'write_approved');
  PERFORM pg_temp.as_user('');
  -- Charles bot c is owned by Juan by now; AJ mints its key.
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  INSERT INTO agent_gateway_tokens (agent_id, token_hash) VALUES ('b0000000-0000-4000-8000-00000000000c', 'x9');
  PERFORM pg_temp.as_user('');
  r := (agent_write_request_create(jsonb_build_object('agent_id','b0000000-0000-4000-8000-00000000000c','token_id',(SELECT id FROM agent_gateway_tokens WHERE token_hash='x9'),'grant_id',(SELECT id FROM agent_grants WHERE agent_id='b0000000-0000-4000-8000-00000000000c'),
     'integration_id','55694453-95b2-4c49-829b-517a50952d7b','action','meta.ad.pause','account_id','111','object_type','ad','object_id','kc2',
     'before','{}'::jsonb,'after','{}'::jsonb,'diff_text','d','decision_expires_at',now()+interval '1 day'), 1000)->>'id')::uuid;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.ok('key creator: AJ approves request on AJ-minted key for Juan-owned bot', decide_agent_write_request(r, true)->>'outcome' = 'write_approved');
  PERFORM pg_temp.as_user('');
  -- Bot a is owned by Charles by now (line ~124); AJ mints its key and may approve.
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.give_write(ARRAY['b0000000-0000-4000-8000-00000000000a']::uuid[]);
  INSERT INTO agent_gateway_tokens (agent_id, token_hash) VALUES ('b0000000-0000-4000-8000-00000000000a', 'aj-juan');
  PERFORM pg_temp.as_user('');
  r := (agent_write_request_create(jsonb_build_object('agent_id','b0000000-0000-4000-8000-00000000000a','token_id',(SELECT id FROM agent_gateway_tokens WHERE token_hash='aj-juan'),'grant_id',(SELECT id FROM agent_grants WHERE agent_id='b0000000-0000-4000-8000-00000000000a'),
     'integration_id','55694453-95b2-4c49-829b-517a50952d7b','action','meta.ad.pause','account_id','111','object_type','ad','object_id','kc6',
     'before','{}'::jsonb,'after','{}'::jsonb,'diff_text','d','decision_expires_at',now()+interval '1 day'), 1000)->>'id')::uuid;
  PERFORM pg_temp.ok('key creator: request on Charles-owned bot records AJ as key creator', (SELECT token_created_by_id FROM agent_write_requests WHERE id = r) = '1fdd684e-6cb7-447e-b616-7e1b9c598971');
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.ok('key creator: AJ approves request on AJ-minted key for Charles-owned bot', decide_agent_write_request(r, true)->>'outcome' = 'write_approved');
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.ok('key snapshot: unknown key refused at create', agent_write_request_create(jsonb_build_object('agent_id','b0000000-0000-4000-8000-00000000000a','token_id',gen_random_uuid(),'action','meta.ad.pause','object_id','kc3'), 1000)->>'outcome' = 'denied_unknown_key');
  PERFORM pg_temp.ok('key snapshot: another agent''s key refused at create', agent_write_request_create(jsonb_build_object('agent_id','b0000000-0000-4000-8000-00000000000a','token_id',kd,'action','meta.ad.pause','object_id','kc4'), 1000)->>'outcome' = 'denied_unknown_key');
  PERFORM pg_temp.ok('key snapshot: missing key refused at create', agent_write_request_create(jsonb_build_object('agent_id','b0000000-0000-4000-8000-00000000000a','action','meta.ad.pause','object_id','kc5'), 1000)->>'outcome' = 'denied_unknown_key');

  -- Grant deletes and write-scope removals alert like additions.
  DELETE FROM agent_access_log WHERE outcome = 'write_control_changed'; DELETE FROM notifications;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  UPDATE agent_grants SET scopes = '{read}' WHERE agent_id = 'b0000000-0000-4000-8000-00000000000c';
  PERFORM pg_temp.ok('removal: write scope removal logged and notified', EXISTS (SELECT 1 FROM agent_access_log WHERE outcome = 'write_control_changed' AND detail LIKE 'write scope removed from grant%' AND agent_id = 'b0000000-0000-4000-8000-00000000000c')
     AND EXISTS (SELECT 1 FROM notifications WHERE type = 'agent_write_control' AND message LIKE 'write scope removed from grant%'));
  PERFORM pg_temp.ok('removal: grant stamped with removal time and owner then', (SELECT write_scope_removed_at IS NOT NULL AND write_scope_removed_owner_id = '004cb16a-0000-4000-8000-000000000003' FROM agent_grants WHERE agent_id = 'b0000000-0000-4000-8000-00000000000c'));
  UPDATE agent_grants SET revoked_at = now() WHERE agent_id = 'b0000000-0000-4000-8000-00000000000d';
  PERFORM pg_temp.ok('removal: revoking a write grant is logged as removal', EXISTS (SELECT 1 FROM agent_access_log WHERE detail LIKE 'write scope removed from grant%' AND agent_id = 'b0000000-0000-4000-8000-00000000000d'));
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('re-grant: Charles cannot un-revoke a write grant', pg_temp.raises($q$UPDATE agent_grants SET revoked_at = NULL WHERE agent_id = 'b0000000-0000-4000-8000-00000000000d'$q$));
  PERFORM pg_temp.as_user('');
  DELETE FROM agent_write_requests WHERE agent_id IN ('b0000000-0000-4000-8000-00000000000a','b0000000-0000-4000-8000-00000000000e');
  DELETE FROM agent_grants WHERE agent_id = 'b0000000-0000-4000-8000-00000000000a';
  PERFORM pg_temp.ok('delete: deleting a write grant (service role) logged and notified', EXISTS (SELECT 1 FROM agent_access_log WHERE detail LIKE 'write scope removed: grant deleted%(no signed-in user)' AND agent_id = 'b0000000-0000-4000-8000-00000000000a')
     AND EXISTS (SELECT 1 FROM notifications WHERE message LIKE 'write scope removed: grant deleted%'));
  SET LOCAL session_replication_role = replica;
  DELETE FROM agent_grants WHERE agent_id = 'b0000000-0000-4000-8000-00000000000e';
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.ok('delete: read grant deleted in a replica session still logged', EXISTS (SELECT 1 FROM agent_access_log WHERE detail LIKE 'grant deleted%' AND agent_id = 'b0000000-0000-4000-8000-00000000000e'));
  PERFORM pg_temp.ok('owner history: owner changes recorded', (SELECT count(*) FROM agent_owner_history WHERE agent_id = 'b0000000-0000-4000-8000-00000000000c') >= 1);
END $$;
SELECT pg_temp.ok('0039 triggers fire ALWAYS', (SELECT count(*) FROM pg_trigger WHERE tgenabled = 'A' AND tgname IN ('agent_gateway_token_write_lock','agent_grants_write_alert','agent_owner_history_record')) = 3);


-- Migration 0042: no caller-supplied key creator, creator immutable for every role, server-side owner confirmation,
-- and a key minted before the write grant.
DO $$ DECLARE kf uuid; gf uuid; o jsonb; BEGIN
  INSERT INTO agents (id, name, owner_team_member_id) VALUES ('b0000000-0000-4000-8000-00000000000f','Late write bot','004cb16a-0000-4000-8000-000000000003');
  INSERT INTO agent_grants (agent_id, integration_id) VALUES ('b0000000-0000-4000-8000-00000000000f','55694453-95b2-4c49-829b-517a50952d7b') RETURNING id INTO gf;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.ok('creator: service role cannot insert a key even with a supplied creator (read bot)', pg_temp.raises($q$INSERT INTO agent_gateway_tokens (agent_id, token_hash, created_by_id) VALUES ('b0000000-0000-4000-8000-00000000000f', 'y1', '1fdd684e-6cb7-447e-b616-7e1b9c598971')$q$));
  SET LOCAL session_replication_role = replica;
  PERFORM pg_temp.ok('creator: replica session cannot insert a key with a supplied creator', pg_temp.raises($q$INSERT INTO agent_gateway_tokens (agent_id, token_hash, created_by_id) VALUES ('b0000000-0000-4000-8000-00000000000f', 'y2', '1fdd684e-6cb7-447e-b616-7e1b9c598971')$q$));
  SET LOCAL session_replication_role = origin;
  -- Juan mints a key for his read-only bot before it holds write.
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000003');
  INSERT INTO agent_gateway_tokens (agent_id, token_hash, created_by_id) VALUES ('b0000000-0000-4000-8000-00000000000f', 'juan-early', '1fdd684e-6cb7-447e-b616-7e1b9c598971') RETURNING id INTO kf;
  PERFORM pg_temp.ok('creator: signed-in creator recorded, supplied value ignored', (SELECT created_by_id FROM agent_gateway_tokens WHERE id = kf) = '004cb16a-0000-4000-8000-000000000003');
  UPDATE agent_gateway_tokens SET revoked_at = now() WHERE id = kf;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.ok('creator: service role cannot change a key creator', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET created_by_id = '1fdd684e-6cb7-447e-b616-7e1b9c598971' WHERE id = %L$q$, kf)));
  SET LOCAL session_replication_role = replica;
  PERFORM pg_temp.ok('creator: replica session cannot change a key creator', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET created_by_id = NULL WHERE id = %L$q$, kf)));
  SET LOCAL session_replication_role = origin;

  -- Owner confirmation is enforced in the database.
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.ok('confirm: AJ direct scope update without confirmation refused', pg_temp.raises(format($q$UPDATE agent_grants SET scopes = '{read,write}' WHERE id = %L$q$, gf)));
  PERFORM pg_temp.ok('confirm: AJ with the wrong confirmed owner refused', pg_temp.raises(format($q$SELECT grant_agent_write_scope(%L, '014fa04a-80a5-41ce-9368-d1a81f6d2eec')$q$, gf)));
  PERFORM pg_temp.ok('confirm: missing confirmed owner refused', pg_temp.raises(format($q$SELECT grant_agent_write_scope(%L, NULL)$q$, gf)));
  INSERT INTO agent_grants (agent_id, integration_id) VALUES ('b0000000-0000-4000-8000-00000000000e','55694453-95b2-4c49-829b-517a50952d7b');
  PERFORM pg_temp.ok('confirm: ownerless bot refused even with a confirmation', pg_temp.raises($q$SELECT grant_agent_write_scope(id, '1fdd684e-6cb7-447e-b616-7e1b9c598971') FROM agent_grants WHERE agent_id = 'b0000000-0000-4000-8000-00000000000e'$q$));
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('confirm: Charles refused even with the correct owner', pg_temp.raises(format($q$SELECT grant_agent_write_scope(%L, '004cb16a-0000-4000-8000-000000000003')$q$, gf)));
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.ok('confirm: AJ with the current owner confirmed succeeds', NOT pg_temp.raises(format($q$SELECT grant_agent_write_scope(%L, '004cb16a-0000-4000-8000-000000000003')$q$, gf)));
  PERFORM pg_temp.ok('confirm: grant now holds write scope', (SELECT 'write' = ANY(scopes) AND revoked_at IS NULL FROM agent_grants WHERE id = gf));
  PERFORM pg_temp.ok('confirm: confirmation does not linger for a later direct update', current_setting('cpm.write_grant_confirmed_owner', true) = '');

  -- The early key is now AJ-only to manage.
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000003');
  PERFORM pg_temp.ok('early key: its creator (Juan) cannot reactivate it after the grant', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET revoked_at = NULL WHERE id = %L$q$, kf)));
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('early key: Charles cannot rotate it', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET token_hash = 'y3' WHERE id = %L$q$, kf)));
  PERFORM pg_temp.ok('early key: Charles cannot extend it', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET expires_at = expires_at + interval '1 day' WHERE id = %L$q$, kf)));
  PERFORM pg_temp.ok('early key: Charles cannot move it off the write bot', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET agent_id = 'b0000000-0000-4000-8000-00000000000e' WHERE id = %L$q$, kf)));
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.ok('early key: service role cannot reactivate it', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET revoked_at = NULL WHERE id = %L$q$, kf)));
  SET LOCAL session_replication_role = replica;
  PERFORM pg_temp.ok('early key: replica session cannot rotate it', pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET token_hash = 'y4' WHERE id = %L$q$, kf)));
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000001');
  PERFORM pg_temp.ok('early key: AJ may reactivate, rotate and extend it',
    NOT pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET revoked_at = NULL WHERE id = %L$q$, kf))
    AND NOT pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET token_hash = 'y5' WHERE id = %L$q$, kf))
    AND NOT pg_temp.raises(format($q$UPDATE agent_gateway_tokens SET expires_at = expires_at + interval '1 day' WHERE id = %L$q$, kf)));
  PERFORM pg_temp.ok('early key: creator still Juan after AJ managed it', (SELECT created_by_id FROM agent_gateway_tokens WHERE id = kf) = '004cb16a-0000-4000-8000-000000000003');
  PERFORM pg_temp.as_user('');
  o := agent_write_request_create(jsonb_build_object('agent_id','b0000000-0000-4000-8000-00000000000f','token_id',kf,'grant_id',gf,
     'integration_id','55694453-95b2-4c49-829b-517a50952d7b','action','meta.ad.pause','account_id','111','object_type','ad','object_id','early1',
     'before','{}'::jsonb,'after','{}'::jsonb,'diff_text','d','decision_expires_at',now()+interval '1 day'), 20);
  PERFORM pg_temp.ok('early key: write request records Juan as the key creator', (o->>'ok')::boolean
     AND (SELECT token_id = kf AND token_created_by_id = '004cb16a-0000-4000-8000-000000000003' FROM agent_write_requests WHERE id = (o->>'id')::uuid));
  PERFORM pg_temp.as_user('aaaaaaaa-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok('early key: Charles (not the creator, not the owner) may approve it', decide_agent_write_request((o->>'id')::uuid, true)->>'outcome' = 'write_approved');
  PERFORM pg_temp.as_user('');
END $$;
SELECT (CASE WHEN pass THEN 'PASS ' ELSE 'FAIL ' END) || name FROM results;
