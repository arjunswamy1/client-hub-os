
-- Cannaball calls (CallGrid webhook target)
CREATE TABLE public.cannaball_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  caller_number text,
  did text,
  caller_state text,
  caller_city text,
  call_start timestamptz NOT NULL,
  duration_seconds integer DEFAULT 0,
  connected boolean DEFAULT false,
  connection_duration_seconds integer DEFAULT 0,
  payout numeric(10,2) DEFAULT 0,
  disposition text,
  campaign_name text,
  creative_name text,
  recording_url text,
  raw_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, call_id)
);
CREATE INDEX idx_cannaball_calls_date ON public.cannaball_calls (client_id, call_start DESC);
CREATE INDEX idx_cannaball_calls_did ON public.cannaball_calls (did);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cannaball_calls TO authenticated;
GRANT ALL ON public.cannaball_calls TO service_role;

ALTER TABLE public.cannaball_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access cannaball_calls" ON public.cannaball_calls
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Assigned team members read cannaball_calls" ON public.cannaball_calls
  FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

-- Cannaball spend (Roku for now; ready for API)
CREATE TABLE public.cannaball_spend (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date date NOT NULL,
  platform text NOT NULL DEFAULT 'roku',
  campaign_name text,
  creative_name text,
  spend numeric(12,2) NOT NULL DEFAULT 0,
  impressions bigint DEFAULT 0,
  clicks bigint DEFAULT 0,
  raw jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, date, platform, campaign_name, creative_name)
);
CREATE INDEX idx_cannaball_spend_date ON public.cannaball_spend (client_id, date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cannaball_spend TO authenticated;
GRANT ALL ON public.cannaball_spend TO service_role;

ALTER TABLE public.cannaball_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access cannaball_spend" ON public.cannaball_spend
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Assigned team members read cannaball_spend" ON public.cannaball_spend
  FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE TRIGGER update_cannaball_spend_updated_at
  BEFORE UPDATE ON public.cannaball_spend
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
