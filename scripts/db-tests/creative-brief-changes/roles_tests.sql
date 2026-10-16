-- Real role tests: RLS on the change log under the real is_admin / has_client_access,
-- grants, cascade, ALWAYS triggers (replica sessions) and the hold rules.
\set A '''b0000000-0000-4000-8000-000000000001'''
\set BB '''b0000000-0000-4000-8000-000000000002'''
CREATE TEMP TABLE r(name text, ok boolean);
-- seed history on both briefs (as postgres, no session = system)
UPDATE creative_briefs SET title = title || ' v2' WHERE id IN (:A, :BB);

-- visible rows per signed-in user: Charles admin, Amy (Alpha only), Dana (Beta assignee), Cara (Beta creator), Olly (nothing)
\set q 'SELECT count(*) FILTER (WHERE brief_id = ''b0000000-0000-4000-8000-000000000001'') AS a, count(*) FILTER (WHERE brief_id = ''b0000000-0000-4000-8000-000000000002'') AS b FROM creative_brief_change_log'
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true); :q \gset admin_
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000003',true); :q \gset amy_
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000004',true); :q \gset dana_
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000005',true); :q \gset cara_
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000006',true); :q \gset olly_
ROLLBACK;
BEGIN; SET LOCAL ROLE authenticated; :q \gset anonsess_
ROLLBACK;
INSERT INTO r VALUES ('admin reads history of every brief', :admin_a > 0 AND :admin_b > 0);
INSERT INTO r VALUES ('client-scoped member reads only their client''s history', :amy_a > 0 AND :amy_b = 0);
INSERT INTO r VALUES ('assignee reads the history of a brief outside their clients', :dana_b > 0 AND :dana_a = 0);
INSERT INTO r VALUES ('creator reads the history of a brief outside their clients', :cara_b > 0 AND :cara_a = 0);
INSERT INTO r VALUES ('unassigned member reads nothing', :olly_a = 0 AND :olly_b = 0);
INSERT INTO r VALUES ('no session reads nothing', :anonsess_a = 0 AND :anonsess_b = 0);

-- grants: no client role may write the log
INSERT INTO r SELECT 'authenticated has SELECT only on the log', has_table_privilege('authenticated','public.creative_brief_change_log','SELECT')
  AND NOT has_table_privilege('authenticated','public.creative_brief_change_log','INSERT') AND NOT has_table_privilege('authenticated','public.creative_brief_change_log','UPDATE')
  AND NOT has_table_privilege('authenticated','public.creative_brief_change_log','DELETE') AND NOT has_table_privilege('authenticated','public.creative_brief_change_log','TRUNCATE');
INSERT INTO r SELECT 'anon has no privilege on the log', NOT has_table_privilege('anon','public.creative_brief_change_log','SELECT')
  AND NOT has_table_privilege('anon','public.creative_brief_change_log','INSERT') AND NOT has_table_privilege('anon','public.creative_brief_change_log','UPDATE')
  AND NOT has_table_privilege('anon','public.creative_brief_change_log','DELETE') AND NOT has_table_privilege('anon','public.creative_brief_change_log','TRUNCATE');
DO $$ BEGIN SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
  INSERT INTO creative_brief_change_log (brief_id, field, actor_kind) VALUES ('b0000000-0000-4000-8000-000000000001','status','user');
  RESET ROLE; INSERT INTO r VALUES ('admin user cannot insert into the log directly', false);
EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; INSERT INTO r VALUES ('admin user cannot insert into the log directly', true); END $$;

-- ALWAYS triggers: a replica session still logs
INSERT INTO r SELECT 'log and hold triggers are ENABLE ALWAYS', (SELECT count(*) FROM pg_trigger WHERE tgname IN ('creative_briefs_log_changes','creative_brief_comments_log_changes','creative_briefs_hold_guard') AND tgenabled = 'A') = 3;
BEGIN; SET LOCAL session_replication_role = replica; UPDATE creative_briefs SET priority = 'high' WHERE id = :A; COMMIT;
INSERT INTO r SELECT 'a replica session change is still logged', EXISTS (SELECT 1 FROM creative_brief_change_log WHERE brief_id = :A AND field = 'priority' AND new_value = 'high');
BEGIN; SET LOCAL session_replication_role = replica;
DO $$ BEGIN UPDATE creative_briefs SET status = 'on_hold' WHERE id = 'b0000000-0000-4000-8000-000000000001'; INSERT INTO r VALUES ('replica session cannot skip the hold reason', false);
EXCEPTION WHEN check_violation THEN INSERT INTO r VALUES ('replica session cannot skip the hold reason', true); END $$;
COMMIT;

