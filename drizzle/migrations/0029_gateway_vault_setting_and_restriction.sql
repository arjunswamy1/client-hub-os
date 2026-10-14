ALTER TABLE public.agent_gateway_settings ADD COLUMN IF NOT EXISTS default_vault text NOT NULL DEFAULT 'CPM Bot Vault';
ALTER TABLE public.integrations DROP CONSTRAINT integrations_op_secret_ref_check;
ALTER TABLE public.integrations ADD CONSTRAINT integrations_op_secret_ref_check CHECK (op_secret_ref IS NULL OR op_secret_ref ~ '^op://[^/\t\r\n]+/[^/\t\r\n]+(/[^/\t\r\n]+)+$');
ALTER TABLE public.integrations ADD COLUMN IF NOT EXISTS restricted_owner_team_member_id uuid REFERENCES public.team_members(id);
COMMENT ON COLUMN public.integrations.restricted_owner_team_member_id IS 'When set, only agents owned by this team member may be granted or use this account.';
CREATE OR REPLACE FUNCTION public.agent_grant_owner_restriction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_agent_owner uuid;
BEGIN
  SELECT restricted_owner_team_member_id INTO v_owner FROM integrations WHERE id = NEW.integration_id;
  IF v_owner IS NOT NULL THEN
    SELECT owner_team_member_id INTO v_agent_owner FROM agents WHERE id = NEW.agent_id;
    IF v_agent_owner IS DISTINCT FROM v_owner THEN
      RAISE EXCEPTION 'This account is restricted to one owner''s agent';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agent_grants_owner_restriction BEFORE INSERT OR UPDATE ON public.agent_grants FOR EACH ROW EXECUTE FUNCTION public.agent_grant_owner_restriction();