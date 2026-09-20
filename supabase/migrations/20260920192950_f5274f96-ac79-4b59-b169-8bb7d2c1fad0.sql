CREATE OR REPLACE FUNCTION public.ringfuel_merge_calls(p_rows jsonb, p_event text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  res jsonb;
  v_inserted int := 0;
  v_merged int := 0;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    res := public.ringfuel_merge_call(r, p_event);
    IF (res->>'inserted')::boolean THEN v_inserted := v_inserted + 1;
    ELSE v_merged := v_merged + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', v_inserted, 'merged', v_merged);
END;
$$;

REVOKE ALL ON FUNCTION public.ringfuel_merge_calls(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ringfuel_merge_calls(jsonb, text) TO service_role;