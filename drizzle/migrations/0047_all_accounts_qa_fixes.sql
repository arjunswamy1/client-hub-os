-- 0047: all_accounts QA fixes. Client ad-account map, owner-only blocklist removal with audit, idempotent renewal cron, retire unused bot_qa_log.account_label.
CREATE TABLE IF NOT EXISTS public.client_ad_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
 platform text NOT NULL DEFAULT 'meta',
 account_id text NOT NULL CHECK (account_id ~ '^[0-9]{1,32}$'),
 created_by_id uuid,
 created_at timestamptz DEFAULT now(),
 UNIQUE(platform, account_id, client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_ad_accounts TO authenticated;
GRANT SELECT ON public.client_ad_accounts TO service_role;
ALTER TABLE public.client_ad_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read client ad accounts" ON public.client_ad_accounts FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins insert client ad accounts" ON public.client_ad_accounts FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins update client ad accounts" ON public.client_ad_accounts FOR UPDATE TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins delete client ad accounts" ON public.client_ad_accounts FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
-- Seed only from existing client connection / selected-account fields.
INSERT INTO public.client_ad_accounts(client_id, platform, account_id)
SELECT DISTINCT client_id, 'meta', regexp_replace(ref, '^act_', '') FROM (
 SELECT client_id, COALESCE(selected_ad_account->>'account_id', selected_ad_account->>'id') AS ref FROM public.platform_connections WHERE platform='meta' AND client_id IS NOT NULL AND jsonb_typeof(selected_ad_account)='object'
 UNION SELECT client_id, account_ref FROM public.integrations WHERE provider='meta_ads' AND client_id IS NOT NULL
) s WHERE ref ~ '^(act_)?[0-9]{1,32}$'
ON CONFLICT (platform, account_id, client_id) DO NOTHING;

-- Blocklist: removal and edits are owner-only; inserts/deletes are audited and alerted.
CREATE OR REPLACE FUNCTION public.gateway_blocklist_owner_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.get_team_member_id(auth.uid()) IS DISTINCT FROM public.agent_gateway_write_owner() OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'denied_blocklist_delete_owner';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER gateway_blocklist_owner_lock BEFORE UPDATE OR DELETE ON public.gateway_account_blocklist FOR EACH ROW EXECUTE FUNCTION public.gateway_blocklist_owner_lock();
ALTER TABLE public.gateway_account_blocklist ENABLE ALWAYS TRIGGER gateway_blocklist_owner_lock;
CREATE OR REPLACE FUNCTION public.gateway_blocklist_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.gateway_account_blocklist; o text; actor uuid := public.get_team_member_id(auth.uid());
BEGIN
 IF TG_OP='DELETE' THEN r:=OLD; o:='blocklist_removed'; ELSE r:=NEW; o:='blocklist_added'; END IF;
 INSERT INTO agent_access_log(scope,event_type,outcome,detail,admin_team_member_id,subject_table,resolved_account_id,connection_id)
 VALUES('read','admin',o,jsonb_build_object('account_id',r.account_id,'integration_id',r.integration_id,'reason',r.reason,'actor_team_member_id',actor)::text,actor,'gateway_account_blocklist',r.account_id,r.integration_id);
 INSERT INTO notifications(recipient_id,type,title,message) VALUES(public.agent_gateway_write_owner(),'agent_gateway_'||o,
  CASE WHEN TG_OP='DELETE' THEN 'Gateway blocklist entry removed' ELSE 'Gateway blocklist entry added' END,
  'Account '||r.account_id||' ('||COALESCE(r.integration_id::text,'all integrations')||'): '||r.reason);
 RETURN NULL;
END $$;
CREATE TRIGGER gateway_blocklist_audit AFTER INSERT OR DELETE ON public.gateway_account_blocklist FOR EACH ROW EXECUTE FUNCTION public.gateway_blocklist_audit();
ALTER TABLE public.gateway_account_blocklist ENABLE ALWAYS TRIGGER gateway_blocklist_audit;
DROP POLICY IF EXISTS "Admins manage blocklist" ON public.gateway_account_blocklist;
CREATE POLICY "Admins read blocklist" ON public.gateway_account_blocklist FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins add blocklist" ON public.gateway_account_blocklist FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Owner removes blocklist" ON public.gateway_account_blocklist FOR DELETE TO authenticated USING (public.get_team_member_id(auth.uid()) = public.agent_gateway_write_owner());
CREATE POLICY "Owner edits blocklist" ON public.gateway_account_blocklist FOR UPDATE TO authenticated USING (public.get_team_member_id(auth.uid()) = public.agent_gateway_write_owner()) WITH CHECK (public.get_team_member_id(auth.uid()) = public.agent_gateway_write_owner());

-- Renewal reminder schedule, idempotent; schedule unchanged.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='agent-grant-renewal-prompts') THEN PERFORM cron.unschedule('agent-grant-renewal-prompts'); END IF;
 PERFORM cron.schedule('agent-grant-renewal-prompts','0 15 * * *','SELECT public.agent_grant_renewal_prompts();');
END $$;

-- No code path writes bot_qa_log rows for gateway writes; the label column added in 0046 is unused.
COMMENT ON COLUMN public.bot_qa_log.account_label IS 'DEPRECATED: no code path writes bot_qa_log rows for gateway writes; use agent_write_requests.account_label';
