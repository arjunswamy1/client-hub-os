
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  company_name text NOT NULL,
  monthly_ad_spend text,
  user_id uuid,
  source text NOT NULL DEFAULT 'demo_funnel',
  status text NOT NULL DEFAULT 'new',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all leads"
  ON public.leads FOR ALL TO authenticated
  USING (is_admin(auth.uid()));

CREATE POLICY "Users can view own lead record"
  ON public.leads FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
