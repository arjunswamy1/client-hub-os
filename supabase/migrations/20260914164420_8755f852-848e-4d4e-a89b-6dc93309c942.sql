ALTER TABLE public.media_brain_instances
  ADD COLUMN IF NOT EXISTS meta_conversion_event_confirmed_by text,
  ADD COLUMN IF NOT EXISTS meta_conversion_event_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS unknown_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS unknown_blocks jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.media_brain_instances.meta_conversion_event IS
  'The SINGLE governing conversion event. Every Media Brain conversion figure is filtered to this event, read from media_brain_platform_conversions. Never a sum of event names, and never the raw conversions column on the ad tables. NULL = UNKNOWN.';
COMMENT ON COLUMN public.media_brain_instances.unknown_fields IS
  'Fields explicitly declared UNKNOWN on this instance. An UNKNOWN must name what it blocks — see unknown_blocks.';
COMMENT ON COLUMN public.media_brain_instances.unknown_blocks IS
  'field name -> plain sentence naming the outputs that UNKNOWN blocks (Decision Engine §1).';