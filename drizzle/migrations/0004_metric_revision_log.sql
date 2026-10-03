CREATE TABLE IF NOT EXISTS public.metric_revision_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  metric_date date NOT NULL,
  source text NOT NULL,
  spend numeric,
  revenue numeric,
  calls integer,
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS metric_revision_log_lookup
  ON public.metric_revision_log (client_id, metric_date, source, observed_at DESC);

GRANT SELECT ON public.metric_revision_log TO authenticated;
GRANT ALL ON public.metric_revision_log TO service_role;
ALTER TABLE public.metric_revision_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and AMs read metric revisions" ON public.metric_revision_log
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_account_manager(auth.uid()));

-- Append-only: refuse UPDATE and DELETE outright, even from the service role.
CREATE OR REPLACE FUNCTION public.metric_revision_log_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'metric_revision_log is append-only: % refused', TG_OP;
END $$;
DROP TRIGGER IF EXISTS metric_revision_log_no_mutation ON public.metric_revision_log;
CREATE TRIGGER metric_revision_log_no_mutation
  BEFORE UPDATE OR DELETE ON public.metric_revision_log
  FOR EACH ROW EXECUTE FUNCTION public.metric_revision_log_append_only();
COMMENT ON TABLE public.metric_revision_log IS 'Append-only observations of a day''s totals per sync run; used to detect provisional (still settling) days.';