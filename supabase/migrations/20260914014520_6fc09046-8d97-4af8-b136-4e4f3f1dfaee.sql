ALTER TABLE public.ringba_calls
  ADD COLUMN IF NOT EXISTS did text,
  ADD COLUMN IF NOT EXISTS did_pool_name text,
  ADD COLUMN IF NOT EXISTS is_from_number_pool boolean,
  ADD COLUMN IF NOT EXISTS has_payout boolean,
  ADD COLUMN IF NOT EXISTS no_payout_reason text;

COMMENT ON COLUMN public.ringba_calls.inbound_number IS
  'MISNAMED FOR HISTORICAL REASONS: this is the CALLER''s number (Ringba `inboundPhoneNumber`, titled "Caller ID" in the call-log column menu), NOT the tracking number the caller dialed. On BuyologyIQ it equals caller_number on ~96.6% of rows. Never use it as a DID for attribution — use ringba_calls.did.';

COMMENT ON COLUMN public.ringba_calls.did IS
  'The tracking number the caller DIALED (Ringba `tag:DialedNumber:Number`, falling back to the `number` column). This is the DID that joins to client_dids / client_did_periods. Null where Ringba returned no dialed number for the call.';

COMMENT ON COLUMN public.ringba_calls.did_pool_name IS 'Ringba `numberPoolName` — the number pool the dialed number came from, where one applies.';
COMMENT ON COLUMN public.ringba_calls.is_from_number_pool IS 'Ringba `isFromNumberPool` — whether the dialed number was drawn from a pool rather than being a fixed DID.';
COMMENT ON COLUMN public.ringba_calls.has_payout IS 'Ringba `hasPayout` — whether Ringba considers the call to have earned a payout, independent of the payout amount stored in `payout`.';
COMMENT ON COLUMN public.ringba_calls.no_payout_reason IS 'Ringba `noPayoutReason` — Ringba''s own stated reason a call earned nothing. The authoritative source for separating real zero-payout calls from sub-dollar telco-cost rows.';