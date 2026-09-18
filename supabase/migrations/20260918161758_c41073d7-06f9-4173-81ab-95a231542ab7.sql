ALTER TABLE public.client_daily_updates
  ADD COLUMN IF NOT EXISTS am_notes text;

COMMENT ON COLUMN public.client_daily_updates.am_notes IS
  'Internal-only notes for the account lead: data gaps, source systems, campaigns at zero. Never part of the client-facing draft.';