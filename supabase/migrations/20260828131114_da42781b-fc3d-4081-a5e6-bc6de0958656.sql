CREATE TABLE public.tech_external_projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name TEXT NOT NULL UNIQUE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tech_external_projects TO authenticated;
GRANT ALL ON public.tech_external_projects TO service_role;
ALTER TABLE public.tech_external_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage external projects" ON public.tech_external_projects
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_tech_external_projects_updated
  BEFORE UPDATE ON public.tech_external_projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.tech_credit_allocations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_name TEXT NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  credits NUMERIC NOT NULL DEFAULT 0,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tech_credit_allocations_date ON public.tech_credit_allocations(date);
CREATE INDEX idx_tech_credit_allocations_client ON public.tech_credit_allocations(client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tech_credit_allocations TO authenticated;
GRANT ALL ON public.tech_credit_allocations TO service_role;
ALTER TABLE public.tech_credit_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage credit allocations" ON public.tech_credit_allocations
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_tech_credit_allocations_updated
  BEFORE UPDATE ON public.tech_credit_allocations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.tech_external_projects (project_name, client_id, notes)
SELECT 'MiiCloud', c.id, 'Lovable workspace project billed to Cannaball'
FROM public.clients c WHERE c.name ILIKE 'cannaball%' LIMIT 1;

INSERT INTO public.tech_external_projects (project_name, client_id, notes)
SELECT 'Easy Bath Renovation', c.id, 'Lovable workspace project billed to BuyologyIQ'
FROM public.clients c WHERE c.name ILIKE 'buyology%' LIMIT 1;