
ALTER TABLE public.creative_briefs 
  ADD COLUMN IF NOT EXISTS estimated_hours numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS scheduled_date date DEFAULT NULL,
  ALTER COLUMN client_id DROP NOT NULL;
