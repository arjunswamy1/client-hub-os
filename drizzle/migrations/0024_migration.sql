CREATE OR REPLACE FUNCTION public.ringfuel_flag_test_call()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.call_id ~* '^test[-_]' THEN NEW.is_test := true; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ringfuel_flag_test_call ON public.ringfuel_calls;
CREATE TRIGGER ringfuel_flag_test_call BEFORE INSERT OR UPDATE OF call_id ON public.ringfuel_calls
FOR EACH ROW EXECUTE FUNCTION public.ringfuel_flag_test_call();