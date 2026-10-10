CREATE TABLE public.ringfuel_revenue_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  call_id text NOT NULL,
  revenue numeric NOT NULL,
  converted boolean NOT NULL,
  source text NOT NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, call_id, source)
);
COMMENT ON TABLE public.ringfuel_revenue_corrections IS 'Audit trail of revenue corrections applied to ringfuel_calls from a RingFuel export, approved by a person.';
GRANT SELECT ON public.ringfuel_revenue_corrections TO authenticated;
GRANT ALL ON public.ringfuel_revenue_corrections TO service_role;
ALTER TABLE public.ringfuel_revenue_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read revenue corrections" ON public.ringfuel_revenue_corrections FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));