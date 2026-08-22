CREATE TABLE public.roku_daily_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  account_uid TEXT NOT NULL,
  date DATE NOT NULL,
  entity TEXT NOT NULL DEFAULT 'campaign',
  entity_uid TEXT NOT NULL,
  entity_name TEXT,
  campaign_uid TEXT,
  campaign_name TEXT,
  spend NUMERIC NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  video_completions BIGINT NOT NULL DEFAULT 0,
  reach BIGINT NOT NULL DEFAULT 0,
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX roku_daily_metrics_unique_idx
  ON public.roku_daily_metrics (client_id, account_uid, entity, entity_uid, date);
CREATE INDEX roku_daily_metrics_client_date_idx
  ON public.roku_daily_metrics (client_id, date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roku_daily_metrics TO authenticated;
GRANT ALL ON public.roku_daily_metrics TO service_role;

ALTER TABLE public.roku_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage roku metrics"
  ON public.roku_daily_metrics FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Assigned team can view roku metrics"
  ON public.roku_daily_metrics FOR SELECT TO authenticated
  USING (public.has_client_access(auth.uid(), client_id));

CREATE TRIGGER trg_roku_daily_metrics_updated
  BEFORE UPDATE ON public.roku_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();