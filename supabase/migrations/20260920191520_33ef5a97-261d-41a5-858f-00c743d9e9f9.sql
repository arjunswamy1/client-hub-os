-- 1. Capture flags (additive only)
ALTER TABLE public.ringfuel_calls
  ADD COLUMN IF NOT EXISTS revenue_captured boolean,
  ADD COLUMN IF NOT EXISTS conversion_captured boolean,
  ADD COLUMN IF NOT EXISTS payload_shape text;

ALTER TABLE public.ringfuel_calls
  DROP CONSTRAINT IF EXISTS ringfuel_calls_payload_shape_check;
ALTER TABLE public.ringfuel_calls
  ADD CONSTRAINT ringfuel_calls_payload_shape_check
  CHECK (payload_shape IS NULL OR payload_shape IN ('csv_full', 'webhook_minimal'));

-- Backfill: rows whose raw payload carries a Revenue field are fully captured.
UPDATE public.ringfuel_calls
SET revenue_captured = true, conversion_captured = true, payload_shape = 'csv_full'
WHERE payload_shape IS DISTINCT FROM 'csv_full'
  AND raw_payload::text LIKE '%"Revenue"%';

UPDATE public.ringfuel_calls
SET revenue_captured = false, conversion_captured = false, payload_shape = 'webhook_minimal'
WHERE payload_shape IS NULL
  AND (raw_payload IS NULL OR raw_payload::text NOT LIKE '%"Revenue"%');

CREATE INDEX IF NOT EXISTS ringfuel_calls_client_capture_idx
  ON public.ringfuel_calls (client_id, revenue_captured);

-- 2. Spektrafin economics, as confirmed. Revenue is the platform's own revenue
--    field ($16 per CONVERTED call, $23 before 2026-09-09); payout is ignored.
--    billable_min_duration_seconds = 0 states deliberately that duration is NOT
--    part of the billable definition here: conversion is a buyer-side decision
--    and any duration rule would fabricate revenue.
INSERT INTO public.media_brain_economics (
  client_id, vertical, vertical_id, platforms, tracking_platform,
  payout_mode, payout, revenue_source, min_payout_threshold,
  billable_min_duration_seconds, billable_filters,
  funnel_type, reporting_cadence, campaign_state, routing_mode,
  known_problems, existing_structure_notes, unknown_fields, last_reviewed_at
) VALUES (
  '6386d309-519a-415d-9480-70c9c6d64436',
  'Spektrafin — Roku performance media', NULL,
  ARRAY['roku'], 'ringfuel',
  'static', 16, 'platform', 1.00,
  0,
  '{"definition":"converted = true AND revenue >= 1.00","duration_used":false,"reason":"Conversion is a buyer-side decision; converted and non-converted calls overlap completely on duration (0 to 4000+ seconds), so no duration rule may stand in for it."}'::jsonb,
  'click_to_call', 'daily', 'existing', 'static',
  'Revenue sits in the revenue column, not payout ($5.00 total across all calls) — payout must be ignored for this account. Webhook-era rows (from 2026-09-15) carry only state/payout/call_id/duration, so revenue and conversion are NOT CAPTURED on those rows; absent is not zero.',
  'CPM buys the Roku media directly, so profit = RingFuel revenue - Roku spend and downside is capped at media spend. Payout per converted call was $23 until 2026-09-09 and $16 from then on.',
  ARRAY[]::text[], CURRENT_DATE
)
ON CONFLICT DO NOTHING;