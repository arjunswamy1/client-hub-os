CREATE TABLE public.client_slack_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scope text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  slack_channel_id text,
  slack_channel_name text,
  day_of_week smallint NOT NULL DEFAULT 1,
  run_hour_utc smallint NOT NULL DEFAULT 13,
  notes text,
  last_sent_at timestamptz,
  last_period_key text,
  last_error text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, scope)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_slack_reports TO authenticated;
GRANT ALL ON public.client_slack_reports TO service_role;

ALTER TABLE public.client_slack_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can manage slack report schedules"
ON public.client_slack_reports FOR ALL TO authenticated
USING (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id))
WITH CHECK (is_admin(auth.uid()) OR has_client_access(auth.uid(), client_id));

CREATE TRIGGER update_client_slack_reports_updated_at
BEFORE UPDATE ON public.client_slack_reports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();