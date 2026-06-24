
ALTER TABLE public.creative_briefs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.creative_time_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS creative_briefs_deleted_at_idx ON public.creative_briefs(deleted_at);
CREATE INDEX IF NOT EXISTS creative_time_entries_deleted_at_idx ON public.creative_time_entries(deleted_at);
