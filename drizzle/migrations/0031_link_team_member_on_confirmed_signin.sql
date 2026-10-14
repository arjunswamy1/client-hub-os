CREATE OR REPLACE FUNCTION public.link_team_member_on_confirmed_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND NEW.email IS NOT NULL THEN
    UPDATE public.team_members
       SET user_id = NEW.id
     WHERE user_id IS NULL
       AND is_active = true
       AND COALESCE(is_service_account, false) = false
       AND lower(email) = lower(NEW.email)
       AND NOT EXISTS (SELECT 1 FROM public.team_members t2 WHERE t2.user_id = NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- never block sign-in
END $$;
REVOKE ALL ON FUNCTION public.link_team_member_on_confirmed_auth_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER link_team_member_on_auth_insert AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.link_team_member_on_confirmed_auth_user();
CREATE TRIGGER link_team_member_on_auth_confirm AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.link_team_member_on_confirmed_auth_user();