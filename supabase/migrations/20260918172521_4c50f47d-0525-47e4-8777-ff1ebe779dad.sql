-- Read-only daily rollups for the data integrity monitor. Both functions only
-- ever SELECT; table names come from a fixed allowlist, never from the caller.
CREATE OR REPLACE FUNCTION public.integrity_daily_call_feed(
  p_client_id uuid, p_table text, p_since date
) RETURNS TABLE(d date, calls bigint, converted bigint, revenue numeric, payout numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_date_col text;
  v_conv text := 'false';
  v_rev text := '0';
  v_pay text := '0';
BEGIN
  IF p_table = 'ringba_calls' THEN
    v_date_col := 'call_date'; v_conv := 'coalesce(converted,false)'; v_rev := 'coalesce(revenue,0)'; v_pay := 'coalesce(payout,0)';
  ELSIF p_table = 'ringfuel_calls' THEN
    v_date_col := 'call_start'; v_conv := 'coalesce(converted,false)'; v_rev := 'coalesce(revenue,0)'; v_pay := 'coalesce(payout,0)';
  ELSIF p_table = 'moja_calls' THEN
    v_date_col := 'call_start'; v_conv := 'coalesce(converted,false)'; v_rev := 'coalesce(revenue,0)'; v_pay := 'coalesce(payout,0)';
  ELSIF p_table = 'ringba_calls_4js' THEN
    v_date_col := 'call_start'; v_pay := 'coalesce(payout,0)';
  ELSIF p_table = 'cannaball_calls' THEN
    v_date_col := 'call_start'; v_pay := 'coalesce(payout,0)';
  ELSE
    RAISE EXCEPTION 'integrity_daily_call_feed: table % is not allowed', p_table;
  END IF;

  RETURN QUERY EXECUTE format(
    'select (%1$I)::date as d, count(*)::bigint,
            count(*) filter (where %2$s or %3$s > 0)::bigint,
            sum(%3$s)::numeric, sum(%4$s)::numeric
     from public.%5$I
     where client_id = $1 and %1$I >= $2
     group by 1 order by 1',
    v_date_col, v_conv, v_rev, v_pay, p_table
  ) USING p_client_id, p_since;
END; $$;

CREATE OR REPLACE FUNCTION public.integrity_daily_spend_feed(
  p_client_id uuid, p_table text, p_platforms text[], p_since date
) RETURNS TABLE(d date, spend numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_filter text := 'true';
BEGIN
  IF p_table NOT IN ('ad_daily_metrics', 'ad_campaigns', 'roku_daily_metrics', 'universal_ads_geo_metrics') THEN
    RAISE EXCEPTION 'integrity_daily_spend_feed: table % is not allowed', p_table;
  END IF;
  IF p_platforms IS NOT NULL AND array_length(p_platforms, 1) > 0 THEN
    v_filter := 'platform = any($3)';
  END IF;

  RETURN QUERY EXECUTE format(
    'select date::date as d, sum(coalesce(spend,0))::numeric
     from public.%1$I where client_id = $1 and date >= $2 and %2$s
     group by 1 order by 1',
    p_table, v_filter
  ) USING p_client_id, p_since, p_platforms;
END; $$;

REVOKE ALL ON FUNCTION public.integrity_daily_call_feed(uuid, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.integrity_daily_spend_feed(uuid, text, text[], date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.integrity_daily_call_feed(uuid, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.integrity_daily_spend_feed(uuid, text, text[], date) TO service_role;