-- hold rules
DO $$ BEGIN UPDATE creative_briefs SET status = 'on_hold', hold_reason = '  ' WHERE id = 'b0000000-0000-4000-8000-000000000001'; INSERT INTO r VALUES ('blank hold reason refused', false);
EXCEPTION WHEN check_violation THEN INSERT INTO r VALUES ('blank hold reason refused', true); END $$;
UPDATE creative_briefs SET status = 'on_hold', hold_reason = 'Client paused the launch' WHERE id = :A;
INSERT INTO r SELECT 'hold records reason, start and the original due date', hold_reason = 'Client paused the launch' AND hold_started_at IS NOT NULL AND hold_original_due_date = '2026-10-01' FROM creative_briefs WHERE id = :A;
UPDATE creative_briefs SET due_date = '2026-12-01', hold_started_at = now() - interval '30 days', hold_original_due_date = '2020-01-01' WHERE id = :A;
INSERT INTO r SELECT 'while on hold the start and original due date cannot be rewritten', hold_original_due_date = '2026-10-01' AND hold_started_at > now() - interval '1 hour' FROM creative_briefs WHERE id = :A;
INSERT INTO r SELECT 'hold reason is in the change log', EXISTS (SELECT 1 FROM creative_brief_change_log WHERE brief_id = :A AND field = 'hold_reason' AND new_value = 'Client paused the launch');
UPDATE creative_briefs SET status = 'submitted' WHERE id = :A;
INSERT INTO r SELECT 'leaving hold clears the hold fields', hold_reason IS NULL AND hold_started_at IS NULL AND hold_original_due_date IS NULL FROM creative_briefs WHERE id = :A;
SELECT agent_write_creative_brief(:A, 'a0000000-0000-4000-8000-000000000002', (SELECT updated_at FROM creative_briefs WHERE id = :A), '{"status":"on_hold"}', 'x', 'agent:Grokbot', 'n', false)->>'outcome' AS o \gset w_
INSERT INTO r VALUES ('agent write refuses on_hold without a reason', :'w_o' = 'refused_hold_reason_required');
SELECT agent_write_creative_brief(:A, 'a0000000-0000-4000-8000-000000000002', (SELECT updated_at FROM creative_briefs WHERE id = :A), '{"status":"on_hold","hold_reason":"Waiting on footage"}', 'x', 'agent:Grokbot', 'n', false)->>'outcome' AS o \gset w2_
INSERT INTO r SELECT 'agent write puts on hold with a reason, attributed to the bot', :'w2_o' = 'ok' AND (SELECT hold_reason FROM creative_briefs WHERE id = :A) = 'Waiting on footage'
  AND EXISTS (SELECT 1 FROM creative_brief_change_log WHERE brief_id = :A AND field = 'status' AND new_value = 'on_hold' AND actor_kind = 'bot' AND changed_by_id = 'a0000000-0000-4000-8000-000000000002');

-- cascade: deleting a brief (with comments) and deleting a client both work and take the log with them
INSERT INTO creative_brief_comments (brief_id, author_id, content) VALUES (:BB, 'a0000000-0000-4000-8000-000000000004', 'Draft attached');
DELETE FROM creative_briefs WHERE id = :BB;
INSERT INTO r SELECT 'deleting a brief with history and comments works and removes its log', NOT EXISTS (SELECT 1 FROM creative_briefs WHERE id = :BB) AND NOT EXISTS (SELECT 1 FROM creative_brief_change_log WHERE brief_id = :BB);
DELETE FROM clients WHERE id = 'c1000000-0000-4000-8000-000000000001';
INSERT INTO r SELECT 'deleting a client with briefs and history works', NOT EXISTS (SELECT 1 FROM creative_briefs WHERE id = :A) AND NOT EXISTS (SELECT 1 FROM creative_brief_change_log WHERE brief_id = :A);
SELECT CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || name FROM r;
