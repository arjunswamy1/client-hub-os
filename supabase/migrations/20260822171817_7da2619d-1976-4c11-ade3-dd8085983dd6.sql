CREATE TABLE public.ringfuel_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  event_type text,
  campaign_id text,
  campaign_name text,
  did text,
  caller_number text,
  caller_state text,
  caller_city text,
  creative_label text,
  call_start timestamptz NOT NULL DEFAULT now(),
  duration_seconds integer NOT NULL DEFAULT 0,
  connection_duration_seconds integer NOT NULL DEFAULT 0,
  connected boolean NOT NULL DEFAULT false,
  converted boolean NOT NULL DEFAULT false,
  payout numeric NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  disposition text,
  recording_url text,
  buyer_name text,
  target_name text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, call_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ringfuel_calls TO authenticated;
GRANT ALL ON public.ringfuel_calls TO service_role;

ALTER TABLE public.ringfuel_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to ringfuel_calls" ON public.ringfuel_calls
  FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Assigned team can view ringfuel_calls" ON public.ringfuel_calls
  FOR SELECT USING (has_client_access(auth.uid(), client_id));

CREATE INDEX idx_ringfuel_calls_client_start ON public.ringfuel_calls (client_id, call_start DESC);
CREATE INDEX idx_ringfuel_calls_did ON public.ringfuel_calls (did);

CREATE TRIGGER trg_ringfuel_calls_updated BEFORE UPDATE ON public.ringfuel_calls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();