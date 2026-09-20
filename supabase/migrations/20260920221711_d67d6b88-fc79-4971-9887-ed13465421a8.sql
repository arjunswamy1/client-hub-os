-- WHY THIS SHAPE: the lane originally switched to a restricted role, but a role
-- switch is not permitted inside a definer function and the role cannot be owned
-- here either. So read-only is enforced by SCREENING instead, and the function no
-- longer runs with elevated rights: it executes as its caller (the edge function's
-- service role) and can reach nothing the caller could not already reach. The
-- screen is what makes the lane read-only, so it also refuses the internal
-- routines that a plain SELECT could otherwise use to write.
CREATE OR REPLACE FUNCTION public.bot_readonly_select(p_sql text, p_row_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET statement_timeout TO '5s'
AS $function$
DECLARE
  s text := btrim(coalesce(p_sql, ''));
  lim int := least(greatest(coalesce(p_row_limit, 200), 1), 1000);
  v jsonb;
BEGIN
  s := btrim(regexp_replace(s, ';\s*$', ''));
  IF s = '' THEN
    RAISE EXCEPTION 'bot_readonly_select: empty query';
  END IF;
  IF position(';' IN s) > 0 THEN
    RAISE EXCEPTION 'bot_readonly_select: only a single statement is allowed';
  END IF;
  IF s !~* '^(with|select)\s' THEN
    RAISE EXCEPTION 'bot_readonly_select: only SELECT (or WITH ... SELECT) is allowed';
  END IF;
  IF s ~ '(--|/\*)' THEN
    RAISE EXCEPTION 'bot_readonly_select: comments are not allowed';
  END IF;
  IF s ~* '\y(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|merge|call|do|vacuum|reindex|cluster|comment|listen|notify|lock|prepare|execute|set|reset|import|nextval|setval|dblink|pg_read_file|pg_sleep)\y' THEN
    RAISE EXCEPTION 'bot_readonly_select: the query contains a forbidden keyword';
  END IF;
  -- A SELECT can still write by calling a routine that writes. Name them and refuse.
  IF s ~* '\y(ringfuel_merge_call|ringfuel_merge_calls|enqueue_email|delete_email|read_email_batch|move_to_dlq|email_queue_dispatch|email_queue_wake|update_updated_at_column|client_dids_log_history|shoot_brief_status_changed|bot_readonly_select)\y' THEN
    RAISE EXCEPTION 'bot_readonly_select: that routine can modify data and cannot be called here';
  END IF;
  IF s ~* '(auth\.|vault\.|storage\.|realtime\.|supabase_functions\.|pgsodium|pg_catalog|pg_class|pg_shadow|pg_authid|pg_roles|information_schema|slack_tokens|platform_connections|cron_invocation_tokens|onboarding_tokens|email_unsubscribe_tokens|client_invites|team_invites|token|secret|password|decrypted)' THEN
    RAISE EXCEPTION 'bot_readonly_select: the query touches a blocked schema, table or column';
  END IF;

  EXECUTE format(
    'SELECT coalesce(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (%s) q LIMIT %s) t',
    s, lim
  ) INTO v;

  RETURN v;
END
$function$;

REVOKE ALL ON FUNCTION public.bot_readonly_select(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bot_readonly_select(text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bot_readonly_select(text, integer) TO service_role;