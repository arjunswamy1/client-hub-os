\set B '''b0000000-0000-4000-8000-000000000001'''
CREATE TEMP TABLE r(name text, ok boolean);
-- on_hold accepted by the status rule, and logged
BEGIN; SELECT set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
UPDATE creative_briefs SET status='on_hold', hold_reason='Client paused' WHERE id=:B; COMMIT;
INSERT INTO r SELECT 'on_hold is an allowed status', (SELECT status FROM creative_briefs WHERE id=:B)='on_hold';
INSERT INTO r SELECT 'status change logged with old/new and the signed-in user', EXISTS (SELECT 1 FROM creative_brief_change_log WHERE brief_id=:B AND field='status' AND old_value='draft' AND new_value='on_hold' AND actor_kind='user' AND changed_by_id='a0000000-0000-4000-8000-000000000001' AND via='hub');
DO $$ BEGIN UPDATE creative_briefs SET status='paused' WHERE id='b0000000-0000-4000-8000-000000000001'; INSERT INTO r VALUES ('unknown status refused', false);
EXCEPTION WHEN check_violation THEN INSERT INTO r VALUES ('unknown status refused', true); END $$;
-- bot change via the agent write path attribution
BEGIN; SELECT set_config('app.actor_id','a0000000-0000-4000-8000-000000000002',true), set_config('app.via','agent',true);
UPDATE creative_briefs SET due_date='2026-11-01', assigned_to_id='a0000000-0000-4000-8000-000000000001' WHERE id=:B; COMMIT;
INSERT INTO r SELECT 'bot due-date change attributed to the bot', EXISTS (SELECT 1 FROM creative_brief_change_log WHERE brief_id=:B AND field='due_date' AND old_value='2026-10-01' AND new_value='2026-11-01' AND actor_kind='bot' AND changed_by_id='a0000000-0000-4000-8000-000000000002');
INSERT INTO r SELECT 'assignee change logged', EXISTS (SELECT 1 FROM creative_brief_change_log WHERE brief_id=:B AND field='assigned_to_id' AND old_value IS NULL AND new_value='a0000000-0000-4000-8000-000000000001');
-- no session, no actor: system
UPDATE creative_briefs SET title='Spring static v2', brand_guidelines_url='https://b' WHERE id=:B;
INSERT INTO r SELECT 'title change by an unattributed job logged as system', EXISTS (SELECT 1 FROM creative_brief_change_log WHERE field='title' AND old_value='Spring static' AND new_value='Spring static v2' AND actor_kind='system' AND changed_by_id IS NULL AND via='system');
INSERT INTO r SELECT 'link change logged', EXISTS (SELECT 1 FROM creative_brief_change_log WHERE field='brand_guidelines_url' AND old_value='https://a' AND new_value='https://b');
-- untracked column / no-op
UPDATE creative_briefs SET updated_at=now(), title='Spring static v2' WHERE id=:B;
INSERT INTO r SELECT 'no-op and untracked updates log nothing', (SELECT count(*) FROM creative_brief_change_log)=5;
-- comments
INSERT INTO creative_brief_comments (id, brief_id, author_id, content) VALUES ('d0000000-0000-4000-8000-000000000001', :B, 'a0000000-0000-4000-8000-000000000002', 'Assets are in the folder');
INSERT INTO r SELECT 'bot comment logged as bot', EXISTS (SELECT 1 FROM creative_brief_change_log WHERE field='comment_added' AND new_value='Assets are in the folder' AND actor_kind='bot' AND changed_by_id='a0000000-0000-4000-8000-000000000002');
UPDATE creative_brief_comments SET content='Assets are in the shared folder' WHERE id='d0000000-0000-4000-8000-000000000001';
INSERT INTO r SELECT 'comment edit keeps before and after text', EXISTS (SELECT 1 FROM creative_brief_change_log WHERE field='comment_edited' AND old_value='Assets are in the folder' AND new_value='Assets are in the shared folder' AND comment_id='d0000000-0000-4000-8000-000000000001');
-- another comment that is never deleted keeps its text
INSERT INTO creative_brief_comments (id, brief_id, author_id, content) VALUES ('d0000000-0000-4000-8000-000000000002', :B, 'a0000000-0000-4000-8000-000000000001', 'Keep me');
BEGIN; SELECT set_config('request.jwt.claim.sub','c0000000-0000-4000-8000-000000000001',true);
DELETE FROM creative_brief_comments WHERE id='d0000000-0000-4000-8000-000000000001'; COMMIT;
INSERT INTO r SELECT 'comment deleted: logged with author, who deleted and time, no text', EXISTS (SELECT 1 FROM creative_brief_change_log WHERE field='comment_deleted' AND old_value IS NULL AND new_value IS NULL AND comment_author_id='a0000000-0000-4000-8000-000000000002' AND changed_by_id='a0000000-0000-4000-8000-000000000001' AND created_at IS NOT NULL);
INSERT INTO r SELECT 'deleted comment text scrubbed from every earlier entry', NOT EXISTS (SELECT 1 FROM creative_brief_change_log WHERE comment_id='d0000000-0000-4000-8000-000000000001' AND (old_value IS NOT NULL OR new_value IS NOT NULL))
  AND (SELECT count(*) FROM creative_brief_change_log WHERE comment_id='d0000000-0000-4000-8000-000000000001') = 3
  AND NOT EXISTS (SELECT 1 FROM creative_brief_change_log WHERE old_value LIKE 'Assets are%' OR new_value LIKE 'Assets are%');
INSERT INTO r SELECT 'other comments keep their text', EXISTS (SELECT 1 FROM creative_brief_change_log WHERE comment_id='d0000000-0000-4000-8000-000000000002' AND new_value='Keep me');
SELECT CASE WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || name FROM r;
