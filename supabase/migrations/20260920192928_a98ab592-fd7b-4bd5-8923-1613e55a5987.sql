ALTER TABLE public.ringfuel_calls
  ADD COLUMN IF NOT EXISTS events_seen text[] NOT NULL DEFAULT '{}'::text[];

CREATE OR REPLACE FUNCTION public.ringfuel_merge_call(p_row jsonb, p_event text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existed boolean := false;
  v_id uuid;
BEGIN
  SELECT true INTO v_existed
  FROM public.ringfuel_calls c
  WHERE c.client_id = (p_row->>'client_id')::uuid
    AND c.call_id = p_row->>'call_id';

  INSERT INTO public.ringfuel_calls AS t (
    client_id, call_id, event_type, campaign_id, campaign_name, did,
    caller_number, caller_state, caller_city, creative_label, call_start,
    duration_seconds, connection_duration_seconds, connected, converted,
    payout, revenue, disposition, recording_url, buyer_name, target_name,
    raw_payload, revenue_captured, conversion_captured, payload_shape, events_seen
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
    coalesce(p_row->'raw_payload', '{}'::jsonb),
    coalesce(nullif(p_row->>'revenue_captured','')::boolean, false),
    coalesce(nullif(p_row->>'conversion_captured','')::boolean, false),
    nullif(p_row->>'payload_shape',''),
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
    target_name     = coalesce(nullif(p_row->>'target_name',''), t.target_name),
    -- raw_payload ACCUMULATES: every event's fields survive.
    raw_payload     = coalesce(t.raw_payload,'{}'::jsonb) || coalesce(p_row->'raw_payload','{}'::jsonb),
    -- Capture flags are sticky: once we have genuinely received revenue or a
    -- conversion value, a later thin event cannot un-capture it.
    revenue_captured    = coalesce(t.revenue_captured,false) OR coalesce(nullif(p_row->>'revenue_captured','')::boolean,false),
    conversion_captured = coalesce(t.conversion_captured,false) OR coalesce(nullif(p_row->>'conversion_captured','')::boolean,false),
    payload_shape   = CASE WHEN t.payload_shape = 'csv_full' OR p_row->>'payload_shape' = 'csv_full'
                           THEN 'csv_full' ELSE coalesce(nullif(p_row->>'payload_shape',''), t.payload_shape) END,
    events_seen     = CASE WHEN coalesce(p_event,'') = '' THEN t.events_seen
                           ELSE t.events_seen || p_event END,
    updated_at      = now()
  RETURNING t.id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'merged', v_existed, 'inserted', NOT v_existed);
END;
$$;

REVOKE ALL ON FUNCTION public.ringfuel_merge_call(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ringfuel_merge_call(jsonb, text) TO service_role;