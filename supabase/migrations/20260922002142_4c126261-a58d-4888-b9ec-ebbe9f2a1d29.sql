CREATE TABLE public.roku_hourly_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date date NOT NULL,
  hour smallint NOT NULL CHECK (hour >= 0 AND hour <= 23),
  campaign_uid text NOT NULL DEFAULT '',
  campaign_name text,
  impressions bigint NOT NULL DEFAULT 0,
  spend numeric NOT NULL DEFAULT 0,
  video_completions bigint NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'roku_api',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, date, hour, campaign_uid)
);

CREATE INDEX roku_hourly_metrics_client_date_idx ON public.roku_hourly_metrics (client_id, date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roku_hourly_metrics TO authenticated;
GRANT ALL ON public.roku_hourly_metrics TO service_role;

ALTER TABLE public.roku_hourly_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roku_hourly_admin_all" ON public.roku_hourly_metrics
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "roku_hourly_team_read" ON public.roku_hourly_metrics
  FOR SELECT TO authenticated
  USING (has_client_access(auth.uid(), client_id));

CREATE TRIGGER trg_roku_hourly_updated
  BEFORE UPDATE ON public.roku_hourly_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();