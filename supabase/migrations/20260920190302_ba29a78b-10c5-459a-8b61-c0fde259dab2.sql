ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS objective text,
  ADD COLUMN IF NOT EXISTS bid_strategy text,
  ADD COLUMN IF NOT EXISTS lifetime_budget numeric;

ALTER TABLE public.ad_sets
  ADD COLUMN IF NOT EXISTS bid_strategy text,
  ADD COLUMN IF NOT EXISTS bid_amount numeric,
  ADD COLUMN IF NOT EXISTS billing_event text,
  ADD COLUMN IF NOT EXISTS optimization_goal text,
  ADD COLUMN IF NOT EXISTS daily_budget numeric,
  ADD COLUMN IF NOT EXISTS lifetime_budget numeric,
  ADD COLUMN IF NOT EXISTS targeting jsonb,
  ADD COLUMN IF NOT EXISTS promoted_object jsonb,
  ADD COLUMN IF NOT EXISTS audience_summary text,
  ADD COLUMN IF NOT EXISTS reach bigint,
  ADD COLUMN IF NOT EXISTS frequency numeric;