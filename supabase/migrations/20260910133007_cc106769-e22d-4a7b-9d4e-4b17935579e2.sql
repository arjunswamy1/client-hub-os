CREATE TABLE public.universal_ads_geo_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  entity TEXT NOT NULL,
  entity_name TEXT NOT NULL DEFAULT 'Unknown',
  campaign_name TEXT,
  creative_name TEXT,
  spend NUMERIC NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX universal_ads_geo_metrics_key
  ON public.universal_ads_geo_metrics (client_id, date, entity, entity_name, campaign_name, creative_name) NULLS NOT DISTINCT;
CREATE INDEX universal_ads_geo_metrics_client_date ON public.universal_ads_geo_metrics (client_id, date);

GRANT SELECT ON public.universal_ads_geo_metrics TO authenticated;
GRANT ALL ON public.universal_ads_geo_metrics TO service_role;
ALTER TABLE public.universal_ads_geo_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view universal geo for their clients"
ON public.universal_ads_geo_metrics FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id));

CREATE TRIGGER trg_universal_ads_geo_metrics_updated
BEFORE UPDATE ON public.universal_ads_geo_metrics
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.universal_ads_report_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  scheduled_report_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  rows_written INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX universal_ads_report_jobs_report_id ON public.universal_ads_report_jobs (scheduled_report_id);

GRANT SELECT ON public.universal_ads_report_jobs TO authenticated;
GRANT ALL ON public.universal_ads_report_jobs TO service_role;
ALTER TABLE public.universal_ads_report_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view universal report jobs for their clients"
ON public.universal_ads_report_jobs FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()) OR public.has_client_access(auth.uid(), client_id));

CREATE TRIGGER trg_universal_ads_report_jobs_updated
BEFORE UPDATE ON public.universal_ads_report_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();