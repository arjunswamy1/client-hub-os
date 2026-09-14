ALTER TABLE public.media_brain_economics
  ADD COLUMN IF NOT EXISTS attributed_publishers text[];

COMMENT ON COLUMN public.media_brain_economics.attributed_publishers IS
  'The traffic sources (Ringba publishers) whose calls belong to this client''s media buying. Every metric, verdict, vertical read and coverage figure filters on it. NULL or empty stops the pull — there is no "all publishers" default, because that default attributes other buyers'' calls to our spend.';