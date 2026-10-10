ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS spend_source_platforms jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.clients.spend_source_platforms IS 'Per spend table, the platform labels the hub may count from it, e.g. {"cannaball_spend":["universal_ads"]}. Absent table = all rows. Prevents counting a platform mirrored into two spend tables twice.';
ALTER TABLE public.client_scope_events ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.client_scope_events ADD COLUMN IF NOT EXISTS detected_key text;
CREATE UNIQUE INDEX IF NOT EXISTS client_scope_events_detected_key_uq ON public.client_scope_events (detected_key) WHERE detected_key IS NOT NULL;