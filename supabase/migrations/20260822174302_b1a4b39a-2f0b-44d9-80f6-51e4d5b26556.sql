CREATE TABLE public.jacuzzi_reconciliation_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date date NOT NULL,
  applied_rate numeric NOT NULL DEFAULT 0,
  rate_effective_from date,
  leads_total integer NOT NULL DEFAULT 0,
  call_leads integer NOT NULL DEFAULT 0,
  qr_leads integer NOT NULL DEFAULT 0,
  ringfuel_calls integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  unmatched_leads integer NOT NULL DEFAULT 0,
  unmatched_calls integer NOT NULL DEFAULT 0,
  station_mismatches integer NOT NULL DEFAULT 0,
  rate_mismatches integer NOT NULL DEFAULT 0,
  expected_revenue numeric NOT NULL DEFAULT 0,
  by_station jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, date)
);

CREATE TABLE public.jacuzzi_reconciliation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date date NOT NULL,
  status text NOT NULL,
  match_method text,
  lead_id uuid,
  transaction_id text,
  lead_type text,
  lead_station text,
  ringfuel_call_id text,
  ringfuel_did text,
  ringfuel_station text,
  caller_number text,
  station_agrees boolean,
  lead_payout_rate numeric,
  expected_rate numeric,
  rate_agrees boolean,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jac_recon_matches_client_date ON public.jacuzzi_reconciliation_matches (client_id, date);

GRANT SELECT ON public.jacuzzi_reconciliation_daily TO authenticated;
GRANT ALL ON public.jacuzzi_reconciliation_daily TO service_role;
GRANT SELECT ON public.jacuzzi_reconciliation_matches TO authenticated;
GRANT ALL ON public.jacuzzi_reconciliation_matches TO service_role;

ALTER TABLE public.jacuzzi_reconciliation_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jacuzzi_reconciliation_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view jacuzzi recon daily" ON public.jacuzzi_reconciliation_daily
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id));

CREATE POLICY "Team can view jacuzzi recon matches" ON public.jacuzzi_reconciliation_matches
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id));

CREATE TRIGGER trg_jac_recon_daily_updated BEFORE UPDATE ON public.jacuzzi_reconciliation_daily
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();