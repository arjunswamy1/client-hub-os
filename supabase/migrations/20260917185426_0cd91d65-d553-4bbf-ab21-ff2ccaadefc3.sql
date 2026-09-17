CREATE TABLE IF NOT EXISTS public.slack_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  parent_occurred_at timestamptz NOT NULL,
  last_reply_ts text,
  last_polled_at timestamptz,
  has_unanswered_question boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, thread_ts)
);

GRANT SELECT ON public.slack_threads TO authenticated;
GRANT ALL ON public.slack_threads TO service_role;

ALTER TABLE public.slack_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view slack threads"
  ON public.slack_threads FOR SELECT TO authenticated
  USING (public.get_team_member_id(auth.uid()) IS NOT NULL);

CREATE TRIGGER trg_slack_threads_updated
  BEFORE UPDATE ON public.slack_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS slack_threads_open_idx
  ON public.slack_threads (channel_id, parent_occurred_at DESC);

-- Archived Billy.com channels: cursors are from April 2026, so a run would pull
-- five months of an archived account. Reading stays opt-in per channel.
UPDATE public.slack_channel_mappings
SET sync_enabled = false, updated_at = now()
WHERE channel_name LIKE 'in_billy%';

-- Bound the unanswered list in time so it cannot accumulate forever.
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
    AND ci.occurred_at >= now() - interval '30 days'
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
      (q.thread_ts IS NOT NULL
        AND COALESCE(r.metadata->>'thread_ts', r.metadata->>'slack_ts') = q.thread_root_ts)
      OR q.thread_ts IS NULL
    )
)
AND public.working_hours_between(q.asked_at, now()) >= 4;

GRANT SELECT ON public.slack_unanswered_client_questions TO authenticated;