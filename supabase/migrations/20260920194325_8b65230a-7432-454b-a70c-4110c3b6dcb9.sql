ALTER TABLE public.ringfuel_calls
  ADD COLUMN IF NOT EXISTS payload_history jsonb[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- Is this delivery a "rich" (csv_full-shaped) payload? Checks top level plus the
-- usual nesting (call / data / tags) for revenue or campaign markers.
CREATE OR REPLACE FUNCTION public.ringfuel_payload_is_rich(p_payload jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  WITH objs AS (
    SELECT p_payload AS o
    UNION ALL SELECT p_payload->'payload'
    UNION ALL SELECT p_payload->'call'
    UNION ALL SELECT p_payload->'data'
    UNION ALL SELECT p_payload->'tags'
    UNION ALL SELECT p_payload->'payload'->'call'
    UNION ALL SELECT p_payload->'payload'->'data'
    UNION ALL SELECT p_payload->'payload'->'tags'
  )
  SELECT EXISTS (
    SELECT 1 FROM objs
    WHERE jsonb_typeof(o) = 'object'
      AND EXISTS (
        SELECT 1 FROM jsonb_object_keys(o) k
        WHERE lower(k) IN ('revenue','revenue_amount','conversion_revenue',
                           'campaign','campaign_name','campaignname',
                           'converted','is_converted','isconverted')
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.ringfuel_merge_call(p_row jsonb, p_event text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existed boolean := false;
  v_id uuid;
  v_new_payload jsonb := coalesce(p_row->'raw_payload', '{}'::jsonb);
  v_entry jsonb;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.ringfuel_calls c
    WHERE c.client_id = (p_row->>'client_id')::uuid
      AND c.call_id = p_row->>'call_id'
  ) INTO v_existed;

  v_entry := jsonb_build_object(
    'event', coalesce(nullif(p_event,''), nullif(p_row->>'event_type',''), 'unlabelled'),
    'received_at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payload', v_new_payload
  );

  INSERT INTO public.ringfuel_calls AS t (
    client_id, call_id, event_type, campaign_id, campaign_name, did,
    caller_number, caller_state, caller_city, creative_label, call_start,
    duration_seconds, connection_duration_seconds, connected, converted,
    payout, revenue, disposition, recording_url, buyer_name, target_name,
    raw_payload, payload_history, revenue_captured, conversion_captured,
    payload_shape, events_seen
  ) VALUES (
    (p_row->>'client_id')::uuid,
    p_row->>'call_id',
    nullif(p_row->>'event_type',''),
    nullif(p_row->>'campaign_id',''),
    nullif(p_row->>'campaign_name',''),
    nullif(p_row->>'did',''),
    nullif(p_row->>'caller_number',''),
    nullif(p_row->>'caller_state',''),
    nullif(p_row->>'caller_city',''),
    nullif(p_row->>'creative_label',''),
    coalesce(nullif(p_row->>'call_start','')::timestamptz, now()),
    coalesce(nullif(p_row->>'duration_seconds','')::int, 0),
    coalesce(nullif(p_row->>'connection_duration_seconds','')::int, 0),
    coalesce(nullif(p_row->>'connected','')::boolean, false),
    coalesce(nullif(p_row->>'converted','')::boolean, false),
    coalesce(nullif(p_row->>'payout','')::numeric, 0),
    coalesce(nullif(p_row->>'revenue','')::numeric, 0),
    nullif(p_row->>'disposition',''),
    nullif(p_row->>'recording_url',''),
    nullif(p_row->>'buyer_name',''),
    nullif(p_row->>'target_name',''),
    v_new_payload,
    ARRAY[v_entry],
    coalesce(nullif(p_row->>'revenue_captured','')::boolean, false),
    coalesce(nullif(p_row->>'conversion_captured','')::boolean, false),
    CASE WHEN public.ringfuel_payload_is_rich(v_new_payload)
              OR coalesce(nullif(p_row->>'revenue_captured','')::boolean,false)
         THEN 'csv_full'
         ELSE coalesce(nullif(p_row->>'payload_shape',''), 'webhook_minimal') END,
    CASE WHEN coalesce(p_event,'') = '' THEN '{}'::text[] ELSE ARRAY[p_event] END
  )
  ON CONFLICT (client_id, call_id) DO UPDATE SET
    -- MERGE, NEVER REPLACE. An absent or empty incoming field leaves the stored
    -- value untouched: every column is COALESCE(incoming, stored).
    event_type      = coalesce(nullif(p_row->>'event_type',''), t.event_type),
    campaign_id     = coalesce(nullif(p_row->>'campaign_id',''), t.campaign_id),
    campaign_name   = coalesce(nullif(p_row->>'campaign_name',''), t.campaign_name),
    did             = coalesce(nullif(p_row->>'did',''), t.did),
    caller_number   = coalesce(nullif(p_row->>'caller_number',''), t.caller_number),
    caller_state    = coalesce(nullif(p_row->>'caller_state',''), t.caller_state),
    caller_city     = coalesce(nullif(p_row->>'caller_city',''), t.caller_city),
    creative_label  = coalesce(nullif(p_row->>'creative_label',''), t.creative_label),
    call_start      = coalesce(nullif(p_row->>'call_start','')::timestamptz, t.call_start),
    -- Durations grow as the call progresses: newest value wins.
    duration_seconds = coalesce(nullif(p_row->>'duration_seconds','')::int, t.duration_seconds),
    connection_duration_seconds = coalesce(nullif(p_row->>'connection_duration_seconds','')::int, t.connection_duration_seconds),
    connected       = t.connected OR coalesce(nullif(p_row->>'connected','')::boolean, false),
    -- Conversion and payout are only ever set by an event that carries them.
    converted       = coalesce(nullif(p_row->>'converted','')::boolean, t.converted),
    payout          = coalesce(nullif(p_row->>'payout','')::numeric, t.payout),
    revenue         = coalesce(nullif(p_row->>'revenue','')::numeric, t.revenue),
    disposition     = coalesce(nullif(p_row->>'disposition',''), t.disposition),
    recording_url   = coalesce(nullif(p_row->>'recording_url',''), t.recording_url),
    buyer_name      = coalesce(nullif(p_row->>'buyer_name',''), t.buyer_name),
    -- raw_payload keeps the LATEST delivery (never blanked by an empty body).
    raw_payload     = CASE WHEN v_new_payload = '{}'::jsonb THEN t.raw_payload ELSE v_new_payload END,
    -- payload_history is APPEND-ONLY, verbatim, in arrival order, capped at 20.
    payload_history = (
      SELECT CASE WHEN array_length(h,1) > 20
                  THEN h[array_length(h,1)-19 : array_length(h,1)]
                  ELSE h END
      FROM (SELECT coalesce(t.payload_history,'{}'::jsonb[]) || v_entry AS h) s
    ),
    -- Capture flags are STICKY: once genuinely received, a later thin event
    -- cannot un-capture revenue or a conversion.
    revenue_captured    = coalesce(t.revenue_captured,false) OR coalesce(nullif(p_row->>'revenue_captured','')::boolean,false),
    conversion_captured = coalesce(t.conversion_captured,false) OR coalesce(nullif(p_row->>'conversion_captured','')::boolean,false),
    -- payload_shape derives from the WHOLE history, never the latest event alone.
    payload_shape   = CASE
      WHEN t.payload_shape = 'csv_full'
        OR coalesce(t.revenue_captured,false)
        OR coalesce(nullif(p_row->>'revenue_captured','')::boolean,false)
        OR public.ringfuel_payload_is_rich(v_new_payload)
        OR EXISTS (
             SELECT 1 FROM unnest(coalesce(t.payload_history,'{}'::jsonb[])) e
             WHERE public.ringfuel_payload_is_rich(coalesce(e->'payload','{}'::jsonb))
           )
      THEN 'csv_full'
      ELSE coalesce(t.payload_shape, nullif(p_row->>'payload_shape',''), 'webhook_minimal') END,
    events_seen     = CASE WHEN coalesce(p_event,'') = '' THEN t.events_seen
                           ELSE t.events_seen || p_event END,
    target_name     = coalesce(nullif(p_row->>'target_name',''), t.target_name),
    updated_at      = now()
  RETURNING t.id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'merged', v_existed, 'inserted', NOT v_existed);
END;
$function$;

REVOKE ALL ON FUNCTION public.ringfuel_merge_call(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ringfuel_merge_call(jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.ringfuel_payload_is_rich(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ringfuel_payload_is_rich(jsonb) TO service_role;

-- Flag (never delete) the stale test row so it stops counting as a real call.
UPDATE public.ringfuel_calls SET is_test = true WHERE call_id = 'test-1789428624643';