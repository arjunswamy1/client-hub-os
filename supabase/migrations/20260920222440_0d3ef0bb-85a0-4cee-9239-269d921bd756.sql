-- WHY: engagement_type alone chose the money column, so Cannaball (performance_media)
-- was told to read `revenue` — a column its call feed does not even have — and every
-- call read as revenue-unknown while the dashboard correctly showed profit from
-- `payout`. The deciding field is an account fact, so it is recorded per account and
-- the engagement type remains the default when this is blank.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS revenue_field text
  CHECK (revenue_field IN ('revenue', 'payout'));

COMMENT ON COLUMN public.clients.revenue_field IS
  'Which call column is CPM''s income on this account. NULL = derive it from engagement_type (performance_media -> revenue, pay_per_call -> payout). Set it only where the feed disagrees with that default.';

UPDATE public.clients
   SET revenue_field = 'payout'
 WHERE slug = 'cannaball';