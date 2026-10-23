-- 'Allow all changes' (migration 0048). Run against the deployed schema with a privileged session.
-- Ends by raising ALL_PASS_ROLLED_BACK, so every fixture, audit row and notification is rolled back.
DO $$
DECLARE aj uuid := public.agent_gateway_write_owner(); ch uuid := '014fa04a-80a5-41ce-9368-d1a81f6d2eec';
  aj_uid text; ch_uid text; i1 uuid; i2 uuid; i3 uuid; ag uuid; g1 uuid; g2 uuid; gx uuid; r jsonb; n int; passed text[] := '{}';
  msg text;
BEGIN
  SELECT user_id::text INTO aj_uid FROM team_members WHERE id = aj;
  SELECT user_id::text INTO ch_uid FROM team_members WHERE id = ch;
  PERFORM set_config('request.jwt.claim.sub', aj_uid, true);
  INSERT INTO integrations(provider,label) VALUES('meta_ads','DBTEST meta 1') RETURNING id INTO i1;
  INSERT INTO integrations(provider,label) VALUES('meta_ads','DBTEST meta 2') RETURNING id INTO i2;
  INSERT INTO integrations(provider,label) VALUES('meta_ads','DBTEST meta 3') RETURNING id INTO i3;
  INSERT INTO agents(name,kind,team,owner_team_member_id,created_by_id,status) VALUES('DBTEST agent','ai_agent','ops',ch,aj,'active') RETURNING id INTO ag;
  INSERT INTO agent_grants(agent_id,integration_id,scopes,created_at) VALUES(ag,i1,'{read}',now()-interval '2 min') RETURNING id INTO g1;
  INSERT INTO agent_grants(agent_id,integration_id,scopes,created_at) VALUES(ag,i2,'{read}',now()-interval '1 min') RETURNING id INTO g2;

  -- 1 non-AJ refused
  PERFORM set_config('request.jwt.claim.sub', ch_uid, true);
  BEGIN PERFORM grant_agent_write_scope_all(ag, ch, 'test reason'); RAISE EXCEPTION 'NOT_REFUSED';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'denied_not_write_owner' THEN RAISE EXCEPTION 'non-AJ FAILED: %', SQLERRM; END IF; END;
  passed := passed || 'non-AJ refused'::text;
  PERFORM set_config('request.jwt.claim.sub', aj_uid, true);
  -- 2 owner mismatch refused
  BEGIN PERFORM grant_agent_write_scope_all(ag, aj, 'test reason'); RAISE EXCEPTION 'NOT_REFUSED';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'denied_owner_mismatch' THEN RAISE EXCEPTION 'owner mismatch FAILED: %', SQLERRM; END IF; END;
  passed := passed || 'owner mismatch refused'::text;
  -- 3 all-or-nothing: second grant fails after the first was granted in the same call
  EXECUTE format($f$CREATE FUNCTION pg_temp.fail_g2() RETURNS trigger LANGUAGE plpgsql AS $b$ BEGIN
    IF NEW.id = %L AND 'write' = ANY(NEW.scopes) THEN RAISE EXCEPTION 'midloop g1_write=%%', (SELECT 'write' = ANY(scopes) FROM public.agent_grants WHERE id = %L); END IF; RETURN NEW; END $b$$f$, g2, g1);
  CREATE TRIGGER zz_dbtest_fail_g2 BEFORE UPDATE ON agent_grants FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_g2();
  BEGIN PERFORM grant_agent_write_scope_all(ag, ch, 'test reason'); RAISE EXCEPTION 'NOT_REFUSED';
  EXCEPTION WHEN OTHERS THEN msg := SQLERRM; END;
  IF msg <> 'midloop g1_write=true' THEN RAISE EXCEPTION 'mid-loop setup FAILED: %', msg; END IF;
  IF EXISTS (SELECT 1 FROM agent_grants WHERE agent_id = ag AND 'write' = ANY(scopes)) THEN RAISE EXCEPTION 'all-or-nothing FAILED'; END IF;
  DROP TRIGGER zz_dbtest_fail_g2 ON agent_grants;
  passed := passed || 'all-or-nothing on mid-loop failure'::text;
  -- 4 pre-0040 key refused (RPC and arming)
  BEGIN
    INSERT INTO agent_gateway_tokens(agent_id,token_hash,token_prefix,created_at) VALUES(ag,md5(random()::text),'dbtest_old',public.agent_key_lock_cutoff()-interval '1 day');
    BEGIN PERFORM grant_agent_write_scope_all(ag, ch, 'test reason'); RAISE EXCEPTION 'NOT_REFUSED';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'denied_pre_0040_key' THEN RAISE EXCEPTION 'pre-0040 RPC FAILED: %', SQLERRM; END IF; END;
    BEGIN UPDATE agents SET write_by_default = true, write_default_confirmed_owner_id = ch WHERE id = ag; RAISE EXCEPTION 'NOT_REFUSED';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'denied_pre_0040_key' THEN RAISE EXCEPTION 'pre-0040 arm FAILED: %', SQLERRM; END IF; END;
    RAISE EXCEPTION 'case_ok';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'case_ok' THEN RAISE; END IF; END;
  passed := passed || 'pre-0040 key refused'::text;
  -- 5 leaked key refused; leaked flag needs an admin session
  BEGIN
    INSERT INTO agent_gateway_tokens(agent_id,token_hash,token_prefix) VALUES(ag,md5(random()::text),'dbtest_new') RETURNING id INTO gx;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    BEGIN UPDATE agent_gateway_tokens SET leaked = true WHERE id = gx; RAISE EXCEPTION 'NOT_REFUSED';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'denied_leaked_flag_admin' THEN RAISE EXCEPTION 'leaked flag lock FAILED: %', SQLERRM; END IF; END;
    PERFORM set_config('request.jwt.claim.sub', aj_uid, true);
    UPDATE agent_gateway_tokens SET leaked = true WHERE id = gx;
    IF NOT EXISTS (SELECT 1 FROM agent_gateway_tokens WHERE id = gx AND leaked_marked_by = aj AND leaked_marked_at IS NOT NULL) THEN RAISE EXCEPTION 'leaked marker FAILED'; END IF;
    BEGIN PERFORM grant_agent_write_scope_all(ag, ch, 'test reason'); RAISE EXCEPTION 'NOT_REFUSED';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'denied_leaked_key' THEN RAISE EXCEPTION 'leaked RPC FAILED: %', SQLERRM; END IF; END;
    RAISE EXCEPTION 'case_ok';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'case_ok' THEN RAISE; END IF; END;
  passed := passed || 'leaked key refused; leaked flag admin-only'::text;
  -- 6 all_accounts needs explicit confirm; then success, then idempotent skip
  BEGIN
    UPDATE agent_grants SET all_accounts = true, expires_at = now() + interval '30 days' WHERE id = g1;
    BEGIN PERFORM grant_agent_write_scope_all(ag, ch, 'test reason'); RAISE EXCEPTION 'NOT_REFUSED';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'denied_all_accounts_unconfirmed' THEN RAISE EXCEPTION 'all_accounts confirm FAILED: %', SQLERRM; END IF; END;
    r := grant_agent_write_scope_all(ag, ch, 'test reason', true);
    IF (r->>'granted')::int <> 2 THEN RAISE EXCEPTION 'confirmed grant FAILED: %', r; END IF;
    RAISE EXCEPTION 'case_ok';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'case_ok' THEN RAISE; END IF; END;
  r := grant_agent_write_scope_all(ag, ch, 'test reason');
  IF (r->>'granted')::int <> 2 OR (r->>'skipped')::int <> 0 THEN RAISE EXCEPTION 'grant_all FAILED: %', r; END IF;
  r := grant_agent_write_scope_all(ag, ch, 'test reason');
  IF (r->>'granted')::int <> 0 OR (r->>'skipped')::int <> 2 THEN RAISE EXCEPTION 'grant_all repeat FAILED: %', r; END IF;
  passed := passed || 'all_accounts needs confirm; grant_all returns granted/skipped'::text;
  -- 7 revoke_all by an admin (Charles, not the write owner)
  PERFORM set_config('request.jwt.claim.sub', ch_uid, true);
  r := revoke_agent_write_scope_all(ag, 'test reason');
  IF (r->>'revoked')::int <> 2 OR EXISTS (SELECT 1 FROM agent_grants WHERE agent_id = ag AND 'write' = ANY(scopes)) THEN RAISE EXCEPTION 'revoke_all FAILED: %', r; END IF;
  passed := passed || 'revoke_all works for an admin'::text;
  -- 8 write_by_default set by non-AJ refused
  BEGIN UPDATE agents SET write_by_default = true, write_default_confirmed_owner_id = ch WHERE id = ag; RAISE EXCEPTION 'NOT_REFUSED';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'denied_write_default_owner' THEN RAISE EXCEPTION 'non-AJ arm FAILED: %', SQLERRM; END IF; END;
  passed := passed || 'write_by_default by non-AJ refused'::text;
  -- 9 AJ arms; inheritance per grant with notification and 90-day clamp
  PERFORM set_config('request.jwt.claim.sub', aj_uid, true);
  UPDATE agents SET write_by_default = true, write_default_confirmed_owner_id = ch WHERE id = ag;
  IF NOT EXISTS (SELECT 1 FROM agents WHERE id = ag AND write_default_set_by = aj) THEN RAISE EXCEPTION 'arm FAILED'; END IF;
  DELETE FROM agent_grants WHERE id IN (g1, g2);
  INSERT INTO agent_grants(agent_id,integration_id,scopes,expires_at) VALUES(ag,i1,'{read}',now()+interval '365 days') RETURNING id INTO g1;
  INSERT INTO agent_grants(agent_id,integration_id,scopes) VALUES(ag,i2,'{read}') RETURNING id INTO g2;
  IF (SELECT count(*) FROM agent_grants WHERE id IN (g1,g2) AND 'write' = ANY(scopes) AND expires_at <= now() + interval '90 days') <> 2 THEN RAISE EXCEPTION 'inheritance/clamp FAILED'; END IF;
  SELECT count(*) INTO n FROM notifications WHERE type = 'agent_write_inherited' AND recipient_id = aj AND (message LIKE '%'||g1::text||'%' OR message LIKE '%'||g2::text||'%');
  IF n <> 2 THEN RAISE EXCEPTION 'per-grant notification FAILED: %', n; END IF;
  passed := passed || 'inheritance notifies per grant and clamps 90 days'::text;
  -- 10 exception does NOT apply on UPDATE
  UPDATE agent_grants SET scopes = '{read}' WHERE id = g2;
  BEGIN UPDATE agent_grants SET scopes = '{read,write}' WHERE id = g2; RAISE EXCEPTION 'NOT_REFUSED';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'write scope needs a confirmed owner%' THEN RAISE EXCEPTION 'UPDATE exception FAILED: %', SQLERRM; END IF; END;
  passed := passed || 'no exception on UPDATE'::text;
  -- 11 exception does NOT apply when set_by is not AJ
  BEGIN
    ALTER TABLE agents DISABLE TRIGGER agent_write_default_lock;
    UPDATE agents SET write_default_set_by = ch WHERE id = ag;
    ALTER TABLE agents ENABLE ALWAYS TRIGGER agent_write_default_lock;
    INSERT INTO agent_grants(agent_id,integration_id,scopes) VALUES(ag,i3,'{read}') RETURNING id INTO gx;
    IF EXISTS (SELECT 1 FROM agent_grants WHERE id = gx AND 'write' = ANY(scopes)) THEN RAISE EXCEPTION 'set_by exception FAILED'; END IF;
    RAISE EXCEPTION 'case_ok';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'case_ok' THEN RAISE; END IF; END;
  passed := passed || 'no exception when set_by is not AJ'::text;
  -- 12 exception does NOT apply for all_accounts without confirmation; does with it
  BEGIN
    INSERT INTO agent_grants(agent_id,integration_id,scopes,all_accounts,expires_at) VALUES(ag,i3,'{read}',true,now()+interval '30 days') RETURNING id INTO gx;
    IF EXISTS (SELECT 1 FROM agent_grants WHERE id = gx AND 'write' = ANY(scopes)) THEN RAISE EXCEPTION 'all_accounts unconfirmed exception FAILED'; END IF;
    DELETE FROM agent_grants WHERE id = gx;
    UPDATE agents SET write_default_all_accounts_confirmed = true WHERE id = ag;
    INSERT INTO agent_grants(agent_id,integration_id,scopes,all_accounts,expires_at) VALUES(ag,i3,'{read}',true,now()+interval '30 days') RETURNING id INTO gx;
    IF NOT EXISTS (SELECT 1 FROM agent_grants WHERE id = gx AND 'write' = ANY(scopes)) THEN RAISE EXCEPTION 'all_accounts confirmed inheritance FAILED'; END IF;
    RAISE EXCEPTION 'case_ok';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'case_ok' THEN RAISE; END IF; END;
  passed := passed || 'no exception for all_accounts without confirmation'::text;
  -- 13 exception does NOT apply when owner differs from the confirmed owner
  BEGIN
    ALTER TABLE agents DISABLE TRIGGER agent_write_default_lock;
    UPDATE agents SET write_default_confirmed_owner_id = aj WHERE id = ag;
    ALTER TABLE agents ENABLE ALWAYS TRIGGER agent_write_default_lock;
    INSERT INTO agent_grants(agent_id,integration_id,scopes) VALUES(ag,i3,'{read}') RETURNING id INTO gx;
    IF EXISTS (SELECT 1 FROM agent_grants WHERE id = gx AND 'write' = ANY(scopes)) THEN RAISE EXCEPTION 'owner-changed exception FAILED'; END IF;
    RAISE EXCEPTION 'case_ok';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'case_ok' THEN RAISE; END IF; END;
  passed := passed || 'no exception when owner changed'::text;
  -- 14 owner change clears write_by_default
  UPDATE agents SET owner_team_member_id = aj WHERE id = ag;
  IF EXISTS (SELECT 1 FROM agents WHERE id = ag AND (write_by_default OR write_default_set_by IS NOT NULL OR write_default_confirmed_owner_id IS NOT NULL)) THEN RAISE EXCEPTION 'owner change clear FAILED'; END IF;
  passed := passed || 'owner change clears write_by_default'::text;
  -- 15 kill switch row (execution refusal itself is a gateway unit test)
  UPDATE agent_gateway_settings SET writes_enabled = NOT writes_enabled WHERE id = 1;
  UPDATE agent_gateway_settings SET writes_enabled = false WHERE id = 1;
  IF (SELECT writes_enabled FROM agent_gateway_settings WHERE id = 1) THEN RAISE EXCEPTION 'kill switch FAILED'; END IF;
  passed := passed || 'writes_enabled can be switched off by AJ (rolled back)'::text;
  RAISE EXCEPTION 'ALL_PASS_ROLLED_BACK (%): %', array_length(passed, 1), array_to_string(passed, '; ');
END $$;
