ALTER TABLE public.moja_calls
  ADD COLUMN IF NOT EXISTS reported_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS reported_inbound_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS duration_semantics text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS connected_unknown_reason text,
  ADD COLUMN IF NOT EXISTS custom_tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS wbraid text,
  ADD COLUMN IF NOT EXISTS gbraid text,
  ADD COLUMN IF NOT EXISTS msclkid text;

ALTER TABLE public.moja_calls ALTER COLUMN connected DROP NOT NULL;
ALTER TABLE public.moja_calls ALTER COLUMN connected DROP DEFAULT;

COMMENT ON COLUMN public.moja_calls.reported_duration_seconds IS
  'Moja [DURATION] exactly as delivered. Moja describes it as CONNECTED duration; unconfirmed. Never re-interpreted.';
COMMENT ON COLUMN public.moja_calls.reported_inbound_duration_seconds IS
  'Moja [INBOUND_DURATION] exactly as delivered. May or may not include ring time; unconfirmed.';
COMMENT ON COLUMN public.moja_calls.duration_semantics IS
  'Which reported duration governs the billable definition: unknown | duration | inbound_duration. UNKNOWN blocks billable count, cost per billable call, billable rate and every threshold derived from them.';
COMMENT ON COLUMN public.moja_calls.connected IS
  'NULL means the connection state was not reported. Derived from the answered field only — never from a duration, because which duration includes ring time is unconfirmed.';
COMMENT ON COLUMN public.moja_calls.connected_unknown_reason IS
  'Named reason connected is NULL. An unknown connection state must read as unknown, never as false.';
COMMENT ON COLUMN public.moja_calls.custom_tags IS
  'Every delivered field the receiver does not map to a column, kept intact so custom tags (click IDs, extra UTMs) flow through without a code change.';

INSERT INTO public.media_brain_economics (
  client_id, vertical_id, tracking_platform, payout_mode, revenue_source,
  payout, billable_min_duration_seconds, attributed_publishers, unknown_fields,
  billable_filters, known_problems, last_reviewed_at
)
SELECT
  '4b2434db-6d47-4653-be34-313976790f9d'::uuid, NULL, 'moja', 'static', 'platform',
  NULL, NULL, NULL,
  ARRAY['billable_duration_field','billable_min_duration_seconds','payout','attributed_publishers']::text[],
  jsonb_build_object(
    'duration_semantics', 'unknown',
    'duration_semantics_note', 'Moja describes [DURATION] as connected duration and [INBOUND_DURATION] as inbound duration; which one the buyer''s billable threshold applies to is unconfirmed.',
    'flags', jsonb_build_array(
      'which duration governs the billable definition is UNKNOWN — blocks billable count, cost per billable call, billable rate and every threshold derived from them',
      'no click-level key in the Moja feed (no gclid/fbclid macros, utm_source only) — ad-level attribution unavailable, campaign level is the ceiling'
    )
  ),
  'Moja delivers no click ID and only utm_source among the UTM macros. Attribution ceiling is campaign level until custom tags carry a click key.',
  CURRENT_DATE
WHERE NOT EXISTS (
  SELECT 1 FROM public.media_brain_economics
  WHERE client_id = '4b2434db-6d47-4653-be34-313976790f9d'::uuid AND vertical_id IS NULL
);