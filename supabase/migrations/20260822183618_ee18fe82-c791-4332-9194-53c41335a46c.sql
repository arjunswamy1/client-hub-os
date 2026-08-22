ALTER TABLE public.moja_calls
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS utm_content text;

CREATE INDEX IF NOT EXISTS moja_calls_utm_term_idx ON public.moja_calls (client_id, utm_term);
CREATE INDEX IF NOT EXISTS moja_calls_utm_content_idx ON public.moja_calls (client_id, utm_content);