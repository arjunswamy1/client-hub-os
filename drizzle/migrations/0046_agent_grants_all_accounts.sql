ALTER TABLE public.agent_grants ADD COLUMN all_accounts boolean NOT NULL DEFAULT false;
ALTER TABLE public.agent_grants ADD CONSTRAINT agent_grants_all_accounts_expiry CHECK (NOT all_accounts OR expires_at IS NOT NULL);
ALTER TABLE public.agent_access_log ADD COLUMN grant_mode text, ADD COLUMN resolved_account_id text, ADD COLUMN connection_id uuid, ADD COLUMN account_mapping text CHECK (account_mapping IN ('mapped','unmapped'));
ALTER TABLE public.agent_write_requests ADD COLUMN account_label text;
ALTER TABLE public.bot_qa_log ADD COLUMN account_label text;
CREATE TABLE public.gateway_cache_epoch (id integer PRIMARY KEY DEFAULT 1 CHECK (id=1), epoch bigint NOT NULL DEFAULT 0);
GRANT ALL ON public.gateway_cache_epoch TO service_role;
ALTER TABLE public.gateway_cache_epoch ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gateway_account_blocklist (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), integration_id uuid REFERENCES public.integrations(id), account_id text NOT NULL CHECK (account_id ~ '^[0-9]{1,32}$'), reason text NOT NULL, created_by_id uuid, created_at timestamptz DEFAULT now(), UNIQUE(integration_id, account_id));
CREATE UNIQUE INDEX gateway_account_blocklist_global_unique ON public.gateway_account_blocklist(account_id) WHERE integration_id IS NULL;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.gateway_account_blocklist TO authenticated;
GRANT SELECT ON public.gateway_account_blocklist TO service_role;
ALTER TABLE public.gateway_account_blocklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage blocklist" ON public.gateway_account_blocklist TO authenticated USING(public.is_admin(auth.uid())) WITH CHECK(public.is_admin(auth.uid()));
CREATE TABLE public.gateway_visible_accounts_cache (integration_id uuid NOT NULL REFERENCES public.integrations(id), token_fingerprint text NOT NULL CHECK (token_fingerprint ~ '^[0-9a-f]{64}$'), account_ids text[] NOT NULL, fetched_at timestamptz NOT NULL, blocklist_epoch bigint NOT NULL, PRIMARY KEY(integration_id,token_fingerprint));
GRANT ALL ON public.gateway_visible_accounts_cache TO service_role;
ALTER TABLE public.gateway_visible_accounts_cache ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gateway_unmapped_account_alerts (agent_id uuid NOT NULL, integration_id uuid NOT NULL, account_id text NOT NULL, alerted_at timestamptz DEFAULT now(), PRIMARY KEY(agent_id,integration_id,account_id));
GRANT ALL ON public.gateway_unmapped_account_alerts TO service_role;
ALTER TABLE public.gateway_unmapped_account_alerts ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gateway_token_expired_alerts (integration_id uuid NOT NULL, alert_day date NOT NULL, created_at timestamptz DEFAULT now(), PRIMARY KEY(integration_id,alert_day));
GRANT ALL ON public.gateway_token_expired_alerts TO service_role;
ALTER TABLE public.gateway_token_expired_alerts ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.gateway_grant_renewal_prompts (grant_id uuid NOT NULL REFERENCES public.agent_grants(id), expires_at timestamptz NOT NULL, prompted_at timestamptz DEFAULT now(), PRIMARY KEY(grant_id,expires_at));
GRANT ALL ON public.gateway_grant_renewal_prompts TO service_role;
ALTER TABLE public.gateway_grant_renewal_prompts ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.gateway_blocklist_epoch_bump() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN INSERT INTO gateway_cache_epoch(id,epoch) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET epoch=gateway_cache_epoch.epoch+1; RETURN NULL; END $$;
CREATE TRIGGER gateway_blocklist_epoch_bump AFTER INSERT OR UPDATE OR DELETE ON public.gateway_account_blocklist FOR EACH STATEMENT EXECUTE FUNCTION public.gateway_blocklist_epoch_bump();
ALTER TABLE public.gateway_account_blocklist ENABLE ALWAYS TRIGGER gateway_blocklist_epoch_bump;
CREATE FUNCTION public.agent_grant_all_accounts_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.all_accounts AND (TG_OP='INSERT' OR NOT OLD.all_accounts) THEN
  IF public.get_team_member_id(auth.uid()) IS DISTINCT FROM public.agent_gateway_write_owner() THEN RAISE EXCEPTION 'denied_all_accounts_owner'; END IF;
  IF NEW.expires_at IS NULL OR NEW.expires_at > now()+interval '90 days' THEN NEW.expires_at:=now()+interval '90 days'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_grant_all_accounts_lock BEFORE INSERT OR UPDATE ON public.agent_grants FOR EACH ROW EXECUTE FUNCTION public.agent_grant_all_accounts_lock();
ALTER TABLE public.agent_grants ENABLE ALWAYS TRIGGER agent_grant_all_accounts_lock;
CREATE FUNCTION public.agent_grant_all_accounts_alert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.all_accounts) OR (TG_OP='UPDATE' AND NEW.all_accounts IS DISTINCT FROM OLD.all_accounts) THEN
  INSERT INTO agent_access_log(scope,event_type,outcome,detail,admin_team_member_id,subject_table,agent_id,grant_id,grant_mode,connection_id) VALUES('read','admin','all_accounts_changed','all_accounts='||NEW.all_accounts::text,public.get_team_member_id(auth.uid()),'agent_grants',NEW.agent_id,NEW.id,CASE WHEN NEW.all_accounts THEN 'all_accounts' ELSE 'explicit' END,NEW.integration_id);
  INSERT INTO notifications(recipient_id,type,title,message) VALUES(public.agent_gateway_write_owner(),'agent_all_accounts_changed','Agent account access changed','Grant '||NEW.id::text||': all_accounts='||NEW.all_accounts::text);
 END IF; RETURN NULL;
END $$;
CREATE TRIGGER agent_grant_all_accounts_alert AFTER INSERT OR UPDATE ON public.agent_grants FOR EACH ROW EXECUTE FUNCTION public.agent_grant_all_accounts_alert();
ALTER TABLE public.agent_grants ENABLE ALWAYS TRIGGER agent_grant_all_accounts_alert;
CREATE FUNCTION public.agent_grant_renewal_prompts() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g record; n integer:=0; inserted integer;
BEGIN
 FOR g IN SELECT id,expires_at FROM agent_grants WHERE all_accounts AND revoked_at IS NULL AND expires_at>now() AND expires_at<=now()+interval '7 days' LOOP
  INSERT INTO gateway_grant_renewal_prompts(grant_id,expires_at) VALUES(g.id,g.expires_at) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted=1 THEN
   INSERT INTO notifications(recipient_id,type,title,message) VALUES(public.agent_gateway_write_owner(),'agent_grant_renewal','All-accounts grant expires soon','Grant '||g.id::text||' expires '||g.expires_at::text); n:=n+1;
  END IF;
 END LOOP; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.agent_grant_renewal_prompts() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agent_grant_renewal_prompts() TO service_role;
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='agent_write_request_create';
 definition:=replace(definition,'object_name, before, after, diff_text, reason, requested_at, decision_expires_at)','object_name, before, after, diff_text, reason, requested_at, decision_expires_at, account_label)');
 definition:=replace(definition,'(p_row->>''decision_expires_at'')::timestamptz)','(p_row->>''decision_expires_at'')::timestamptz, p_row->>''account_label'')');
 EXECUTE definition;
END $$;