CREATE OR REPLACE FUNCTION public.refuse_service_account_assignee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  v_id := NULLIF(to_jsonb(NEW) ->> (CASE TG_TABLE_NAME WHEN 'creative_briefs' THEN 'assigned_to_id' ELSE 'assignee_id' END), '')::uuid;
  IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.team_members WHERE id = v_id AND is_service_account) THEN
    RAISE EXCEPTION 'a service account cannot be assigned work' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;