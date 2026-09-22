CREATE TABLE public.cannaball_daily_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL,
  date date NOT NULL,
  platform text NOT NULL,

  -- media (null = not landed / not available, never a substituted zero)
  spend numeric,
  impressions bigint,
  reach bigint,
  frequency numeric,
  cpm numeric,

  -- funnel
  attempts integer NOT NULL DEFAULT 0,
  connected integer NOT NULL DEFAULT 0,
  calls_over_10s integer NOT NULL DEFAULT 0,
  calls_over_60s integer NOT NULL DEFAULT 0,
  avg_connected_duration numeric,

  -- failure modes
  no_route integer NOT NULL DEFAULT 0,
  no_answer integer NOT NULL DEFAULT 0,
  connect_failed integer NOT NULL DEFAULT 0,
  busy integer NOT NULL DEFAULT 0,
  duplicates integer NOT NULL DEFAULT 0,
  anonymous_callers integer NOT NULL DEFAULT 0,
  distinct_callers integer,

  -- buyer layer
  buyer_accepted integer,
  buyer_rejected integer,
  buyer_acceptance_rate numeric,
  vendor_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- money
  revenue numeric,
  revenue_calls_captured integer NOT NULL DEFAULT 0,
  revenue_calls_uncaptured integer NOT NULL DEFAULT 0,
  profit numeric,
  roas numeric,
  roi numeric,
  cost_per_connected numeric,
  cost_per_10s numeric,
  cost_per_60s numeric,

  -- stage conversion
  connect_rate numeric,
  qualified_rate numeric,

  -- breakdowns
  state_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  did_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  geo_excluded_calls integer NOT NULL DEFAULT 0,

  -- provenance
  spend_complete boolean NOT NULL DEFAULT false,
  was_dark boolean NOT NULL DEFAULT false,
  anomalies_present boolean NOT NULL DEFAULT false,
  anomalies jsonb NOT NULL DEFAULT '[]'::jsonb,
  unavailable_metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cannaball_daily_metrics_date_platform_key UNIQUE (date, platform)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cannaball_daily_metrics TO authenticated;
GRANT ALL ON public.cannaball_daily_metrics TO service_role;

ALTER TABLE public.cannaball_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can read cannaball daily metrics"
  ON public.cannaball_daily_metrics FOR SELECT TO authenticated
  USING (public.get_team_member_id(auth.uid()) IS NOT NULL);

CREATE POLICY "Admins manage cannaball daily metrics"
  ON public.cannaball_daily_metrics FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX cannaball_daily_metrics_date_idx ON public.cannaball_daily_metrics (date DESC);

CREATE TRIGGER update_cannaball_daily_metrics_updated_at
  BEFORE UPDATE ON public.cannaball_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();