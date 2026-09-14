CREATE TABLE public.media_brain_sync_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('ringba','moja','meta','google','roku','callgrid')),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  last_attempted_at timestamptz,
  last_succeeded_at timestamptz,
  rows_written integer,
  status text NOT NULL CHECK (status IN ('ok','error','stale','never_run')),
  error text,
  token_status text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, client_id)
);

COMMENT ON TABLE public.media_brain_sync_status IS 'Per-source delivery health. never_run means nothing has EVER arrived; stale means deliveries stopped. Different problems, different fixes — never conflate them.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_brain_sync_status TO authenticated;
GRANT ALL ON public.media_brain_sync_status TO service_role;

ALTER TABLE public.media_brain_sync_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all media brain sync status"
ON public.media_brain_sync_status FOR ALL TO authenticated
USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Team members access assigned client media brain sync status"
ON public.media_brain_sync_status FOR ALL TO authenticated
USING (has_client_access(auth.uid(), client_id)) WITH CHECK (has_client_access(auth.uid(), client_id));

CREATE TRIGGER update_media_brain_sync_status_updated_at
BEFORE UPDATE ON public.media_brain_sync_status
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();