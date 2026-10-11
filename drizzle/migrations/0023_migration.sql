ALTER TABLE public.ringfuel_calls
  ADD COLUMN IF NOT EXISTS end_reason text GENERATED ALWAYS AS (nullif(coalesce(raw_payload->>'End Reason', raw_payload->>'end_reason'), '')) STORED,
  ADD COLUMN IF NOT EXISTS end_call_source text GENERATED ALWAYS AS (nullif(coalesce(raw_payload->>'End Call Source', raw_payload->>'end_call_source'), '')) STORED,
  ADD COLUMN IF NOT EXISTS revenue_reconciled boolean GENERATED ALWAYS AS (raw_payload ? '_import_source') STORED;
COMMENT ON COLUMN public.ringfuel_calls.end_reason IS 'Derived from raw_payload; null = source did not send an end reason (strict connected unknown).';
COMMENT ON COLUMN public.ringfuel_calls.revenue_reconciled IS 'True once a RingFuel export/reconciliation merged this call; webhook-only revenue stays provisional.';