ALTER TABLE public.cannaball_calls
  ADD COLUMN IF NOT EXISTS caller_zip text,
  ADD COLUMN IF NOT EXISTS caller_area_code text;

UPDATE public.cannaball_calls SET
  caller_state = COALESCE(caller_state, NULLIF(raw_payload->>'InboundStateCode',''), NULLIF(raw_payload->>'InboundState','')),
  caller_city = COALESCE(caller_city, NULLIF(raw_payload->>'InboundCity','')),
  caller_zip = COALESCE(caller_zip, NULLIF(raw_payload->>'InboundZipCode','')),
  caller_area_code = COALESCE(caller_area_code, NULLIF(raw_payload->>'InboundAreaCode',''))
WHERE raw_payload IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cannaball_calls_zip ON public.cannaball_calls(client_id, caller_zip);