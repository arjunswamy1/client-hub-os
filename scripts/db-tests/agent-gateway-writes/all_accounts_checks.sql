-- Run against the deployed schema. Every mutation and generated audit is rolled back.
BEGIN;
DO $$ DECLARE g uuid; blocked boolean:=false; constrained boolean:=false; BEGIN
 PERFORM set_config('request.jwt.claim.sub','',true);
 SELECT id INTO g FROM public.agent_grants LIMIT 1;
 IF g IS NULL THEN RAISE EXCEPTION 'A grant fixture is required'; END IF;
 BEGIN UPDATE public.agent_grants SET all_accounts=true WHERE id=g;
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='denied_all_accounts_owner' THEN blocked:=true; ELSE RAISE; END IF;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'no-session enable test FAILED'; END IF;
 PERFORM set_config('request.jwt.claim.sub',(SELECT user_id::text FROM public.team_members WHERE id=public.agent_gateway_write_owner()),true);
 UPDATE public.agent_grants SET all_accounts=true,expires_at=NULL WHERE id=g;
 IF NOT EXISTS(SELECT 1 FROM public.agent_grants WHERE id=g AND expires_at<=now()+interval '90 days' AND expires_at IS NOT NULL) THEN RAISE EXCEPTION '90-day clamp FAILED'; END IF;
 BEGIN UPDATE public.agent_grants SET expires_at=NULL WHERE id=g;
 EXCEPTION WHEN check_violation THEN constrained:=true; END;
 IF NOT constrained THEN RAISE EXCEPTION 'expiry constraint FAILED'; END IF;
 IF (SELECT count(*) FROM public.gateway_account_blocklist WHERE integration_id IS NULL AND account_id IN ('448669084867269','1370793061763134'))<>2 THEN RAISE EXCEPTION 'seeds FAILED'; END IF;
END $$;
ROLLBACK;
SELECT count(*) as all_accounts_enabled FROM public.agent_grants WHERE all_accounts;