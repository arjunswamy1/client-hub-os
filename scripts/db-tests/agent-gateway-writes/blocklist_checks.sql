-- Run against the deployed schema. Every mutation, audit row and notification is rolled back.
-- Triggers are tested as the privileged migration role (they are ENABLE ALWAYS, so RLS is not what refuses here); the RLS split is checked from pg_policies below.
BEGIN;
DO $$ DECLARE owner_uid uuid; admin_uid uuid; refused boolean:=false; n int; acct text:='999000111222333'; BEGIN
 SELECT user_id INTO owner_uid FROM public.team_members WHERE id=public.agent_gateway_write_owner();
 SELECT user_id INTO admin_uid FROM public.team_members WHERE role='admin' AND user_id IS NOT NULL AND id<>public.agent_gateway_write_owner() LIMIT 1;
 IF admin_uid IS NULL THEN RAISE EXCEPTION 'An admin non-owner fixture is required'; END IF;
 -- Admin (non-owner) insert: allowed, logged and notified.
 PERFORM set_config('request.jwt.claim.sub',admin_uid::text,true);
 INSERT INTO public.gateway_account_blocklist(account_id,reason) VALUES(acct,'db-test');
 IF NOT EXISTS(SELECT 1 FROM public.agent_access_log WHERE outcome='blocklist_added' AND resolved_account_id=acct AND event_type='admin' AND detail::jsonb->>'actor_team_member_id'=(SELECT id::text FROM public.team_members WHERE user_id=admin_uid)) THEN RAISE EXCEPTION 'admin insert log FAILED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE type='agent_gateway_blocklist_added' AND recipient_id=public.agent_gateway_write_owner() AND message LIKE '%'||acct||'%') THEN RAISE EXCEPTION 'admin insert notify FAILED'; END IF;
 RAISE NOTICE 'PASS admin insert allowed, logged and notified';
 -- Admin (non-owner) delete and update: refused.
 BEGIN DELETE FROM public.gateway_account_blocklist WHERE account_id=acct; GET DIAGNOSTICS n=ROW_COUNT;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='denied_blocklist_delete_owner' THEN refused:=true; ELSE RAISE; END IF; END;
 IF NOT refused AND n<>0 THEN RAISE EXCEPTION 'admin delete refusal FAILED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.gateway_account_blocklist WHERE account_id=acct) THEN RAISE EXCEPTION 'admin delete refusal FAILED (row gone)'; END IF;
 refused:=false;
 BEGIN UPDATE public.gateway_account_blocklist SET account_id='1' WHERE account_id=acct;
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='denied_blocklist_delete_owner' THEN refused:=true; ELSE RAISE; END IF; END;
 IF NOT refused THEN RAISE EXCEPTION 'non-owner update refusal FAILED'; END IF;
 RAISE NOTICE 'PASS admin non-owner delete and update refused';
 -- Owner delete: allowed, logged and notified.
 PERFORM set_config('request.jwt.claim.sub',owner_uid::text,true);
 DELETE FROM public.gateway_account_blocklist WHERE account_id=acct;
 IF EXISTS(SELECT 1 FROM public.gateway_account_blocklist WHERE account_id=acct) THEN RAISE EXCEPTION 'owner delete FAILED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.agent_access_log WHERE outcome='blocklist_removed' AND resolved_account_id=acct) THEN RAISE EXCEPTION 'owner delete log FAILED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE type='agent_gateway_blocklist_removed' AND message LIKE '%'||acct||'%') THEN RAISE EXCEPTION 'owner delete notify FAILED'; END IF;
 RAISE NOTICE 'PASS owner delete allowed, logged and notified';
 -- No session (service role): delete refused.
 PERFORM set_config('request.jwt.claim.sub','',true); refused:=false;
 BEGIN DELETE FROM public.gateway_account_blocklist WHERE account_id='448669084867269';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='denied_blocklist_delete_owner' THEN refused:=true; ELSE RAISE; END IF; END;
 IF NOT refused THEN RAISE EXCEPTION 'no-session delete refusal FAILED'; END IF;
 RAISE NOTICE 'PASS no-session delete refused';
END $$;
ROLLBACK;
SELECT count(*) AS blocklist_seeds FROM public.gateway_account_blocklist WHERE account_id IN ('448669084867269','1370793061763134');
SELECT policyname, cmd FROM pg_policies WHERE tablename='gateway_account_blocklist' ORDER BY cmd;
