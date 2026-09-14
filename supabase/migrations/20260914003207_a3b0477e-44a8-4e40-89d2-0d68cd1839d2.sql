ALTER TABLE public.media_brain_instances
  ADD COLUMN IF NOT EXISTS meta_conversion_event text,
  ADD COLUMN IF NOT EXISTS expected_meta_events_per_week numeric;

COMMENT ON COLUMN public.media_brain_instances.meta_conversion_event IS
  'The event this account''s Meta ad sets optimise toward (e.g. call initiated, call connected, CAPI qualified call). The fragmentation check counts THIS event, never billable calls. Null = UNKNOWN, which blocks the check.';
COMMENT ON COLUMN public.media_brain_instances.expected_meta_events_per_week IS
  'Expected weekly count of meta_conversion_event. Numerator of the fragmentation check. Null = UNKNOWN, which blocks the check.';