ALTER TABLE public.moja_calls
  ADD COLUMN IF NOT EXISTS forwarded_number text,
  ADD COLUMN IF NOT EXISTS connected_source text,
  ADD COLUMN IF NOT EXISTS answered boolean,
  ADD COLUMN IF NOT EXISTS hangup_cause text,
  ADD COLUMN IF NOT EXISTS number_pool text,
  ADD COLUMN IF NOT EXISTS no_payout_reason text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS gclid text,
  ADD COLUMN IF NOT EXISTS fbclid text,
  ADD COLUMN IF NOT EXISTS is_test_delivery boolean NOT NULL DEFAULT false;

ALTER TABLE public.moja_calls ALTER COLUMN call_start DROP NOT NULL;

COMMENT ON COLUMN public.moja_calls.payout IS 'Publisher-paid amount — this is CPM revenue. Never conflate with revenue.';
COMMENT ON COLUMN public.moja_calls.revenue IS 'Buyer-paid amount, informational only. Not CPM revenue.';
COMMENT ON COLUMN public.moja_calls.connected_source IS 'answered_field | inbound_duration | unknown — a reported connected and a derived one are not the same evidence.';
COMMENT ON COLUMN public.moja_calls.is_test_delivery IS 'True for provider test fires; excluded from every read and margin figure.';

CREATE UNIQUE INDEX IF NOT EXISTS moja_calls_client_call_id_key ON public.moja_calls (client_id, call_id);