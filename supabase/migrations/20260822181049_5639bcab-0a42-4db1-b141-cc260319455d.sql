CREATE TABLE public.moja_calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  event_type TEXT,
  service_line TEXT NOT NULL DEFAULT 'unassigned',
  platform TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  publisher_name TEXT,
  target_name TEXT,
  buyer_name TEXT,
  tracking_number TEXT,
  caller_number TEXT,
  caller_state TEXT,
  caller_zip TEXT,
  call_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  converted_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  inbound_duration_seconds INTEGER NOT NULL DEFAULT 0,
  connected BOOLEAN NOT NULL DEFAULT false,
  converted BOOLEAN NOT NULL DEFAULT false,
  revenue NUMERIC NOT NULL DEFAULT 0,
  payout NUMERIC NOT NULL DEFAULT 0,
  disposition TEXT,
  recording_url TEXT,
  utm_source TEXT,
  utm_campaign TEXT,
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT moja_calls_client_call_unique UNIQUE (client_id, call_id)
);

CREATE INDEX idx_moja_calls_client_start ON public.moja_calls (client_id, call_start DESC);
CREATE INDEX idx_moja_calls_service_line ON public.moja_calls (client_id, service_line);

GRANT SELECT ON public.moja_calls TO authenticated;
GRANT ALL ON public.moja_calls TO service_role;

ALTER TABLE public.moja_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "moja_calls_admin_all" ON public.moja_calls FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "moja_calls_team_read" ON public.moja_calls FOR SELECT TO authenticated
USING (public.has_client_access(auth.uid(), client_id));

CREATE TRIGGER trg_moja_calls_updated BEFORE UPDATE ON public.moja_calls
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();