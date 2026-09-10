CREATE TABLE public.client_did_periods (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  did TEXT NOT NULL,
  did_formatted TEXT,
  creative_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'roku',
  campaign_name TEXT,
  effective_from DATE NOT NULL,
  effective_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX client_did_periods_unique ON public.client_did_periods (client_id, did, effective_from);
CREATE INDEX client_did_periods_lookup ON public.client_did_periods (client_id, did, effective_from, effective_to);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_did_periods TO authenticated;
GRANT ALL ON public.client_did_periods TO service_role;

ALTER TABLE public.client_did_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "did_periods_select" ON public.client_did_periods FOR SELECT TO authenticated
  USING (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id));
CREATE POLICY "did_periods_insert" ON public.client_did_periods FOR INSERT TO authenticated
  WITH CHECK (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id));
CREATE POLICY "did_periods_update" ON public.client_did_periods FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id));
CREATE POLICY "did_periods_delete" ON public.client_did_periods FOR DELETE TO authenticated
  USING (is_admin(auth.uid()));

CREATE TRIGGER trg_client_did_periods_updated BEFORE UPDATE ON public.client_did_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.cannaball_calls ADD COLUMN IF NOT EXISTS platform TEXT;