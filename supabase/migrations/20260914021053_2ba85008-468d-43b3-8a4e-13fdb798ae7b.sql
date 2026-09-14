ALTER TABLE public.media_brain_economics
  ADD COLUMN IF NOT EXISTS vertical_id text,
  ADD COLUMN IF NOT EXISTS revenue_source text NOT NULL DEFAULT 'platform',
  ADD COLUMN IF NOT EXISTS min_payout_threshold numeric NOT NULL DEFAULT 1.00;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_brain_economics_revenue_source_check'
  ) THEN
    ALTER TABLE public.media_brain_economics
      ADD CONSTRAINT media_brain_economics_revenue_source_check
      CHECK (revenue_source IN ('platform','computed'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS media_brain_economics_client_vertical_uniq
  ON public.media_brain_economics (client_id, vertical_id)
  WHERE vertical_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS media_brain_economics_client_default_uniq
  ON public.media_brain_economics (client_id)
  WHERE vertical_id IS NULL;

COMMENT ON COLUMN public.media_brain_economics.vertical_id IS
  'client_verticals.vertical_id this economics record governs. NULL = the client-level default.';
COMMENT ON COLUMN public.media_brain_economics.revenue_source IS
  'platform = revenue is the sum of payouts the tracking platform reports, and billable means payout >= min_payout_threshold. computed = the platform payout field is not visible to us, so billable is duration alone and revenue is payout x billable count. A payout field we cannot see is a declared data limitation, never a believed zero.';
COMMENT ON COLUMN public.media_brain_economics.min_payout_threshold IS
  'Smallest payout that counts as revenue. Below it a non-zero payout is treated as telco cost recorded in the payout field, not as revenue.';