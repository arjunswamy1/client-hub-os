ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS company_revenue text,
  ADD COLUMN IF NOT EXISTS num_hub_users text,
  ADD COLUMN IF NOT EXISTS use_cases text[] DEFAULT '{}'::text[];