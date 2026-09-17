-- Working-hours elapsed time: Mon-Fri, 09:00-18:00 America/New_York.
CREATE OR REPLACE FUNCTION public.working_hours_between(p_start timestamptz, p_end timestamptz)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  s timestamp; e timestamp; d date;
  a timestamp; b timestamp; total numeric := 0;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN RETURN 0; END IF;
  s := p_start AT TIME ZONE 'America/New_York';
  e := p_end AT TIME ZONE 'America/New_York';
  d := s::date;
  WHILE d <= e::date LOOP
    IF EXTRACT(isodow FROM d) BETWEEN 1 AND 5 THEN
      a := GREATEST(s, d + time '09:00');
      b := LEAST(e, d + time '18:00');
      IF b > a THEN total := total + EXTRACT(epoch FROM (b - a)) / 3600.0; END IF;
    END IF;
    d := d + 1;
  END LOOP;
  RETURN round(total, 2);
END;
$$;

CREATE INDEX IF NOT EXISTS context_items_slack_channel_idx
  ON public.context_items ((metadata->>'channel_id'), occurred_at)
  WHERE source = 'slack';

CREATE INDEX IF NOT EXISTS context_items_slack_class_idx
  ON public.context_items ((metadata->>'message_class'))
  WHERE source = 'slack';

CREATE OR REPLACE VIEW public.slack_unanswered_client_questions
WITH (security_invoker = true) AS
WITH q AS (
  SELECT
    ci.id,
    ci.client_id,
    ci.content                              AS question,
    COALESCE(ci.participants[1], 'Unknown') AS author,
    ci.occurred_at                          AS asked_at,
    ci.metadata->>'channel_id'              AS channel_id,
    ci.metadata->>'channel_name'            AS channel_name,
    ci.metadata->>'slack_ts'                AS slack_ts,
    ci.metadata->>'thread_ts'               AS thread_ts,
    COALESCE(ci.metadata->>'thread_ts', ci.metadata->>'slack_ts') AS thread_root_ts,
    ci.metadata->>'permalink'               AS permalink
  FROM public.context_items ci
  WHERE ci.source = 'slack'
    AND ci.metadata->>'message_class' = 'client_question'
)
SELECT
  q.id,
  q.client_id,
  c.name AS client_name,
  q.channel_id,
  q.channel_name,
  q.author,
  q.question,
  q.asked_at,
  q.permalink,
  public.working_hours_between(q.asked_at, now()) AS age_working_hours
FROM q
LEFT JOIN public.clients c ON c.id = q.client_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.context_items r
  WHERE r.source = 'slack'
    AND r.metadata->>'channel_id' = q.channel_id
    AND (r.metadata->>'is_cpm_author')::boolean IS TRUE
    AND r.occurred_at > q.asked_at
    AND (
      -- threaded question: only a reply in the same thread clears it
      (q.thread_ts IS NOT NULL
        AND COALESCE(r.metadata->>'thread_ts', r.metadata->>'slack_ts') = q.thread_root_ts)
      -- unthreaded question: any later CPM message in the channel clears it
      OR q.thread_ts IS NULL
    )
)
AND public.working_hours_between(q.asked_at, now()) >= 4;

GRANT SELECT ON public.slack_unanswered_client_questions TO authenticated;